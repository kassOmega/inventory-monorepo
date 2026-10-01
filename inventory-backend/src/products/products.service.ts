import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LocationType,
  Prisma,
  ProductKind,
  RequestItemStatus,
  RequestStatus,
  RequestType,
} from '@prisma/client';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import {
  PriceChange,
  newPriceBatchRef,
  recordPriceChanges,
} from '../common/price-history.util';
import { itemDisplayName } from '../common/variant-label.util';
import { getCurrentTenantId, requireTenantId } from '../common/tenant/tenant.context';
import { Paging, pagedResult } from '../common/pagination.util';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { tr } from '../i18n/i18n.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { AddVariantDto } from './dto/add-variant.dto';
import {
  BulkAdjustStockDto,
  BulkAdjustStockItemDto,
} from './dto/bulk-adjust-stock.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { inventorySet, inventoryUpsert } from '../common/inventory.util';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lower-cased attribute map used to compare variant rows: "Red " and "red" are
 * the same option, so two products that describe the same matrix group together.
 */
const normalizeAttributes = (attributes: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (attributes && typeof attributes === 'object') {
    for (const [key, value] of Object.entries(
      attributes as Record<string, unknown>,
    )) {
      if (value === null || value === undefined || value === '') continue;
      out[key.trim().toLowerCase()] = String(value).trim().toLowerCase();
    }
  }
  return out;
};

/**
 * A single row handed to the Variant Builder. Attributes come back exactly as
 * stored (the builder folds legacy size/color keys into its slots), and prices
 * plus the per-variant alert numbers ride along so the row is usable as-is.
 *
 * SKU, barcode and quantity are deliberately never suggested: variant SKUs are
 * generated per product, barcodes are unique per tenant, and quantity is this
 * product's own stock — not a copy of another product's.
 */
const toSuggestionRow = (v: any) => ({
  attributes: v.attributes ?? {},
  buyPrice: v.buyPrice ?? null,
  sellPrice: v.sellPrice ?? null,
  reorderLevel: v.reorderLevel ?? 0,
  reorderQty: v.reorderQty ?? null,
});

/** A validated count row, ready to be applied inside a transaction. */
interface AdjustTarget {
  index: number;
  product: {
    id: number;
    brand: string;
    baseName: string;
    hasVariants: boolean;
    currentBuyPrice: number | null;
    reorderLevel: number;
  };
  variant: {
    id: number;
    sku: string | null;
    attributes: unknown;
    reorderLevel: number;
  } | null;
  location: { id: number; name: string; type: LocationType };
  quantity: number;
  /** Selling price corrected while counting (null = leave it alone). */
  sellPrice?: number | null;
}

/**
 * A row that failed validation. `status` keeps the single-row endpoint's
 * historical HTTP status for that failure (404 product/location, 403 scope),
 * so a sheet can report the same reasons in bulk.
 */
interface AdjustRowError {
  index: number;
  productId?: number;
  variantId?: number | null;
  locationId?: number;
  message: string;
  status: number;
}

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private finance: FinanceService,
  ) {}

  /** Require buy/sell prices on every variant row being persisted. */
  private assertVariantPrices(variants: any[]) {
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!(Number(v.buyPrice) > 0) || !(Number(v.sellPrice) > 0)) {
        throw new BadRequestException(
          tr('errors.variantPricesRequired', { index: i + 1 }),
        );
      }
    }
  }

  /** Simple average of the variant buy/sell prices (parent row snapshot). */
  private averageVariantPrices(variants: any[]) {
    const n = variants.length;
    return {
      buyPrice: round2(
        variants.reduce((s, v) => s + Number(v.buyPrice), 0) / n,
      ),
      sellPrice: round2(
        variants.reduce((s, v) => s + Number(v.sellPrice), 0) / n,
      ),
    };
  }

  async create(dto: CreateProductDto, user: JwtPayload) {
    // Duplicate-entry guard: reject when the same brand + base name already exists.
    const existing = await this.prisma.product.findFirst({
      where: {
        brand: { equals: dto.brand, mode: 'insensitive' },
        baseName: { equals: dto.baseName, mode: 'insensitive' },
      },
      select: { id: true, brand: true, baseName: true },
    });
    if (existing) {
      throw new ConflictException(
        tr('errors.productDuplicate', {
          brand: existing.brand,
          name: existing.baseName,
        }),
      );
    }

    // Ingredients (raw food stock) must carry an explicit unit of measure and
    // category so recipes and inventory reports can compute amounts/values.
    const kind = dto.kind ?? ProductKind.GOODS;
    if (kind === ProductKind.INGREDIENT) {
      if (dto.unitId == null) {
        throw new BadRequestException(
          'Unit of measure is required for ingredient products (e.g. kg, L, g).',
        );
      }
      if (dto.categoryId == null) {
        throw new BadRequestException(
          'Category is required for ingredient products (e.g. Raw Food Ingredients).',
        );
      }
    }

    const tenantId = requireTenantId();
    let targetLocationId: number | null = dto.storeId ?? null;

    if (tenantId != null) {
      const org = await this.prisma.organization.findUnique({
        where: { id: tenantId },
        select: { standalone: true },
      });
      // Standalone shops have a single SHOP location (no separate store); fall
      // back to the user's own location or the org's shop.
      if (org?.standalone === true && !targetLocationId) {
        targetLocationId =
          user.locationId ??
          (
            await this.prisma.location.findFirst({
              where: { tenantId, type: LocationType.SHOP },
            })
          )?.id ??
          null;
      }
    }

    // --- Price rules: variant products price per row (the parent row stores a
    // simple average snapshot); plain products carry their own required
    // buy/sell prices. ---
    const variantRows = dto.variants ?? [];
    const isVariantProduct = !!dto.hasVariants;
    let parentBuyPrice = Number(dto.currentBuyPrice) || 0;
    let parentSellPrice = Number(dto.currentSellPrice) || 0;
    if (isVariantProduct) {
      if (variantRows.length === 0) {
        throw new BadRequestException(
          'Add at least one variant with buy and sell prices, or uncheck Has Variants.',
        );
      }
      this.assertVariantPrices(variantRows);
      const avg = this.averageVariantPrices(variantRows);
      parentBuyPrice = avg.buyPrice;
      parentSellPrice = avg.sellPrice;
    } else {
      if (!(parentBuyPrice > 0) || !(parentSellPrice > 0)) {
        throw new BadRequestException(
          'Buy Price and Sell Price are required for this product.',
        );
      }
    }

    // A target location is mandatory whenever initial stock will be deposited.
    const needsInitialStock = isVariantProduct
      ? variantRows.some((v) => Number(v.quantity ?? 0) > 0)
      : Number(dto.quantity ?? 0) > 0;
    if (needsInitialStock && !targetLocationId) {
      throw new BadRequestException(
        'Please select a target Store/Location to assign initial stock.',
      );
    }

    const sku = `${dto.brand.slice(0, 3).toUpperCase()}-${dto.baseName.slice(0, 3).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const product = await this.prisma.product.create({
      data: {
        tenantId,
        brand: dto.brand,
        baseName: dto.baseName,
        attributes: dto.attributes ?? {},
        currentBuyPrice: parentBuyPrice,
        currentSellPrice: parentSellPrice,
        categoryId: dto.categoryId,
        unitId: dto.unitId ?? null,
        kind: dto.kind ?? ProductKind.GOODS,
        barcode: dto.barcode ?? null,
        hasVariants: dto.hasVariants ?? false,
        isPerishable: dto.isPerishable ?? false,
        reorderLevel: dto.reorderLevel,
        reorderQty: dto.reorderQty ?? null,
        sku,
      },
    });

    // --- Variants (size/color matrix). Initial quantity is deposited per
    // variant into that variant's own inventory row. ---
    let createdVariants: any[] = [];
    let variantTotal = 0;
    if (dto.variants && dto.variants.length > 0) {
      createdVariants = await this.prisma.productVariant.createManyAndReturn({
        data: dto.variants.map((v, i) => ({
          productId: product.id,
          tenantId,
          sku: v.sku?.trim() || `${product.sku}-V${i + 1}`,
          barcode: v.barcode?.trim() || null,
          attributes: v.attributes ?? {},
          buyPrice: v.buyPrice ?? null,
          sellPrice: v.sellPrice ?? null,
          quantity: v.quantity ?? 0,
          // 0 = inherit the product's alert number; null = inherit its suggested
          // reorder quantity.
          reorderLevel: v.reorderLevel ?? 0,
          reorderQty: v.reorderQty ?? null,
        })),
      });
      variantTotal = createdVariants.reduce(
        (s: number, v: any) => s + (v.quantity ?? 0),
        0,
      );
    }

    // --- Initial stock deposit. Plain products use dto.quantity; variant
    // products deposit each variant's own initial quantity (the parent's
    // Total Quantity is the sum of the variants). ---
    if (targetLocationId) {
      const target = await this.prisma.location.findUnique({
        where: { id: targetLocationId },
        select: { type: true },
      });
      const isShopTarget = target?.type === LocationType.SHOP;
      const shopId = isShopTarget ? targetLocationId : null;

      const stockItems: {
        productId: number;
        variantId: number | null;
        quantity: number;
        unitCost?: number | null;
      }[] = !dto.hasVariants
        ? dto.quantity && dto.quantity > 0
          ? [
              {
                productId: product.id,
                variantId: null,
                quantity: dto.quantity,
                unitCost: dto.currentBuyPrice ?? product.currentBuyPrice,
              },
            ]
          : []
        : createdVariants
            .filter((v) => (v.quantity ?? 0) > 0)
            .map((v) => ({
              productId: product.id,
              variantId: v.id,
              quantity: v.quantity ?? 0,
              // Value the deposit at the exact variant cost, never the parent
              // average — inventory avg-cost and COGS stay precise per SKU.
              unitCost: v.buyPrice ?? product.currentBuyPrice,
            }));

      if (stockItems.length > 0) {
        await this.depositInitialStock({
          tenantId,
          product,
          targetLocationId,
          shopId,
          isShopTarget,
          user,
          items: stockItems,
        });
      }
    }

    // Batch / expiry (perishable). The batch quantity links to the initial
    // stock so the initial units are attributed to the created batch.
    if (dto.isPerishable || dto.batch?.batchNumber) {
      const qty =
        dto.batch?.quantity ?? (dto.hasVariants ? variantTotal : (dto.quantity ?? 0));
      await this.prisma.productBatch.create({
        data: {
          productId: product.id,
          batchNumber:
            dto.batch?.batchNumber?.trim() ||
            `BATCH-${Date.now().toString(36).toUpperCase()}`,
          manufactureDate: dto.batch?.manufactureDate
            ? new Date(dto.batch.manufactureDate)
            : null,
          expiryDate: dto.batch?.expiryDate
            ? new Date(dto.batch.expiryDate)
            : null,
          quantity: qty > 0 ? qty : 0,
        },
      });
    }

    return product;
  }

  /**
   * Deposit initial stock for a newly created product into per-location
   * inventory. Items carry an optional variantId — plain products use null,
   * variant products send one item per variant (stock lands on that variant's
   * own inventory row).
   *
   * When non-owner staff exist at the target location the deposit requires
   * their confirmation (AWAITING_CONFIRMATION request); otherwise the stock is
   * allowed immediately and a COMPLETED request records the history.
   */
  private async depositInitialStock(args: {
    tenantId: number | null;
    product: any;
    targetLocationId: number;
    shopId: number | null;
    isShopTarget: boolean;
    user: JwtPayload;
    items: {
      productId: number;
      variantId: number | null;
      quantity: number;
      unitCost?: number | null;
    }[];
  }) {
    const {
      tenantId,
      product,
      targetLocationId,
      shopId,
      isShopTarget,
      user,
      items,
    } = args;
    const totalQty = items.reduce((s, it) => s + it.quantity, 0);

    // Receivers = non-owner staff at the target location who must confirm
    // receipt (the acting user and owner accounts never count as receivers —
    // a solo operator never confirms their own stocking).
    const receivers = await this.prisma.user.findMany({
      where: {
        locationId: targetLocationId,
        isOwnerAccount: false,
        NOT: [{ role: { isSystem: true } }, { id: user.sub }],
      },
      select: { id: true },
    });

    if (receivers.length === 0) {
      // No shopkeeper to confirm → allow the stock immediately and record the
      // deposit as a COMPLETED request.
      for (const it of items) {
        await inventoryUpsert(this.prisma, {
          tenantId: requireTenantId(),
          productId: it.productId,
          variantId: it.variantId ?? null,
          locationId: targetLocationId,
          increment: it.quantity,
          // Exact per-item unit cost: variant buy price for variant rows,
          // parent buy price for plain products.
          unitCost: it.unitCost ?? product.currentBuyPrice ?? null,
        });
      }

      await this.prisma.stockRequest.create({
        data: {
          requestType: RequestType.STORE_TO_OWNER,
          storeId: targetLocationId,
          shopId,
          createdById: user.sub,
          approvedById: user.sub,
          status: RequestStatus.COMPLETED,
          items: {
            create: items.map((it) => ({
              tenantId,
              productId: it.productId,
              variantId: it.variantId ?? null,
              quantityStored: it.quantity,
              quantityReceived: it.quantity,
              status: RequestItemStatus.RECEIVED,
              confirmedById: user.sub,
              confirmedAt: new Date(),
            })),
          },
        },
        include: { items: true },
      }).then(async (req) => {
        // Universal finance: procurement posting (Inventory ↔ AP) for the
        // initial stock that just landed — idempotent per request item.
        for (const it of items) {
          await this.finance
            .postProcurement({
              ref: `RST-${req.id}-${req.items.find((r) => r.productId === it.productId && (r.variantId ?? null) === (it.variantId ?? null))?.id ?? 0}`,
              description: `Initial stock ${it.quantity} × ${product.brand} ${product.baseName}`,
              amount: (product.currentBuyPrice ?? 0) * it.quantity,
              entryDate: new Date(),
              createdById: user.sub,
              paid: false, // goods received on account (AP)
              tenantId: args.tenantId,
            })
            .catch(() => false);
        }
      });

      await this.notifications
        .notifyLocation(
          'Stock Added',
          `${totalQty} units of ${product.brand} ${product.baseName} were stocked directly at ${isShopTarget ? 'the shop' : 'the location'}`,
          targetLocationId,
          { productId: product.id },
        )
        .catch(() => undefined);
    } else {
      // A shopkeeper must confirm receipt first (deposit mode): the stock is
      // NOT added until they confirm on the Requests page. The notification
      // is location-scoped so only the shopkeepers at this location see it.
      const request = await this.prisma.stockRequest.create({
        data: {
          requestType: RequestType.STORE_TO_OWNER,
          storeId: targetLocationId,
          shopId,
          createdById: user.sub,
          status: RequestStatus.AWAITING_CONFIRMATION,
          items: {
            create: items.map((it) => ({
              tenantId,
              productId: it.productId,
              variantId: it.variantId ?? null,
              quantityStored: it.quantity,
              status: RequestItemStatus.STORED,
            })),
          },
        },
      });

      await this.notifications.notifyLocation(
        'Stock Ready for Receipt',
        `Request #${request.id}: ${totalQty} units of ${product.brand} ${product.baseName} ready for you to confirm`,
        targetLocationId,
        { productId: product.id },
      );
    }
  }

  /**
   * Exact case-insensitive duplicate lookup by brand + base name. Used by the
   * add-product form to pre-fill the item's details so the user can adjust
   * what should be different (true duplicates are still blocked on create).
   */
  async lookupByBrandBase(brand?: string, baseName?: string) {
    const b = brand?.trim();
    const n = baseName?.trim();
    if (!b || !n) return { product: null };
    const product = await this.prisma.product.findFirst({
      where: {
        brand: { equals: b, mode: 'insensitive' },
        baseName: { equals: n, mode: 'insensitive' },
      },
      include: { category: true, unit: true },
    });
    return { product };
  }

  /**
   * Variant-builder suggestions for a category ("this is what the other
   * Electrical Wire items look like"): the variant matrices already used by the
   * business's own products in that category (plus its sub-categories), and a
   * short list of same-category products whose variants can be copied wholesale.
   *
   * Variant rows are never shared between products — each product owns its SKUs,
   * barcodes, prices and stock — so this only returns the row definitions the
   * builder pre-fills. The user prunes/edits them, and the normal create/update
   * path still writes per-product rows. Read-only: nothing is written here.
   *
   * `brand` is only a ranking hint (the typed brand's items win ties) and
   * `excludeProductId` keeps a product from being suggested back to itself.
   */
  async variantSuggestions(
    opts: {
      categoryId?: number;
      brand?: string;
      excludeProductId?: number;
      limit?: number;
    } = {},
  ) {
    const empty = {
      categoryId: null as number | null,
      categoryName: null as string | null,
      categoryIds: [] as number[],
      scannedProducts: 0,
      groups: [] as any[],
      products: [] as any[],
    };
    if (!opts.categoryId) return empty;

    const tenantId = requireTenantId();

    // The category must belong to the active business: a foreign id must never
    // expose another business's catalog.
    const root = await this.prisma.category.findFirst({
      where: { id: opts.categoryId, tenantId },
      select: { id: true, name: true },
    });
    if (!root) throw new NotFoundException(tr('errors.categoryNotFound'));

    // Sub-categories count too — catalogs are usually filed one level down
    // ("Electrical Wire" → "Wire 2.5mm"). Depth-capped so a cycle can't loop.
    const categoryIds: number[] = [root.id];
    let frontier: number[] = [root.id];
    for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
      const children = await this.prisma.category.findMany({
        where: { parentId: { in: frontier }, tenantId },
        select: { id: true },
      });
      frontier = children
        .map((c: any) => c.id as number)
        .filter((id: number) => !categoryIds.includes(id));
      categoryIds.push(...frontier);
    }

    const scanLimit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const scanned = await this.prisma.product.findMany({
      where: {
        tenantId,
        hasVariants: true,
        categoryId: { in: categoryIds },
        ...(opts.excludeProductId ? { id: { not: opts.excludeProductId } } : {}),
      },
      select: {
        id: true,
        brand: true,
        baseName: true,
        updatedAt: true,
        variants: {
          orderBy: { id: 'asc' },
          select: {
            attributes: true,
            buyPrice: true,
            sellPrice: true,
            reorderLevel: true,
            reorderQty: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: scanLimit,
    });

    // Products that were flagged as variant products but carry no rows teach us
    // nothing, so they are skipped.
    const withRows = scanned
      .map((p: any) => ({ ...p, variants: p.variants ?? [] }))
      .filter((p: any) => p.variants.length > 0);

    const brand = opts.brand?.trim().toLowerCase() || null;
    const signatureOf = (rows: any[]) =>
      JSON.stringify(
        rows
          .map((v: any) => JSON.stringify(normalizeAttributes(v.attributes)))
          .sort(),
      );

    // A whole matrix is what the user wants to reuse, so identical row sets are
    // grouped and counted. The sample row set (and therefore the pre-filled
    // prices) comes from the typed brand when it has one, else the newest item.
    const bySignature = new Map<string, any>();
    for (const product of withRows) {
      const signature = signatureOf(product.variants);
      const isSameBrand =
        !!brand && (product.brand ?? '').toLowerCase() === brand;
      let entry = bySignature.get(signature);
      if (!entry) {
        entry = {
          signature,
          count: 0,
          brandCount: 0,
          sampleIsSameBrand: false,
          updatedAt: new Date(product.updatedAt).getTime(),
          sample: {
            productId: product.id,
            brand: product.brand,
            baseName: product.baseName,
          },
          rows: product.variants.map(toSuggestionRow),
        };
        bySignature.set(signature, entry);
      }
      entry.count += 1;
      if (isSameBrand) entry.brandCount += 1;
      if (isSameBrand && !entry.sampleIsSameBrand) {
        entry.sampleIsSameBrand = true;
        entry.sample = {
          productId: product.id,
          brand: product.brand,
          baseName: product.baseName,
        };
        entry.rows = product.variants.map(toSuggestionRow);
      }
    }

    const groups = Array.from(bySignature.values())
      .sort(
        (a, b) =>
          b.brandCount - a.brandCount ||
          b.count - a.count ||
          b.updatedAt - a.updatedAt,
      )
      .slice(0, 8)
      .map((g) => ({
        signature: g.signature,
        count: g.count,
        sample: g.sample,
        rows: g.rows,
      }));

    // Copy-from sources: newest first, each with its own rows so the picker
    // needs no second round-trip.
    const products = withRows.slice(0, 10).map((p: any) => ({
      id: p.id,
      brand: p.brand,
      baseName: p.baseName,
      variantCount: p.variants.length,
      rows: p.variants.slice(0, 30).map(toSuggestionRow),
    }));

    return {
      categoryId: root.id,
      categoryName: root.name,
      categoryIds,
      scannedProducts: withRows.length,
      groups,
      products,
    };
  }

  /**
   * Exact barcode/SKU lookup for the POS "scan to cart" flow. A product barcode
   * or SKU wins; otherwise a variant barcode/SKU is matched and its parent
   * product is returned alongside it. Case-insensitive, and automatically scoped
   * to the active tenant by the Prisma middleware. `locationId` scopes the
   * returned stock levels to the shop the sale is being made at.
   */
  async findByCode(code?: string, locationId?: number) {
    const value = code?.trim();
    if (!value) return { product: null, variant: null, matchType: 'NONE' };

    const include: any = {
      category: true,
      unit: true,
      variants: { orderBy: { id: 'asc' } },
      inventory: locationId
        ? { where: { locationId }, include: { location: true } }
        : { include: { location: true } },
    };
    const exact = { equals: value, mode: 'insensitive' as const };

    const product = await this.prisma.product.findFirst({
      where: { OR: [{ barcode: exact }, { sku: exact }] },
      include,
    });
    if (product) return { product, variant: null, matchType: 'PRODUCT' };

    const variant = await this.prisma.productVariant.findFirst({
      where: { OR: [{ barcode: exact }, { sku: exact }] },
      include: { product: { include } },
    });
    if (variant) {
      const { product: parent, ...variantFields } = variant as any;
      return { product: parent, variant: variantFields, matchType: 'VARIANT' };
    }

    return { product: null, variant: null, matchType: 'NONE' };
  }

  async findAll(
    user: JwtPayload,
    search?: string,
    categoryId?: string,
    locationId?: number,
    paging?: Paging,
  ) {
    const conditions: any[] = [];

    if (search) {
      const attrIds = await this.prisma.findProductIdsByAttributes(search);
      conditions.push({
        OR: [
          { baseName: { contains: search, mode: 'insensitive' } },
          { brand: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
          ...(attrIds.length > 0 ? [{ id: { in: attrIds } }] : []),
          {
            variants: {
              some: {
                OR: [
                  { sku: { contains: search, mode: 'insensitive' } },
                  { barcode: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
          {
            batches: {
              some: { batchNumber: { contains: search, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    if (categoryId) {
      conditions.push({ categoryId: Number(categoryId) });
    }

    // Determine which location to filter inventory by. The product catalog is
    // visible to all users; the inventory include stays scoped to the user's own
    // location unless an explicit location filter is given.
    const invLocationId = locationId ?? user.locationId ?? undefined;

    const where: any = conditions.length > 0 ? { AND: conditions } : {};

    const include: any = {
      category: true,
      unit: true,
      variants: { orderBy: { id: 'asc' } },
      batches: { orderBy: { id: 'desc' } },
      inventory: invLocationId
        ? {
            where: { locationId: invLocationId },
            include: { location: true },
          }
        : { include: { location: true } },
    };

    if (paging?.enabled) {
      const [rows, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include,
          skip: (paging.page - 1) * paging.pageSize,
          take: paging.pageSize,
        }),
        this.prisma.product.count({ where }),
      ]);
      return pagedResult(rows, total, paging.page, paging.pageSize);
    }

    return this.prisma.product.findMany({ where, include });
  }

  /** Current stock levels at the signed-in user's own location. */
  async findMyInventory(
    user: JwtPayload,
    search?: string,
    categoryId?: string,
  ) {
    if (!user.locationId) return [];

    const inventories = await this.prisma.inventory.findMany({
      where: {
        locationId: user.locationId,
        product: {
          ...(categoryId &&
          !Number.isNaN(Number(categoryId)) &&
          Number(categoryId) > 0
            ? { categoryId: Number(categoryId) }
            : {}),
          ...(search
            ? {
                OR: [
                  { baseName: { contains: search, mode: 'insensitive' } },
                  { brand: { contains: search, mode: 'insensitive' } },
                  { sku: { contains: search, mode: 'insensitive' } },
                  { barcode: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: { product: true, variant: true },
      orderBy: { product: { baseName: 'asc' } },
    });

    return inventories
      .filter((inv) => inv.quantity > 0)
      .map((inv) => ({
        productId: inv.productId,
        productName: `${inv.product.brand} ${inv.product.baseName}`,
        sku: inv.product.sku,
        quantity: inv.quantity,
        // Variant-level detail so the dashboard can group by base product and
        // expand each product into its per-variant stock breakdown.
        variantId: inv.variantId ?? null,
        variantSku: inv.variant?.sku ?? null,
        variantAttributes: inv.variant?.attributes ?? null,
      }));
  }

  async findOne(id: number, user: JwtPayload) {
    const include: any = {
      priceHistory: { orderBy: { updatedAt: 'desc' } },
      category: true,
      unit: true,
      variants: { orderBy: { id: 'asc' } },
      batches: { orderBy: { id: 'desc' } },
      inventory: user.locationId
        ? {
            where: { locationId: user.locationId },
            include: { location: true },
          }
        : { include: { location: true } },
    };

    const product = await this.prisma.product.findFirst({
      where: { id },
      include,
    });

    if (!product) throw new NotFoundException(tr('errors.productNotFound'));

    return product;
  }

  async update(id: number, dto: UpdateProductDto, user: JwtPayload) {
    const tenantId = requireTenantId();
    // One batch reference for the whole edit, so the product's own row and every
    // variant it changed group together on the price-history page.
    const priceBatchRef = newPriceBatchRef();
    const priceChanges: PriceChange[] = [];
    const existingBefore = await this.prisma.product.findUnique({ where: { id } });
    if (!existingBefore) throw new NotFoundException(tr('errors.productNotFound'));
    if (
      (dto.currentBuyPrice !== undefined &&
        dto.currentBuyPrice !== existingBefore.currentBuyPrice) ||
      (dto.currentSellPrice !== undefined &&
        dto.currentSellPrice !== existingBefore.currentSellPrice)
    ) {
      priceChanges.push({
        productId: id,
        oldBuyPrice: existingBefore.currentBuyPrice,
        newBuyPrice: dto.currentBuyPrice ?? existingBefore.currentBuyPrice,
        oldSellPrice: existingBefore.currentSellPrice,
        newSellPrice: dto.currentSellPrice ?? existingBefore.currentSellPrice,
      });
    }
    // The form edits variant prices on the variant rows themselves; capture their
    // old values now, because the upserts below overwrite them.
    const variantPriceEdits = new Map<
      number,
      { buyPrice?: number; sellPrice?: number }
    >();
    for (const v of (dto.variants ?? []) as any[]) {
      if (v?.id && (v.buyPrice !== undefined || v.sellPrice !== undefined)) {
        variantPriceEdits.set(Number(v.id), {
          ...(v.buyPrice !== undefined ? { buyPrice: Number(v.buyPrice) } : {}),
          ...(v.sellPrice !== undefined ? { sellPrice: Number(v.sellPrice) } : {}),
        });
      }
    }
    if (variantPriceEdits.size > 0) {
      const rows = await this.prisma.productVariant.findMany({
        where: { id: { in: [...variantPriceEdits.keys()] }, productId: id },
        select: { id: true, buyPrice: true, sellPrice: true },
      });
      for (const row of rows) {
        const edit = variantPriceEdits.get(row.id)!;
        const newBuy = edit.buyPrice ?? row.buyPrice ?? 0;
        const newSell = edit.sellPrice ?? row.sellPrice ?? 0;
        if (newBuy === (row.buyPrice ?? 0) && newSell === (row.sellPrice ?? 0)) {
          continue;
        }
        priceChanges.push({
          productId: id,
          variantId: row.id,
          oldBuyPrice: row.buyPrice ?? 0,
          newBuyPrice: newBuy,
          oldSellPrice: row.sellPrice ?? 0,
          newSellPrice: newSell,
        });
      }
    }
    // Variant upserts + batch creation happen below (non-destructive).
    // Only whitelisted product scalar fields are updated. categoryId/unitId are
    // written as plain FK scalars (unchecked input — valid regardless of how
    // the Prisma client models the relations), and storeId/quantity belong to
    // variant stock deposition below — never to the Product row itself.
    const { variants, batch } = dto as any;
    const data: any = {};
    if (dto.brand !== undefined) data.brand = dto.brand;
    if (dto.baseName !== undefined) data.baseName = dto.baseName;
    if (dto.attributes !== undefined) data.attributes = dto.attributes;
    if (dto.currentBuyPrice !== undefined) data.currentBuyPrice = dto.currentBuyPrice;
    if (dto.currentSellPrice !== undefined) data.currentSellPrice = dto.currentSellPrice;
    if (dto.barcode !== undefined) data.barcode = dto.barcode ?? null;
    if (dto.hasVariants !== undefined) data.hasVariants = dto.hasVariants;
    if (dto.isPerishable !== undefined) data.isPerishable = dto.isPerishable;
    if (dto.reorderLevel !== undefined) data.reorderLevel = dto.reorderLevel;
    if (dto.reorderQty !== undefined) data.reorderQty = dto.reorderQty ?? null;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.unitId !== undefined) data.unitId = dto.unitId ?? null;

    // Price rules mirror create(): variant products keep the parent row in
    // sync with the per-row average; plain products must carry positive
    // buy/sell prices whenever the form sends them.
    const variantRows = (variants ?? []) as any[];
    // A Store/Location is mandatory before a brand-new variant row can deposit
    // its initial quantity. Existing rows' quantities are historical (never
    // re-deposited), so only rows without an id count. Validated up-front so a
    // rejection never leaves the product row half-updated.
    const newRowNeedsStock = variantRows.some(
      (v: any) => !v.id && Number(v.quantity ?? 0) > 0,
    );
    if (newRowNeedsStock) {
      const checkLocation = await this.resolveDepositLocation(
        user,
        (dto as any).storeId ?? null,
      );
      if (!checkLocation) {
        throw new BadRequestException(
          'Please select a target Store/Location to assign initial stock.',
        );
      }
    }
    if (dto.hasVariants) {
      if (variantRows.length > 0) {
        this.assertVariantPrices(variantRows);
        const avg = this.averageVariantPrices(variantRows);
        data.currentBuyPrice = avg.buyPrice;
        data.currentSellPrice = avg.sellPrice;
      }
    } else if (
      dto.currentBuyPrice !== undefined ||
      dto.currentSellPrice !== undefined
    ) {
      if (
        !(Number(dto.currentBuyPrice) > 0) ||
        !(Number(dto.currentSellPrice) > 0)
      ) {
        throw new BadRequestException(
          'Buy Price and Sell Price are required for this product.',
        );
      }
    }

    const product = await this.prisma.product.update({
      where: { id },
      data,
    });

    // --- Variant upserts. Existing variants (by id) are updated in place;
    // new rows are created with an auto-generated free SKU and optional
    // initial stock at the given store. Nothing is ever deleted here because
    // variants can be referenced by sales/requests/inventory history. ---
    if (variants && variants.length > 0) {
      const existingVariants = await this.prisma.productVariant.findMany({
        where: { productId: id },
        select: { sku: true },
      });
      const usedSkus = new Set(existingVariants.map((v) => v.sku));
      // Where new variants' initial stock lands: the explicit storeId from the
      // form, falling back to the user's own location / the org shop.
      const depositLocationId = await this.resolveDepositLocation(
        user,
        (dto as any).storeId ?? null,
      );

      for (const v of variants) {
        if (v.id) {
          await this.prisma.productVariant.update({
            where: { id: v.id },
            data: {
              sku: v.sku?.trim() || undefined,
              barcode: v.barcode?.trim() || undefined,
              attributes: v.attributes ?? undefined,
              buyPrice: v.buyPrice ?? undefined,
              sellPrice: v.sellPrice ?? undefined,
              // 0 is a meaningful value (inherit), so only `undefined` (field
              // absent from the payload) leaves the stored number untouched.
              // `null` clears the suggested qty back to "inherit".
              reorderLevel: v.reorderLevel ?? undefined,
              ...(v.reorderQty === null
                ? { reorderQty: null }
                : v.reorderQty !== undefined
                  ? { reorderQty: v.reorderQty }
                  : {}),
            },
          });
        } else {
          // Auto-generate a free SKU: {productSKU}-V{n} (same as addVariant).
          let sku = v.sku?.trim() || '';
          if (!sku) {
            let n = 1;
            sku = `${product.sku}-V${n}`;
            while (usedSkus.has(sku)) {
              n += 1;
              sku = `${product.sku}-V${n}`;
            }
          }
          usedSkus.add(sku);
          const created = await this.prisma.productVariant.create({
            data: {
              productId: id,
              tenantId: getCurrentTenantId(),
              sku,
              barcode: v.barcode?.trim() || null,
              attributes: v.attributes ?? {},
              buyPrice: v.buyPrice ?? null,
              sellPrice: v.sellPrice ?? null,
              reorderLevel: v.reorderLevel ?? 0,
              reorderQty: v.reorderQty ?? null,
            },
          });
          // Deposit initial quantity for brand-new variants at the resolved
          // store/shop location (owner-operated direct landing).
          if (depositLocationId && v.quantity > 0) {
            await inventoryUpsert(this.prisma, {
              tenantId: requireTenantId(),
              productId: id,
              variantId: created.id,
              locationId: depositLocationId,
              increment: v.quantity,
              unitCost: v.buyPrice ?? null,
            });
          }
        }
      }
    }

    // --- Batch creation (non-destructive: appends a new batch when data is
    // present; duplicates by (tenant, product, batchNumber) are skipped). ---
    if (
      batch &&
      (batch.batchNumber || batch.expiryDate || batch.manufactureDate)
    ) {
      const batchNumber = batch.batchNumber?.trim() || `B-${Date.now()}`;
      const existingBatch = await this.prisma.productBatch.findFirst({
        where: { tenantId: getCurrentTenantId(), productId: id, batchNumber },
      });
      if (!existingBatch) {
        await this.prisma.productBatch.create({
          data: {
            tenantId: getCurrentTenantId(),
            productId: id,
            batchNumber,
            manufactureDate: batch.manufactureDate
              ? new Date(batch.manufactureDate)
              : null,
            expiryDate: batch.expiryDate
              ? new Date(batch.expiryDate)
              : null,
            quantity: batch.quantity ?? 0,
          },
        });
      }
    }

    // --- Price history (one action, one batch). The parent row is written even
    // when only variant prices moved, so the action always has a main row to
    // group its per-variant rows under. ---
    if (priceChanges.length > 0) {
      await recordPriceChanges(this.prisma, {
        tenantId,
        userId: user.sub,
        source: 'PRODUCT_EDIT',
        batchRef: priceBatchRef,
        changes: priceChanges,
        // Always write the product's own row: when only variant prices moved it is
        // unchanged, but the history page lists parent rows and hangs the per-variant
        // detail under them — without it those rows would be invisible.
        keepUnchanged: true,
      });
    }

    return this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        unit: true,
        variants: { orderBy: { id: 'asc' } },
        batches: { orderBy: { id: 'desc' } },
        inventory: { include: { location: true } },
      },
    });
  }

  async remove(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(tr('errors.productNotFound'));

    // Prevent deletion of products that are referenced by transactional history
    const [sales, creditItems, requestItems, returnItems] = await Promise.all([
      this.prisma.saleItem.count({ where: { productId: id } }),
      this.prisma.creditSaleItem.count({ where: { productId: id } }),
      this.prisma.requestItem.count({ where: { productId: id } }),
      this.prisma.returnItem.count({ where: { productId: id } }),
    ]);

    if (sales + creditItems + requestItems + returnItems > 0) {
      throw new BadRequestException(
        'Cannot delete a product that has sales, credit, request, or return history',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { productId: id } });
      await tx.priceHistory.deleteMany({ where: { productId: id } });
      await tx.inventory.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    return { message: 'Product deleted' };
  }

  // ---------------------------------------------------------------- Counting
  /**
   * Location scope for a reconciliation: a user bound to a location may only
   * count that one (the products page already hides the others from them — this
   * is the server-side half of the same rule). Owners, users without a bound
   * location, and holders of `inventory.all-locations` keep any location of the
   * active business.
   */
  private assertLocationAllowed(locationId: number, user: JwtPayload) {
    if (user.isSuperuser) return;
    if (user.permissions?.includes('inventory.all-locations')) return;
    if (user.locationId != null && user.locationId !== locationId) {
      throw new ForbiddenException(
        'You can only adjust stock at your own location.',
      );
    }
  }

  /** Who may move prices: owners and roles that can edit products. */
  private canChangePrices(user: JwtPayload) {
    return (
      user.isSuperuser === true ||
      user.permissions?.includes('products.edit') === true
    );
  }

  /**
   * Validate a whole counting sheet before anything is written. Products,
   * variants and locations are loaded once (tenant-scoped) and every row is
   * checked with exactly the rules the single-row endpoint enforces — including
   * duplicate detection, since a repeated product/variant/location row would
   * double-count and collide on the journal reference.
   *
   * `single` preserves the historical single-row contract (throw that row's
   * original exception with its status); otherwise every failure is collected
   * and one 400 lists each bad row by index.
   */
  private async validateAdjustItems(
    items: BulkAdjustStockItemDto[],
    user: JwtPayload,
    tenantId: number,
    opts: { single?: boolean } = {},
  ): Promise<AdjustTarget[]> {
    const productIds = [...new Set(items.map((i) => Number(i.productId)))];
    const locationIds = [...new Set(items.map((i) => Number(i.locationId)))];
    const variantIds = [
      ...new Set(
        items
          .map((i) => Number(i.variantId))
          .filter((v) => Number.isInteger(v) && v > 0),
      ),
    ];

    const [products, locations, variants] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, tenantId },
        select: {
          id: true,
          brand: true,
          baseName: true,
          hasVariants: true,
          currentBuyPrice: true,
          reorderLevel: true,
        },
      }),
      this.prisma.location.findMany({
        where: { id: { in: locationIds }, tenantId },
        select: { id: true, name: true, type: true },
      }),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds }, tenantId },
            select: {
              id: true,
              productId: true,
              sku: true,
              attributes: true,
              reorderLevel: true,
            },
          })
        : Promise.resolve([] as any[]),
    ]);

    const productById = new Map<number, any>(
      (products as any[]).map((p) => [p.id, p]),
    );
    const locationById = new Map<number, any>(
      (locations as any[]).map((l) => [l.id, l]),
    );
    const variantById = new Map<number, any>(
      (variants as any[]).map((v) => [v.id, v]),
    );

    const errors: AdjustRowError[] = [];
    const seen = new Set<string>();
    // Prices are per variant/product, so the sheet may not price one item two ways.
    const priceByKey = new Map<string, number>();
    const targets: AdjustTarget[] = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const productId = Number(item.productId);
      const variantId = item.variantId != null ? Number(item.variantId) : null;
      const locationId = Number(item.locationId);
      const fail = (message: string, status = 400) =>
        errors.push({ index, productId, variantId, locationId, message, status });

      const product = productById.get(productId);
      if (!product) {
        fail('Product not found', 404);
        continue;
      }
      const location = locationById.get(locationId);
      if (!location) {
        fail('Location not found', 404);
        continue;
      }
      // Stock lives on the variant rows for a variant product and on the plain
      // (variantId = null) row otherwise, so a count must say which variant it is
      // — writing the plain row for a variant product used to create a phantom
      // row and leave the real variant stock (and the ledger) untouched.
      if (product.hasVariants && variantId === null) {
        fail(
          'Select a variant to reconcile — this product keeps stock per variant.',
        );
        continue;
      }
      if (!product.hasVariants && variantId !== null) {
        fail('This product has no variants.');
        continue;
      }
      let variant: any = null;
      if (variantId !== null) {
        variant = variantById.get(variantId);
        if (!variant || variant.productId !== productId) {
          fail('That variant does not belong to this product.');
          continue;
        }
      }
      if (
        typeof item.quantity !== 'number' ||
        !Number.isFinite(item.quantity) ||
        item.quantity < 0
      ) {
        fail('Counted quantity must be zero or more.');
        continue;
      }
      // A count may correct the selling price, never the buying price (there is no
      // buy field on the payload at all), and only for users who may edit prices.
      if (item.sellPrice != null) {
        if (!this.canChangePrices(user)) {
          fail('You cannot change selling prices.', 403);
          continue;
        }
        const rounded = round2(item.sellPrice);
        const priceKey = `${productId}|${variantId ?? 'base'}`;
        const already = priceByKey.get(priceKey);
        if (already !== undefined && already !== rounded) {
          fail(
            'This item has two different selling prices in the sheet — use one price per item.',
          );
          continue;
        }
        priceByKey.set(priceKey, rounded);
      }
      try {
        this.assertLocationAllowed(locationId, user);
      } catch (err: any) {
        fail(err?.message ?? 'Location not allowed', 403);
        continue;
      }
      const key = `${productId}|${variantId ?? 'base'}|${locationId}`;
      if (seen.has(key)) {
        fail(
          'This item is listed twice for the same variant and location — remove the duplicate row.',
        );
        continue;
      }
      seen.add(key);
      targets.push({
        index,
        product,
        variant,
        location,
        quantity: item.quantity,
        sellPrice: item.sellPrice != null ? round2(item.sellPrice) : null,
      });
    }

    if (errors.length > 0) {
      const first = errors[0];
      if (opts.single) {
        if (first.status === 404) throw new NotFoundException(first.message);
        if (first.status === 403) throw new ForbiddenException(first.message);
        throw new BadRequestException(first.message);
      }
      throw new BadRequestException({
        message: 'Some rows could not be processed',
        errors: errors.map((e) => ({
          index: e.index,
          productId: e.productId,
          variantId: e.variantId,
          locationId: e.locationId,
          message: e.message,
        })),
      });
    }
    return targets;
  }

  /**
   * Apply one validated count inside an open transaction: read the row's current
   * stock, set the counted quantity, and report what changed. Shared by the
   * single-row and the bulk endpoints so their rules can never drift.
   */
  private async adjustRowInTx(
    tx: Prisma.TransactionClient,
    tenantId: number,
    target: AdjustTarget,
    ctx: { userId: number; reason?: string },
  ) {
    const { product, variant, location, quantity } = target;
    const variantId = variant?.id ?? null;
    const label = itemDisplayName(product, variant);

    const before = await tx.inventory.findFirst({
      where: {
        tenantId,
        productId: product.id,
        variantId,
        locationId: location.id,
      },
    });
    await inventorySet(tx, {
      tenantId,
      productId: product.id,
      variantId,
      locationId: location.id,
      quantity,
    });

    const delta = round2(quantity - (before?.quantity ?? 0));
    const unitCost = before?.avgCost ?? product.currentBuyPrice ?? 0;

    await tx.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'STOCK_ADJUST',
        details: `Adjusted ${label} to ${quantity} at ${location.name}${ctx.reason ? ` — ${ctx.reason}` : ''}`,
      },
    });

    // Per-row hint for the sheet: is this row now at or below its alert level?
    const alertLevel = variant?.reorderLevel || product.reorderLevel || 0;
    const lowStock = quantity === 0 || (alertLevel > 0 && quantity <= alertLevel);

    return {
      index: target.index,
      productId: product.id,
      variantId,
      locationId: location.id,
      locationName: location.name,
      label,
      before: before?.quantity ?? 0,
      after: quantity,
      delta,
      unitCost: round2(unitCost),
      valueDelta: round2(delta * unitCost),
      lowStock,
    };
  }

  /**
   * Reconcile one counted row: compare the counted vs system stock, then book the
   * value difference (surplus/shortage) via an Inventory Adjustment journal so the
   * Inventory Asset ledger stays in sync with the physical count.
   */
  async adjustStock(productId: number, dto: AdjustStockDto, user: JwtPayload) {
    const tenantId = requireTenantId();
    const [target] = await this.validateAdjustItems(
      [
        {
          productId,
          variantId: dto.variantId ?? null,
          locationId: dto.locationId,
          quantity: dto.quantity,
        },
      ],
      user,
      tenantId,
      { single: true },
    );

    const result = await this.prisma.$transaction((tx) =>
      this.adjustRowInTx(tx as Prisma.TransactionClient, tenantId, target, {
        userId: user.sub,
        reason: dto.reason,
      }),
    );

    if (result.delta !== 0) {
      await this.finance
        .postInventoryAdjustment({
          ref: `ADJ-${result.productId}-${result.variantId ?? 'base'}-${result.locationId}-${Date.now()}`,
          description: `Inventory adjustment: ${result.label} at ${result.locationName} — count ${result.after} (was ${result.before})${dto.reason ? ` — ${dto.reason}` : ''}`,
          signedAmount: result.valueDelta,
          createdById: user.sub,
          tenantId: getCurrentTenantId(),
        })
        .catch(() => false);
    }

    await this.notifications.checkAndNotifyLowStock(productId, dto.locationId);

    return { message: 'Stock adjusted successfully' };
  }

  /**
   * Reconcile a whole counting session: many products / variants across many
   * locations in one submission.
   *
   * The sheet is validated up front (see validateAdjustItems) and applied inside
   * one transaction, so a bad row rejects the batch without writing anything —
   * a half-counted store would be worse than a rejected sheet. The ledger gets
   * ONE entry per location at the net value of that location's rows (a session is
   * one accounting event per store) while every row keeps its own audit entry, and
   * low stock is re-evaluated once per product/location pair.
   */
  async adjustStockBulk(dto: BulkAdjustStockDto, user: JwtPayload) {
    const tenantId = requireTenantId();
    const batchId =
      dto.batchId?.trim() ||
      `B${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const targets = await this.validateAdjustItems(dto.items, user, tenantId);
    const priceBatchRef = newPriceBatchRef();
    // Selling prices corrected while counting (filled inside the transaction).
    const priceChanges: PriceChange[] = [];

    const results = await this.prisma.$transaction(async (tx) => {
      const applied: Awaited<ReturnType<ProductsService['adjustRowInTx']>>[] = [];
      for (const target of targets) {
        applied.push(
          await this.adjustRowInTx(tx as Prisma.TransactionClient, tenantId, target, {
            userId: user.sub,
            reason: dto.reason,
          }),
        );
      }

      // Selling prices corrected while counting: one value per variant (or per
      // plain product), applied once, with the product's own number kept as the
      // variant AVERAGE. The buying price is never touched — the payload has no
      // buy field, and the history rows record old == new for cost.
      const priced = new Map<
        string,
        { productId: number; variantId: number | null; sellPrice: number }
      >();
      for (const target of targets) {
        if (target.sellPrice == null) continue;
        priced.set(`${target.product.id}|${target.variant?.id ?? 'base'}`, {
          productId: target.product.id,
          variantId: target.variant?.id ?? null,
          sellPrice: target.sellPrice,
        });
      }

      const touchedProducts = new Set<number>();
      for (const entry of priced.values()) {
        if (entry.variantId != null) {
          const variant = await tx.productVariant.findFirst({
            where: { id: entry.variantId },
            select: { buyPrice: true, sellPrice: true },
          });
          if (!variant || variant.sellPrice === entry.sellPrice) continue;
          await tx.productVariant.update({
            where: { id: entry.variantId },
            data: { sellPrice: entry.sellPrice },
          });
          priceChanges.push({
            productId: entry.productId,
            variantId: entry.variantId,
            oldBuyPrice: variant.buyPrice ?? 0,
            newBuyPrice: variant.buyPrice ?? 0,
            oldSellPrice: variant.sellPrice ?? 0,
            newSellPrice: entry.sellPrice,
          });
          touchedProducts.add(entry.productId);
        } else {
          const product = await tx.product.findFirst({
            where: { id: entry.productId },
            select: { currentBuyPrice: true, currentSellPrice: true },
          });
          if (!product || product.currentSellPrice === entry.sellPrice) continue;
          await tx.product.update({
            where: { id: entry.productId },
            data: { currentSellPrice: entry.sellPrice },
          });
          priceChanges.push({
            productId: entry.productId,
            oldBuyPrice: product.currentBuyPrice,
            newBuyPrice: product.currentBuyPrice,
            oldSellPrice: product.currentSellPrice,
            newSellPrice: entry.sellPrice,
          });
        }
      }

      for (const productId of touchedProducts) {
        const sellRows = await tx.productVariant.findMany({
          where: { productId },
          select: { sellPrice: true },
        });
        if (sellRows.length === 0) continue;
        const avgSell = round2(
          sellRows.reduce((sum, r) => sum + (r.sellPrice ?? 0), 0) /
            sellRows.length,
        );
        const parent = await tx.product.findFirst({
          where: { id: productId },
          select: { currentBuyPrice: true, currentSellPrice: true },
        });
        if (!parent || parent.currentSellPrice === avgSell) continue;
        await tx.product.update({
          where: { id: productId },
          data: { currentSellPrice: avgSell },
        });
        priceChanges.push({
          productId,
          oldBuyPrice: parent.currentBuyPrice,
          newBuyPrice: parent.currentBuyPrice,
          oldSellPrice: parent.currentSellPrice,
          newSellPrice: avgSell,
        });
      }

      if (priceChanges.length > 0) {
        await recordPriceChanges(tx as Prisma.TransactionClient, {
          tenantId,
          userId: user.sub,
          source: 'COUNT',
          batchRef: priceBatchRef,
          changes: priceChanges,
          keepUnchanged: true,
        });
        await tx.auditLog.create({
          data: {
            userId: user.sub,
            action: 'PRICE_UPDATE',
            details: `Selling price updated while counting: ${priceChanges
              .map(
                (c) =>
                  `${c.productId}${c.variantId ? `/v${c.variantId}` : ''} ${c.oldSellPrice} → ${c.newSellPrice}`,
              )
              .join(', ')}${dto.reason ? ` — ${dto.reason}` : ''}`,
          },
        });
      }

      return applied;
    });

    const byLocation = new Map<number, any>();
    for (const r of results) {
      const acc =
        byLocation.get(r.locationId) ??
        {
          locationId: r.locationId,
          locationName: r.locationName,
          items: 0,
          changed: 0,
          surplusValue: 0,
          shortageValue: 0,
          netValue: 0,
          journalRef: null as string | null,
        };
      acc.items += 1;
      if (r.delta !== 0) {
        acc.changed += 1;
        if (r.valueDelta > 0) acc.surplusValue = round2(acc.surplusValue + r.valueDelta);
        else acc.shortageValue = round2(acc.shortageValue + r.valueDelta);
      }
      acc.netValue = round2(acc.netValue + r.valueDelta);
      byLocation.set(r.locationId, acc);
    }

    for (const acc of byLocation.values()) {
      if (acc.netValue === 0) continue;
      const ref = `ADJ-BULK-${batchId}-${acc.locationId}`;
      const posted = await this.finance
        .postInventoryAdjustment({
          ref,
          description: `Inventory count (${acc.changed} item(s)) at ${acc.locationName}${dto.reason ? ` — ${dto.reason}` : ''}`,
          signedAmount: acc.netValue,
          createdById: user.sub,
          tenantId: getCurrentTenantId(),
        })
        .catch(() => false);
      acc.journalRef = posted ? ref : null;
    }

    // One re-evaluation per product/location — a sheet can hold many rows of the
    // same product at the same location.
    const pairs = [
      ...new Set(results.map((r) => `${r.productId}:${r.locationId}`)),
    ];
    for (const pair of pairs) {
      const [productId, locationId] = pair.split(':').map(Number);
      await this.notifications.checkAndNotifyLowStock(productId, locationId);
    }

    return {
      message: 'Stock adjusted',
      batchId,
      applied: results.filter((r) => r.delta !== 0).length,
      unchanged: results.filter((r) => r.delta === 0).length,
      priceUpdates: priceChanges.length,
      byLocation: Array.from(byLocation.values()),
      results,
    };
  }

  /**
   * Current stock rows for a set of products at a set of locations, plus those
   * products with their variants — everything the count sheet needs for its
   * "System" column and its matrix grid, in one request instead of one per item.
   * A location-bound user only ever sees their own location's rows.
   */
  async stockLookup(
    productIds: number[],
    locationIds: number[],
    user: JwtPayload,
  ) {
    const tenantId = requireTenantId();
    const ids = [
      ...new Set(productIds.filter((n) => Number.isInteger(n) && n > 0)),
    ].slice(0, 200);
    const requestedLocations = [
      ...new Set(locationIds.filter((n) => Number.isInteger(n) && n > 0)),
    ].slice(0, 50);
    if (ids.length === 0) return { products: [], stock: [] };

    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, tenantId },
      select: {
        id: true,
        sku: true,
        brand: true,
        baseName: true,
        hasVariants: true,
        currentBuyPrice: true,
        currentSellPrice: true,
        reorderLevel: true,
        variants: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            sku: true,
            attributes: true,
            buyPrice: true,
            sellPrice: true,
            reorderLevel: true,
            reorderQty: true,
          },
        },
      },
    });

    const scopedLocations =
      user.isSuperuser ||
      user.permissions?.includes('inventory.all-locations') ||
      user.locationId == null
        ? requestedLocations
        : requestedLocations.filter((id) => id === user.locationId);

    // No usable location scope (nothing chosen, or only foreign locations for a
    // bound user) means nothing to report — never fall back to "all locations".
    const stock =
      scopedLocations.length === 0
        ? []
        : await this.prisma.inventory.findMany({
            where: {
              tenantId,
              productId: { in: ids },
              locationId: { in: scopedLocations },
            },
            select: {
              productId: true,
              variantId: true,
              locationId: true,
              quantity: true,
              avgCost: true,
            },
          });

    return { products, stock };
  }

  /**
   * Add a new variant to an existing product on the fly (restock inline flow).
   * SKU auto-generates as `{productSKU}-V{n}` (next free n). When a quantity +
   * storeId are given, the stock lands immediately at that location (the same
   * direct-landing behavior as an owner-operated restock).
   */
  /**
   * Resolve where variant initial stock should be deposited when the form did
   * not send an explicit store: the user's own location, or (standalone shops)
   * the org's SHOP location. Without this fallback, variant stock added via the
   * product form / restock page was silently ignored whenever storeId was empty.
   */
  private async resolveDepositLocation(
    user: JwtPayload,
    explicitStoreId?: number | null,
  ): Promise<number | null> {
    if (explicitStoreId) return explicitStoreId;
    const tenantId = getCurrentTenantId();
    if (tenantId == null) return user.locationId ?? null;
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { standalone: true },
    });
    if (org?.standalone === true) {
      return (
        user.locationId ??
        (await this.prisma.location.findFirst({
          where: { tenantId, type: LocationType.SHOP },
        }))?.id ??
        null
      );
    }
    return user.locationId ?? null;
  }

  async addVariant(productId: number, dto: AddVariantDto, user: JwtPayload) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, sku: true, brand: true, baseName: true, currentBuyPrice: true },
    });
    if (!product) throw new NotFoundException(tr('errors.productNotFound'));

    const tenantId = getCurrentTenantId();

    // Auto-generate SKU: {productSKU}-V{n} with the next free n.
    let sku = dto.sku?.trim() || '';
    if (!sku) {
      const existing = await this.prisma.productVariant.findMany({
        where: { productId },
        select: { sku: true },
      });
      const used = new Set(existing.map((v) => v.sku));
      let n = 1;
      sku = `${product.sku}-V${n}`;
      while (used.has(sku)) {
        n += 1;
        sku = `${product.sku}-V${n}`;
      }
    }

    const variant = await this.prisma.productVariant.create({
      data: {
        productId,
        tenantId,
        sku,
        barcode: dto.barcode?.trim() || null,
        attributes: dto.attributes ?? {},
        buyPrice: dto.buyPrice ?? null,
        sellPrice: dto.sellPrice ?? null,
        reorderLevel: dto.reorderLevel ?? 0,
        reorderQty: dto.reorderQty ?? null,
      },
    });

    // Optional immediate deposit at the given location — or a sensible default
    // (user's own location / org shop) so variant stock is never silently lost.
    const depositLocationId = await this.resolveDepositLocation(
      user,
      dto.storeId ?? null,
    );
    if (dto.quantity && dto.quantity > 0 && depositLocationId) {
      const location = await this.prisma.location.findUnique({
        where: { id: depositLocationId },
      });
      if (location) {
        await inventoryUpsert(this.prisma, {
          tenantId: requireTenantId(),
          productId,
          variantId: variant.id,
          locationId: depositLocationId,
          increment: dto.quantity,
          unitCost: dto.buyPrice ?? product.currentBuyPrice ?? null,
        });

        // Universal finance: procurement posting (Inventory ↔ AP) for the
        // new variant stock that just landed.
        await this.finance
          .postProcurement({
            ref: `PRDV-${variant.id}`,
            description: `New variant stock ${dto.quantity} × ${product.brand} ${product.baseName} (${variant.sku})`,
            amount: (dto.buyPrice ?? product.currentBuyPrice ?? 0) * dto.quantity,
            entryDate: new Date(),
            createdById: user.sub,
            paid: false, // goods received on account (AP)
            tenantId: getCurrentTenantId(),
          })
          .catch(() => false);

        await this.notifications
          .notifyLocation(
            'Variant Added',
            `New ${product.brand} ${product.baseName} variant (${variant.sku}) stocked with ${dto.quantity} unit(s)`,
            depositLocationId,
            { productId },
          )
          .catch(() => undefined);
      }
    }

    return variant;
  }
}

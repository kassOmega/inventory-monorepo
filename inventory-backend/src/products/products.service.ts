import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LocationType,
  ProductKind,
  RequestItemStatus,
  RequestStatus,
  RequestType,
} from '@prisma/client';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { Paging, pagedResult } from '../common/pagination.util';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { AddVariantDto } from './dto/add-variant.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { inventorySet, inventoryUpsert } from '../common/inventory.util';

const round2 = (n: number) => Math.round(n * 100) / 100;

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
          `Variant ${i + 1}: buy and sell prices are required for variant products.`,
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
        `A product "${existing.brand} ${existing.baseName}" already exists. Please edit the existing product instead of creating a duplicate.`,
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

    const tenantId = getCurrentTenantId();
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

    if (!product) throw new NotFoundException('Product not found');

    return product;
  }

  async update(id: number, dto: UpdateProductDto, user: JwtPayload) {
    if (dto.currentBuyPrice || dto.currentSellPrice) {
      const existing = await this.prisma.product.findUnique({ where: { id } });
      if (existing) {
        await this.prisma.priceHistory.create({
          data: {
            productId: id,
            oldBuyPrice: existing.currentBuyPrice,
            newBuyPrice: dto.currentBuyPrice ?? existing.currentBuyPrice,
            oldSellPrice: existing.currentSellPrice,
            newSellPrice: dto.currentSellPrice ?? existing.currentSellPrice,
            updatedById: 1, // Hardcoded for now
          },
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
            },
          });
          // Deposit initial quantity for brand-new variants at the resolved
          // store/shop location (owner-operated direct landing).
          if (depositLocationId && v.quantity > 0) {
            await inventoryUpsert(this.prisma, {
              tenantId: getCurrentTenantId(),
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
    if (!product) throw new NotFoundException('Product not found');

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

  async adjustStock(productId: number, dto: AdjustStockDto, user: JwtPayload) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
    });
    if (!location) throw new NotFoundException('Location not found');

    // Reconciliation: compare the counted vs system stock, then book the value
    // difference (surplus/shortage) via an Inventory Adjustment journal so the
    // Inventory Asset ledger stays in sync with the physical count.
    const before = await this.prisma.inventory.findFirst({
      where: {
        tenantId: getCurrentTenantId(),
        productId,
        variantId: null,
        locationId: dto.locationId,
      },
    });
    const delta = round2(dto.quantity - (before?.quantity ?? 0));

    await inventorySet(this.prisma, {
      productId,
      locationId: dto.locationId,
      quantity: dto.quantity,
    });

    if (delta !== 0) {
      const unitCost = before?.avgCost ?? product.currentBuyPrice ?? 0;
      await this.finance
        .postInventoryAdjustment({
          ref: `ADJ-${productId}-${dto.locationId}-${Date.now()}`,
          description: `Inventory adjustment: ${product.brand} ${product.baseName} at ${location.name} — count ${dto.quantity} (was ${before?.quantity ?? 0})${dto.reason ? ` — ${dto.reason}` : ''}`,
          signedAmount: round2(delta * unitCost),
          createdById: user.sub,
          tenantId: getCurrentTenantId(),
        })
        .catch(() => false);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        action: 'STOCK_ADJUST',
        details: `Adjusted ${product.brand} ${product.baseName} to ${dto.quantity} at ${location.name}${dto.reason ? ` — ${dto.reason}` : ''}`,
      },
    });

    await this.notifications.checkAndNotifyLowStock(productId, dto.locationId);

    return { message: 'Stock adjusted successfully' };
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
    if (!product) throw new NotFoundException('Product not found');

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

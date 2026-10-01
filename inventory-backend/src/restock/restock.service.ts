import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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
import { inventoryUpsert } from '../common/inventory.util';
import {
  PriceChange,
  newPriceBatchRef,
  recordPriceChanges,
} from '../common/price-history.util';
import { requireTenantId } from '../common/tenant/tenant.context';
import { itemDisplayName } from '../common/variant-label.util';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { tr } from '../i18n/i18n.service';
import { RegisterPurchaseDto } from './dto/register-purchase.dto';
import { RestockDto } from './dto/restock.dto';
import { BatchRestockDto } from './dto/batch-restock.dto';

@Injectable()
export class RestockService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private finance: FinanceService,
  ) {}

  /**
   * Restock a location (STORE or SHOP).
   *
   * - Owner + receivers assigned → deposit: STORE_TO_OWNER request,
   *   AWAITING_CONFIRMATION, item STORED; the receiver confirms receipt.
   * - Owner + no receiver assigned → direct stock: inventory is upserted
   *   immediately and a COMPLETED request is recorded so the restock stays
   *   fully queryable in StockRequest history.
   * - Non-owner (storekeeper or shop employee) → PENDING request for the
   *   owner to store/reject; the requester then confirms receipt.
   *
   * Shop-target requests set shopId = target.id (alongside storeId) so the
   * shop sees them in the Requests list and reports keep working.
   */
  async restock(dto: RestockDto, user: JwtPayload) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { category: { select: { name: true } } },
    });
    if (!product) throw new BadRequestException(tr('errors.productNotFound'));

    // Resolve the variant when restocking a variant product.
    let variantId: number | null = dto.variantId ?? null;
    if (variantId != null) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: variantId, productId: dto.productId },
        select: { id: true },
      });
      if (!variant) {
        throw new BadRequestException('Variant not found for this product');
      }
    } else if (product.hasVariants) {
      throw new BadRequestException('Please select a variant for this product');
    }

    // Perishable restocks must carry batch + expiry info.
    if (product.isPerishable && (!dto.batchNumber || !dto.expiryDate)) {
      throw new BadRequestException(
        'Batch number and expiry date are required for perishable products',
      );
    }

    const tenantId = requireTenantId();
    // Standalone businesses are owner-operated single shops: restocks add
    // stock directly (inventory auto-updates) without a confirmation step,
    // and the owner never has to pick a location.
    const org =
      tenantId != null
        ? await this.prisma.organization.findUnique({
            where: { id: tenantId },
            select: { name: true, standalone: true },
          })
        : null;
    const isStandaloneOrg = org?.standalone === true;

    // Resolve the receiving location. Standalone orgs own a single hidden shop
    // that the system manages (lazily created on first restock); other orgs
    // require an explicit storeId.
    let target: { id: number; type: LocationType; name: string } | null = null;
    if (isStandaloneOrg) {
      if (dto.storeId != null) {
        target = await this.prisma.location.findUnique({
          where: { id: dto.storeId },
        });
      } else {
        target = await this.prisma.location.findFirst({
          where: { tenantId, type: LocationType.SHOP },
        });
        if (!target) {
          target = await this.prisma.location.create({
            data: {
              name: org?.name ?? 'Shop',
              type: LocationType.SHOP,
              tenantId,
            },
          });
        }
      }
    } else if (dto.storeId != null) {
      target = await this.prisma.location.findUnique({
        where: { id: dto.storeId },
      });
    }

    if (
      !target ||
      (target.type !== LocationType.STORE && target.type !== LocationType.SHOP)
    ) {
      throw new BadRequestException(tr('errors.locationNotFound'));
    }
    const isOwner = user.isSuperuser === true;
    // StockRequest.storeId is the receiving location. When that location is a
    // SHOP we also populate shopId so the shop can see its own restock
    // requests (the Requests list filters shop users by shopId).
    const shopId = target.type === LocationType.SHOP ? target.id : null;

    // Non-owners may only restock their own location and cannot change prices.
    if (!isOwner) {
      if (
        user.locationId !== dto.storeId &&
        !user.permissions?.includes('inventory.all-locations')
      ) {
        throw new ForbiddenException(
          'You can only restock your own store/shop',
        );
      }
      if (dto.newBuyPrice != null || dto.newSellPrice != null) {
        throw new BadRequestException(
          'Only the owner can change prices on a restock',
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Owner: apply price changes (when provided) + record price history.
      if (isOwner) {
        const newBuyPrice = dto.newBuyPrice ?? product.currentBuyPrice;
        const newSellPrice = dto.newSellPrice ?? product.currentSellPrice;
        if (
          product.currentBuyPrice !== newBuyPrice ||
          product.currentSellPrice !== newSellPrice
        ) {
          await tx.product.update({
            where: { id: dto.productId },
            data: {
              currentBuyPrice: newBuyPrice,
              currentSellPrice: newSellPrice,
            },
          });
          await recordPriceChanges(tx, {
            tenantId,
            userId: user.sub,
            source: 'RESTOCK',
            changes: [
              {
                productId: dto.productId,
                oldBuyPrice: product.currentBuyPrice,
                newBuyPrice,
                oldSellPrice: product.currentSellPrice,
                newSellPrice,
              },
            ],
          });
        }
      }

      // --- Owner path ---
      if (isOwner) {
        // Receivers = non-owner staff assigned to the target location.
        // (The restocking owner themself and owner accounts never count as
        // receivers — a solo operator would otherwise have to confirm their
        // own restock.)
        const receiverCount = await tx.user.count({
          where: {
            locationId: target.id,
            isOwnerAccount: false,
            NOT: [{ role: { isSystem: true } }, { id: user.sub }],
          },
        });

        // Owner-operated location (no staff): stock directly. A COMPLETED
        // request is still written so 100% of restock activity is queryable.
        if (receiverCount === 0) {
          await inventoryUpsert(tx, {
            tenantId,
            productId: dto.productId,
            variantId,
            locationId: target.id,
            increment: dto.quantity,
            unitCost: dto.newBuyPrice ?? product.currentBuyPrice ?? null,
          });

          // Perishable: attribute the incoming units to their batch (FIFO).
          let batchId: number | null = null;
          if (product.isPerishable) {
            batchId = await this.upsertBatch(tx, {
              tenantId,
              productId: dto.productId,
              batchNumber: dto.batchNumber!,
              manufactureDate: dto.manufactureDate,
              expiryDate: dto.expiryDate,
              increment: dto.quantity,
            });
          }

          const req = await tx.stockRequest.create({
            data: {
              requestType: RequestType.STORE_TO_OWNER,
              storeId: target.id,
              shopId,
              createdById: user.sub,
              approvedById: user.sub,
              status: RequestStatus.COMPLETED,
              items: {
                create: {
                  productId: dto.productId,
                  variantId,
                  batchId,
                  quantityStored: dto.quantity,
                  quantityReceived: dto.quantity,
                  status: RequestItemStatus.RECEIVED,
                  confirmedById: user.sub,
                  confirmedAt: new Date(),
                },
              },
            },
            include: { items: true },
          });

          // Universal finance: procurement posting — Debit Inventory Asset ↔
          // Credit Accounts Payable so restocking never skews Net Income.
          const unitCost = dto.newBuyPrice ?? product.currentBuyPrice;
          await this.finance
            .postProcurement({
              ref: `RST-${req.id}-${req.items[0]?.id ?? 0}`,
              description: `Restock ${dto.quantity} × ${product.brand} ${product.baseName} (${(product as any).category?.name ?? 'uncategorized'}) at ${target.name}`,
              amount: unitCost * dto.quantity,
              entryDate: new Date(),
              createdById: user.sub,
              paid: false, // goods received on account (AP)
              tenantId,
              tx,
            })
            .catch(() => false);

          await tx.requestActivity.create({
            data: {
              requestId: req.id,
              action: 'CREATED',
              actorId: user.sub,
              details: 'Stocked directly — no confirmation required',
            },
          });

          await tx.auditLog.create({
            data: {
              userId: user.sub,
              action: 'RESTOCK',
              details: `Directly stocked ${dto.quantity} units of ${product.brand} ${product.baseName} to ${target.name}`,
            },
          });

          return { req, mode: 'direct' as const };
        }

        // Receivers are assigned: deposit the goods and let them confirm.
        let batchId: number | null = null;
        if (product.isPerishable) {
          batchId = await this.upsertBatch(tx, {
            tenantId,
            productId: dto.productId,
            batchNumber: dto.batchNumber!,
            manufactureDate: dto.manufactureDate,
            expiryDate: dto.expiryDate,
            increment: 0,
          });
        }
        const req = await tx.stockRequest.create({
          data: {
            requestType: RequestType.STORE_TO_OWNER,
            storeId: target.id,
            shopId,
            createdById: user.sub,
            status: RequestStatus.AWAITING_CONFIRMATION,
            items: {
              create: {
                productId: dto.productId,
                variantId,
                batchId,
                quantityStored: dto.quantity,
                status: RequestItemStatus.STORED,
              },
            },
          },
        });

        await tx.requestActivity.create({
          data: {
            requestId: req.id,
            action: 'CREATED',
            actorId: user.sub,
            details: `${dto.quantity} unit(s) deposited — awaiting receipt confirmation`,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: user.sub,
            action: 'RESTOCK',
            details: `Deposited ${dto.quantity} units of ${product.brand} ${product.baseName} to ${target.name} (pending receipt confirmation)`,
          },
        });

        return { req, mode: 'deposit' as const };
      }

      // --- Non-owner path (storekeeper or shop employee) ---
      let batchId: number | null = null;
      if (product.isPerishable) {
        batchId = await this.upsertBatch(tx, {
          tenantId,
          productId: dto.productId,
          batchNumber: dto.batchNumber!,
          manufactureDate: dto.manufactureDate,
          expiryDate: dto.expiryDate,
          increment: 0,
        });
      }
      const req = await tx.stockRequest.create({
        data: {
          tenantId,
          requestType: RequestType.STORE_TO_OWNER,
          storeId: target.id,
          shopId,
          createdById: user.sub,
          status: RequestStatus.PENDING,
          items: {
            create: {
              tenantId,
              productId: dto.productId,
              variantId,
              batchId,
              quantityRequested: dto.quantity,
              status: RequestItemStatus.PENDING,
            },
          },
        },
      });

      await tx.requestActivity.create({
        data: {
          requestId: req.id,
          action: 'CREATED',
          actorId: user.sub,
          details: `Requested ${dto.quantity} unit(s) — awaiting owner approval`,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.sub,
          action: 'RESTOCK',
          details: `Restock requested for ${target.name}: ${dto.quantity} units of ${product.brand} ${product.baseName} (pending owner approval)`,
        },
      });

      return { req, mode: 'pending' as const };
    });

    // --- Notifications + responses ---
    if (result.mode === 'direct') {
      await this.notifications
        .notifyLocation(
          'Stock Added',
          `${dto.quantity} units of ${product.brand} ${product.baseName} were stocked directly at ${target.name}`,
          target.id,
          { productId: dto.productId },
        )
        .catch(() => undefined);

      return {
        message: 'Restock stocked directly — no confirmation needed.',
        requestId: result.req.id,
      };
    }

    if (result.mode === 'deposit') {
      // Location-scoped notification: visible only to the shopkeepers assigned
      // to this location (the owner who created the restock is not shown it —
      // buildVisibleWhere scopes everyone by company + location).
      await this.notifications.notifyLocation(
        'Stock Ready for Receipt',
        `Request #${result.req.id}: ${dto.quantity} units of ${product.brand} ${product.baseName} ready for you to confirm`,
        target.id,
        { productId: dto.productId },
      );

      return {
        message: 'Restock submitted — pending receiver confirmation.',
        requestId: result.req.id,
      };
    }

    // pending: notify the owner to review and store/reject the request.
    await this.notifications
      .notifyOwner(
        'Restock Awaiting Approval',
        `${dto.quantity} units of ${product.brand} ${product.baseName} for ${target.name} are waiting for your approval (store) or rejection.`,
        { locationId: target.id, productId: dto.productId },
      )
      .catch(() => undefined);

    return {
      message: 'Restock submitted — awaiting owner approval.',
      requestId: result.req.id,
    };
  }

  /**
   * Restock many items in one submission: several products (with their variants)
   * across several locations.
   *
   * Validated up front and applied in one transaction. Items are grouped by
   * receiving location and each location gets ONE request carrying all of its
   * items — so a delivery is one document (and one procurement entry) per store
   * instead of one per line. Per line prices are applied per variant and the
   * product's own numbers are kept as the variant average.
   */
  async restockBatch(dto: BatchRestockDto, user: JwtPayload) {
    const tenantId = requireTenantId();
    const isOwner = user.isSuperuser === true;
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { name: true, standalone: true },
    });
    const isStandaloneOrg = org?.standalone === true;

    // Standalone businesses own a single hidden shop; resolve (or create) it once
    // so every row has a real target even when the form sends no location.
    let standaloneShopId: number | null = null;
    if (isStandaloneOrg && dto.storeId == null) {
      const existing = await this.prisma.location.findFirst({
        where: { tenantId, type: LocationType.SHOP },
        select: { id: true },
      });
      standaloneShopId =
        existing?.id ??
        (
          await this.prisma.location.create({
            data: { name: org?.name ?? 'Shop', type: LocationType.SHOP, tenantId },
            select: { id: true },
          })
        ).id;
    }

    const items = dto.items;
    const productIds = [...new Set(items.map((i) => Number(i.productId)))];
    const requestedLocationIds = [
      ...new Set(
        items
          .map((i) => Number(i.locationId ?? dto.storeId ?? standaloneShopId))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const variantIds = [
      ...new Set(
        items
          .map((i) => Number(i.variantId))
          .filter((v) => Number.isInteger(v) && v > 0),
      ),
    ];

    const [products, locations, variants] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true, brand: true, baseName: true, hasVariants: true, isPerishable: true,
          currentBuyPrice: true, currentSellPrice: true,
        },
      }),
      requestedLocationIds.length
        ? this.prisma.location.findMany({
            where: { id: { in: requestedLocationIds }, tenantId },
            select: { id: true, name: true, type: true },
          })
        : Promise.resolve([] as any[]),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, productId: true, sku: true, attributes: true, buyPrice: true, sellPrice: true },
          })
        : Promise.resolve([] as any[]),
    ]);
    const productById = new Map((products as any[]).map((p) => [p.id, p]));
    const locationById = new Map((locations as any[]).map((l) => [l.id, l]));
    const variantById = new Map((variants as any[]).map((v) => [v.id, v]));

    const errors: { index: number; productId?: number; locationId?: number; message: string }[] = [];
    const seen = new Set<string>();
    const targets: any[] = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const productId = Number(item.productId);
      const variantId = item.variantId != null ? Number(item.variantId) : null;
      const locationId = Number(item.locationId ?? dto.storeId ?? standaloneShopId);
      const fail = (message: string) => errors.push({ index, productId, locationId, message });

      const product = productById.get(productId);
      if (!product) {
        fail('Product not found');
        continue;
      }
      const location = locationById.get(locationId);
      if (!location || (location.type !== LocationType.STORE && location.type !== LocationType.SHOP)) {
        fail('Location not found');
        continue;
      }
      if (product.hasVariants && variantId === null) {
        fail('Select a variant to restock — this product keeps stock per variant.');
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
      if (!(Number(item.quantity) > 0)) {
        fail('Quantity must be greater than zero.');
        continue;
      }
      if (product.isPerishable && (!item.batchNumber || !item.expiryDate)) {
        fail('Batch number and expiry date are required for perishable products.');
        continue;
      }
      // Only owners may move prices, and only within their own business.
      if (!isOwner) {
        if (
          user.locationId !== locationId &&
          !user.permissions?.includes('inventory.all-locations')
        ) {
          fail('You can only restock your own store/shop.');
          continue;
        }
        if (item.buyPrice != null || item.sellPrice != null) {
          fail('Only the owner can change prices on a restock.');
          continue;
        }
      }
      const key = `${productId}|${variantId ?? 'base'}|${locationId}`;
      if (seen.has(key)) {
        fail('This item is listed twice for the same variant and location — remove the duplicate row.');
        continue;
      }
      seen.add(key);
      targets.push({ index, product, variant, location, ...item });
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Some rows could not be processed',
        errors,
      });
    }

    const priceBatchRef = newPriceBatchRef();
    const touchedProducts = new Set<number>();

    const results = await this.prisma.$transaction(async (tx) => {
      // --- 1. Prices, line by line ---
      const priceChanges: PriceChange[] = [];
      if (isOwner) {
        for (const target of targets) {
          const { product, variant, buyPrice, sellPrice } = target;
          if (buyPrice == null && sellPrice == null) continue;
          if (variant) {
            const newBuy = buyPrice ?? variant.buyPrice ?? 0;
            const newSell = sellPrice ?? variant.sellPrice ?? 0;
            if (
              newBuy !== (variant.buyPrice ?? 0) ||
              newSell !== (variant.sellPrice ?? 0)
            ) {
              await tx.productVariant.update({
                where: { id: variant.id },
                data: { buyPrice: newBuy, sellPrice: newSell },
              });
              priceChanges.push({
                productId: product.id,
                variantId: variant.id,
                oldBuyPrice: variant.buyPrice ?? 0,
                newBuyPrice: newBuy,
                oldSellPrice: variant.sellPrice ?? 0,
                newSellPrice: newSell,
              });
              touchedProducts.add(product.id);
            }
          } else {
            const newBuy = buyPrice ?? product.currentBuyPrice;
            const newSell = sellPrice ?? product.currentSellPrice;
            if (
              newBuy !== product.currentBuyPrice ||
              newSell !== product.currentSellPrice
            ) {
              await tx.product.update({
                where: { id: product.id },
                data: { currentBuyPrice: newBuy, currentSellPrice: newSell },
              });
              priceChanges.push({
                productId: product.id,
                oldBuyPrice: product.currentBuyPrice,
                newBuyPrice: newBuy,
                oldSellPrice: product.currentSellPrice,
                newSellPrice: newSell,
              });
              touchedProducts.add(product.id);
            }
          }
        }

        // A variant move updates the product's own numbers too: they are the
        // average across variants, exactly as everywhere else.
        for (const productId of touchedProducts) {
          const product = productById.get(productId);
          const rows = await tx.productVariant.findMany({
            where: { productId },
            select: { buyPrice: true, sellPrice: true },
          });
          if (!rows.length) continue;
          const avg = (pick: (r: any) => number | null) =>
            round2(
              rows.reduce((sum: number, r: any) => sum + (pick(r) ?? 0), 0) /
                rows.length,
            );
          const avgBuy = avg((r) => r.buyPrice);
          const avgSell = avg((r) => r.sellPrice);
          if (
            product &&
            (product.currentBuyPrice !== avgBuy ||
              product.currentSellPrice !== avgSell)
          ) {
            await tx.product.update({
              where: { id: productId },
              data: { currentBuyPrice: avgBuy, currentSellPrice: avgSell },
            });
            priceChanges.push({
              productId,
              oldBuyPrice: product.currentBuyPrice,
              newBuyPrice: avgBuy,
              oldSellPrice: product.currentSellPrice,
              newSellPrice: avgSell,
            });
          }
        }
      }

      // --- 2. One request (and one procurement entry) per receiving location ---
      const byLocation = new Map<number, any[]>();
      for (const target of targets) {
        const list = byLocation.get(target.location.id) ?? [];
        list.push(target);
        byLocation.set(target.location.id, list);
      }

      const perLocation: any[] = [];
      for (const [locationId, lines] of byLocation) {
        const location = locationById.get(locationId);
        const shopId = location.type === LocationType.SHOP ? location.id : null;
        // Whether staff must confirm is a property of the LOCATION, so it is
        // decided once per location instead of once per line.
        const receiverCount = await tx.user.count({
          where: {
            locationId,
            isOwnerAccount: false,
            NOT: [{ role: { isSystem: true } }, { id: user.sub }],
          },
        });
        const mode = !isOwner
          ? 'pending'
          : receiverCount === 0
            ? 'direct'
            : 'deposit';

        const itemRows: any[] = [];
        let totalCost = 0;
        for (const line of lines) {
          const unitCost =
            line.buyPrice ??
            line.variant?.buyPrice ??
            line.product.currentBuyPrice ??
            0;
          line.unitCost = unitCost;
          line.lineCost = round2(unitCost * Number(line.quantity));
          totalCost = round2(totalCost + line.lineCost);

          if (mode === 'direct') {
            await inventoryUpsert(tx, {
              tenantId,
              productId: line.product.id,
              variantId: line.variant?.id ?? null,
              locationId,
              increment: line.quantity,
              unitCost,
            });
          }

          let batchId: number | null = null;
          if (line.product.isPerishable) {
            batchId = await this.upsertBatch(tx, {
              tenantId,
              productId: line.product.id,
              batchNumber: line.batchNumber!,
              manufactureDate: line.manufactureDate,
              expiryDate: line.expiryDate,
              increment: mode === 'direct' ? line.quantity : 0,
            });
          }

          const base = {
            productId: line.product.id,
            variantId: line.variant?.id ?? null,
            batchId,
          };
          if (mode === 'direct') {
            itemRows.push({
              ...base,
              quantityStored: line.quantity,
              quantityReceived: line.quantity,
              status: RequestItemStatus.RECEIVED,
              confirmedById: user.sub,
              confirmedAt: new Date(),
            });
          } else if (mode === 'deposit') {
            itemRows.push({
              ...base,
              tenantId,
              quantityStored: line.quantity,
              status: RequestItemStatus.STORED,
            });
          } else {
            itemRows.push({
              ...base,
              tenantId,
              quantityRequested: line.quantity,
              status: RequestItemStatus.PENDING,
            });
          }
        }

        const status =
          mode === 'direct'
            ? RequestStatus.COMPLETED
            : mode === 'deposit'
              ? RequestStatus.AWAITING_CONFIRMATION
              : RequestStatus.PENDING;
        const req = await tx.stockRequest.create({
          data: {
            tenantId,
            requestType: RequestType.STORE_TO_OWNER,
            storeId: locationId,
            shopId,
            createdById: user.sub,
            ...(mode === 'direct' ? { approvedById: user.sub } : {}),
            status,
            items: { create: itemRows },
          },
          include: { items: true },
        });

        // One procurement posting per store, at the value of its items.
        let journalRef: string | null = null;
        if (mode === 'direct') {
          const ref = `RST-${req.id}`;
          const posted = await this.finance
            .postProcurement({
              ref,
              description: `Restock ${lines.length} item(s) at ${location.name}${
                dto.vendor ? ` — ${dto.vendor}` : ''
              }`,
              amount: totalCost,
              entryDate: new Date(),
              createdById: user.sub,
              paid: false, // goods received on account (AP)
              tenantId,
              tx,
            })
            .catch(() => false);
          journalRef = posted ? ref : null;
        }

        await tx.requestActivity.create({
          data: {
            requestId: req.id,
            action: 'CREATED',
            actorId: user.sub,
            details:
              mode === 'direct'
                ? `Stocked directly — ${lines.length} item(s), no confirmation required`
                : mode === 'deposit'
                  ? `${lines.length} item(s) deposited — awaiting receipt confirmation`
                  : `${lines.length} item(s) requested — awaiting owner approval`,
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            userId: user.sub,
            action: 'RESTOCK',
            details: `Restock at ${location.name}: ${lines.length} item(s) — ${
              mode === 'direct'
                ? 'stocked directly'
                : mode === 'deposit'
                  ? 'awaiting receipt'
                  : 'awaiting approval'
            }`,
          },
        });

        perLocation.push({
          locationId,
          locationName: location.name,
          mode,
          requestId: req.id,
          items: lines.length,
          quantity: round2(
            lines.reduce((s, l) => s + Number(l.quantity), 0),
          ),
          totalCost,
          journalRef,
        });
      }

      if (priceChanges.length > 0) {
        // Variant moves keep the product's own row, so the history page can group
        // the detail under one main row for the whole action.
        await recordPriceChanges(tx, {
          tenantId,
          userId: user.sub,
          source: 'RESTOCK',
          batchRef: priceBatchRef,
          changes: priceChanges,
          keepUnchanged: true,
        });
      }

      return perLocation;
    });

    // --- Notifications, mirroring the single-item restock ---
    for (const loc of results) {
      if (loc.mode === 'direct') {
        await this.notifications
          .notifyLocation(
            'Stock Added',
            `${loc.quantity} unit(s) were stocked directly at ${loc.locationName}`,
            loc.locationId,
            {},
          )
          .catch(() => undefined);
      } else if (loc.mode === 'deposit') {
        await this.notifications
          .notifyLocation(
            'Stock Ready for Receipt',
            `Request #${loc.requestId}: ${loc.quantity} unit(s) ready for you to confirm`,
            loc.locationId,
            {},
          )
          .catch(() => undefined);
      } else {
        await this.notifications
          .notifyOwner(
            'Restock Awaiting Approval',
            `${loc.quantity} unit(s) for ${loc.locationName} are waiting for your approval (store) or rejection.`,
            { locationId: loc.locationId },
          )
          .catch(() => undefined);
      }
    }

    const anyPending = results.some((l) => l.mode !== 'direct');
    return {
      message: anyPending
        ? 'Restock submitted — awaiting confirmation.'
        : 'Restock stocked directly — no confirmation needed.',
      byLocation: results,
      results: targets.map((t) => ({
        index: t.index,
        productId: t.product.id,
        variantId: t.variant?.id ?? null,
        locationId: t.location.id,
        label: itemDisplayName(t.product, t.variant),
        quantity: t.quantity,
        unitCost: t.unitCost ?? 0,
        lineCost: t.lineCost ?? 0,
      })),
    };
  }


  /**
   * Find-or-create a product batch and increment its quantity. ProductBatch is
   * product-level (unique per tenant/product/batchNumber) — the batch tracks
   * the expiry timeline; per-variant availability lives on Inventory.
   */
  private async upsertBatch(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: number | null;
      productId: number;
      batchNumber: string;
      manufactureDate?: string;
      expiryDate?: string;
      increment: number;
    },
  ): Promise<number> {
    const batchNumber =
      args.batchNumber.trim() ||
      `BATCH-${Date.now().toString(36).toUpperCase()}`;
    const existing = await tx.productBatch.findFirst({
      where: {
        tenantId: args.tenantId ?? null,
        productId: args.productId,
        batchNumber,
      },
    });
    if (existing) {
      if (args.increment > 0) {
        await tx.productBatch.update({
          where: { id: existing.id },
          data: {
            quantity: { increment: args.increment },
            ...(args.expiryDate
              ? { expiryDate: new Date(args.expiryDate) }
              : {}),
            ...(args.manufactureDate
              ? { manufactureDate: new Date(args.manufactureDate) }
              : {}),
          },
        });
      }
      return existing.id;
    }
    const created = await tx.productBatch.create({
      data: {
        tenantId: args.tenantId ?? null,
        productId: args.productId,
        batchNumber,
        manufactureDate: args.manufactureDate
          ? new Date(args.manufactureDate)
          : null,
        expiryDate: args.expiryDate ? new Date(args.expiryDate) : null,
        quantity: args.increment > 0 ? args.increment : 0,
      },
    });
    return created.id;
  }
  /**
   * Inventory purchase / expense registration (the "Inventory Purchase" tab of
   * the dual-mode Add Expense modal).
   *
   * Atomically: resolves or creates the item (+ initial variant), derives the
   * unit buy price from the total spent, updates the targeted buy price,
   * increments physical stock at the resolved location, and posts the
   * procurement journal (Debit Inventory Asset <-> Credit Cash/AP) so the
   * purchase has zero P&L impact. Records a COMPLETED stock request so the
   * purchase stays fully queryable in history.
   */
  async registerPurchase(dto: RegisterPurchaseDto, user: JwtPayload) {
    const tenantId = requireTenantId();
    // Hospitality multi-variant purchases carry per-variant quantity + cost in
    // `lines` (existing item) or `createNew.variants` (on-the-fly item). Their
    // aggregates (quantity / totalAmount / unitBuyPrice) are derived from those
    // lines; single-item purchases keep the top-level values as-is.
    const isMultiVariant =
      (dto.lines?.length ?? 0) > 0 ||
      (dto.createNew?.variants?.length ?? 0) > 0;
    const quantity = isMultiVariant
      ? (dto.lines ?? []).reduce((s, l) => s + l.quantity, 0) +
        (dto.createNew?.variants ?? []).reduce((s, v) => s + v.quantity, 0)
      : dto.quantity;
    if (!(quantity > 0)) {
      throw new BadRequestException('Quantity must be greater than zero');
    }
    const totalAmount = isMultiVariant
      ? (dto.lines ?? []).reduce((s, l) => s + l.totalCost, 0) +
        (dto.createNew?.variants ?? []).reduce((s, v) => s + v.totalCost, 0)
      : dto.totalAmount;
    const unitBuyPrice = round2(totalAmount / quantity);
    if (!(unitBuyPrice > 0)) {
      throw new BadRequestException('Total amount must be greater than zero');
    }
    const paid = dto.paid ?? true;
    const isOwner = user.isSuperuser === true;

    // Duplicate guard for on-the-fly creation (case-insensitive brand + name).
    if (dto.createNew) {
      const existing = await this.prisma.product.findFirst({
        where: {
          brand: {
            equals: dto.createNew.brand?.trim() ?? '',
            mode: 'insensitive',
          },
          baseName: {
            equals: dto.createNew.name.trim(),
            mode: 'insensitive',
          },
        },
        select: { id: true, brand: true, baseName: true },
      });
      if (existing) {
        throw new BadRequestException(
          tr('errors.itemAlreadyExists', {
            name: [existing.brand, existing.baseName]
              .filter(Boolean)
              .join(' '),
          }),
        );
      }
    }

    // Resolve the receiving location (same rules as restock(), plus a default
    // that lets orgs with no locations yet (e.g. hospitality) record their
    // first purchase without manual setup).
    const org =
      tenantId != null
        ? await this.prisma.organization.findUnique({
            where: { id: tenantId },
            select: { name: true, standalone: true, businessType: true },
          })
        : null;
    const isStandaloneOrg = org?.standalone === true;
    // Multi-variant purchases are a hospitality-only capability. Retail and
    // distribution orgs keep the single-item purchase flow unchanged.
    if (isMultiVariant && org?.businessType !== 'HOSPITALITY') {
      throw new ForbiddenException(
        'Multi-variant purchases are only available to hospitality businesses.',
      );
    }
    let target: { id: number; type: LocationType; name: string } | null = null;
    if (isStandaloneOrg) {
      if (dto.storeId != null) {
        target = await this.prisma.location.findFirst({
          where: { id: dto.storeId },
        });
      } else {
        target = await this.prisma.location.findFirst({
          where: { tenantId, type: LocationType.SHOP },
        });
        if (!target) {
          target = await this.prisma.location.create({
            data: {
              name: org?.name ?? 'Shop',
              type: LocationType.SHOP,
              tenantId,
            },
          });
        }
      }
    } else if (dto.storeId != null) {
      target = await this.prisma.location.findFirst({
        where: { id: dto.storeId },
      });
    } else if (user.locationId != null) {
      target = await this.prisma.location.findFirst({
        where: { id: user.locationId },
      });
    } else {
      target = await this.prisma.location.findFirst({
        where: { type: { in: [LocationType.STORE, LocationType.SHOP] } },
        orderBy: { id: 'asc' },
      });
    }
    // No location exists for this org yet — auto-create a default store so the
    // purchase can land (mirrors the standalone SHOP auto-creation).
    if (!target && tenantId != null) {
      target = await this.prisma.location.create({
        data: {
          name: `${org?.name ?? 'Business'} Store`,
          type: LocationType.STORE,
          tenantId,
        },
      });
    }
    if (
      !target ||
      (target.type !== LocationType.STORE && target.type !== LocationType.SHOP)
    ) {
      throw new BadRequestException(
        'No store or location is set up for this business yet — create one before recording a purchase.',
      );
    }
    if (
      !isOwner &&
      !user.permissions?.includes('inventory.all-locations') &&
      user.locationId !== target.id
    ) {
      throw new ForbiddenException(
        'You can only purchase stock for your own store/shop',
      );
    }
    const shopId = target.type === LocationType.SHOP ? target.id : null;
    const targetLoc = target;

    const result = await this.prisma.$transaction(async (tx) => {
      // --- 1. Resolve or create the product + variant(s) ---
      let productId: number;
      let variantId: number | null = null;
      let product: any;
      let sellPrice: number;
      let productName: string;
      let categoryName = 'uncategorized';
      // Hospitality multi-variant purchase lines: one entry per variant with its
      // own quantity + total cost. Drives per-variant stock / pricing / request
      // items; stays empty for single-item purchases.
      const variantLines: {
        variantId: number;
        quantity: number;
        totalCost: number;
        unitBuyPrice: number;
      }[] = [];

      if (dto.createNew) {
        const createNew = dto.createNew;
        const kind = createNew.kind ?? ProductKind.GOODS;
        if (kind === ProductKind.INGREDIENT) {
          if (createNew.unitId == null) {
            throw new BadRequestException(
              'Unit of measure is required for ingredient items (e.g. kg, L, g).',
            );
          }
          if (createNew.categoryId == null) {
            throw new BadRequestException(
              'Category is required for ingredient items.',
            );
          }
        }
        if (createNew.categoryId == null) {
          throw new BadRequestException('Category is required for new items.');
        }
        const brand = createNew.brand?.trim() ?? '';
        const baseName = createNew.name.trim();
        const sku = `${brand.slice(0, 3).toUpperCase()}-${baseName.slice(0, 3).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        sellPrice = createNew.sellPrice ?? unitBuyPrice;
        const multiVariants = createNew.variants ?? [];
        const hasVariants =
          multiVariants.length > 0 ||
          (!!createNew.variantAttributes &&
            Object.keys(createNew.variantAttributes).length > 0);
        const created = await tx.product.create({
          data: {
            tenantId,
            brand,
            baseName,
            attributes: {},
            currentBuyPrice: unitBuyPrice,
            currentSellPrice: sellPrice,
            categoryId: createNew.categoryId,
            unitId: createNew.unitId ?? null,
            kind,
            sku,
            hasVariants,
            isPerishable: false,
            reorderLevel: 0,
          },
        });
        productId = created.id;
        product = created;
        productName = `${created.brand ?? ''} ${created.baseName ?? ''}`.trim();
        if (multiVariants.length > 0) {
          // Hospitality: one variant per draft line, each with its own unit buy
          // price (totalCost / quantity) and a unique SKU (V1, V2, ...).
          for (let i = 0; i < multiVariants.length; i += 1) {
            const v = multiVariants[i];
            const lineUnit = round2(v.totalCost / v.quantity);
            const createdVariant = await tx.productVariant.create({
              data: {
                tenantId,
                productId,
                sku: `${sku}-V${i + 1}`,
                attributes: v.attributes ?? {},
                buyPrice: lineUnit,
                sellPrice,
              },
            });
            variantLines.push({
              variantId: createdVariant.id,
              quantity: v.quantity,
              totalCost: v.totalCost,
              unitBuyPrice: lineUnit,
            });
          }
          variantId = variantLines[0].variantId;
        } else if (hasVariants && createNew.variantAttributes) {
          const createdVariant = await tx.productVariant.create({
            data: {
              tenantId,
              productId,
              sku: `${sku}-V1`,
              attributes: createNew.variantAttributes,
              buyPrice: unitBuyPrice,
              sellPrice,
            },
          });
          variantId = createdVariant.id;
        }
      } else {
        if (dto.productId == null) {
          throw new BadRequestException(
            'Select an existing item or create a new one.',
          );
        }
        const found = await tx.product.findUnique({
          where: { id: dto.productId },
          include: { category: { select: { name: true } } },
        });
        if (!found) throw new BadRequestException(tr('errors.productNotFound'));
        productId = found.id;
        product = found;
        productName = `${found.brand ?? ''} ${found.baseName ?? ''}`.trim();
        categoryName = (found as any).category?.name ?? 'uncategorized';
        sellPrice = found.currentSellPrice;
        if (dto.lines && dto.lines.length > 0) {
          // Hospitality multi-variant purchase of an existing variant product.
          if (!found.hasVariants) {
            throw new BadRequestException(
              'This item has no variants to purchase.',
            );
          }
          for (const line of dto.lines) {
            const variant = await tx.productVariant.findFirst({
              where: { id: line.variantId, productId },
              select: { id: true },
            });
            if (!variant) {
              throw new BadRequestException(
                tr('errors.variantNotFoundForProduct', { id: line.variantId }),
              );
            }
            variantLines.push({
              variantId: line.variantId,
              quantity: line.quantity,
              totalCost: line.totalCost,
              unitBuyPrice: round2(line.totalCost / line.quantity),
            });
          }
          variantId = variantLines[0].variantId;
        } else {
          variantId = dto.variantId ?? null;
          if (variantId != null) {
            const variant = await tx.productVariant.findFirst({
              where: { id: variantId, productId },
              select: { id: true },
            });
            if (!variant)
              throw new BadRequestException(
                'Variant not found for this product',
              );
          } else if (found.hasVariants) {
            throw new BadRequestException(
              'Please select a variant for this product',
            );
          }
        }
      }

      // --- 2. Buy-price updates ---
      const priceChanges: PriceChange[] = [];
      if (variantLines.length > 0) {
        // Per-variant lines: each variant's buy price is its own total / qty;
        // the root item reflects the weighted-average cost across the purchase.
        for (const line of variantLines) {
          const variant = await tx.productVariant.findUnique({
            where: { id: line.variantId },
            select: { buyPrice: true, sellPrice: true },
          });
          if (!variant) continue;
          if (variant.buyPrice !== line.unitBuyPrice) {
            await tx.productVariant.update({
              where: { id: line.variantId },
              data: { buyPrice: line.unitBuyPrice },
            });
          }
          if (
            variant.buyPrice !== line.unitBuyPrice ||
            variant.sellPrice !== sellPrice
          ) {
            priceChanges.push({
              productId,
              variantId: line.variantId,
              oldBuyPrice: variant.buyPrice ?? 0,
              newBuyPrice: line.unitBuyPrice,
              oldSellPrice: variant.sellPrice ?? 0,
              newSellPrice: sellPrice,
            });
          }
        }
        if (product.currentBuyPrice !== unitBuyPrice) {
          await tx.product.update({
            where: { id: productId },
            data: { currentBuyPrice: unitBuyPrice },
          });
          priceChanges.push({
            productId,
            oldBuyPrice: product.currentBuyPrice,
            newBuyPrice: unitBuyPrice,
            oldSellPrice: product.currentSellPrice,
            newSellPrice: sellPrice,
          });
        }
      } else if (variantId != null) {
        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: { buyPrice: true, sellPrice: true },
        });
        if (variant && variant.buyPrice !== unitBuyPrice) {
          await tx.productVariant.update({
            where: { id: variantId },
            data: { buyPrice: unitBuyPrice },
          });
          priceChanges.push({
            productId,
            variantId,
            oldBuyPrice: variant.buyPrice ?? 0,
            newBuyPrice: unitBuyPrice,
            oldSellPrice: variant.sellPrice ?? 0,
            newSellPrice: variant.sellPrice ?? 0,
          });
        }
      } else {
        if (product.currentBuyPrice !== unitBuyPrice) {
          await tx.product.update({
            where: { id: productId },
            data: { currentBuyPrice: unitBuyPrice },
          });
          priceChanges.push({
            productId,
            oldBuyPrice: product.currentBuyPrice,
            newBuyPrice: unitBuyPrice,
            oldSellPrice: product.currentSellPrice,
            newSellPrice: sellPrice,
          });
        }
      }

      // Per-variant moves still record the product's own row, so the history page
      // always has a main row to group the detail under.
      if (
        priceChanges.length > 0 &&
        !priceChanges.some((c) => !c.variantId)
      ) {
        priceChanges.push({
          productId,
          oldBuyPrice: product.currentBuyPrice,
          newBuyPrice: product.currentBuyPrice,
          oldSellPrice: product.currentSellPrice,
          newSellPrice: product.currentSellPrice,
        });
      }
      if (priceChanges.length > 0) {
        await recordPriceChanges(tx, {
          tenantId,
          userId: user.sub,
          source: 'PURCHASE',
          changes: priceChanges,
          keepUnchanged: true,
        });
      }

      // --- 3. Physical stock increments at the resolved location ---
      if (variantLines.length > 0) {
        for (const line of variantLines) {
          await inventoryUpsert(tx, {
            tenantId,
            productId,
            variantId: line.variantId,
            locationId: targetLoc.id,
            increment: line.quantity,
            unitCost: line.unitBuyPrice,
          });
        }
      } else {
        await inventoryUpsert(tx, {
          tenantId,
          productId,
          variantId,
          locationId: targetLoc.id,
          increment: quantity,
          unitCost: unitBuyPrice,
        });
      }

      // --- 4. COMPLETED stock request so the purchase is queryable ---
      const req = await tx.stockRequest.create({
        data: {
          tenantId,
          requestType: RequestType.STORE_TO_OWNER,
          storeId: targetLoc.id,
          shopId,
          createdById: user.sub,
          approvedById: user.sub,
          status: RequestStatus.COMPLETED,
          items:
            variantLines.length > 0
              ? {
                  create: variantLines.map((line) => ({
                    tenantId,
                    productId,
                    variantId: line.variantId,
                    quantityStored: line.quantity,
                    quantityReceived: line.quantity,
                    status: RequestItemStatus.RECEIVED,
                    confirmedById: user.sub,
                    confirmedAt: new Date(),
                  })),
                }
              : {
                  create: {
                    tenantId,
                    productId,
                    variantId,
                    quantityStored: quantity,
                    quantityReceived: quantity,
                    status: RequestItemStatus.RECEIVED,
                    confirmedById: user.sub,
                    confirmedAt: new Date(),
                  },
                },
        },
        include: { items: true },
      });

      // --- 5. Procurement journal: Debit Inventory Asset <-> Credit Cash/AP ---
      const purchaseSummary =
        variantLines.length > 0
          ? `Purchase ${variantLines.length} variants × ${productName}${
              categoryName !== 'uncategorized' ? ` (${categoryName})` : ''
            }`
          : `Purchase ${quantity} × ${productName}${
              categoryName !== 'uncategorized' ? ` (${categoryName})` : ''
            }`;
      await this.finance
        .postProcurement({
          ref: `PUR-${req.id}`,
          description: `${purchaseSummary} at ${targetLoc.name}${
            dto.vendor ? ` from ${dto.vendor}` : ''
          }`,
          amount: totalAmount,
          entryDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
          createdById: user.sub,
          paid,
          tenantId,
          tx,
        })
        .catch(() => false);

      // --- 6. Daily cash ledger OUTFLOW when paid now ---
      if (paid) {
        await tx.cashEntry.create({
          data: {
            shopId: targetLoc.id,
            type: 'OUTFLOW',
            amount: totalAmount,
            source: 'PURCHASE',
            refId: req.id,
            description: `Purchased ${quantity} × ${productName}`,
            createdById: user.sub,
          },
        });
      }

      // --- 7. Audit trail ---
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.sub,
          action: 'PURCHASE',
          details: `Inventory purchase: ${totalAmount.toFixed(2)} ETB for ${purchaseSummary} at ${targetLoc.name} (${paid ? 'paid cash' : 'on account'})`,
        },
      });

      return {
        req,
        productId,
        variantId,
        productName,
        unitBuyPrice,
        variantCount: variantLines.length,
      };
    });

    await this.notifications
      .notifyLocation(
        'Stock Added',
        `${quantity} units of ${result.productName} were added at ${targetLoc.name}`,
        targetLoc.id,
        { productId: result.productId },
      )
      .catch(() => undefined);
    await this.notifications
      .checkAndNotifyLowStock(result.productId, targetLoc.id)
      .catch(() => undefined);

    return {
      message: `Purchased ${quantity} × ${result.productName} — stock added at ${targetLoc.name}.`,
      requestId: result.req.id,
      productId: result.productId,
      variantId: result.variantId,
      unitBuyPrice: result.unitBuyPrice,
      variantCount: result.variantCount,
    };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

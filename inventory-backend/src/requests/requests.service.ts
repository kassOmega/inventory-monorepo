import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestItemStatus, RequestStatus, RequestType } from '@prisma/client';
import {
  asNumericId,
  formatBusinessNumber,
} from '../common/business-number.util';
import { inventoryFind, inventoryUpsert } from '../common/inventory.util';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { getCurrentTenantId, requireTenantId } from '../common/tenant/tenant.context';
import { parsePaging, pagedResult } from '../common/pagination.util';
import { tr } from '../i18n/i18n.service';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { ConfirmSaleDto } from './dto/confirm-sale.dto';

@Injectable()
export class RequestsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private sales: SalesService,
    private finance: FinanceService,
  ) {}

  async createRequest(dto: CreateRequestDto, user: JwtPayload) {
    if (!user.locationId)
      throw new ForbiddenException(tr('errors.reqNoLocation'));

    const tenantId = getCurrentTenantId();
    const isStorekeeper = user.locationType === 'STORE';

    let requestType: RequestType;
    let shopId: number | null;
    let storeId: number;
    let fromStoreId: number | null = null;

    if (isStorekeeper) {
      if (dto.requestType === 'STORE_TO_STORE') {
        requestType = RequestType.STORE_TO_STORE;
        storeId = user.locationId; // receiver
        fromStoreId = dto.fromStoreId ?? null;
        if (!fromStoreId) throw new BadRequestException(tr('errors.reqSourceStoreRequired'));
        shopId = null;
      } else {
        requestType = RequestType.STORE_TO_OWNER;
        storeId = user.locationId;
        shopId = null;
      }
    } else {
      // Shopkeeper requesting stock. Normally the request targets a store;
      // when the business has no store (or none was chosen), route the request
      // straight to the owner as a STORE_TO_OWNER request from the shop itself
      // so single-shop businesses are not blocked.
      if (dto.storeId) {
        requestType = RequestType.SHOP_TO_STORE;
        shopId = user.locationId;
        storeId = dto.storeId;
      } else {
        requestType = RequestType.STORE_TO_OWNER;
        shopId = null;
        storeId = user.locationId;
      }
    }

    // Make sure the supplying location can actually fulfil the request before
    // anything enters the approval pipeline.
    if (requestType === RequestType.SHOP_TO_STORE) {
      await this.validateStoreStock(dto.items, storeId, 'store');
    } else if (requestType === RequestType.STORE_TO_STORE && fromStoreId) {
      await this.validateStoreStock(dto.items, fromStoreId, 'source store');
    }

    return this.prisma.stockRequest.create({
      data: {
        shopId,
        storeId,
        fromStoreId,
        requestType,
        createdById: user.sub,
        status: RequestStatus.PENDING,
        items: {
          create: dto.items.map((item) => ({
            tenantId,
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantityRequested: item.quantityRequested ?? null,
            status: RequestItemStatus.PENDING,
          })),
        },
      },
      include: {
        items: { include: { product: true, variant: true, batch: true } },
        shop: true,
        store: true,
        fromStore: true,
      },
    }).then(async (req) => {
      await this.prisma.requestActivity.create({
        data: {
          requestId: req.id,
          action: 'CREATED',
          actorId: user.sub,
          details: `${req.items.length} item(s) requested`,
        },
      });
      await this.notifications.notifyOwner(
        'New Stock Request',
        `Request #${req.id}: ${req.items.length} items from ${isStorekeeper ? 'Store' : req.shop?.name}`,
      );
      return req;
    });
  }

  /**
   * Verify the supplying location has each requested product in stock and, when
   * a quantity is given, enough of it. Throws a detailed error otherwise.
   */
  private async validateStoreStock(
    items: { productId: number; quantityRequested?: number; variantId?: number | null }[],
    locationId: number,
    label: string,
  ) {
    const problems: string[] = [];

    for (const item of items) {
      const inventory = await inventoryFind(
        this.prisma,
        { productId: item.productId, variantId: item.variantId ?? null, locationId },
        { product: true },
      );

      const productName = inventory?.product
        ? `${inventory.product.brand} ${inventory.product.baseName}`
        : `Product #${item.productId}`;
      const available = inventory?.quantity ?? 0;
      const requested = item.quantityRequested ?? null;

      if (!inventory || available <= 0) {
        problems.push(tr('errors.reqNotAvailableAt', { product: productName, label }));
      } else if (requested !== null && requested > available) {
        problems.push(
          tr('errors.reqOnlyAvailableAt', { product: productName, available, label, requested }),
        );
      }
    }

    if (problems.length > 0) {
      throw new BadRequestException(
        tr('errors.reqStockProblems', { label, problems: problems.join('; ') }),
      );
    }
  }

  /**
   * Owner or request creator edits a request that hasn't started dispatching
   * yet. Items are replaced wholesale and the request returns to PENDING so the
   * approval process runs again on the revised quantities.
   */
  async editRequest(id: number, dto: CreateRequestDto, user: JwtPayload) {
    const request = await this.prisma.stockRequest.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!request) throw new NotFoundException(tr('errors.requestNotFound'));
    if (request.status === RequestStatus.CLOSED || request.status === RequestStatus.COMPLETED) {
      throw new BadRequestException(tr('errors.reqCannotEditClosed'));
    }

    const canEdit = user.isSuperuser || request.createdById === user.sub;
    if (!canEdit) {
      throw new ForbiddenException(
        tr('errors.reqEditPermission'),
      );
    }

    const progressed = request.items.some(
      (i) =>
        i.quantityDispatched > 0 ||
        i.quantityStored > 0 ||
        i.status === RequestItemStatus.DISPATCHED ||
        i.status === RequestItemStatus.STORED ||
        i.status === RequestItemStatus.RECEIVED ||
        i.status === RequestItemStatus.PARTIALLY_RECEIVED ||
        i.status === RequestItemStatus.COMPLETED ||
        i.status === RequestItemStatus.PARTIALLY_FULFILLED ||
        i.status === RequestItemStatus.CANCELLED,
    );
    if (progressed) {
      throw new BadRequestException(
        tr('errors.reqCannotEditDispatched'),
      );
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(tr('errors.reqNeedsItem'));
    }

    // Keep the original routing but allow re-pointing the supplying store.
    let storeId = request.storeId;
    let fromStoreId = request.fromStoreId;
    if (request.requestType === RequestType.SHOP_TO_STORE && dto.storeId) {
      storeId = dto.storeId;
    }
    if (request.requestType === RequestType.STORE_TO_STORE && dto.fromStoreId) {
      fromStoreId = dto.fromStoreId;
    }

    if (request.requestType === RequestType.SHOP_TO_STORE) {
      await this.validateStoreStock(dto.items, storeId, 'store');
    } else if (
      request.requestType === RequestType.STORE_TO_STORE &&
      fromStoreId
    ) {
      await this.validateStoreStock(dto.items, fromStoreId, 'source store');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.requestItem.deleteMany({ where: { requestId: id } });
      await tx.stockRequest.update({
        where: { id },
        data: {
          storeId,
          fromStoreId,
          status: RequestStatus.PENDING,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId ?? null,
              quantityRequested: item.quantityRequested ?? null,
              status: RequestItemStatus.PENDING,
            })),
          },
        },
      });
      await this.createActivity(
        tx,
        id,
        'EDITED',
        user.sub,
        'Items revised — request back to pending',
      );
    });

    await this.notifications.notifyOwner(
      'Request Updated',
      `Request #${id}: quantities were revised and sent back for re-approval`,
    );

    return this.prisma.stockRequest.findUnique({
      where: { id },
      include: {
        items: { include: { product: true, variant: true, batch: true } },
        shop: true,
        store: true,
        fromStore: true,
      },
    });
  }

  /**
   * When the dispatching store cannot fulfil the requested quantities, it sends
   * the request back to the creator so they can re-arrange (usually reduce) the
   * quantities before it goes through approval again.
   */
  async sendBack(requestId: number, user: JwtPayload) {
    const request = await this.prisma.stockRequest.findUnique({
      where: { id: requestId },
      include: { items: true },
    });
    if (!request) throw new NotFoundException(tr('errors.requestNotFound'));
    if (request.requestType === RequestType.STORE_TO_OWNER) {
      throw new BadRequestException(
        tr('errors.reqSendBackType'),
      );
    }
    if (request.status === RequestStatus.CLOSED || request.status === RequestStatus.COMPLETED) {
      throw new BadRequestException(tr('errors.reqCannotSendBackClosed'));
    }

    const progressed = request.items.some(
      (i) =>
        i.quantityDispatched > 0 ||
        i.quantityStored > 0 ||
        i.status === RequestItemStatus.DISPATCHED ||
        i.status === RequestItemStatus.STORED ||
        i.status === RequestItemStatus.RECEIVED ||
        i.status === RequestItemStatus.PARTIALLY_RECEIVED ||
        i.status === RequestItemStatus.COMPLETED ||
        i.status === RequestItemStatus.PARTIALLY_FULFILLED ||
        i.status === RequestItemStatus.CANCELLED,
    );
    if (progressed) {
      throw new BadRequestException(
        tr('errors.reqCannotSendBackDispatched'),
      );
    }

    const dispatchLocationId =
      request.requestType === RequestType.STORE_TO_STORE
        ? request.fromStoreId
        : request.storeId;
    const isDispatcher =
      user.locationType === 'STORE' && user.locationId === dispatchLocationId;
    if (!user.isSuperuser && !isDispatcher) {
      throw new ForbiddenException(
        tr('errors.reqSendBackPermission'),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.requestItem.updateMany({
        where: { requestId },
        data: { status: RequestItemStatus.PENDING, quantityDispatched: 0 },
      });
      await tx.stockRequest.update({
        where: { id: requestId },
        data: { status: RequestStatus.PENDING },
      });
      await this.createActivity(
        tx,
        requestId,
        'SENT_BACK',
        user.sub,
        'Sent back to the creator to re-arrange quantities',
      );
    });

    const creatorLocationId =
      request.requestType === RequestType.STORE_TO_STORE
        ? request.storeId
        : request.shopId;
    if (creatorLocationId) {
      await this.notifications.notifyLocation(
        'Request Sent Back',
        `Request #${requestId}: the store ran out of stock before dispatch. Please review and adjust the quantities, then resubmit.`,
        creatorLocationId,
      );
    }
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: user.sub,
          action: 'SEND_BACK',
          details: `Sent request #${requestId} back to the creator for re-arranging quantities`,
        },
      });
    } catch {
      // audit logging must never break the flow
    }

    return this.prisma.stockRequest.findUnique({
      where: { id: requestId },
      include: {
        items: { include: { product: true, variant: true, batch: true } },
        shop: true,
        store: true,
        fromStore: true,
      },
    });
  }

  /**
   * Owner or request creator deletes a request. The owner may delete a request
   * in any status (including closed/progressed ones). Other users may only
   * delete requests that haven't started dispatching or been closed.
   */
  async remove(id: number, user: JwtPayload) {
    const request = await this.prisma.stockRequest.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!request) throw new NotFoundException(tr('errors.requestNotFound'));

    const isOwner = user.isSuperuser;
    const hasDeletePermission = Array.isArray(user.permissions)
      ? user.permissions.includes('requests.delete')
      : false;
    if (!isOwner && !hasDeletePermission) {
      throw new ForbiddenException(
        tr('errors.reqDeletePermission'),
      );
    }

    // Owners may delete regardless of status; other delete-permission holders
    // are still restricted to requests that haven't progressed
    // (dispatch/receipt) or been closed.
    if (!isOwner) {
      if (request.status === RequestStatus.CLOSED || request.status === RequestStatus.COMPLETED) {
        throw new BadRequestException(tr('errors.reqCannotDeleteClosed'));
      }

      const progressed = request.items.some(
        (i) =>
          i.quantityDispatched > 0 ||
          i.quantityStored > 0 ||
          i.status === RequestItemStatus.DISPATCHED ||
          i.status === RequestItemStatus.STORED ||
          i.status === RequestItemStatus.RECEIVED ||
          i.status === RequestItemStatus.PARTIALLY_RECEIVED,
      );
      if (progressed) {
        throw new BadRequestException(
          tr('errors.reqCannotDeleteDispatched'),
        );
      }
    }

    await this.prisma.stockRequest.delete({ where: { id } });

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: user.sub,
          action: 'REQUEST_DELETED',
          details: `Deleted request #${id}`,
        },
      });
    } catch {
      // audit logging must never break the flow
    }

    return { message: 'Request deleted' };
  }

  /** Accept a numeric id or the UUID publicId, returning the numeric key. */
  async resolveRequestId(ref: string): Promise<number> {
    const numeric = asNumericId(ref);
    if (numeric != null) return numeric;
    const row = await this.prisma.stockRequest.findUnique({
      where: { publicId: ref },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(tr('errors.requestNotFound'));
    return row.id;
  }

  async findAll(
    filters: {
      locationId?: string;
      categoryId?: string;
      productId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    },
    user: JwtPayload,
  ) {
    // Order by status priority (action-needed first) then oldest first — the
    // ranking is computed in the database so the list arrives pre-sorted.
    const conditions: string[] = [];
    const values: any[] = [];

    if (user.locationId) {
      if (user.locationType === 'SHOP') {
        // A shop appears as `shopId` on SHOP_TO_STORE requests, but on
        // STORE_TO_OWNER requests (standalone shops / direct-to-owner restocks)
        // the shop is the RECEIVING location stored in `storeId` and shopId is
        // null — match both so shopkeepers always see their own requests.
        conditions.push(
          `("shopId" = $${values.length + 1} OR "storeId" = $${values.length + 2})`,
        );
        values.push(user.locationId, user.locationId);
      } else {
        conditions.push(`"storeId" = $${values.length + 1}`);
        values.push(user.locationId);
      }
    } else if (filters.locationId) {
      conditions.push(
        `("shopId" = $${values.length + 1} OR "storeId" = $${values.length + 2})`,
      );
      values.push(Number(filters.locationId), Number(filters.locationId));
    }

    if (filters.status) {
      conditions.push(`"status"::text = $${values.length + 1}`);
      values.push(filters.status);
    }
    if (filters.startDate && filters.endDate) {
      conditions.push(`"createdAt" >= $${values.length + 1}`);
      values.push(new Date(filters.startDate));
      conditions.push(`"createdAt" <= $${values.length + 1}`);
      values.push(new Date(filters.endDate));
    }
    if (filters.categoryId || filters.productId) {
      const sub: string[] = [];
      if (filters.productId) {
        sub.push(`ri."productId" = $${values.length + 1}`);
        values.push(Number(filters.productId));
      }
      if (filters.categoryId) {
        sub.push(`p."categoryId" = $${values.length + 1}`);
        values.push(Number(filters.categoryId));
      }
      conditions.push(
        `EXISTS (SELECT 1 FROM "RequestItem" ri JOIN "Product" p ON p.id = ri."productId" WHERE ri."requestId" = "StockRequest".id AND ${sub.join(' AND ')})`,
      );
    }

    const whereSql = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const ranked = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM "StockRequest"
       ${whereSql}
       ORDER BY CASE "status"
         WHEN 'PENDING' THEN 0
         WHEN 'PARTIALLY_APPROVED' THEN 1
         WHEN 'AWAITING_CONFIRMATION' THEN 2
         WHEN 'APPROVED' THEN 3
         WHEN 'PARTIALLY_DISPATCHED' THEN 4
         WHEN 'PARTIALLY_FULFILLED' THEN 5
         WHEN 'COMPLETED' THEN 6
         WHEN 'REJECTED' THEN 7
         WHEN 'CLOSED' THEN 8
         ELSE 9 END ASC,
         "createdAt" ASC`,
      ...values,
    );
    const orderedIds = ranked.map((r) => r.id);

    const requests = orderedIds.length
      ? await this.prisma.stockRequest.findMany({
          where: { id: { in: orderedIds } },
          include: {
            items: { include: { product: true, variant: true, batch: true } },
            shop: true,
            store: true,
            fromStore: true,
          },
        })
      : [];

    // Restore the DB-computed order (Prisma doesn't preserve `in` ordering).
    const byId = new Map(requests.map((r) => [r.id, r]));
    const ordered = orderedIds
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    const attached = await this.attachCreatedByNames(ordered);
    const paging = parsePaging(filters ?? {});
    if (paging.enabled) {
      const start = (paging.page - 1) * paging.pageSize;
      return pagedResult(
        attached.slice(start, start + paging.pageSize),
        attached.length,
        paging.page,
        paging.pageSize,
      );
    }
    return attached;
  }

  /** Attach the request creator's display name and whether they're the owner. */
  private async attachCreatedByNames<T extends { createdById: number }>(
    requests: T[],
  ): Promise<
    (T & { createdByName: string | null; createdByIsOwner: boolean })[]
  > {
    const userIds = [...new Set(requests.map((r) => r.createdById))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            isOwnerAccount: true,
            role: { select: { isSystem: true } },
          },
        })
      : [];
    const creatorById = new Map(users.map((u) => [u.id, u]));
    return requests.map((r) => {
      const creator = creatorById.get(r.createdById);
      return {
        ...r,
        numberLabel: formatBusinessNumber('REQ', (r as any).number),
        createdByName: creator?.name ?? null,
        // `isOwnerAccount` is the reliable owner signal (set on every owner
        // account in both seeds); role.isSystem is kept as a fallback for
        // legacy rows whose direct role was never flagged system.
        createdByIsOwner:
          creator?.isOwnerAccount ?? creator?.role?.isSystem ?? false,
      };
    });
  }

  /** Record a status-change event on the request timeline. */
  private async createActivity(
    tx: any,
    requestId: number,
    action: string,
    actorId: number,
    details?: string,
  ) {
    await tx.requestActivity.create({
      data: { requestId, action, actorId, details },
    });
  }

  /** Resolve actor display names for a request's activity timeline. */
  private async attachActivityActors(req: {
    activities: { actorId: number; [k: string]: any }[];
  }) {
    const userIds = [...new Set(req.activities.map((a) => a.actorId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return {
      ...req,
      activities: req.activities.map((a) => ({
        ...a,
        actorName: nameById.get(a.actorId) ?? null,
      })),
    };
  }

  async findOne(id: number) {
    const req = await this.prisma.stockRequest.findUnique({
      where: { id },
      include: {
        items: { include: { product: true, variant: true, batch: true } },
        shop: true,
        store: true,
        fromStore: true,
        activities: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!req) throw new NotFoundException(tr('errors.requestNotFound'));
    const withCreator = (await this.attachCreatedByNames([req]))[0];
    return this.attachActivityActors(withCreator);
  }

  // --- Helper: re-evaluate overall request status ---
  private async evaluateRequestStatus(
    tx: any,
    requestId: number,
  ): Promise<RequestStatus> {
    const items = await tx.requestItem.findMany({
      where: { requestId },
    });

    // Final (terminal) item states — new writes use COMPLETED/CANCELLED; the
    // legacy RECEIVED/SOLD/REJECTED values are kept so existing history reads
    // the same way.
    const isFinal = (i: any) =>
      i.status === RequestItemStatus.COMPLETED ||
      i.status === RequestItemStatus.CANCELLED ||
      i.status === RequestItemStatus.RECEIVED ||
      i.status === RequestItemStatus.SOLD ||
      i.status === RequestItemStatus.REJECTED;

    if (items.length > 0 && items.every(isFinal)) {
      return items.every(
        (i: any) =>
          i.status === RequestItemStatus.CANCELLED ||
          i.status === RequestItemStatus.REJECTED,
      )
        ? RequestStatus.REJECTED
        : RequestStatus.COMPLETED;
    }

    // Anything sent but not yet confirmed keeps the request awaiting receipt.
    const hasOutstanding = items.some(
      (i: any) =>
        !isFinal(i) &&
        Math.max(i.quantityDispatched || 0, i.quantityStored || 0) -
          (i.quantityReceived || 0) >
          0,
    );
    if (hasOutstanding) return RequestStatus.AWAITING_CONFIRMATION;

    // Some progress (dispatched/received) but items remain → in progress.
    const hasProgress = items.some(
      (i: any) =>
        !isFinal(i) &&
        ((i.quantityReceived || 0) > 0 ||
          (i.quantityDispatched || 0) > 0 ||
          (i.quantityStored || 0) > 0),
    );
    if (hasProgress) return RequestStatus.PARTIALLY_FULFILLED;

    const someApproved = items.some(
      (i: any) => i.status === RequestItemStatus.APPROVED,
    );
    const somePending = items.some(
      (i: any) => i.status === RequestItemStatus.PENDING,
    );
    const someRejected = items.some(
      (i: any) =>
        i.status === RequestItemStatus.CANCELLED ||
        i.status === RequestItemStatus.REJECTED,
    );
    if (someApproved && (somePending || someRejected))
      return RequestStatus.PARTIALLY_APPROVED;
    if (someApproved) return RequestStatus.APPROVED;
    return RequestStatus.PENDING;
  }

  // Owner: Approve/Reject (shop→store) or Store/Reject (store→owner)
  async updateItemStatuses(
    requestId: number,
    itemUpdates: {
      id: number;
      status: RequestItemStatus;
      quantityStored?: number;
      newBuyPrice?: number;
      newSellPrice?: number;
    }[],
    user: JwtPayload,
  ) {
    const request = await this.prisma.stockRequest.findUnique({
      where: { id: requestId },
      include: { items: { include: { product: true, variant: true, batch: true } } },
    });
    if (!request) throw new NotFoundException(tr('errors.requestNotFound'));
    if (request.status === RequestStatus.CLOSED || request.status === RequestStatus.COMPLETED) {
      throw new BadRequestException(tr('errors.cannotModifyClosedRequest'));
    }

    const isStoreToOwner = request.requestType === RequestType.STORE_TO_OWNER;
    const isStoreToStore = request.requestType === RequestType.STORE_TO_STORE;

    const tenantId = getCurrentTenantId();
    return this.prisma.$transaction(async (tx) => {
      for (const update of itemUpdates) {
        const item = request.items.find((i) => i.id === update.id);
        if (!item) continue;

        if (isStoreToOwner) {
          if (
            update.status !== RequestItemStatus.STORED &&
            update.status !== RequestItemStatus.REJECTED &&
            update.status !== RequestItemStatus.CANCELLED
          ) {
            throw new BadRequestException(
              tr('errors.reqOwnerStoreStatuses'),
            );
          }

          // Skip items already fully fulfilled — keep-it-open.
          if (
            item.status === RequestItemStatus.RECEIVED ||
            item.status === RequestItemStatus.SOLD ||
            item.status === RequestItemStatus.COMPLETED ||
            item.status === RequestItemStatus.CANCELLED
          ) {
            continue;
          }

          if (update.status === RequestItemStatus.STORED) {
            const qty = update.quantityStored || 0;
            if (qty <= 0) {
              throw new BadRequestException(
                tr('errors.reqStoredQtyRequired', { product: `${item.product.brand} ${item.product.baseName}` }),
              );
            }
            const requestedQty = item.quantityRequested ?? qty;
            const totalStored = (item.quantityStored || 0) + qty;
            if (totalStored > requestedQty) {
              throw new BadRequestException(
                tr('errors.reqStoreOverRequested', { amount: requestedQty, product: `${item.product.brand} ${item.product.baseName}` }),
              );
            }
            await tx.requestItem.update({
              where: { id: update.id },
              data: {
                status:
                  item.quantityReceived > 0
                    ? RequestItemStatus.PARTIALLY_FULFILLED
                    : RequestItemStatus.STORED,
                quantityStored: totalStored,
              },
            });

            if (
              update.newBuyPrice !== undefined &&
              update.newSellPrice !== undefined
            ) {
              await tx.priceHistory.create({
                data: {
                  tenantId,
                  productId: item.productId,
                  oldBuyPrice: item.product.currentBuyPrice,
                  newBuyPrice: update.newBuyPrice,
                  oldSellPrice: item.product.currentSellPrice,
                  newSellPrice: update.newSellPrice,
                  updatedById: request.createdById,
                },
              });
              await tx.product.update({
                where: { id: item.productId },
                data: {
                  currentBuyPrice: update.newBuyPrice,
                  currentSellPrice: update.newSellPrice,
                },
              });
            }
          } else {
            if ((item.quantityReceived || 0) > 0) {
              throw new BadRequestException(
                tr('errors.reqCannotRejectReceived', { product: `${item.product.brand} ${item.product.baseName}` }),
              );
            }
            await tx.requestItem.update({
              where: { id: update.id },
              data: { status: update.status },
            });
          }
        } else {
          if (
            update.status !== RequestItemStatus.APPROVED &&
            update.status !== RequestItemStatus.REJECTED &&
            update.status !== RequestItemStatus.CANCELLED
          ) {
            throw new BadRequestException(
              tr('errors.reqShopStatuses'),
            );
          }
          await tx.requestItem.update({
            where: { id: update.id },
            data: { status: update.status },
          });
        }
      }

      const newStatus = await this.evaluateRequestStatus(tx, requestId);
      const updated = await tx.stockRequest.update({
        where: { id: requestId },
        data: { status: newStatus },
      });

      const storedCount = itemUpdates.filter(
        (u) => u.status === RequestItemStatus.STORED,
      ).length;
      const approvedCount = itemUpdates.filter(
        (u) => u.status === RequestItemStatus.APPROVED,
      ).length;
      const rejectedCount = itemUpdates.filter(
        (u) =>
          (u.status === RequestItemStatus.REJECTED ||
            u.status === RequestItemStatus.CANCELLED),
      ).length;
      const details = [
        storedCount ? `${storedCount} stored` : '',
        approvedCount ? `${approvedCount} approved` : '',
        rejectedCount ? `${rejectedCount} rejected` : '',
      ]
        .filter(Boolean)
        .join(', ');
      await this.createActivity(
        tx,
        requestId,
        newStatus === RequestStatus.REJECTED
          ? 'REJECTED'
          : isStoreToOwner
            ? 'STORED'
            : 'APPROVED',
        user.sub,
        details || 'Owner action',
      );

      // Notify based on what happened
      if (isStoreToOwner) {
        // Notify storekeeper that owner has acted
        await this.notifications.notifyLocation(
          'Request Updated',
          `Request #${requestId}: Owner has ${updated.status === 'REJECTED' ? 'rejected' : 'stored'} items`,
          request.storeId,
        );
      } else {
        // Approvals notify whoever dispatches next:
        //   Shop→Store  -> the store
        //   Store→Store -> the source store
        const hasApproved = itemUpdates.some((u) => u.status === RequestItemStatus.APPROVED);
        if (hasApproved) {
          const dispatchLocationId = isStoreToStore ? request.fromStoreId : request.storeId;
          if (dispatchLocationId) {
            await this.notifications.notifyLocation(
              'Items Approved',
              `Request #${requestId}: Items approved for dispatch`,
              dispatchLocationId,
            );
          }
        }
        // Rejections notify the requester:
        //   Shop→Store  -> the shop
        //   Store→Store -> the receiving store
        const hasRejected = itemUpdates.some((u) =>
          (u.status === RequestItemStatus.REJECTED ||
            u.status === RequestItemStatus.CANCELLED));
        if (hasRejected) {
          const requesterLocationId = isStoreToStore ? request.storeId : request.shopId;
          if (requesterLocationId) {
            await this.notifications.notifyLocation(
              'Items Rejected',
              `Request #${requestId}: Some items were rejected`,
              requesterLocationId,
            );
          }
        }
      }

      return updated;
    });
  }

  // Storekeeper: Dispatch quantities (shop→store only, no inventory movement)
  async dispatchItems(
    requestId: number,
    dispatchData: { id: number; quantityDispatched: number }[],
    user: JwtPayload,
  ) {
    const request = await this.prisma.stockRequest.findUnique({
      where: { id: requestId },
      include: { items: { include: { product: true, variant: true, batch: true } } },
    });
    if (!request) throw new NotFoundException(tr('errors.requestNotFound'));
    const isStoreToStore = request.requestType === RequestType.STORE_TO_STORE;
    if (request.requestType !== RequestType.SHOP_TO_STORE && !isStoreToStore) {
      throw new BadRequestException(tr('errors.reqDispatchType'));
    }
    if (request.status === RequestStatus.CLOSED || request.status === RequestStatus.COMPLETED) {
      throw new BadRequestException(tr('errors.cannotModifyClosedRequest'));
    }
    if (
      request.status !== RequestStatus.APPROVED &&
      request.status !== RequestStatus.PARTIALLY_APPROVED &&
      request.status !== RequestStatus.PARTIALLY_DISPATCHED &&
      request.status !== RequestStatus.PARTIALLY_RECEIVED &&
      request.status !== RequestStatus.PARTIALLY_FULFILLED
    ) {
      throw new BadRequestException(tr('errors.reqMustBeApproved'));
    }

    // For store-to-store, source is fromStoreId; otherwise it's storeId
    const sourceLocationId = isStoreToStore ? request.fromStoreId! : request.storeId;

    const result = await this.prisma.$transaction(async (tx) => {
      for (const data of dispatchData) {
        if (data.quantityDispatched <= 0) continue;
        const item = request.items.find((i) => i.id === data.id);
        if (!item) throw new BadRequestException(tr('errors.reqInvalidDispatchItem'));
        if (
          item.status !== RequestItemStatus.APPROVED &&
          item.status !== RequestItemStatus.DISPATCHED &&
          item.status !== RequestItemStatus.PARTIALLY_RECEIVED &&
          item.status !== RequestItemStatus.PARTIALLY_FULFILLED
        ) {
          // Skip items that aren't dispatchable (partial approvals, already
          // fulfilled) instead of aborting the whole dispatch.
          continue;
        }
        const requestedQty = item.quantityRequested ?? data.quantityDispatched;
        if (item.quantityDispatched + data.quantityDispatched > requestedQty) {
          throw new BadRequestException(
            tr('errors.reqDispatchOverRequested', { amount: requestedQty, product: `${item.product?.brand ?? ''} ${item.product?.baseName ?? ''}` }),
          );
        }

        const storeInventory = await inventoryFind(tx, {
          productId: item.productId,
          variantId: item.variantId ?? null,
          locationId: sourceLocationId,
        });
        if (!storeInventory || storeInventory.quantity < data.quantityDispatched) {
          throw new BadRequestException(tr('errors.reqInsufficientStockProduct', { product: item.product.baseName }));
        }

        // The source store loses the goods as soon as they are dispatched. The
        // receiver only gains the quantity it actually confirms on arrival.
        await tx.inventory.update({
          where: { id: storeInventory.id },
          data: { quantity: { decrement: data.quantityDispatched } },
        });

        await tx.requestItem.update({
          where: { id: item.id },
          data: {
            quantityDispatched: { increment: data.quantityDispatched },
            status:
              item.quantityReceived > 0
                ? RequestItemStatus.PARTIALLY_FULFILLED
                : RequestItemStatus.DISPATCHED,
          },
        });
      }
      const newStatus = await this.evaluateRequestStatus(tx, requestId);
      const dispatchedUnits = dispatchData.reduce(
        (sum, d) => sum + (d.quantityDispatched || 0),
        0,
      );
      await this.createActivity(
        tx,
        requestId,
        'DISPATCHED',
        user.sub,
        `Dispatched ${dispatchedUnits} unit(s)`,
      );
      return tx.stockRequest.update({ where: { id: requestId }, data: { status: newStatus } });
    });

    const ids = dispatchData.map((d) => request.items.find((i) => i.id === d.id)?.productId).filter(Boolean) as number[];
    for (const pid of [...new Set(ids)]) {
      await this.notifications.checkAndNotifyLowStock(pid, sourceLocationId);
    }
    if (isStoreToStore) {
      await this.notifications.notifyLocation(
        'Items Dispatched',
        `Transfer #${requestId}: Items dispatched to your store`,
        request.storeId,
      );
    } else {
      if (request.shopId) {
        await this.notifications.notifyLocation(
          'Items Dispatched',
          `Request #${requestId}: Items dispatched to your shop`,
          request.shopId,
        );
      }
    }
    return result;
  }

  // Receiving party confirms receipt → inventory moves here.
  // For STORE_TO_OWNER the receiving location user confirms (owner never
  // confirms); for other types the request creator confirms.
  async confirmReceipt(
    requestId: number,
    items: { id: number; quantityReceived?: number }[],
    user: JwtPayload,
  ) {
    const request = await this.prisma.stockRequest.findUnique({
      where: { id: requestId },
      include: {
        items: { include: { product: true, variant: true, batch: true } },
        store: true,
      },
    });
    if (!request) throw new NotFoundException(tr('errors.requestNotFound'));
    if (request.status === RequestStatus.CLOSED || request.status === RequestStatus.COMPLETED) {
      throw new BadRequestException(tr('errors.requestAlreadyClosed'));
    }

    const isStoreToOwner = request.requestType === RequestType.STORE_TO_OWNER;
    const isStoreToStore = request.requestType === RequestType.STORE_TO_STORE;

    if (isStoreToOwner) {
      if (user.locationId !== request.storeId) {
        throw new ForbiddenException(
          tr('errors.reqConfirmReceiptReceiver'),
        );
      }
    } else if (request.createdById !== user.sub) {
      throw new ForbiddenException(tr('errors.reqConfirmReceiptCreator'));
    }

    const tenantId = requireTenantId();
    // Shortages (received < dispatched/stored) are reported to whoever
    // dispatched after the transaction commits.
    const shortageNotices: {
      toOwner: boolean;
      locationId: number;
      message: string;
    }[] = [];

    const txResult = await this.prisma.$transaction(async (tx) => {
      for (const update of items) {
        const item = request.items.find((i) => i.id === update.id);
        if (!item) throw new BadRequestException(tr('errors.reqInvalidItemId', { id: update.id }));

        const dispatchedOrStoredQty = isStoreToOwner
          ? item.quantityStored || 0
          : item.quantityDispatched || 0;
        // Quantity sent but not yet confirmed on the receiving side.
        const outstanding = dispatchedOrStoredQty - (item.quantityReceived || 0);
        if (outstanding <= 0) {
          throw new BadRequestException(
            tr('errors.reqNothingPending', { product: `${item.product?.brand ?? ''} ${item.product?.baseName ?? ''}` }),
          );
        }

        // Default to the full outstanding amount, unless the receiver submits
        // the actual received quantity.
        const receivedQty = update.quantityReceived ?? outstanding;
        if (receivedQty <= 0) {
          throw new BadRequestException(tr('errors.reqReceivedQtyPositive'));
        }
        if (receivedQty > outstanding) {
          throw new BadRequestException(
            tr('errors.reqConfirmOverDispatched', { amount: outstanding, product: `${item.product?.brand ?? ''} ${item.product?.baseName ?? ''}` }),
          );
        }

        if (isStoreToOwner) {
          // Owner's goods arrive at the store — no source deduction.
          await inventoryUpsert(tx, {
            tenantId,
            productId: item.productId,
            variantId: item.variantId ?? null,
            locationId: request.storeId,
            increment: receivedQty,
            unitCost: item.product.currentBuyPrice ?? null,
          });
          if (item.batchId != null) {
            await tx.productBatch.update({
              where: { id: item.batchId },
              data: { quantity: { increment: receivedQty } },
            });
          }

          // Universal finance: procurement posting (Inventory ↔ AP) for the
          // goods that just landed — idempotent per request item so partial
          // confirmations each record their own portion.
          const unitCost = item.product.currentBuyPrice ?? 0;
          await this.finance
            .postProcurement({
              ref: `RST-${requestId}-${item.id}`,
              description: `Restock ${receivedQty} × ${item.product?.brand ?? ''} ${item.product?.baseName ?? ''} — receipt confirmed`,
              amount: unitCost * receivedQty,
              entryDate: new Date(),
              createdById: user.sub,
              paid: false, // goods received on account (AP)
              tenantId,
              tx,
            })
            .catch(() => false);
        } else {
          // The source store was already deducted at dispatch time; the
          // receiver only gains what actually arrived.
          const receiverId = isStoreToStore ? request.storeId : request.shopId;
          if (receiverId) {
            await inventoryUpsert(tx, {
              tenantId,
              productId: item.productId,
              variantId: item.variantId ?? null,
              locationId: receiverId,
              increment: receivedQty,
              unitCost: item.product.currentBuyPrice ?? null,
            });
            if (item.batchId != null) {
              await tx.productBatch.update({
                where: { id: item.batchId },
                data: { quantity: { increment: receivedQty } },
              });
            }
          }
        }

        const totalReceived = (item.quantityReceived || 0) + receivedQty;
        const expectedQty =
          item.quantityRequested ??
          Math.max(item.quantityStored || 0, item.quantityDispatched || 0);
        const fulfilled = expectedQty > 0 && totalReceived >= expectedQty;
        const hasShortage = receivedQty < outstanding;
        await tx.requestItem.update({
          where: { id: update.id },
          data: {
            status: fulfilled
              ? RequestItemStatus.COMPLETED
              : RequestItemStatus.PARTIALLY_FULFILLED,
            quantityReceived: totalReceived,
            confirmedById: user.sub,
            confirmedAt: new Date(),
          },
        });

        const receiptLabel = isStoreToOwner
          ? request.store?.type === 'SHOP'
            ? 'Shop'
            : 'Store'
          : isStoreToStore
            ? 'Receiving Store'
            : 'Shop';
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: user.sub,
            action: 'CONFIRM_RECEIPT',
            details: `Confirmed receipt of ${receivedQty} (of ${outstanding} pending) at ${receiptLabel}`,
          },
        });

        // A gap between what was pending and what actually arrived is recorded
        // so the dispatcher can investigate or make good the missing quantity.
        if (hasShortage) {
          const gap = outstanding - receivedQty;
          const productName = `${item.product.brand} ${item.product.baseName}`;
          shortageNotices.push({
            toOwner: isStoreToOwner,
            // STORE_TO_STORE always has a source store; SHOP_TO_STORE and
            // STORE_TO_OWNER always have a store.
            locationId: isStoreToStore
              ? (request.fromStoreId as number)
              : request.storeId,
            message: `Request #${requestId}: ${productName} — expected ${outstanding}, received ${receivedQty} (${gap} missing).`,
          });
        }
      }

      const receivedTotal = items.reduce(
        (sum, it) => sum + (it.quantityReceived ?? 0),
        0,
      );
      await this.createActivity(
        tx,
        requestId,
        'CONFIRMED',
        user.sub,
        `Confirmed receipt of ${receivedTotal} unit(s)`,
      );
      const newStatus = await this.evaluateRequestStatus(tx, requestId);
      const result = await tx.stockRequest.update({ where: { id: requestId }, data: { status: newStatus } });

      // Check low stock for affected locations. Same-transaction client: the
      // receipt was just booked inside `tx`, so an outside read would see the
      // pre-receipt quantities.
      for (const update of items) {
        const item = request.items.find((i) => i.id === update.id);
        if (item) {
          await this.notifications.checkAndNotifyLowStock(
            item.productId,
            request.storeId,
            tx,
          );
          if (request.shopId) {
            await this.notifications.checkAndNotifyLowStock(
              item.productId,
              request.shopId,
              tx,
            );
          }
        }
      }

      // Notify the Owner that the storekeeper confirmed receipt
      await this.notifications.notifyOwner(
        'Receipt Confirmed',
        `Request #${requestId}: items confirmed as received`,
      );

      return result;
    });

    // Report any gaps between what was sent and what was actually received.
    for (const notice of shortageNotices) {
      if (notice.toOwner) {
        await this.notifications.notifyOwner('Shortage Reported', notice.message);
        continue;
      }
      await this.notifications.notifyLocation(
        'Shortage Reported',
        notice.message,
        notice.locationId,
      );
    }

    return txResult;
  }

  // Shopkeeper confirms receipt AND sells some or all of the goods directly to
  // a customer. The received goods enter the shop's inventory, the sold
  // quantity is recorded as a normal sale in the same transaction, and each
  // item is marked SOLD / RECEIVED / PARTIALLY_RECEIVED depending on how much
  // arrived and how much was sold. The request stays open until every item is
  // fully fulfilled or explicitly closed.
  async confirmReceiptAndSell(
    requestId: number,
    dto: ConfirmSaleDto,
    user: JwtPayload,
  ) {
    const request = await this.prisma.stockRequest.findUnique({
      where: { id: requestId },
      include: { items: { include: { product: true, variant: true, batch: true } } },
    });
    if (!request) throw new NotFoundException(tr('errors.requestNotFound'));
    if (request.requestType !== RequestType.SHOP_TO_STORE) {
      throw new BadRequestException(
        tr('errors.reqSaleOnReceiptType'),
      );
    }
    if (request.status === RequestStatus.CLOSED || request.status === RequestStatus.COMPLETED) {
      throw new BadRequestException(tr('errors.requestAlreadyClosed'));
    }
    if (request.shopId === null) {
      throw new BadRequestException(tr('errors.reqNoShopDestination'));
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(tr('errors.reqNoItemsToSell'));
    }
    const shopId: number = request.shopId;

    const shortageNotices: {
      toOwner: boolean;
      locationId: number;
      message: string;
    }[] = [];

    const txResult = await this.prisma.$transaction(async (tx) => {
      const saleItemInputs: {
        productId: number;
        variantId?: number;
        quantity: number;
        customPrice?: number;
      }[] = [];

      for (const sold of dto.items) {
        const item = request.items.find((i) => i.id === sold.id);
        if (!item) {
          throw new BadRequestException(tr('errors.reqInvalidSaleItem'));
        }

        const dispatchedQty = item.quantityDispatched || 0;
        const outstanding = dispatchedQty - (item.quantityReceived || 0);
        if (outstanding <= 0) {
          throw new BadRequestException(
            tr('errors.reqNothingPendingSale', { product: `${item.product?.brand ?? ''} ${item.product?.baseName ?? ''}` }),
          );
        }
        const receivedQty = sold.quantityReceived ?? outstanding;
        if (receivedQty <= 0) {
          throw new BadRequestException(tr('errors.reqReceivedQtyGreaterZero'));
        }
        if (receivedQty > outstanding) {
          throw new BadRequestException(
            tr('errors.reqReceiveOverDispatched', { amount: outstanding, product: `${item.product?.brand ?? ''} ${item.product?.baseName ?? ''}` }),
          );
        }
        const soldQty = sold.quantity ?? receivedQty;
        if (soldQty < 0 || soldQty > receivedQty) {
          throw new BadRequestException(
            tr('errors.reqSoldQtyRange', { amount: receivedQty, product: `${item.product?.brand ?? ''} ${item.product?.baseName ?? ''}` }),
          );
        }

        // Destination (shop) receives what actually arrived. The source store
        // was already deducted at dispatch time.
        await inventoryUpsert(tx, {
          tenantId: requireTenantId(),
          productId: item.productId,
          variantId: item.variantId ?? null,
          locationId: shopId,
          increment: receivedQty,
          unitCost: item.product.currentBuyPrice ?? null,
        });
        if (item.batchId != null) {
          await tx.productBatch.update({
            where: { id: item.batchId },
            data: { quantity: { increment: receivedQty } },
          });
        }

        const totalReceived = (item.quantityReceived || 0) + receivedQty;
        const expectedQty =
          item.quantityRequested ??
          Math.max(item.quantityStored || 0, item.quantityDispatched || 0);
        const fulfilled = expectedQty > 0 && totalReceived >= expectedQty;
        await tx.requestItem.update({
          where: { id: item.id },
          data: {
            status: fulfilled
              ? RequestItemStatus.COMPLETED
              : RequestItemStatus.PARTIALLY_FULFILLED,
            quantityReceived: totalReceived,
            confirmedById: user.sub,
            confirmedAt: new Date(),
          },
        });

        if (soldQty > 0) {
          saleItemInputs.push({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            quantity: soldQty,
            ...(sold.unitSellPrice != null
              ? { customPrice: sold.unitSellPrice }
              : {}),
          });
        }

        // A gap between what was pending and what actually arrived is reported
        // so the dispatcher can investigate or make good the missing quantity.
        if (receivedQty < outstanding) {
          shortageNotices.push({
            toOwner: false,
            locationId: request.storeId,
            message: `Request #${requestId}: ${item.product?.brand ?? ''} ${item.product?.baseName ?? ''} — expected ${outstanding}, received ${receivedQty} (${outstanding - receivedQty} missing).`,
          });
        }
      }

      // 2. Create the normal sale (deducts the sold quantity from the shop
      // inventory that was just added) and link it back to this request. When
      // nothing is sold (all items stocked), no sale is created — it is a
      // plain receipt confirmation.
      let sale: any = null;
      if (saleItemInputs.length > 0) {
        sale = await this.sales.createSale(
          {
            shopId,
            items: saleItemInputs,
            saleType: dto.saleType,
            paidAmount: dto.paidAmount,
            paymentMethodId: dto.paymentMethodId,
            customerId: dto.customerId,
            notes: dto.notes ?? `Direct sale from request #${requestId}`,
          },
          user,
          { tx, requestId },
        );
      }

      // 3. Re-evaluate the request status (open until fully fulfilled).
      const newStatus = await this.evaluateRequestStatus(tx, requestId);
      await tx.stockRequest.update({
        where: { id: requestId },
        data: { status: newStatus },
      });

      await this.createActivity(
        tx,
        requestId,
        sale ? 'SOLD_ON_RECEIPT' : 'CONFIRMED',
        user.sub,
        sale
          ? `Sale #${sale.invoiceNumber} — ${saleItemInputs.length} item(s) sold directly`
          : 'Confirmed receipt (no items sold)',
      );

      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'SALE_ON_RECEIPT',
          details: `Request #${requestId}: confirmed receipt and sold ${saleItemInputs.length} item(s) as sale #${sale?.invoiceNumber ?? '—'}`,
        },
      });

      return { requestId, sale };
    });

    // Report any gaps between what was sent and what was actually received.
    for (const notice of shortageNotices) {
      if (notice.toOwner) {
        await this.notifications.notifyOwner('Shortage Reported', notice.message);
        continue;
      }
      await this.notifications.notifyLocation(
        'Shortage Reported',
        notice.message,
        notice.locationId,
      );
    }

    return txResult;
  }

}

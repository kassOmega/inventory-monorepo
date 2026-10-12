import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  getCurrentTenantId,
  tenantContext,
} from '../common/tenant/tenant.context';
import { tr } from '../i18n/i18n.service';

/** Models that carry a `tenantId` column and should be auto-scoped. */
const TENANT_MODELS = new Set([
  'LocationCategory',
  'Location',
  'Category',
  'Product',
  'ProductVariant',
  'ProductBatch',
  'Unit',
  'PriceHistory',
  'Inventory',
  'StockRequest',
  'RequestItem',
  'Sale',
  'SaleItem',
  'Return',
  'ReturnItem',
  'PaymentMethod',
  'Customer',
  'CustomerNote',
  'CustomerLoyaltyEntry',
  'LoyaltyProgram',
  'CreditSale',
  'CreditSaleItem',
  'CreditPayment',
  'Purchase',
  'PurchasePayment',
  'PurchaseOrderDraft',
  'Notification',
  'AuditLog',
  'Account',
  'JournalEntry',
  'JournalLine',
  'Expense',
  'OtherIncome',
  'CogsEntry',
  'WastageEntry',
  'MenuCategory',
  'MenuItem',
  'MenuItemIngredient',
  'MenuItemOption',
  'DiningTable',
  'Order',
  'OrderItem',
  'OrderStatusHistory',
  'Reservation',
  'RoomType',
  'Room',
  'HotelReservation',
  'Folio',
  'FolioEntry',
  'BusinessInsight',
  'AiChatSession',
  'AiChatMessage',
  'TaxRate',
  'FiscalReceipt',
  'FiscalBatch',
  'TenantFiscalConfig',
  // Per-vertical 1:1 profile tables (scoped by `organizationId`, see the
  // TENANT_FIELD_BY_MODEL map below).
  'RetailProfile',
  'HospitalityProfile',
  'ManufacturingProfile',
  'ServiceProfile',
  'CarWashProfile',
  // SERVICE vertical
  'ServiceCategory',
  'ServiceItem',
  'ServiceBooking',
  'ServiceTicket',
  'ServiceTicketItem',
  'ServicePayment',
  // CAR WASH vertical
  'CarWashWasher',
  'CarWashWashType',
  'CarWashVehicleType',
  'CarWashPrice',
  'CarWashVehicle',
  'CarWashBooking',
  'CarWashBookingItem',
  'CarWash',
  'CarWashEquipmentIssue',
  'CarWashCollection',
  // MANUFACTURING vertical
  'BillOfMaterials',
  'WorkOrder',
  'ProductionScrapLog',
  'MfgService',
  'MfgServiceIncome',
  'ManufacturingOrder',
  'ManufacturingOrderHistory',
  'MaterialIssue',
  'MaterialReturn',
  'ConsumableIssue',
  'ConsumableUsageLog',
  'Machine',
  'MachineComponent',
  'MachineStatusLog',
  'ComponentStatusLog',
  'ShiftTemplate',
  'ShiftSession',
  'ShiftAssignment',
  'Worker',
  'MachineIssuance',
  'MachineIssuanceItem',
  'MachineLossCharge',
]);

/**
 * Models whose tenant/business scope lives in a differently-named column.
 * `Customer` uses `organizationId` so it has a real FK relation to the
 * Organization it belongs to (instead of an implicit nullable `tenantId`).
 */
const TENANT_FIELD_BY_MODEL: Record<string, string> = {
  Customer: 'organizationId',
  // CRM: notes, loyalty ledger and programme all hang off `Organization`.
  CustomerNote: 'organizationId',
  CustomerLoyaltyEntry: 'organizationId',
  LoyaltyProgram: 'organizationId',
  // 1:1 per-vertical profile tables (Organization relation).
  RetailProfile: 'organizationId',
  HospitalityProfile: 'organizationId',
  ManufacturingProfile: 'organizationId',
  ServiceProfile: 'organizationId',
  CarWashProfile: 'organizationId',
  TaxRate: 'organizationId',
  BillOfMaterials: 'organizationId',
  WorkOrder: 'organizationId',
  ProductionScrapLog: 'organizationId',
  MfgService: 'organizationId',
  MfgServiceIncome: 'organizationId',
  ManufacturingOrder: 'organizationId',
  ManufacturingOrderHistory: 'organizationId',
  MaterialIssue: 'organizationId',
  MaterialReturn: 'organizationId',
  ConsumableIssue: 'organizationId',
  ConsumableUsageLog: 'organizationId',
  Machine: 'organizationId',
  MachineComponent: 'organizationId',
  MachineStatusLog: 'organizationId',
  ComponentStatusLog: 'organizationId',
  ShiftTemplate: 'organizationId',
  ShiftSession: 'organizationId',
  ShiftAssignment: 'organizationId',
  Worker: 'organizationId',
  MachineIssuance: 'organizationId',
  MachineIssuanceItem: 'organizationId',
  MachineLossCharge: 'organizationId',
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super();
    // Row-level tenant scoping. When a tenant context is active we (a) tag every
    // created row with the tenant and (b) filter list/multi operations by it, so
    // existing services keep working while staying isolated per organization.
    this.$use(async (params, next) => {
      const tenantId = getCurrentTenantId();
      if (tenantId == null) return next(params);
      if (!params.model || !TENANT_MODELS.has(params.model)) return next(params);

      const action = params.action as string;
      // Prisma sets `params.args` to undefined when a query is called without
      // arguments (e.g. `prisma.location.findMany()`). Attach the args object to
      // `params` BEFORE mutating it so the tenant filter actually reaches the
      // query engine — otherwise the filter is applied to a throwaway object
      // and the query leaks every tenant's rows.
      if (!params.args || typeof params.args !== 'object') {
        params.args = {};
      }
      const args: any = params.args;

      const field = TENANT_FIELD_BY_MODEL[params.model] ?? 'tenantId';
      // Prisma's `params.model` is the PascalCase model name while the client
      // exposes delegates in lowerCamelCase (product, productVariant, …).
      const delegateName =
        params.model.charAt(0).toLowerCase() + params.model.slice(1);
      const modelDelegate: any = (this as any)[delegateName];

      const addTenantFilter = () => {
        if (!args.where) args.where = {};
        if (typeof args.where === 'object' && args.where[field] === undefined) {
          args.where[field] = tenantId;
        }
      };

      /** True when a row matching `where` exists inside the CURRENT tenant. */
      const existsInTenant = async (where: unknown): Promise<boolean> => {
        const row = await modelDelegate?.findFirst({
          where: { ...(where as object), [field]: tenantId },
          select: { [field]: true },
        });
        return row != null;
      };

      if (action === 'create') {
        if (args.data && typeof args.data === 'object') {
          args.data[field] = tenantId;
        }
      } else if (action === 'createMany') {
        if (Array.isArray(args.data)) {
          for (const d of args.data) {
            if (d && typeof d === 'object') d[field] = tenantId;
          }
        }
      } else if (action === 'upsert') {
        // Reject an upsert whose unique selector already resolves to a row in a
        // DIFFERENT tenant — otherwise `update` below would overwrite it. The
        // lookup runs with the tenant context cleared so it is not auto-scoped.
        const existingAny = await tenantContext.run(null, () =>
          modelDelegate?.findFirst({
            where: args.where,
            select: { [field]: true },
          }),
        );
        if (existingAny && existingAny[field] !== tenantId) {
          throw new NotFoundException(tr('errors.notFound'));
        }
        if (args.create && typeof args.create === 'object') {
          args.create[field] = tenantId;
        }
        if (args.update && typeof args.update === 'object') {
          args.update[field] = tenantId;
        }
      } else if (action === 'findUnique' || action === 'findUniqueOrThrow') {
        // Singular reads by a unique selector (usually a numeric id) must be
        // scoped like every other read. Rewriting to findFirst keeps the return
        // shape identical while adding the tenant predicate.
        params.action =
          action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
        addTenantFilter();
      } else if (action === 'update' || action === 'delete') {
        // Mutations take a unique selector, not a general filter — verify the
        // target belongs to the active tenant before touching it. A row owned by
        // another tenant (or missing) surfaces as a 404 so existence is never
        // leaked.
        if (!(await existsInTenant(args.where))) {
          throw new NotFoundException(tr('errors.notFound'));
        }
        if (action === 'update' && args.data && typeof args.data === 'object') {
          args.data[field] = tenantId;
        }
      } else if (
        ['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'updateMany', 'deleteMany', 'aggregate', 'groupBy'].includes(
          action,
        )
      ) {
        addTenantFilter();
      }

      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Return product ids whose JSONB `attributes` (product specifications) OR any
   * of their variants' `attributes` contain the search term in any key or value
   * (Prisma has no native cross-key JSON filter).
   */
  async findProductIdsByAttributes(search: string): Promise<number[]> {
    const tenantId = getCurrentTenantId();
    if (tenantId == null) return [];
    const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
    const rows = await this.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT p."id"
      FROM "Product" p
      LEFT JOIN "ProductVariant" pv ON pv."productId" = p."id"
      WHERE p."tenantId" = ${tenantId}
        AND (CAST(p."attributes" AS TEXT) ILIKE ${`%${escaped}%`}
             OR CAST(pv."attributes" AS TEXT) ILIKE ${`%${escaped}%`})
    `;
    return rows.map((r) => r.id);
  }
}


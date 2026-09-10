import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getCurrentTenantId } from '../common/tenant/tenant.context';

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
  'CreditSale',
  'CreditSaleItem',
  'CreditPayment',
  'Purchase',
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
  // SERVICE vertical
  'ServiceCategory',
  'ServiceItem',
  'ServiceBooking',
  'ServiceTicket',
  'ServiceTicketItem',
  'ServicePayment',
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

      if (action === 'create') {
        if (args.data && typeof args.data === 'object' && args.data[field] === undefined) {
          args.data[field] = tenantId;
        }
      } else if (action === 'createMany') {
        if (Array.isArray(args.data)) {
          for (const d of args.data) {
            if (d && typeof d === 'object' && d[field] === undefined) d[field] = tenantId;
          }
        }
      } else if (action === 'upsert') {
        if (args.create && typeof args.create === 'object' && args.create[field] === undefined) {
          args.create[field] = tenantId;
        }
      } else if (
        ['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'updateMany', 'deleteMany', 'aggregate', 'groupBy'].includes(
          action,
        )
      ) {
        if (!args.where) args.where = {};
        if (typeof args.where === 'object' && args.where[field] === undefined) {
          args.where[field] = tenantId;
        }
      }
      // Note: findUnique / update / delete (singular) use unique selectors and are
      // left untouched; callers obtain ids from tenant-scoped list queries.

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
    const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
    const rows = await this.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT p."id"
      FROM "Product" p
      LEFT JOIN "ProductVariant" pv ON pv."productId" = p."id"
      WHERE CAST(p."attributes" AS TEXT) ILIKE ${`%${escaped}%`}
         OR CAST(pv."attributes" AS TEXT) ILIKE ${`%${escaped}%`}
    `;
    return rows.map((r) => r.id);
  }
}


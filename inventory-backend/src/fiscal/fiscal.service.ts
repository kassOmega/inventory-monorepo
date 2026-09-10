// src/fiscal/fiscal.service.ts
// Universal fiscal printing: builds the domain-aware invoice summary payload for
// both hospitality orders and retail sales, tracks print state (PRINT_PENDING /
// PRINTED / PRINT_FAILED) and persists the 1:1 FiscalReceipt record returned by
// the local fiscal agent. Retail transactions always carry serviceCharge = 0.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FiscalStatus, OrderStatus } from '@prisma/client';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { round2 } from '../common/tax.util';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalAckDto, FiscalBatchDto, FiscalConfigDto, FiscalFailDto } from './dto/fiscal.dto';

export type FiscalTarget = { orderId?: number; saleId?: number };

export interface FiscalFinancials {
  subtotal: number;
  discount: number;
  serviceChargeAmount: number;
  vatAmount: number;
  grandTotal: number;
  vatInclusive: boolean;
  paidAmount: number;
}

@Injectable()
export class FiscalService {
  constructor(private prisma: PrismaService) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  /** Universal fiscal summary for an order or a sale. */
  async getSummary(target: FiscalTarget) {
    const tenantId = this.tenant();
    if (target.orderId != null) {
      return this.orderSummary(tenantId, target.orderId);
    }
    if (target.saleId != null) {
      return this.saleSummary(tenantId, target.saleId);
    }
    throw new BadRequestException('Missing orderId or saleId');
  }

  async markPrintPending(target: FiscalTarget) {
    const tenantId = this.tenant();
    if (target.orderId != null) {
      const order = await this.prisma.order.findFirst({
        where: { id: target.orderId, tenantId },
        select: { status: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status !== OrderStatus.PAID) {
        throw new ConflictException('Only paid orders can be fiscally printed');
      }
      await this.prisma.order.update({
        where: { id: target.orderId },
        data: { fiscalStatus: FiscalStatus.PRINT_PENDING, fiscalError: null },
      });
      return { ok: true, fiscalStatus: FiscalStatus.PRINT_PENDING };
    }
    if (target.saleId != null) {
      const sale = await this.prisma.sale.findFirst({
        where: { id: target.saleId, tenantId },
        select: { id: true },
      });
      if (!sale) throw new NotFoundException('Sale not found');
      await this.prisma.sale.update({
        where: { id: target.saleId },
        data: { fiscalStatus: FiscalStatus.PRINT_PENDING, fiscalError: null },
      });
      return { ok: true, fiscalStatus: FiscalStatus.PRINT_PENDING };
    }
    throw new BadRequestException('Missing orderId or saleId');
  }

  async ack(target: FiscalTarget, dto: FiscalAckDto) {
    const tenantId = this.tenant();
    if (target.orderId != null) {
      const order = await this.prisma.order.findFirst({
        where: { id: target.orderId, tenantId },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      const fin = this.orderFinancials(order);
      const receipt = await this.prisma.fiscalReceipt.upsert({
        where: { orderId: target.orderId },
        create: {
          tenantId,
          orderId: target.orderId,
          fsNumber: dto.fsNumber,
          ejNumber: dto.ejNumber,
          machineSerial: dto.machineSerial ?? null,
          subtotal: fin.subtotal,
          serviceCharge: fin.serviceChargeAmount,
          vatAmount: fin.vatAmount,
          grandTotal: fin.grandTotal,
        },
        update: {
          fsNumber: dto.fsNumber,
          ejNumber: dto.ejNumber,
          machineSerial: dto.machineSerial ?? null,
          subtotal: fin.subtotal,
          serviceCharge: fin.serviceChargeAmount,
          vatAmount: fin.vatAmount,
          grandTotal: fin.grandTotal,
        },
      });
      await this.prisma.order.update({
        where: { id: target.orderId },
        data: { fiscalStatus: FiscalStatus.PRINTED, fiscalError: null },
      });
      return { ok: true, fiscalStatus: FiscalStatus.PRINTED, receipt };
    }
    if (target.saleId != null) {
      const sale = await this.prisma.sale.findFirst({
        where: { id: target.saleId, tenantId },
        include: { items: true },
      });
      if (!sale) throw new NotFoundException('Sale not found');
      const fin = this.saleFinancials(sale);
      const receipt = await this.prisma.fiscalReceipt.upsert({
        where: { saleId: target.saleId },
        create: {
          tenantId,
          saleId: target.saleId,
          fsNumber: dto.fsNumber,
          ejNumber: dto.ejNumber,
          machineSerial: dto.machineSerial ?? null,
          subtotal: fin.subtotal,
          serviceCharge: fin.serviceChargeAmount,
          vatAmount: fin.vatAmount,
          grandTotal: fin.grandTotal,
        },
        update: {
          fsNumber: dto.fsNumber,
          ejNumber: dto.ejNumber,
          machineSerial: dto.machineSerial ?? null,
          subtotal: fin.subtotal,
          serviceCharge: fin.serviceChargeAmount,
          vatAmount: fin.vatAmount,
          grandTotal: fin.grandTotal,
        },
      });
      await this.prisma.sale.update({
        where: { id: target.saleId },
        data: { fiscalStatus: FiscalStatus.PRINTED, fiscalError: null },
      });
      return { ok: true, fiscalStatus: FiscalStatus.PRINTED, receipt };
    }
    throw new BadRequestException('Missing orderId or saleId');
  }

  async markFailed(target: FiscalTarget, dto: FiscalFailDto) {
    const tenantId = this.tenant();
    const error = dto.message ?? 'Fiscal print failed';
    if (target.orderId != null) {
      const order = await this.prisma.order.findFirst({
        where: { id: target.orderId, tenantId },
        select: { id: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      await this.prisma.order.update({
        where: { id: target.orderId },
        data: { fiscalStatus: FiscalStatus.PRINT_FAILED, fiscalError: error },
      });
      return { ok: true, fiscalStatus: FiscalStatus.PRINT_FAILED };
    }
    if (target.saleId != null) {
      const sale = await this.prisma.sale.findFirst({
        where: { id: target.saleId, tenantId },
        select: { id: true },
      });
      if (!sale) throw new NotFoundException('Sale not found');
      await this.prisma.sale.update({
        where: { id: target.saleId },
        data: { fiscalStatus: FiscalStatus.PRINT_FAILED, fiscalError: error },
      });
      return { ok: true, fiscalStatus: FiscalStatus.PRINT_FAILED };
    }
    throw new BadRequestException('Missing orderId or saleId');
  }


  // --- Summary builders ----------------------------------------------------

  private async orderSummary(tenantId: number, orderId: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: true,
        table: true,
        history: { select: { status: true, actorName: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    // Order stores createdById as a bare scalar (no relation) — resolve the
    // waiter's name explicitly for the receipt metadata.
    const waiterName =
      order.createdById != null
        ? ((await this.prisma.user.findUnique({
            where: { id: order.createdById },
            select: { name: true },
          }))?.name ?? null)
        : null;
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { name: true, taxId: true },
    });
    const config = await this.prisma.tenantFiscalConfig.findUnique({ where: { tenantId } });
    const rate = order.taxRateId
      ? await this.prisma.taxRate.findUnique({
          where: { id: order.taxRateId },
          select: { code: true, name: true },
        })
      : null;
    const fin = this.orderFinancials(order);
    return {
      type: 'ORDER',
      reference: order.orderNumber,
      date: order.updatedAt,
      header: {
        companyName: org?.name ?? '',
        tin: config?.tin ?? org?.taxId ?? null,
        taxName: config?.taxName ?? null,
        address: config?.address ?? null,
        phone: config?.phone ?? null,
        customerName: order.customerName ?? null,
        customerTin: null,
      },
      lineItems: order.items.map((i) => ({
        description: i.name,
        barcode: null,
        qty: i.quantity,
        unitPrice: round2(i.unitPrice),
        taxGroup: rate?.code ?? rate?.name ?? null,
      })),
      cashierName: this.orderCashier(order),
      waiterName,
      tableNo: order.table?.name ?? null,
      financials: fin,
    };
  }

  /** The cashier who settled the order (the PAID status-history actor). */
  private orderCashier(order: {
    history?: Array<{ status: string; actorName: string | null }>;
  }): string | null {
    const paid = (order.history ?? []).find(
      (h) => h.status === OrderStatus.PAID,
    );
    return paid?.actorName ?? null;
  }

  private async saleSummary(tenantId: number, saleId: number) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId },
      include: {
        items: { include: { product: true, variant: true } },
        customer: true,
        shop: true,
        soldBy: { select: { name: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { name: true, taxId: true },
    });
    const config = await this.prisma.tenantFiscalConfig.findUnique({ where: { tenantId } });
    const rate = sale.taxRateId
      ? await this.prisma.taxRate.findUnique({
          where: { id: sale.taxRateId },
          select: { code: true, name: true },
        })
      : null;
    const fin = this.saleFinancials(sale);
    return {
      type: 'SALE',
      reference: sale.invoiceNumber,
      date: sale.saleDate,
      header: {
        companyName: org?.name ?? '',
        tin: config?.tin ?? org?.taxId ?? null,
        taxName: config?.taxName ?? null,
        address: config?.address ?? null,
        phone: config?.phone ?? null,
        customerName: sale.customer?.name ?? null,
        customerTin: null,
      },
      lineItems: sale.items.map((i) => ({
        description:
          `${i.product?.brand ?? ''} ${i.product?.baseName ?? ''}`.trim() +
            (i.variant?.sku ? ` (${i.variant.sku})` : '') ||
          'Product',
        barcode: null,
        qty: i.quantity,
        unitPrice: round2(i.unitSellPrice),
        taxGroup: rate?.code ?? rate?.name ?? null,
      })),
      cashierName: sale.soldBy?.name ?? null,
      waiterName: null,
      tableNo: null,
      financials: fin,
    };
  }

  /** Hospitality order financials — service charge + VAT, settle-matched. */
  private orderFinancials(order: {
    items: { unitPrice: number; quantity: number }[];
    discount?: number | null;
    serviceCharge?: number | null;
    tax?: number | null;
    taxInclusive?: boolean | null;
    paidAmount?: number | null;
  }): FiscalFinancials {
    const lineSubtotal = order.items.reduce(
      (s, i) => s + i.unitPrice * i.quantity,
      0,
    );
    const discount = order.discount ?? 0;
    const serviceChargeAmount = order.serviceCharge ?? 0;
    const vatAmount = round2(order.tax ?? 0);
    const vatInclusive = order.taxInclusive !== false;
    const grandTotal = round2(
      Math.max(0, lineSubtotal - discount) +
        serviceChargeAmount +
        (vatInclusive ? 0 : vatAmount),
    );
    const subtotal = round2(grandTotal - serviceChargeAmount - vatAmount);
    return {
      subtotal,
      discount,
      serviceChargeAmount,
      vatAmount,
      grandTotal,
      vatInclusive,
      paidAmount: order.paidAmount ?? 0,
    };
  }

  /** Retail sale financials — service charge is strictly 0. */
  private saleFinancials(sale: {
    totalAmount: number;
    taxAmount?: number | null;
    paidAmount?: number | null;
  }): FiscalFinancials {
    const grandTotal = round2(sale.totalAmount);
    const vatAmount = round2(sale.taxAmount ?? 0);
    const subtotal = round2(grandTotal - vatAmount);
    return {
      subtotal,
      discount: 0,
      serviceChargeAmount: 0,
      vatAmount,
      grandTotal,
      vatInclusive: true,
      paidAmount: sale.paidAmount ?? 0,
    };
  }

  // --- Tenant fiscal config (lazy-created 1:1) ---

  async getConfig() {
    const tenantId = this.tenant();
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { taxId: true },
    });
    const existing = await this.prisma.tenantFiscalConfig.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;
    return this.prisma.tenantFiscalConfig.create({
      data: {
        tenantId,
        tin: org?.taxId ?? '',
        taxName: 'VAT',
        agentUrl: 'http://localhost:5000',
        printerVendor: 'GENERIC',
        comPort: 'COM1',
        baudRate: 9600,
        enableFiscal: true,
      },
    });
  }

  async updateConfig(dto: FiscalConfigDto) {
    const tenantId = this.tenant();
    const data: Record<string, unknown> = {};
    if (dto.tin !== undefined) data.tin = dto.tin;
    if (dto.taxName !== undefined) data.taxName = dto.taxName;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.agentUrl !== undefined) data.agentUrl = dto.agentUrl;
    if (dto.agentApiKey !== undefined) data.agentApiKey = dto.agentApiKey;
    if (dto.printerVendor !== undefined) data.printerVendor = dto.printerVendor;
    if (dto.comPort !== undefined) data.comPort = dto.comPort;
    if (dto.baudRate !== undefined) data.baudRate = dto.baudRate;
    if (dto.enableFiscal !== undefined) data.enableFiscal = dto.enableFiscal;
    // MoR E-Invoicing & Security credentials
    if (dto.morLiveUrl !== undefined) data.morLiveUrl = dto.morLiveUrl;
    if (dto.morClientId !== undefined) data.morClientId = dto.morClientId;
    if (dto.morClientSecret !== undefined) data.morClientSecret = dto.morClientSecret;
    if (dto.morCertificate !== undefined) data.morCertificate = dto.morCertificate;
    if (dto.terminalId !== undefined) data.terminalId = dto.terminalId;
    if (dto.branchCode !== undefined) data.branchCode = dto.branchCode;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No valid fiscal config fields provided');
    }
    await this.getConfig(); // ensure the row exists before updating
    return this.prisma.tenantFiscalConfig.update({ where: { tenantId }, data });
  }

  // --- Batch (multi-order/sale consolidation) ---

  private async batchDocs(targets: FiscalBatchDto) {
    const tenantId = this.tenant();
    const orderIds = targets.orderIds ?? [];
    const saleIds = targets.saleIds ?? [];
    if (orderIds.length + saleIds.length === 0) {
      throw new BadRequestException('Provide orderIds and/or saleIds');
    }
    const [orders, sales] = await Promise.all([
      orderIds.length
        ? this.prisma.order.findMany({
            where: { id: { in: orderIds }, tenantId },
            include: {
              items: true,
              table: true,
              history: { select: { status: true, actorName: true } },
            },
          })
        : Promise.resolve([]),
      saleIds.length
        ? this.prisma.sale.findMany({
            where: { id: { in: saleIds }, tenantId },
            include: {
              items: true,
              customer: true,
              soldBy: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    if (orders.length + sales.length !== orderIds.length + saleIds.length) {
      throw new BadRequestException(
        'One or more documents were not found in this organization',
      );
    }
    return { tenantId, orders, sales };
  }


  async getBatchSummary(targets: FiscalBatchDto) {
    const { tenantId, orders, sales } = await this.batchDocs(targets);
    const [org, config] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: tenantId },
        select: { name: true, taxId: true },
      }),
      this.prisma.tenantFiscalConfig.findUnique({ where: { tenantId } }),
    ]);
    const documents = [
      ...orders.map((o) => ({
        type: 'ORDER',
        reference: o.orderNumber,
        lineItems: this.orderLineItems(o),
        financials: this.orderFinancials(o),
      })),
      ...sales.map((s) => ({
        type: 'SALE',
        reference: s.invoiceNumber,
        lineItems: this.saleLineItems(s),
        financials: this.saleFinancials(s),
      })),
    ];
    const financials = this.aggregateFinancials(
      documents.map((d) => d.financials),
    );
    // When every document in the batch belongs to the same customer, surface
    // that name on the consolidated invoice header.
    const customerNames = [
      ...orders.map((o) => o.customerName ?? null),
      ...sales.map((s) => s.customer?.name ?? null),
    ].filter((n): n is string => Boolean(n));
    const sharedCustomer =
      [...new Set(customerNames)].length === 1 ? customerNames[0] : null;
    // Receipt metadata: surface the cashier / waiter / table when every document
    // in the batch agrees on the value (otherwise blank).
    const unique = (arr: Array<string | null>) => {
      const vals = [...new Set(arr.filter((v): v is string => Boolean(v)))];
      return vals.length === 1 ? vals[0] : null;
    };
    const cashierName = unique([
      ...orders.map((o) => this.orderCashier(o)),
      ...sales.map((s) => s.soldBy?.name ?? null),
    ]);
    const waiterName = await (async () => {
      const waiterIds = [
        ...new Set(
          orders
            .map((o) => o.createdById)
            .filter((v): v is number => v != null),
        ),
      ];
      const map =
        waiterIds.length > 0
          ? new Map(
              (
                await this.prisma.user.findMany({
                  where: { id: { in: waiterIds } },
                  select: { id: true, name: true },
                })
              ).map((u) => [u.id, u.name]),
            )
          : new Map<number, string>();
      return unique(
        orders.map((o) =>
          o.createdById != null ? (map.get(o.createdById) ?? null) : null,
        ),
      );
    })();
    const tableNo = unique(orders.map((o) => o.table?.name ?? null));    return {
      type: 'BATCH',
      reference: `FB-${Date.now()}`,
      header: {
        companyName: org?.name ?? '',
        tin: config?.tin ?? org?.taxId ?? null,
        taxName: config?.taxName ?? null,
        address: config?.address ?? null,
        phone: config?.phone ?? null,
        customerName: sharedCustomer,
        customerTin: null,
      },
      cashierName,
      waiterName,
      tableNo,
      documents: documents.map((d) => ({
        type: d.type,
        reference: d.reference,
        financials: d.financials,
      })),
      // Merge similar line items across documents (same description + unit
      // price + tax group, even when they carry different internal ids) so the
      // consolidated receipt shows combined quantities.
      lineItems: (() => {
        const merged = new Map<string, any>();
        for (const it of documents.flatMap((d) => d.lineItems)) {
          const key = `${(it.description ?? '')
            .toLowerCase()
            .trim()}|${it.unitPrice}|${it.taxGroup ?? ''}`;
          const row = merged.get(key) ?? {
            description: it.description,
            barcode: it.barcode ?? null,
            qty: 0,
            unitPrice: it.unitPrice,
            taxGroup: it.taxGroup ?? null,
          };
          row.qty += it.qty;
          merged.set(key, row);
        }
        return [...merged.values()];
      })(),
      financials,
    };
  }

  async markBatchPrintPending(targets: FiscalBatchDto) {
    const { orders, sales } = await this.batchDocs(targets);
    for (const o of orders) {
      if (o.status !== OrderStatus.PAID) {
        throw new ConflictException(`Order ${o.orderNumber} is not paid`);
      }
      await this.prisma.order.update({
        where: { id: o.id },
        data: { fiscalStatus: FiscalStatus.PRINT_PENDING, fiscalError: null },
      });
    }
    for (const s of sales) {
      await this.prisma.sale.update({
        where: { id: s.id },
        data: { fiscalStatus: FiscalStatus.PRINT_PENDING, fiscalError: null },
      });
    }
    return {
      ok: true,
      fiscalStatus: FiscalStatus.PRINT_PENDING,
      count: orders.length + sales.length,
    };
  }


  async ackBatch(targets: FiscalBatchDto, dto: FiscalAckDto) {
    const { tenantId, orders, sales } = await this.batchDocs(targets);
    const financials = this.aggregateFinancials([
      ...orders.map((o) => this.orderFinancials(o)),
      ...sales.map((s) => this.saleFinancials(s)),
    ]);
    const batch = await this.prisma.fiscalBatch.create({
      data: {
        tenantId,
        batchRef: `FB-${Date.now()}`,
        fsNumber: dto.fsNumber,
        ejNumber: dto.ejNumber,
        machineSerial: dto.machineSerial ?? null,
        subtotal: financials.subtotal,
        serviceCharge: financials.serviceChargeAmount,
        vatAmount: financials.vatAmount,
        grandTotal: financials.grandTotal,
      },
    });
    for (const o of orders) {
      const fin = this.orderFinancials(o);
      await this.prisma.fiscalReceipt.upsert({
        where: { orderId: o.id },
        create: {
          tenantId,
          orderId: o.id,
          batchId: batch.id,
          fsNumber: dto.fsNumber,
          ejNumber: dto.ejNumber,
          machineSerial: dto.machineSerial ?? null,
          subtotal: fin.subtotal,
          serviceCharge: fin.serviceChargeAmount,
          vatAmount: fin.vatAmount,
          grandTotal: fin.grandTotal,
        },
        update: {
          batchId: batch.id,
          fsNumber: dto.fsNumber,
          ejNumber: dto.ejNumber,
          machineSerial: dto.machineSerial ?? null,
        },
      });
      await this.prisma.order.update({
        where: { id: o.id },
        data: { fiscalStatus: FiscalStatus.PRINTED, fiscalError: null },
      });
    }
    for (const s of sales) {
      const fin = this.saleFinancials(s);
      await this.prisma.fiscalReceipt.upsert({
        where: { saleId: s.id },
        create: {
          tenantId,
          saleId: s.id,
          batchId: batch.id,
          fsNumber: dto.fsNumber,
          ejNumber: dto.ejNumber,
          machineSerial: dto.machineSerial ?? null,
          subtotal: fin.subtotal,
          serviceCharge: fin.serviceChargeAmount,
          vatAmount: fin.vatAmount,
          grandTotal: fin.grandTotal,
        },
        update: {
          batchId: batch.id,
          fsNumber: dto.fsNumber,
          ejNumber: dto.ejNumber,
          machineSerial: dto.machineSerial ?? null,
        },
      });
      await this.prisma.sale.update({
        where: { id: s.id },
        data: { fiscalStatus: FiscalStatus.PRINTED, fiscalError: null },
      });
    }
    return {
      ok: true,
      fiscalStatus: FiscalStatus.PRINTED,
      batch,
      count: orders.length + sales.length,
    };
  }

  async markBatchFailed(targets: FiscalBatchDto, dto: FiscalFailDto) {
    const { orders, sales } = await this.batchDocs(targets);
    const error = dto.message ?? 'Fiscal print failed';
    for (const o of orders) {
      await this.prisma.order.update({
        where: { id: o.id },
        data: { fiscalStatus: FiscalStatus.PRINT_FAILED, fiscalError: error },
      });
    }
    for (const s of sales) {
      await this.prisma.sale.update({
        where: { id: s.id },
        data: { fiscalStatus: FiscalStatus.PRINT_FAILED, fiscalError: error },
      });
    }
    return {
      ok: true,
      fiscalStatus: FiscalStatus.PRINT_FAILED,
      count: orders.length + sales.length,
    };
  }

  // --- Shared builders ---

  private orderLineItems(order: any) {
    return order.items.map((i: any) => ({
      description: i.name,
      barcode: null,
      qty: i.quantity,
      unitPrice: round2(i.unitPrice),
      taxGroup: null,
    }));
  }

  private saleLineItems(sale: any) {
    return sale.items.map((i: any) => ({
      description:
        `${i.product?.brand ?? ''} ${i.product?.baseName ?? ''}`.trim() +
          (i.variant?.sku ? ` (${i.variant.sku})` : '') ||
        'Product',
      barcode: null,
      qty: i.quantity,
      unitPrice: round2(i.unitSellPrice),
      taxGroup: null,
    }));
  }

  private aggregateFinancials(
    list: FiscalFinancials[],
  ): FiscalFinancials {
    const total = (k: 'subtotal' | 'serviceChargeAmount' | 'vatAmount' | 'grandTotal') =>
      round2(list.reduce((s, f) => s + f[k], 0));
    return {
      subtotal: total('subtotal'),
      discount: round2(list.reduce((s, f) => s + f.discount, 0)),
      serviceChargeAmount: total('serviceChargeAmount'),
      vatAmount: total('vatAmount'),
      grandTotal: total('grandTotal'),
      vatInclusive: list.every((f) => f.vatInclusive),
      paidAmount: round2(list.reduce((s, f) => s + f.paidAmount, 0)),
    };
  }
}



// src/taxes/taxes.service.ts
// Per-company tax configuration. Tax rates belong to exactly one organization
// (real FK, cascade delete) and are auto-scoped by the tenant middleware via
// `organizationId` (registered in TENANT_FIELD_BY_MODEL). Enabling tax lazily
// creates the Output VAT Payable / Input VAT Receivable accounts for the org.
import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, Prisma, TaxDirection } from '@prisma/client';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTaxRateDto,
  TaxSettingsDto,
  UpdateTaxRateDto,
} from './dto/tax.dto';

const VAT_ACCOUNTS: { name: string; code: string; type: AccountType }[] = [
  { name: 'Output VAT Payable', code: '2100', type: AccountType.LIABILITY },
  { name: 'Input VAT Receivable', code: '1101', type: AccountType.ASSET },
];

@Injectable()
export class TaxesService {
  constructor(private readonly prisma: PrismaService) {}

  private orgId(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  /** Rates + company-level tax settings for the active organization. */
  async findAll() {
    const organizationId = this.orgId();
    const [org, rates] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { taxEnabled: true, taxInclusive: true, taxId: true },
      }),
      this.prisma.taxRate.findMany({
        where: { organizationId },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
    ]);
    return {
      settings: {
        taxEnabled: org?.taxEnabled ?? false,
        taxInclusive: org?.taxInclusive ?? true,
        taxId: org?.taxId ?? null,
      },
      rates,
    };
  }

  async create(dto: CreateTaxRateDto) {
    const organizationId = this.orgId();
    const rate = this.clampRate(dto.rate);
    const direction = dto.direction ?? TaxDirection.OUTPUT;
    const isDefault = dto.isDefault ?? false;
    const enabled = dto.enabled ?? true;

    if (isDefault) {
      await this.clearDefault(organizationId, direction, null);
    }

    // Enabling a rate also switches the company's tax flag on — so "I created an
    // enabled VAT rate" always results in VAT being applied to sales, with no
    // hidden org-level switch to miss.
    if (enabled) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { taxEnabled: true },
      });
    }

    return this.prisma.taxRate.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        rate,
        direction,
        isDefault,
        enabled,
      },
    });
  }

  async update(id: number, dto: UpdateTaxRateDto) {
    const organizationId = this.orgId();
    const existing = await this.prisma.taxRate.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new BadRequestException('Tax rate not found');

    const data: Prisma.TaxRateUpdateManyMutationInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.code !== undefined) data.code = dto.code?.trim() || null;
    if (dto.rate !== undefined) data.rate = this.clampRate(dto.rate);
    if (dto.direction !== undefined) data.direction = dto.direction;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;

    if (dto.isDefault === true) {
      // Promote this rate to default → demote the previous default (same org +
      // final direction), without self-matching when it already is the default.
      await this.clearDefault(
        organizationId,
        dto.direction ?? existing.direction,
        id,
      );
    }

    await this.prisma.taxRate.updateMany({ where: { id, organizationId }, data });

    if (data.enabled === true) {
      // A rate being (re-)enabled implies the company wants VAT applied.
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { taxEnabled: true },
      });
    }

    return this.prisma.taxRate.findFirst({ where: { id, organizationId } });
  }

  async remove(id: number) {
    const organizationId = this.orgId();
    const existing = await this.prisma.taxRate.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new BadRequestException('Tax rate not found');
    if (existing.isDefault) {
      throw new BadRequestException(
        'The default tax rate cannot be deleted. Set another rate as default first.',
      );
    }
    await this.prisma.taxRate.deleteMany({ where: { id, organizationId } });
    return { id };
  }

  async updateSettings(dto: TaxSettingsDto) {
    const organizationId = this.orgId();
    const data: { taxEnabled?: boolean; taxInclusive?: boolean; taxId?: string | null } = {};
    if (dto.taxEnabled !== undefined) data.taxEnabled = dto.taxEnabled;
    if (dto.taxInclusive !== undefined) data.taxInclusive = dto.taxInclusive;
    if (dto.taxId !== undefined) data.taxId = dto.taxId?.trim() || null;

    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data,
    });
    if (org.taxEnabled) {
      await this.ensureVatAccounts(organizationId);
    }
    return {
      settings: {
        taxEnabled: org.taxEnabled,
        taxInclusive: org.taxInclusive,
        taxId: org.taxId,
      },
    };
  }

  /** Demote the current default rate for the org+direction (optionally excluding one id). */
  private async clearDefault(
    organizationId: number,
    direction: TaxDirection,
    exceptId: number | null,
  ) {
    await this.prisma.taxRate.updateMany({
      where: {
        organizationId,
        direction,
        isDefault: true,
        ...(exceptId != null ? { NOT: { id: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  /** Lazily create the VAT accounts for an org the first time tax is enabled. */
  private async ensureVatAccounts(organizationId: number) {
    const accounts = await this.prisma.account.findMany({
      where: { tenantId: organizationId },
    });
    const missing = VAT_ACCOUNTS.filter(
      (a) => !accounts.some((x) => x.name === a.name),
    );
    if (missing.length === 0) return;
    await this.prisma.account.createMany({
      data: missing.map((a) => ({ tenantId: organizationId, ...a, isSystem: true })),
    });
  }

  private clampRate(value: number): number {
    return Math.min(100, Math.max(0, Number(value)));
  }
}


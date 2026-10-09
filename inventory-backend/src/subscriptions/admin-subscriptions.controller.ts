// src/subscriptions/admin-subscriptions.controller.ts
// Platform-admin management of subscriptions: default prices, per-tenant state,
// bank accounts, and the receipt review queue.
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { BusinessType, SubscriptionPaymentStatus, SubscriptionStatus, SubscriptionTerm } from '@prisma/client';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { SubscriptionsService } from './subscriptions.service';
import {
  AdminUpdateSubscriptionDto,
  BankAccountDto,
  ReviewPaymentDto,
  UpdateSubscriptionSettingsDto,
  UpsertPlanDto,
} from './dto/subscriptions.dto';
import { tr } from '../i18n/i18n.service';

@Controller('admin')
export class AdminSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  private assertAdmin(req: RequestWithUser) {
    if (!req.user?.isPlatformAdmin) {
      throw new ForbiddenException(tr('errors.onlyPlatformAdmins'));
    }
  }

  // --- Default plans --------------------------------------------------------

  @Get('subscription-settings')
  async getSettings(@Req() req: RequestWithUser) {
    this.assertAdmin(req);
    return { trialDays: await this.subscriptions.getTrialDays() };
  }

  @Patch('subscription-settings')
  updateSettings(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateSubscriptionSettingsDto,
  ) {
    this.assertAdmin(req);
    return this.subscriptions.setTrialDays(dto.trialDays);
  }

  @Get('subscription-plans')
  listPlans(@Req() req: RequestWithUser) {
    this.assertAdmin(req);
    return this.subscriptions.listPlans();
  }

  @Post('subscription-plans')
  upsertPlan(@Req() req: RequestWithUser, @Body() dto: UpsertPlanDto) {
    this.assertAdmin(req);
    return this.subscriptions.upsertPlan({
      businessType: (dto.businessType ?? null) as BusinessType | null,
      term: dto.term as SubscriptionTerm,
      price: dto.price,
      currency: dto.currency,
      active: dto.active,
    });
  }

  // --- Per-tenant subscription ---------------------------------------------

  @Get('organizations/:id/subscription')
  getOrgSubscription(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertAdmin(req);
    return this.subscriptions.getForOrg(id);
  }

  @Patch('organizations/:id/subscription')
  updateOrgSubscription(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUpdateSubscriptionDto,
  ) {
    this.assertAdmin(req);
    return this.subscriptions.adminUpdate(id, {
      status: dto.status as SubscriptionStatus | undefined,
      term: (dto.term ?? undefined) as SubscriptionTerm | null | undefined,
      priceOverride: dto.priceOverride,
      expiresAt: dto.expiresAt,
      autoRenew: dto.autoRenew,
      note: dto.note,
    });
  }

  // --- Bank accounts --------------------------------------------------------

  @Get('bank-accounts')
  listBankAccounts(@Req() req: RequestWithUser) {
    this.assertAdmin(req);
    return this.subscriptions.listBankAccounts();
  }

  @Post('bank-accounts')
  createBankAccount(@Req() req: RequestWithUser, @Body() dto: BankAccountDto) {
    this.assertAdmin(req);
    return this.subscriptions.createBankAccount({
      bankName: dto.bankName,
      accountName: dto.accountName,
      accountNumber: dto.accountNumber,
      branch: dto.branch,
      businessType: (dto.businessType ?? null) as BusinessType | null,
      active: dto.active,
      sortOrder: dto.sortOrder,
    });
  }

  @Patch('bank-accounts/:id')
  updateBankAccount(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BankAccountDto,
  ) {
    this.assertAdmin(req);
    return this.subscriptions.updateBankAccount(id, {
      bankName: dto.bankName,
      accountName: dto.accountName,
      accountNumber: dto.accountNumber,
      branch: dto.branch,
      businessType: (dto.businessType ?? null) as BusinessType | null,
      active: dto.active,
      sortOrder: dto.sortOrder,
    });
  }

  @Delete('bank-accounts/:id')
  deleteBankAccount(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
    this.assertAdmin(req);
    return this.subscriptions.deleteBankAccount(id);
  }

  // --- Receipt review queue -------------------------------------------------

  @Get('subscription-payments')
  listPayments(
    @Req() req: RequestWithUser,
    @Query('status') status?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    this.assertAdmin(req);
    return this.subscriptions.listPayments({
      status: status ? (status as SubscriptionPaymentStatus) : undefined,
      organizationId: organizationId ? Number(organizationId) : undefined,
    });
  }

  @Post('subscription-payments/:id/review')
  reviewPayment(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewPaymentDto,
  ) {
    this.assertAdmin(req);
    return this.subscriptions.adminReviewPayment(id, req.user.sub, dto.action, dto.note);
  }
}

// src/subscriptions/subscriptions.controller.ts
// Client-facing subscription endpoints (pricing view, bank accounts, receipt
// submission + history, receipt download). Receipt submission is allowed even for
// unverified / expired tenants — that is exactly how they renew — so it is
// wrapped in @AllowUnverified and gated only by membership via the tenant id.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { AllowExpired } from '../common/decorators/allow-expired.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { createDocumentUploadOptions } from '../common/upload.config';
import type { UploadedFileShape } from '../common/upload.config';
import { SubscriptionsService } from './subscriptions.service';
import { SubmitSubscriptionPaymentDto } from './dto/subscriptions.dto';
import { tr } from '../i18n/i18n.service';

// Receipts reuse the shared document upload config (JPG/PNG/WEBP/HEIC/PDF, 10MB).
const receiptMulterOptions = createDocumentUploadOptions('subscription-receipts');

@Controller('subscriptions')
@AllowUnverified()
@AllowExpired()
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  private requireOrg(req: RequestWithUser): number {
    const orgId = req.tenantId ?? req.user?.organizationId;
    if (orgId == null) throw new BadRequestException(tr('errors.noActiveOrganization'));
    return orgId;
  }

  /** The tenant's subscription state (status, expiry, days left, price). */
  @Get('me')
  me(@Req() req: RequestWithUser) {
    return this.subscriptions.getForOrg(this.requireOrg(req));
  }

  /** The price grid for the tenant's business type (all terms). */
  @Get('pricing')
  async pricing(@Req() req: RequestWithUser) {
    const orgId = this.requireOrg(req);
    const terms = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'] as const;
    const rows = await Promise.all(
      terms.map(async (term) => ({
        term,
        ...(await this.subscriptions.resolvePrice(orgId, term)),
      })),
    );
    return rows;
  }

  /** Active bank accounts the tenant can pay into. */
  @Get('bank-accounts')
  bankAccounts(@Req() req: RequestWithUser) {
    return this.subscriptions.bankAccountsForOrg(this.requireOrg(req));
  }

  /** The tenant's own receipt submissions. */
  @Get('payments')
  payments(@Req() req: RequestWithUser) {
    return this.subscriptions.listOrgPayments(this.requireOrg(req));
  }

  /** Submit a payment receipt; AI reviews it and may auto-extend the subscription. */
  @Post('payments')
  @UseInterceptors(FileInterceptor('file', receiptMulterOptions))
  submit(
    @Req() req: RequestWithUser,
    @Body() dto: SubmitSubscriptionPaymentDto,
    @UploadedFile() file?: UploadedFileShape,
  ) {
    const orgId = this.requireOrg(req);
    if (!file) throw new BadRequestException(tr('errors.noFileUploaded'));
    const term = this.subscriptions.assertTerm(dto.term);
    return this.subscriptions.submitPayment({
      organizationId: orgId,
      userId: req.user.sub,
      term,
      bankAccountId: dto.bankAccountId ? Number(dto.bankAccountId) : undefined,
      payerName: dto.payerName,
      transactionRef: dto.transactionRef,
      amount: dto.amount != null && dto.amount !== '' ? Number(dto.amount) : undefined,
      file,
    });
  }

  /** Download a receipt the tenant submitted (scoped to their org). */
  @Get('payments/:id/file')
  async file(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const orgId = this.requireOrg(req);
    await this.subscriptions.assertOrgAccess(id, orgId);
    const meta = await this.subscriptions.getPaymentFile(id);
    res.set({
      'Content-Type': meta.mimeType,
      'Content-Disposition': `inline; filename="${meta.fileName}"`,
    });
    return new StreamableFile(createReadStream(meta.filePath));
  }
}

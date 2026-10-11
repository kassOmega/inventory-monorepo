// src/public/public.controller.ts
// PUBLIC (unauthenticated) guest-ordering endpoints. Every route is scoped ONLY
// by the opaque entry token in the path/body — there are no internal :id params,
// and no X-Tenant-Id is ever trusted here.
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PublicService } from './public.service';

@Controller('public')
@Public()
export class PublicController {
  constructor(private readonly publicSvc: PublicService) {}

  /** The public-safe view + catalog for a scanned QR token. */
  @Get('entry/:token')
  entry(@Param('token') token: string) {
    return this.publicSvc.view(token);
  }

  /** Autofill the guest's name from their phone (minimal, tenant-scoped by token). */
  @Post('entry/:token/customer-lookup')
  lookup(@Param('token') token: string, @Body('phone') phone: string) {
    return this.publicSvc.lookupCustomer(token, phone);
  }

  /** Submit a guest order/booking. */
  @Post('entry/:token/orders')
  submit(
    @Param('token') token: string,
    @Body()
    body: {
      items: Array<{ ref: string; quantity: number; notes?: string }>;
      customerName?: string;
      customerPhone?: string;
      note?: string;
    },
  ) {
    return this.publicSvc.submit(token, body);
  }

  /** The guest's own order status (by its opaque order token). */
  @Get('orders/:orderToken')
  status(@Param('orderToken') orderToken: string) {
    return this.publicSvc.orderStatus(orderToken);
  }
}

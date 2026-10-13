// src/guest-orders/guest-orders.controller.ts
// Privileged management of public guest orders: the inbox, review, routing to
// branches, branch replies, release, QR/public-entry management, and the phone
// blocklist. Permission-gated; tenant-scoped.
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { GuestOrdersService } from './guest-orders.service';

@Controller('guest-orders')
export class GuestOrdersController {
  constructor(private readonly guestOrders: GuestOrdersService) {}

  // --- Inbox ----------------------------------------------------------------

  @Get()
  @Permissions('guest-orders.view')
  list(
    @Query('status') status: string | undefined,
    @Query('sort') sort: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    return this.guestOrders.list(status, req.user, sort);
  }

  // Bulk routes MUST be declared before the `:id` routes so `/bulk/review`
  // is not captured by `:id/review`.
  @Post('bulk/review')
  @Permissions('guest-orders.manage')
  bulkReview(
    @Req() req: RequestWithUser,
    @Body() body: { ids: number[]; note?: string },
  ) {
    return this.guestOrders.bulkReview(body.ids ?? [], req.user, body.note);
  }

  @Post('bulk/reject')
  @Permissions('guest-orders.manage')
  bulkReject(
    @Req() req: RequestWithUser,
    @Body() body: { ids: number[]; note?: string },
  ) {
    return this.guestOrders.bulkReject(body.ids ?? [], req.user, body.note);
  }

  @Get('pending-count')
  @Permissions('guest-orders.view')
  pendingCount(@Req() req: RequestWithUser) {
    return this.guestOrders.pendingCount(req.user);
  }

  // Declared before `:id` so it is not captured as a numeric id.
  @Get('edit-options')
  @Permissions('guest-orders.manage')
  editOptions() {
    return this.guestOrders.editOptions();
  }

  @Get(':id')
  @Permissions('guest-orders.view')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.guestOrders.get(id, req.user);
  }

  @Patch(':id')
  @Permissions('guest-orders.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req: RequestWithUser,
  ) {
    return this.guestOrders.update(id, body, req.user);
  }

  @Delete(':id')
  @Permissions('guest-orders.manage')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.guestOrders.remove(id, req.user);
  }

  @Post(':id/review')
  @Permissions('guest-orders.manage')
  review(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('note') note?: string,
  ) {
    return this.guestOrders.review(id, req.user, note);
  }

  @Post(':id/route')
  @Permissions('guest-orders.manage')
  route(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { locationIds: number[]; note?: string },
  ) {
    return this.guestOrders.route(id, body.locationIds ?? [], req.user, body.note);
  }

  @Post(':id/branches/:locationId/respond')
  @Permissions('guest-orders.manage')
  respond(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('locationId', ParseIntPipe) locationId: number,
    @Body() body: { reply: 'ACCEPTED' | 'DECLINED'; note?: string },
  ) {
    return this.guestOrders.respond(id, locationId, req.user, body.reply, body.note);
  }

  @Post(':id/assign')
  @Permissions('guest-orders.manage')
  assign(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      locationId: number;
      paymentMethodId?: number;
      saleType?: string;
      paidAmount?: number;
    },
  ) {
    return this.guestOrders.assign(id, Number(body.locationId), req.user, {
      paymentMethodId: body.paymentMethodId ? Number(body.paymentMethodId) : undefined,
      saleType: body.saleType,
      paidAmount: body.paidAmount ? Number(body.paidAmount) : undefined,
    });
  }

  @Post(':id/convert')
  @Permissions('guest-orders.manage')
  convert(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      locationId?: number;
      paymentMethodId?: number;
      saleType?: string;
      paidAmount?: number;
    },
  ) {
    return this.guestOrders.convert(id, req.user, {
      locationId: body.locationId ? Number(body.locationId) : undefined,
      paymentMethodId: body.paymentMethodId ? Number(body.paymentMethodId) : undefined,
      saleType: body.saleType,
      paidAmount: body.paidAmount ? Number(body.paidAmount) : undefined,
    });
  }

  @Post(':id/reject')
  @Permissions('guest-orders.manage')
  reject(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('note') note?: string,
  ) {
    return this.guestOrders.reject(id, req.user, note);
  }

  // --- QR / public entries --------------------------------------------------

  @Get('qr/entries')
  @Permissions('qr.manage')
  entries() {
    // Auto-prepare the business's QRs (idempotent) before returning them.
    return this.guestOrders.ensurePublicEntries();
  }

  @Get('qr/entry-kinds')
  @Permissions('qr.manage')
  entryKinds() {
    return this.guestOrders.allowedEntryKinds();
  }

  @Post('qr/entries')
  @Permissions('qr.manage')
  createEntry(
    @Body()
    body: {
      kind: 'TABLE' | 'HOTEL' | 'SHOP' | 'CARWASH_BAY' | 'SERVICE';
      label: string;
      tableId?: number | null;
      locationId?: number | null;
      serviceType?: 'FOOD_AND_BEVERAGE' | 'ACCOMMODATION' | 'SPA_AND_WELLNESS' | 'GYM_AND_FITNESS' | 'SWIMMING_POOL' | 'EVENT_AND_HALL_RENTAL' | 'CUSTOM' | null;
    },
  ) {
    return this.guestOrders.createEntry(body);
  }

  @Patch('qr/entries/:id')
  @Permissions('qr.manage')
  updateEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      label?: string;
      state?: 'LIVE' | 'HELD' | 'DROPPED';
      liveFrom?: string | null;
      liveUntil?: string | null;
      active?: boolean;
      autoApprove?: boolean;
    },
  ) {
    return this.guestOrders.updateEntry(id, body);
  }

  @Delete('qr/entries/:id')
  @Permissions('qr.manage')
  deleteEntry(@Param('id', ParseIntPipe) id: number) {
    return this.guestOrders.deleteEntry(id);
  }

  @Post('qr/entries/:id/items')
  @Permissions('qr.manage')
  setItems(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      items: Array<{
        itemKind: string;
        itemId: number;
        priceOverride?: number | null;
        sortOrder?: number;
      }>;
    },
  ) {
    return this.guestOrders.setEntryItems(id, body.items ?? []);
  }

  // --- Blocklist ------------------------------------------------------------

  @Get('qr/blocklist')
  @Permissions('qr.manage')
  blocklist() {
    return this.guestOrders.listBlocklist();
  }

  @Post('qr/blocklist')
  @Permissions('qr.manage')
  block(@Body() body: { phone: string; reason?: string }) {
    return this.guestOrders.blockPhone(body.phone, body.reason);
  }

  @Delete('qr/blocklist/:id')
  @Permissions('qr.manage')
  unblock(@Param('id', ParseIntPipe) id: number) {
    return this.guestOrders.unblockPhone(id);
  }
}

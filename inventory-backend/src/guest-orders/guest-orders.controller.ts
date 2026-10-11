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
  list(@Query('status') status?: string) {
    return this.guestOrders.list(status);
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
  pendingCount() {
    return this.guestOrders.pendingCount();
  }

  @Get(':id')
  @Permissions('guest-orders.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.guestOrders.get(id);
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
    return this.guestOrders.route(id, body.locationIds ?? [], req.user.sub, body.note);
  }

  @Post(':id/branches/:locationId/respond')
  @Permissions('guest-orders.manage')
  respond(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('locationId', ParseIntPipe) locationId: number,
    @Body() body: { reply: 'ACCEPTED' | 'DECLINED'; note?: string },
  ) {
    return this.guestOrders.respond(id, locationId, req.user.sub, body.reply, body.note);
  }

  @Post(':id/assign')
  @Permissions('guest-orders.manage')
  assign(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('locationId', ParseIntPipe) locationId: number,
  ) {
    return this.guestOrders.assign(id, locationId, req.user);
  }

  @Post(':id/reject')
  @Permissions('guest-orders.manage')
  reject(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('note') note?: string,
  ) {
    return this.guestOrders.reject(id, req.user.sub, note);
  }

  @Post(':id/free')
  @Permissions('guest-orders.manage')
  free(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('note') note?: string,
  ) {
    return this.guestOrders.free(id, req.user.sub, note);
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

// src/restaurant/restaurant.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import {
  CreateMenuCategoryDto,
  CreateMenuItemDto,
  CreateMenuItemOptionDto,
  CreateOrderDto,
  CreateReservationDto,
  CreateStationDto,
  CreateTableDto,
  SetMenuItemRecipeDto,
  SettleOrderDto,
  SettleBatchDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto,
  UpdateMenuItemOptionDto,
  UpdateOrderDto,
  UpdateOrderItemStatusDto,
  UpdateOrderStatusDto,
  UpdateReservationStatusDto,
  UpdateStationDto,
  UpdateTableStatusDto,
} from './dto/restaurant.dto';
import { MenuRecipeService } from './menu-recipe.service';
import { RestaurantService } from './restaurant.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { FiscalAckDto, FiscalFailDto } from '../fiscal/dto/fiscal.dto';

@Controller('restaurant')
@Permissions('restaurant.view')
export class RestaurantController {
  constructor(
    private restaurant: RestaurantService,
    private recipes: MenuRecipeService,
    private fiscal: FiscalService,
  ) {}

  // Stations (owner-managed, dynamic)
  @Get('stations')
  listStations() {
    return this.restaurant.listStations();
  }

  @Post('stations')
  @Permissions('restaurant.manage')
  createStation(@Body() dto: CreateStationDto) {
    return this.restaurant.createStation(dto);
  }

  @Patch('stations/:id')
  @Permissions('restaurant.manage')
  updateStation(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStationDto) {
    return this.restaurant.updateStation(id, dto);
  }

  @Delete('stations/:id')
  @Permissions('restaurant.manage')
  deleteStation(@Param('id', ParseIntPipe) id: number) {
    return this.restaurant.deleteStation(id);
  }

  // Staff list + quick role assignment for a station (used by the menu page).
  @Get('stations/:id/users')
  @Permissions('restaurant.manage')
  listStationUsers(@Param('id', ParseIntPipe) id: number) {
    return this.restaurant.listStationUsers(id);
  }

  @Put('stations/:id/assign')
  @Permissions('restaurant.manage')
  assignStationUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { userId: number; assign: boolean },
  ) {
    return this.restaurant.assignStationUser(id, body);
  }

  // Menu
  @Get('menu')
  listMenu() {
    return this.restaurant.listMenu();
  }

  @Post('menu-categories')
  @Permissions('restaurant.manage')
  createMenuCategory(@Body() dto: CreateMenuCategoryDto) {
    return this.restaurant.createMenuCategory(dto);
  }

  @Post('menu-categories/defaults')
  @Permissions('restaurant.manage')
  seedDefaultMenuCategories() {
    return this.restaurant.seedDefaultMenuCategories();
  }

  @Post('menu-items')
  @Permissions('restaurant.manage')
  createMenuItem(@Body() dto: CreateMenuItemDto) {
    return this.restaurant.createMenuItem(dto);
  }

  @Patch('menu-items/:id/availability')
  @Permissions('restaurant.manage')
  updateMenuItemAvailability(@Param('id', ParseIntPipe) id: number, @Body() body: { isAvailable: boolean }) {
    return this.restaurant.updateMenuItemAvailability(id, body.isAvailable);
  }

  @Patch('menu-categories/:id')
  @Permissions('restaurant.manage')
  updateMenuCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMenuCategoryDto) {
    return this.restaurant.updateMenuCategory(id, dto);
  }

  @Delete('menu-categories/:id')
  @Permissions('restaurant.manage')
  deleteMenuCategory(@Param('id', ParseIntPipe) id: number) {
    return this.restaurant.deleteMenuCategory(id);
  }

  @Patch('menu-items/:id')
  @Permissions('restaurant.manage')
  updateMenuItem(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMenuItemDto) {
    return this.restaurant.updateMenuItem(id, dto);
  }

  @Delete('menu-items/:id')
  @Permissions('restaurant.manage')
  deleteMenuItem(@Param('id', ParseIntPipe) id: number) {
    return this.restaurant.deleteMenuItem(id);
  }

  @Post('menu-items/:id/options')
  @Permissions('restaurant.manage')
  addMenuItemOption(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateMenuItemOptionDto) {
    return this.restaurant.addMenuItemOption(id, dto);
  }

  @Patch('menu-item-options/:id')
  @Permissions('restaurant.manage')
  updateMenuItemOption(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMenuItemOptionDto) {
    return this.restaurant.updateMenuItemOption(id, dto);
  }

  @Delete('menu-item-options/:id')
  @Permissions('restaurant.manage')
  deleteMenuItemOption(@Param('id', ParseIntPipe) id: number) {
    return this.restaurant.deleteMenuItemOption(id);
  }

  // Recipe (ingredient) costing
  @Get('menu-items/:id/recipe')
  getMenuItemRecipe(@Param('id', ParseIntPipe) id: number) {
    return this.recipes.getRecipe(id, this.restaurant.tenant());
  }

  @Put('menu-items/:id/recipe')
  @Permissions('restaurant.manage')
  setMenuItemRecipe(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetMenuItemRecipeDto,
  ) {
    return this.recipes.setRecipe(id, this.restaurant.tenant(), dto.ingredients);
  }

  // Tables
  @Get('tables')
  listTables() {
    return this.restaurant.listTables();
  }

  @Post('tables')
  @Permissions('restaurant.manage')
  createTable(@Body() dto: CreateTableDto) {
    return this.restaurant.createTable(dto);
  }

  @Patch('tables/:id/status')
  @Permissions('restaurant.manage')
  updateTableStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTableStatusDto) {
    return this.restaurant.updateTableStatus(id, dto.status);
  }

  // Orders
  @Get('orders')
  listOrders(
    @Req() req: RequestWithUser,
    @Query('status') status?: string,
    @Query('waiterId') waiterId?: string,
    @Query('tableId') tableId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.restaurant.listOrders(req.user, status, {
      waiterId: waiterId ? Number(waiterId) : undefined,
      tableId: tableId ? Number(tableId) : undefined,
      dateFrom,
      dateTo,
    });
  }

  @Get('kitchen')
  kitchenBoard(@Query('station') station: string | undefined, @Req() req: RequestWithUser) {
    return this.restaurant.getKitchenBoard(station, req.user);
  }

  @Post('orders')
  @Permissions('restaurant.take-orders', 'restaurant.manage')
  createOrder(@Body() dto: CreateOrderDto, @Req() req: RequestWithUser) {
    return this.restaurant.createOrder(dto, req.user);
  }

  // Multi-hop handoff: move an item to the next station in its route. The
  // per-station update permission is enforced inside the service so custom
  // stations (station.<key>.update) are covered alongside the built-ins.
  @Post('orders/:id/items/:itemId/advance')
  @Permissions('restaurant.view', 'restaurant.serve', 'restaurant.manage')
  advanceItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: RequestWithUser,
  ) {
    return this.restaurant.advanceItem(id, itemId, req.user);
  }

  @Patch('orders/:id/status')
  @Permissions('restaurant.manage')
  updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.restaurant.updateOrderStatus(id, dto.status, req.user);
  }

  @Patch('orders/:id')
  @Permissions('restaurant.manage')
  updateOrder(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) {
    return this.restaurant.updateOrder(id, dto);
  }

  @Post('orders/:id/cancel')
  @Permissions('restaurant.manage')
  cancelOrder(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.restaurant.cancelOrder(id, req.user);
  }

  @Delete('orders/:id')
  @Permissions('restaurant.manage')
  deleteOrder(@Param('id', ParseIntPipe) id: number) {
    return this.restaurant.deleteOrder(id);
  }

  @Patch('orders/:id/items/:itemId/status')
  @Permissions('restaurant.view', 'restaurant.serve', 'restaurant.manage')
  updateItemStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateOrderItemStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.restaurant.updateItemStatus(id, itemId, dto.status, req.user);
  }

  // Waiter action: take the ready order to the customer (station marks READY,
  // the waiter marks SERVED). Managers/owners can trigger it as an override.
  @Post('orders/:id/mark-served')
  @Permissions('restaurant.serve', 'restaurant.manage')
  markOrderServed(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.restaurant.markOrderServed(id, req.user);
  }

  @Post('orders/:id/settle')
  @Permissions('restaurant.settle', 'restaurant.manage')
  settleOrder(@Param('id', ParseIntPipe) id: number, @Body() dto: SettleOrderDto, @Req() req: RequestWithUser) {
    return this.restaurant.settleOrder(id, dto, req.user);
  }

  // Batch-settle several open orders (e.g. every open order on one table) in a
  // single transaction so the whole bill is closed atomically.
  @Post('orders/batch-settle')
  @Permissions('restaurant.settle', 'restaurant.manage')
  batchSettleOrders(@Body() dto: SettleBatchDto, @Req() req: RequestWithUser) {
    return this.restaurant.batchSettleOrders(dto.orderIds, dto, req.user);
  }

  // --- Fiscal printing (universal invoice summary + local-agent lifecycle) ---
  @Get('orders/:id/fiscal-summary')
  @Permissions('restaurant.view', 'restaurant.settle', 'restaurant.manage', 'cashier.view', 'cashier.confirm', 'finance.view')
  fiscalOrderSummary(@Param('id', ParseIntPipe) id: number) {
    return this.fiscal.getSummary({ orderId: id });
  }

  @Post('orders/:id/fiscal-print')
  @Permissions('restaurant.settle', 'restaurant.manage', 'cashier.confirm', 'finance.manage')
  fiscalOrderPrint(@Param('id', ParseIntPipe) id: number) {
    return this.fiscal.markPrintPending({ orderId: id });
  }

  @Patch('orders/:id/fiscal-ack')
  @Permissions('restaurant.settle', 'restaurant.manage', 'cashier.confirm', 'finance.manage')
  fiscalOrderAck(@Param('id', ParseIntPipe) id: number, @Body() dto: FiscalAckDto) {
    return this.fiscal.ack({ orderId: id }, dto);
  }

  @Post('orders/:id/fiscal-print-failed')
  @Permissions('restaurant.settle', 'restaurant.manage', 'cashier.confirm', 'finance.manage')
  fiscalOrderFailed(@Param('id', ParseIntPipe) id: number, @Body() dto: FiscalFailDto) {
    return this.fiscal.markFailed({ orderId: id }, dto);
  }

  // Reservations
  @Get('reservations')
  listReservations(@Query('date') date?: string) {
    return this.restaurant.listReservations(date);
  }

  @Post('reservations')
  @Permissions('restaurant.manage')
  createReservation(@Body() dto: CreateReservationDto) {
    return this.restaurant.createReservation(dto);
  }

  @Patch('reservations/:id/status')
  @Permissions('restaurant.manage')
  updateReservationStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReservationStatusDto) {
    return this.restaurant.updateReservationStatus(id, dto.status);
  }
}

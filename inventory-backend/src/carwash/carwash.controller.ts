// src/carwash/carwash.controller.ts
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
import { BusinessType } from '@prisma/client';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { Vertical } from '../common/decorators/vertical.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { CarWashService } from './carwash.service';
import {
  CreateBookingDto,
  CreateCarWashExpenseDto,
  CreateCollectionDto,
  CreateStoreItemDto,
  CreateVehicleDto,
  CreateWashDto,
  CreateWasherDto,
  StartWashDto,
  CreateWashTypeDto,
  CreateVehicleTypeDto,
  UpdateWashDto,
  IssueEquipmentDto,
  PayEquipmentIssueDto,
  UpdateBookingStatusDto,
  UpdateCarWashExpenseDto,
  UpdateStoreItemDto,
  UpdateSettingsDto,
  SettleWashDto,
  UpdateVehicleDto,
  UpdateWasherDto,
  UpdateWashTypeDto,
  UpdateVehicleTypeDto,
  UpsertPriceDto,
} from './dto/carwash.dto';

@Controller('carwash')
@Vertical(BusinessType.CAR_WASH)
export class CarWashController {
  constructor(private readonly carwash: CarWashService) {}

  @Get('dashboard')
  @Permissions('carwash.washes.view')
  dashboard(
    @Req() req: RequestWithUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('washerId') washerId?: string,
    @Query('washTypeId') washTypeId?: string,
    @Query('vehicleType') vehicleType?: string,
  ) {
    return this.carwash.dashboard(req.user, {
      startDate,
      endDate,
      washerId: washerId ? Number(washerId) : undefined,
      washTypeId: washTypeId ? Number(washTypeId) : undefined,
      vehicleType,
    });
  }

  // -------------------------------------------------------------------------
  // Washers
  // -------------------------------------------------------------------------
  @Get('washers')
  @Permissions('carwash.washers.view')
  listWashers(@Query('activeOnly') activeOnly?: string) {
    return this.carwash.listWashers(activeOnly === '1' || activeOnly === 'true');
  }

  @Post('washers')
  @Permissions('carwash.washers.create')
  createWasher(@Body() dto: CreateWasherDto, @Req() req: RequestWithUser) {
    return this.carwash.createWasher(dto, req.user.sub);
  }

  @Patch('washers/:id')
  @Permissions('carwash.washers.edit')
  updateWasher(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWasherDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.updateWasher(id, dto, req.user.sub);
  }

  @Delete('washers/:id')
  @Permissions('carwash.washers.delete')
  deleteWasher(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.carwash.deleteWasher(id, req.user.sub);
  }

  // -------------------------------------------------------------------------
  // Prices
  // -------------------------------------------------------------------------
  @Get('prices')
  @Permissions('carwash.prices.view')
  listPrices() {
    return this.carwash.listPrices();
  }

  @Post('prices')
  @Permissions('carwash.prices.create', 'carwash.prices.edit')
  upsertPrice(@Body() dto: UpsertPriceDto, @Req() req: RequestWithUser) {
    return this.carwash.upsertPrice(dto, req.user.sub);
  }

  @Patch('prices/:id')
  @Permissions('carwash.prices.create', 'carwash.prices.edit')
  updatePrice(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertPriceDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.updatePrice(id, dto, req.user.sub);
  }

  @Delete('prices/:id')
  @Permissions('carwash.prices.delete')
  deletePrice(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.carwash.deletePrice(id, req.user.sub);
  }

  // -------------------------------------------------------------------------
  // Wash types (business-defined wash service types)
  // -------------------------------------------------------------------------
  @Get('wash-types')
  @Permissions('carwash.prices.view')
  listWashTypes() {
    return this.carwash.listWashTypes();
  }

  @Post('wash-types')
  @Permissions('carwash.prices.create', 'carwash.prices.edit')
  createWashType(@Body() dto: CreateWashTypeDto) {
    return this.carwash.createWashType(dto);
  }

  @Patch('wash-types/:id')
  @Permissions('carwash.prices.edit')
  updateWashType(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWashTypeDto,
  ) {
    return this.carwash.updateWashType(id, dto);
  }

  @Delete('wash-types/:id')
  @Permissions('carwash.prices.delete')
  deleteWashType(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteWashType(id);
  }

  // -------------------------------------------------------------------------
  // Vehicle types (business-defined vehicle categories)
  // -------------------------------------------------------------------------
  @Get('vehicle-types')
  @Permissions('carwash.prices.view')
  listVehicleTypes() {
    return this.carwash.listVehicleTypes();
  }

  @Post('vehicle-types')
  @Permissions('carwash.prices.create', 'carwash.prices.edit')
  createVehicleType(@Body() dto: CreateVehicleTypeDto) {
    return this.carwash.createVehicleType(dto);
  }

  @Patch('vehicle-types/:id')
  @Permissions('carwash.prices.edit')
  updateVehicleType(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVehicleTypeDto,
  ) {
    return this.carwash.updateVehicleType(id, dto);
  }

  @Delete('vehicle-types/:id')
  @Permissions('carwash.prices.delete')
  deleteVehicleType(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteVehicleType(id);
  }

  // -------------------------------------------------------------------------
  // Vehicles
  // -------------------------------------------------------------------------
  @Get('vehicles')
  @Permissions('carwash.vehicles.view')
  listVehicles(
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.carwash.listVehicles(search, customerId ? Number(customerId) : undefined);
  }

  @Post('vehicles')
  @Permissions('carwash.vehicles.create')
  createVehicle(@Body() dto: CreateVehicleDto) {
    return this.carwash.createVehicle(dto);
  }

  @Patch('vehicles/:id')
  @Permissions('carwash.vehicles.edit')
  updateVehicle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.carwash.updateVehicle(id, dto);
  }

  @Delete('vehicles/:id')
  @Permissions('carwash.vehicles.delete')
  deleteVehicle(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteVehicle(id);
  }

  // -------------------------------------------------------------------------
  // Bookings
  // -------------------------------------------------------------------------
  @Get('bookings')
  @Permissions('carwash.bookings.view')
  listBookings(
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('washerId') washerId?: string,
    @Query('status') status?: string,
  ) {
    return this.carwash.listBookings(date, {
      startDate,
      endDate,
      washerId: washerId ? Number(washerId) : undefined,
      status,
    });
  }

  @Get('bookings/availability')
  @Permissions('carwash.bookings.view')
  checkAvailability(
    @Query('washerId', ParseIntPipe) washerId: number,
    @Query('startsAt') startsAt: string,
    @Query('slotMinutes') slotMinutes?: string,
  ) {
    return this.carwash.checkAvailability(
      washerId,
      startsAt,
      slotMinutes ? Number(slotMinutes) : undefined,
    );
  }

  @Post('bookings')
  @Permissions('carwash.bookings.create')
  createBooking(@Body() dto: CreateBookingDto, @Req() req: RequestWithUser) {
    return this.carwash.createBooking(dto, req.user.sub);
  }

  @Patch('bookings/:id/status')
  @Permissions('carwash.bookings.edit')
  updateBookingStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBookingStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.updateBookingStatus(id, dto.status, req.user.sub);
  }

  @Delete('bookings/:id')
  @Permissions('carwash.bookings.delete')
  deleteBooking(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.carwash.deleteBooking(id, req.user.sub);
  }

  // -------------------------------------------------------------------------
  // Wash jobs
  // -------------------------------------------------------------------------
  @Get('washes')
  @Permissions('carwash.washes.view')
  listWashes(
    @Req() req: RequestWithUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('washerId') washerId?: string,
    @Query('washTypeId') washTypeId?: string,
  ) {
    return this.carwash.listWashes(startDate, endDate, req.user, {
      washerId: washerId ? Number(washerId) : undefined,
      washTypeId: washTypeId ? Number(washTypeId) : undefined,
    });
  }

  @Post('washes')
  @Permissions('carwash.washes.create')
  createWash(@Body() dto: CreateWashDto, @Req() req: RequestWithUser) {
    return this.carwash.createWash(dto, req.user.sub);
  }

  @Patch('washes/:id')
  @Permissions('carwash.washes.edit')
  updateWash(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWashDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.updateWash(id, dto, req.user.sub);
  }

  @Patch('washes/:id/start')
  @Permissions('carwash.washes.edit')
  startWash(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartWashDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.startWash(id, req.user.sub, {
      washerId: dto.washerId,
      participantWasherIds: dto.participantWasherIds,
    });
  }

  @Patch('washes/:id/complete')
  @Permissions('carwash.washes.edit')
  completeWash(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.carwash.completeWash(id, req.user.sub);
  }

  @Patch('washes/:id/settle')
  @Permissions('carwash.washes.edit')
  settleWash(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SettleWashDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.settleWash(id, req.user.sub, dto.paymentMethodId);
  }

  @Delete('washes/:id')
  @Permissions('carwash.washes.delete')
  deleteWash(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.carwash.deleteWash(id, req.user.sub);
  }

  @Get('commissions')
  @Permissions('carwash.reports.view', 'carwash.collections.view')
  commissions(
    @Req() req: RequestWithUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.carwash.commissions(startDate, endDate, req.user);
  }

  @Get('my-report')
  @Permissions('carwash.reports.view', 'carwash.washes.view')
  myReport(@Req() req: RequestWithUser) {
    return this.carwash.myReport(req.user.sub);
  }

  @Get('reports/washers')
  @Permissions('carwash.reports.view')
  washerReports(
    @Req() req: RequestWithUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.carwash.washerReports(startDate, endDate, req.user);
  }

  @Get('reports/washers/:washerId/washes')
  @Permissions('carwash.reports.view')
  washerWashes(
    @Req() req: RequestWithUser,
    @Param('washerId', ParseIntPipe) washerId: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.carwash.washerWashes(washerId, startDate, endDate, req.user);
  }

  @Get('reports/payment-methods')
  @Permissions('carwash.reports.view')
  paymentMethodsBreakdown(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.carwash.paymentMethodsBreakdown(startDate, endDate);
  }

  @Get('reports/breakdown')
  @Permissions('carwash.reports.view', 'carwash.collections.view')
  reportsBreakdown(
    @Req() req: RequestWithUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.carwash.reportsBreakdown(startDate, endDate, req.user);
  }

  // -------------------------------------------------------------------------
  // Equipment issuance
  // -------------------------------------------------------------------------
  @Get('products')
  @Permissions('carwash.equipment.view', 'carwash.equipment.issue')
  listProducts() {
    return this.carwash.listProducts();
  }

  @Get('store-items')
  @Permissions('carwash.equipment.view', 'carwash.equipment.issue')
  listStoreItems() {
    return this.carwash.listStoreItems();
  }

  @Post('store-items')
  @Permissions('carwash.equipment.issue')
  createStoreItem(@Body() dto: CreateStoreItemDto) {
    return this.carwash.createStoreItem(dto);
  }

  @Patch('store-items/:id')
  @Permissions('carwash.equipment.issue')
  updateStoreItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStoreItemDto,
  ) {
    return this.carwash.updateStoreItem(id, dto);
  }

  @Delete('store-items/:id')
  @Permissions('carwash.equipment.delete')
  deleteStoreItem(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteStoreItem(id);
  }

  @Get('equipment-issues')
  @Permissions('carwash.equipment.view')
  listEquipmentIssues() {
    return this.carwash.listEquipmentIssues();
  }

  @Post('equipment-issues')
  @Permissions('carwash.equipment.issue')
  issueEquipment(@Body() dto: IssueEquipmentDto, @Req() req: RequestWithUser) {
    return this.carwash.issueEquipment(dto, req.user.sub);
  }

  @Patch('equipment-issues/:id/pay')
  @Permissions('carwash.equipment.edit')
  markEquipmentIssuePaid(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayEquipmentIssueDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.markEquipmentIssuePaid(id, dto.isPaid, req.user.sub);
  }

  @Delete('equipment-issues/:id')
  @Permissions('carwash.equipment.delete')
  deleteEquipmentIssue(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.carwash.deleteEquipmentIssue(id, req.user.sub);
  }

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------
  @Get('expenses')
  @Permissions('carwash.expenses.view')
  listExpenses(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.carwash.listExpenses(startDate, endDate, category, search);
  }

  @Post('expenses')
  @Permissions('carwash.expenses.create')
  createExpense(
    @Body() dto: CreateCarWashExpenseDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.createExpense(dto, req.user.sub);
  }

  @Patch('expenses/:id')
  @Permissions('carwash.expenses.edit')
  updateExpense(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCarWashExpenseDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.updateExpense(id, dto, req.user.sub);
  }

  @Delete('expenses/:id')
  @Permissions('carwash.expenses.delete')
  deleteExpense(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.carwash.deleteExpense(id, req.user.sub);
  }

  // -------------------------------------------------------------------------
  // Money collection
  // -------------------------------------------------------------------------
  @Get('summary')
  @Permissions('carwash.collections.view', 'carwash.reports.view')
  dailySummary(
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    // `date` is the legacy single-day param; startDate/endDate supersede it.
    return this.carwash.dailySummary(date ?? startDate, endDate);
  }

  @Get('collections')
  @Permissions('carwash.collections.view')
  listCollections(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.carwash.listCollections(startDate, endDate);
  }

  @Post('collections')
  @Permissions('carwash.collections.create')
  createCollection(
    @Body() dto: CreateCollectionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carwash.createCollection(dto, req.user.sub);
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  @Get('settings')
  @Permissions('carwash.settings.view')
  getSettings() {
    return this.carwash.getSettings();
  }

  @Patch('settings')
  @Permissions('carwash.settings.edit')
  updateSettings(@Body() dto: UpdateSettingsDto, @Req() req: RequestWithUser) {
    return this.carwash.updateSettings(dto.slotMinutes, req.user.sub);
  }
}

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
  CreateWashTypeDto,
  CreateVehicleTypeDto,
  IssueEquipmentDto,
  PayEquipmentIssueDto,
  UpdateBookingStatusDto,
  UpdateCarWashExpenseDto,
  UpdateStoreItemDto,
  UpdateSettingsDto,
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
  dashboard(@Req() req: RequestWithUser) {
    return this.carwash.dashboard(req.user);
  }

  // -------------------------------------------------------------------------
  // Washers
  // -------------------------------------------------------------------------
  @Get('washers')
  @Permissions('carwash.washers.view')
  listWashers() {
    return this.carwash.listWashers();
  }

  @Post('washers')
  @Permissions('carwash.washers.create')
  createWasher(@Body() dto: CreateWasherDto) {
    return this.carwash.createWasher(dto);
  }

  @Patch('washers/:id')
  @Permissions('carwash.washers.edit')
  updateWasher(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWasherDto,
  ) {
    return this.carwash.updateWasher(id, dto);
  }

  @Delete('washers/:id')
  @Permissions('carwash.washers.delete')
  deleteWasher(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteWasher(id);
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
  upsertPrice(@Body() dto: UpsertPriceDto) {
    return this.carwash.upsertPrice(dto);
  }

  @Delete('prices/:id')
  @Permissions('carwash.prices.delete')
  deletePrice(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deletePrice(id);
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
  listVehicles(@Query('search') search?: string) {
    return this.carwash.listVehicles(search);
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
  listBookings(@Query('date') date?: string) {
    return this.carwash.listBookings(date);
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
  createBooking(@Body() dto: CreateBookingDto) {
    return this.carwash.createBooking(dto);
  }

  @Patch('bookings/:id/status')
  @Permissions('carwash.bookings.edit')
  updateBookingStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.carwash.updateBookingStatus(id, dto.status);
  }

  @Delete('bookings/:id')
  @Permissions('carwash.bookings.delete')
  deleteBooking(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteBooking(id);
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
  ) {
    return this.carwash.listWashes(startDate, endDate, req.user);
  }

  @Post('washes')
  @Permissions('carwash.washes.create')
  createWash(@Body() dto: CreateWashDto, @Req() req: RequestWithUser) {
    return this.carwash.createWash(dto, req.user.sub);
  }

  @Patch('washes/:id/complete')
  @Permissions('carwash.washes.edit')
  completeWash(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.completeWash(id);
  }

  @Delete('washes/:id')
  @Permissions('carwash.washes.delete')
  deleteWash(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteWash(id);
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
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.carwash.washerReports(startDate, endDate);
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
  issueEquipment(@Body() dto: IssueEquipmentDto) {
    return this.carwash.issueEquipment(dto);
  }

  @Patch('equipment-issues/:id/pay')
  @Permissions('carwash.equipment.edit')
  markEquipmentIssuePaid(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayEquipmentIssueDto,
  ) {
    return this.carwash.markEquipmentIssuePaid(id, dto.isPaid);
  }

  @Delete('equipment-issues/:id')
  @Permissions('carwash.equipment.delete')
  deleteEquipmentIssue(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteEquipmentIssue(id);
  }

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------
  @Get('expenses')
  @Permissions('carwash.expenses.view')
  listExpenses(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.carwash.listExpenses(startDate, endDate);
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
  ) {
    return this.carwash.updateExpense(id, dto);
  }

  @Delete('expenses/:id')
  @Permissions('carwash.expenses.delete')
  deleteExpense(@Param('id', ParseIntPipe) id: number) {
    return this.carwash.deleteExpense(id);
  }

  // -------------------------------------------------------------------------
  // Money collection
  // -------------------------------------------------------------------------
  @Get('summary')
  @Permissions('carwash.collections.view', 'carwash.reports.view')
  dailySummary(@Query('date') date?: string) {
    return this.carwash.dailySummary(date);
  }

  @Get('collections')
  @Permissions('carwash.collections.view')
  listCollections() {
    return this.carwash.listCollections();
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
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.carwash.updateSettings(dto.slotMinutes);
  }
}

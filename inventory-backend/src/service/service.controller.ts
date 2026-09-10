// src/service/service.controller.ts
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
} from '@nestjs/common';
import { BusinessType } from '@prisma/client';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { Vertical } from '../common/decorators/vertical.decorator';
import {
  AddTicketItemDto,
  CreateServiceBookingDto,
  CreateServiceCategoryDto,
  CreateServiceItemDto,
  CreateServiceTicketDto,
  PayTicketDto,
  UpdateServiceBookingStatusDto,
  UpdateTicketStatusDto,
} from './dto/service.dto';
import { ServiceService } from './service.service';

@Controller('service')
@Vertical(BusinessType.SERVICE)
export class ServiceController {
  constructor(private readonly service: ServiceService) {}

  @Get('dashboard')
  @Permissions('service.view', 'service.manage')
  dashboard() {
    return this.service.dashboard();
  }

  @Get('categories')
  @Permissions('service.view', 'service.manage')
  listCategories() {
    return this.service.listCategories();
  }

  @Post('categories')
  @Permissions('service.manage')
  createCategory(@Body() dto: CreateServiceCategoryDto) {
    return this.service.createCategory(dto);
  }

  @Patch('categories/:id')
  @Permissions('service.manage')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateServiceCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Permissions('service.manage')
  deleteCategory(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteCategory(id);
  }

  @Get('items')
  @Permissions('service.view', 'service.manage')
  listItems(@Query('categoryId') categoryId?: string) {
    return this.service.listItems(categoryId ? Number(categoryId) : undefined);
  }

  @Post('items')
  @Permissions('service.manage')
  createItem(@Body() dto: CreateServiceItemDto) {
    return this.service.createItem(dto);
  }

  @Patch('items/:id')
  @Permissions('service.manage')
  updateItem(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateServiceItemDto) {
    return this.service.updateItem(id, dto);
  }

  @Delete('items/:id')
  @Permissions('service.manage')
  deleteItem(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteItem(id);
  }

  @Get('bookings')
  @Permissions('service.view', 'service.manage')
  listBookings(@Query('date') date?: string) {
    return this.service.listBookings(date);
  }

  @Post('bookings')
  @Permissions('service.manage')
  createBooking(@Body() dto: CreateServiceBookingDto) {
    return this.service.createBooking(dto);
  }

  @Patch('bookings/:id/status')
  @Permissions('service.manage')
  updateBookingStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateServiceBookingStatusDto) {
    return this.service.updateBookingStatus(id, dto.status as never);
  }

  @Get('tickets')
  @Permissions('service.view', 'service.manage')
  listTickets(@Query('status') status?: string) {
    return this.service.listTickets(status);
  }

  @Post('tickets')
  @Permissions('service.manage')
  createTicket(@Body() dto: CreateServiceTicketDto) {
    return this.service.createTicket(dto);
  }

  @Post('tickets/:id/items')
  @Permissions('service.manage')
  addTicketItem(@Param('id', ParseIntPipe) id: number, @Body() dto: AddTicketItemDto) {
    return this.service.addTicketItem(id, dto.serviceItemId, dto.quantity ?? 1);
  }

  @Post('tickets/:id/pay')
  @Permissions('service.manage')
  payTicket(@Param('id', ParseIntPipe) id: number, @Body() dto: PayTicketDto) {
    return this.service.payTicket(id, dto);
  }

  @Patch('tickets/:id/status')
  @Permissions('service.manage')
  updateTicketStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTicketStatusDto) {
    return this.service.updateTicketStatus(id, dto.status as never);
  }

  @Get('clients')
  @Permissions('service.view', 'service.manage')
  listClients(@Query('search') search?: string) {
    return this.service.listClients(search);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { RequestItemStatus } from '@prisma/client';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { ConfirmSaleDto } from './dto/confirm-sale.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { RequestsService } from './requests.service';

@Controller('requests')
export class RequestsController {
  constructor(private service: RequestsService) {}

  @Post()
  @Permissions('requests.create')
  createRequest(@Body() dto: CreateRequestDto, @Req() req: RequestWithUser) {
    return this.service.createRequest(dto, req.user);
  }

  // Owner or request creator edits a request that hasn't started dispatching.
  @Put(':id')
  @Permissions('requests.create')
  async editRequest(
    @Param('id') ref: string,
    @Body() dto: CreateRequestDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.editRequest(
      await this.service.resolveRequestId(ref),
      dto,
      req.user,
    );
  }

  // Dispatching store sends the request back to the creator for re-arranging
  // quantities when it can't fulfil them before dispatch.
  @Post(':id/send-back')
  @Permissions('requests.create')
  async sendBack(
    @Param('id') ref: string,
    @Req() req: RequestWithUser,
  ) {
    return this.service.sendBack(await this.service.resolveRequestId(ref), req.user);
  }

  // Owner or a role explicitly granted requests.delete removes a request that
  // hasn't progressed/closed (owners may delete any status).
  @Delete(':id')
  @Permissions('requests.delete')
  async remove(
    @Param('id') ref: string,
    @Req() req: RequestWithUser,
  ) {
    return this.service.remove(await this.service.resolveRequestId(ref), req.user);
  }

  @Get()
  @Permissions('requests.view')
  findAll(@Query() query: any, @Req() req: RequestWithUser) {
    return this.service.findAll(query, req.user);
  }

  @Get(':id')
  @Permissions('requests.view')
  async findOne(@Param('id') ref: string) {
    return this.service.findOne(await this.service.resolveRequestId(ref));
  }

  // Endpoint for Owner to Approve/Reject individual items (shop→store)
  // or Store/Reject individual items (store→owner)
  @Patch(':id/items')
  @Permissions('requests.approve')
  async updateItemStatuses(
    @Param('id') ref: string,
    @Body('items')
    items: {
      id: number;
      status: RequestItemStatus;
      quantityStored?: number;
      newBuyPrice?: number;
      newSellPrice?: number;
    }[],
    @Req() req: RequestWithUser,
  ) {
    return this.service.updateItemStatuses(
      await this.service.resolveRequestId(ref),
      items,
      req.user,
    );
  }

  // Endpoint for Storekeeper to Dispatch specific quantities (shop→store only)
  @Post(':id/dispatch')
  @Permissions('requests.dispatch')
  async dispatchItems(
    @Param('id') ref: string,
    @Body('items') items: { id: number; quantityDispatched: number }[],
    @Req() req: RequestWithUser,
  ) {
    return this.service.dispatchItems(
      await this.service.resolveRequestId(ref),
      items,
      req.user,
    );
  }

  // Endpoint for the receiving party to confirm receipt of items
  @Post(':id/confirm-receipt')
  @Permissions('requests.confirm')
  async confirmReceipt(
    @Param('id') ref: string,
    @Body() dto: ConfirmReceiptDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.confirmReceipt(
      await this.service.resolveRequestId(ref),
      dto.items,
      req.user,
    );
  }

  // Shopkeeper: confirm receipt AND sell the goods directly to a customer
  // (creates a sale linked to the request).
  @Post(':id/confirm-sale')
  @Permissions('requests.confirm', 'sales.create')
  async confirmReceiptAndSell(
    @Param('id') ref: string,
    @Body() dto: ConfirmSaleDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.confirmReceiptAndSell(
      await this.service.resolveRequestId(ref),
      dto,
      req.user,
    );
  }
}

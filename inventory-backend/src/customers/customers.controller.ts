import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { parsePaging } from '../common/pagination.util';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get()
  findAll(
    @Query('shopId') shopId?: string,
    @Query('search') search?: string,
    @Query('onlyDebt') onlyDebt?: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    return this.svc.findAll(shopId ? +shopId : undefined, {
      search,
      onlyDebt: onlyDebt === 'true' || onlyDebt === '1',
      paging: parsePaging(query),
    });
  }

  @Get(':id')
  async findOne(@Param('id') ref: string, @Query('shopId') shopId?: string) {
    return this.svc.findOne(
      await this.svc.resolveCustomerId(ref),
      shopId ? +shopId : undefined,
    );
  }

  @Post()
  create(@Body() body: { name: string; phone?: string; shopId: number }) {
    return this.svc.create(body);
  }

  @Put(':id')
  async update(
    @Param('id') ref: string,
    @Body() body: { name?: string; phone?: string },
  ) {
    return this.svc.update(await this.svc.resolveCustomerId(ref), body);
  }

  @Delete(':id')
  async remove(@Param('id') ref: string) {
    return this.svc.remove(await this.svc.resolveCustomerId(ref));
  }
}

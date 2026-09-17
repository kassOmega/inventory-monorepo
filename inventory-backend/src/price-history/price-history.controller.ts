import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { parsePaging } from '../common/pagination.util';
import { UpdatePriceHistoryDto } from './dto/update-price-history.dto';
import { PriceHistoryService } from './price-history.service';

@Controller('price-history')
@Permissions('prices.view')
export class PriceHistoryController {
  constructor(private service: PriceHistoryService) {}

  @Get()
  findAll(@Query() query: Record<string, unknown>) {
    const num = (key: string) => {
      const value = Number(query?.[key]);
      return Number.isInteger(value) && value > 0 ? value : undefined;
    };
    const flag = (key: string) =>
      query?.[key] === '1' || query?.[key] === 'true' || query?.[key] === true;
    return this.service.findAll(parsePaging(query), {
      productId: num('productId'),
      variantId: num('variantId'),
      source: typeof query?.source === 'string' && query.source ? query.source : undefined,
      withDetails: flag('withDetails'),
    });
  }
  @Get(':id') findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }
  @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePriceHistoryDto) {
    return this.service.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

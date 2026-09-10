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
    return this.service.findAll(parsePaging(query));
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

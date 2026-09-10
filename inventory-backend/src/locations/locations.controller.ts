import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { parsePaging } from '../common/pagination.util';
import { CreateLocationCategoryDto } from './dto/create-location-category.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private service: LocationsService) {}

  @Post()
  @Permissions('locations.manage')
  create(@Body() dto: CreateLocationDto) {
    return this.service.create(dto);
  }

  @Post('categories')
  @Permissions('locations.manage')
  createCategory(@Body() dto: CreateLocationCategoryDto) {
    return this.service.createCategory(dto.name);
  }

  @Get()
  findAll(@Query() query: Record<string, unknown>) {
    return this.service.findAll(parsePaging(query));
  }

  @Get('categories')
  findCategories() {
    return this.service.findCategories();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @Permissions('locations.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Permissions('locations.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

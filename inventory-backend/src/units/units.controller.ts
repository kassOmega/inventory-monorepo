import { Controller, Get, Post, Body } from '@nestjs/common';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly svc: UnitsService) {}

  @Get()
  findAll() {
    return this.svc.findAll();
  }

  @Post()
  create(@Body() body: { name?: string; symbol?: string }) {
    return this.svc.create(body.name ?? '', body.symbol ?? undefined);
  }
}
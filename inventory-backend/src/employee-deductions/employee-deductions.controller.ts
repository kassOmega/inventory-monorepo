import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import {
  CreateDeductionDto,
  RecoverDeductionDto,
  SweepDeductionsDto,
  UpdateDeductionDto,
} from './dto/employee-deductions.dto';
import { EmployeeDeductionsService } from './employee-deductions.service';

@Controller('employee-deductions')
export class EmployeeDeductionsController {
  constructor(private readonly deductions: EmployeeDeductionsService) {}

  @Get()
  list(
    @Query('userId') userId?: string,
    @Query('washerId') washerId?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
  ) {
    return this.deductions.list({
      userId: userId ? Number(userId) : undefined,
      washerId: washerId ? Number(washerId) : undefined,
      kind,
      status,
      source,
    });
  }

  @Get('cap')
  cap() {
    return this.deductions.capPercent();
  }

  @Patch('cap')
  setCap(@Body('percent') percent: number) {
    return this.deductions.setCapPercent(percent);
  }

  @Get('due-soon')
  dueSoon(@Query('days') days?: string) {
    return this.deductions.dueSoon(days ? Number(days) : undefined);
  }

  @Post('remind-due-soon')
  remindDueSoon(@Query('days') days?: string) {
    return this.deductions.remindDueSoon(days ? Number(days) : undefined);
  }

  @Get('summary')
  summary(
    @Query('userId') userId?: string,
    @Query('washerId') washerId?: string,
  ) {
    return this.deductions.summaryForEmployee({
      userId: userId ? Number(userId) : undefined,
      washerId: washerId ? Number(washerId) : undefined,
    });
  }

  @Post()
  create(@Req() req: RequestWithUser, @Body() dto: CreateDeductionDto) {
    return this.deductions.create(
      {
        userId: dto.userId ?? null,
        washerId: dto.washerId ?? null,
        kind: dto.kind as 'LOAN' | 'PENALTY',
        source: dto.source as 'SALARY' | 'COMMISSION' | undefined,
        reason: dto.reason,
        amount: dto.amount,
        dueAt: dto.dueAt ?? null,
        notes: dto.notes ?? null,
      },
      req.user.sub,
    );
  }

  @Patch(':id')
  update(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeductionDto,
  ) {
    return this.deductions.update(id, dto as any, req.user.sub);
  }

  @Post(':id/recover')
  recover(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecoverDeductionDto,
  ) {
    return this.deductions.recover(
      id,
      dto.amount,
      { note: dto.note, periodPay: dto.periodPay },
      req.user.sub,
    );
  }

  @Post(':id/cancel')
  cancel(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
    return this.deductions.cancel(id, req.user.sub);
  }

  @Post('sweep')
  sweep(@Req() req: RequestWithUser, @Body() dto: SweepDeductionsDto) {
    return this.deductions.sweepForPayout(
      {
        userId: dto.userId,
        washerId: dto.washerId,
        source: dto.source as 'SALARY' | 'COMMISSION',
        periodPay: dto.periodPay,
        note: dto.note,
      },
      req.user.sub,
    );
  }
}

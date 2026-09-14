// src/facilities/facilities.controller.ts
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { CheckInDto } from './dto/facility.dto';
import { FacilitiesService } from './facilities.service';

@Controller('hospitality/facilities')
@Permissions('facility.view')
export class FacilitiesController {
  constructor(private facilities: FacilitiesService) {}

  @Get(':serviceId/dashboard')
  getDashboard(@Param('serviceId') serviceId: string) {
    return this.facilities.getDashboard(serviceId);
  }

  @Get(':serviceId/members')
  @Permissions('facility.view', 'memberships.view')
  searchMembers(@Param('serviceId') serviceId: string, @Query('search') search?: string) {
    return this.facilities.searchMembers(serviceId, search);
  }

  @Post(':serviceId/check-in')
  @Permissions('facility.check-in', 'facility.manage')
  checkIn(@Param('serviceId') serviceId: string, @Body() dto: CheckInDto, @Req() req: RequestWithUser) {
    return this.facilities.checkIn(serviceId, dto, req.user.sub);
  }

  @Post(':serviceId/check-out/:visitId')
  @Permissions('facility.check-in', 'facility.manage')
  checkOut(@Param('serviceId') serviceId: string, @Param('visitId') visitId: string) {
    return this.facilities.checkOut(serviceId, visitId);
  }
}

// src/memberships/memberships.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import {
  AssignMembershipDto,
  CreateMembershipTypeDto,
  UpdateCustomerMembershipDto,
  UpdateMembershipTypeDto,
} from './dto/membership.dto';
import { MembershipsService } from './memberships.service';

@Controller('hospitality/memberships')
@Permissions('memberships.view')
export class MembershipsController {
  constructor(private memberships: MembershipsService) {}

  @Get('types')
  listTypes(@Query('serviceId') serviceId?: string) {
    return this.memberships.listTypes(serviceId);
  }

  @Post('types')
  @Permissions('memberships.manage')
  createType(@Body() dto: CreateMembershipTypeDto) {
    return this.memberships.createType(dto);
  }

  @Patch('types/:id')
  @Permissions('memberships.manage')
  updateType(@Param('id') id: string, @Body() dto: UpdateMembershipTypeDto) {
    return this.memberships.updateType(id, dto);
  }

  @Delete('types/:id')
  @Permissions('memberships.manage')
  deleteType(@Param('id') id: string) {
    return this.memberships.deleteType(id);
  }

  @Get()
  listMemberships(
    @Query('serviceId') serviceId?: string,
    @Query('status') status?: string,
  ) {
    return this.memberships.listMemberships(serviceId, status);
  }

  @Post()
  @Permissions('memberships.manage')
  assignMembership(@Body() dto: AssignMembershipDto) {
    return this.memberships.assignMembership(dto);
  }

  @Patch(':id')
  @Permissions('memberships.manage')
  updateMembership(@Param('id') id: string, @Body() dto: UpdateCustomerMembershipDto) {
    return this.memberships.updateMembership(id, dto);
  }
}

// src/tenants/tenants.controller.ts
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import {
  CreateOrganizationDto,
  UpdateMyOrganizationDto,
  UpdateSettingsDto,
} from './dto/create-organization.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @AllowUnverified()
  @Get('me')
  myOrganizations(@Req() req: RequestWithUser) {
    return this.tenantsService.myOrganizations(req.user.sub);
  }

  @AllowUnverified()
  @Get(':id')
  getOrganization(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tenantsService.getOrganization(id, req.user.sub);
  }

  @Post()
  createOrganization(
    @Req() req: RequestWithUser,
    @Body() dto: CreateOrganizationDto,
  ) {
    if (req.user.isPlatformAdmin) {
      throw new ForbiddenException(
        'Platform admins create businesses via /admin/organizations',
      );
    }
    if (!req.user.isOwnerAccount) {
      throw new ForbiddenException('Only owner accounts can create businesses');
    }
    return this.tenantsService.createOrganization(req.user.sub, dto);
  }

  @Permissions('users.manage')
  @Get()
  findAll() {
    return this.tenantsService.findAllOrganizations();
  }

  @Patch(':id')
  updateOrganization(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMyOrganizationDto,
  ) {
    return this.tenantsService.updateOrganization(id, req.user.sub, dto);
  }

  @Patch(':id/settings')
  updateSettings(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.tenantsService.updateSettings(id, req.user.sub, dto.settings);
  }

  @Patch(':id/profile')
  updateProfile(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tenantsService.updateProfile(id, req.user.sub, body);
  }

  @Delete(':id')
  deleteOrganization(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tenantsService.deleteOrganization(id, req.user.sub);
  }
}

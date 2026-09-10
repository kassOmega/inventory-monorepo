// src/admin/admin.controller.ts
import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { RejectVerificationDto, SetVerificationStatusDto, UploadDocumentDto } from '../verification/dto/verification.dto';
import { verificationMulterOptions } from '../verification/verification-upload.config';
import type { UploadedFileShape } from '../verification/verification-upload.config';
import { AdminService } from './admin.service';
import { VerificationService } from '../verification/verification.service';
import { AssignOwnerDto, CreateOrgForOwnerDto, CreateOwnerDto, UpdateOrganizationDto, UpdateOrgStatusDto, UpdateUserDto, UpdateUserStatusDto } from './dto/admin.dto';

@Controller('admin')
export class AdminController {
  constructor(
    private admin: AdminService,
    private verification: VerificationService,
  ) {}

  private assertAdmin(req: RequestWithUser) {
    if (!req.user?.isPlatformAdmin) {
      throw new ForbiddenException('Only platform admins can perform this action');
    }
  }

  @Get('users')
  listUsers(@Req() req: RequestWithUser) {
    this.assertAdmin(req);
    return this.admin.listUsers();
  }

  @Post('users')
  createOwner(@Req() req: RequestWithUser, @Body() dto: CreateOwnerDto) {
    this.assertAdmin(req);
    return this.admin.createOwner(dto);
  }

  @Patch('users/:id/status')
  updateUserStatus(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserStatusDto) {
    this.assertAdmin(req);
    return this.admin.updateUserStatus(id, dto.status);
  }

  @Patch('users/:id')
  updateUser(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    this.assertAdmin(req);
    return this.admin.updateUser(id, dto);
  }

  @Delete('users/:id')
  deleteUser(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
    this.assertAdmin(req);
    return this.admin.deleteUser(id);
  }

  @Get('organizations')
  listOrganizations(@Req() req: RequestWithUser) {
    this.assertAdmin(req);
    return this.admin.listOrganizations();
  }

  @Post('organizations')
  createOrganizationForOwner(@Req() req: RequestWithUser, @Body() dto: CreateOrgForOwnerDto) {
    this.assertAdmin(req);
    return this.admin.createOrganizationForOwner(dto);
  }

  @Patch('organizations/:id/status')
  updateOrganizationStatus(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrgStatusDto) {
    this.assertAdmin(req);
    return this.admin.updateOrganizationStatus(id, dto.status);
  }

  @Patch('organizations/:id')
  updateOrganization(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrganizationDto) {
    this.assertAdmin(req);
    return this.admin.updateOrganization(id, dto);
  }

  @Post('organizations/:id/owner')
  assignOwner(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignOwnerDto) {
    this.assertAdmin(req);
    return this.admin.assignOwner(id, dto.ownerUserId);
  }

  @Delete('organizations/:id')
  deleteOrganization(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
    this.assertAdmin(req);
    return this.admin.deleteOrganization(id);
  }

  // --- Account verification review queue ---

  @Get('verification')
  listVerification(@Req() req: RequestWithUser, @Query('status') status?: string) {
    this.assertAdmin(req);
    return this.admin.listVerification(status);
  }

  @Post('verification/user/:id/approve')
  approveUserVerification(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
    this.assertAdmin(req);
    return this.admin.approveUserVerification(id);
  }

  @Post('verification/user/:id/reject')
  rejectUserVerification(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RejectVerificationDto) {
    this.assertAdmin(req);
    return this.admin.rejectUserVerification(id, dto.reason);
  }

  @Post('verification/business/:id/approve')
  approveBusinessVerification(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
    this.assertAdmin(req);
    return this.admin.approveBusinessVerification(id);
  }

  @Post('verification/business/:id/reject')
  rejectBusinessVerification(@Req() req: RequestWithUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RejectVerificationDto) {
    this.assertAdmin(req);
    return this.admin.rejectBusinessVerification(id, dto.reason);
  }

  /**
   * POST /admin/verification/:accountType/:accountId/status
   * body: { status: VerificationStatus, note?: string }
   * Move an account to ANY verification status from any current status.
   */
  @Post('verification/:accountType/:accountId/status')
  setVerificationStatus(
    @Req() req: RequestWithUser,
    @Param('accountType') accountType: 'USER' | 'BUSINESS',
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: SetVerificationStatusDto,
  ) {
    this.assertAdmin(req);
    const type = accountType.toUpperCase() as 'USER' | 'BUSINESS';
    if (type !== 'USER' && type !== 'BUSINESS') {
      throw new ForbiddenException('Invalid account type.');
    }
    return this.admin.setVerificationStatus(type, accountId, dto.status as any, dto.note);
  }

  /**
   * POST /admin/verification/:accountType/:accountId/request-documents
   * body: { documents: string[] }
   * Ask the owner to upload missing pictures/documents for approval.
   */
  @Post('verification/:accountType/:accountId/request-documents')
  requestVerificationDocuments(
    @Req() req: RequestWithUser,
    @Param('accountType') accountType: 'USER' | 'BUSINESS',
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() body: { documents?: string[] },
  ) {
    this.assertAdmin(req);
    const type = accountType.toUpperCase() as 'USER' | 'BUSINESS';
    if (type !== 'USER' && type !== 'BUSINESS') {
      throw new ForbiddenException('Invalid account type.');
    }
    return this.verification.requestDocuments(
      type,
      accountId,
      body?.documents ?? [],
    );
  }

  // --- Admin-side document uploads (on behalf of users / businesses) ---

  @Post('verification/user/:id/documents')
  @UseInterceptors(FileInterceptor('file', verificationMulterOptions))
  uploadUserVerificationDocument(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: UploadedFileShape,
  ) {
    this.assertAdmin(req);
    if (dto.documentType !== 'NATIONAL_ID') {
      throw new ForbiddenException('User accounts only require a national ID document.');
    }
    if (!file) throw new ForbiddenException('No file uploaded');
    return this.admin.uploadUserVerificationDocument(id, file);
  }
  @Post('verification/business/:id/documents')
  @UseInterceptors(FileInterceptor('file', verificationMulterOptions))
  uploadBusinessVerificationDocument(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: UploadedFileShape,
  ) {
    this.assertAdmin(req);
    if (!['TRADE_LICENSE', 'TIN_CERTIFICATE'].includes(dto.documentType)) {
      throw new ForbiddenException('Invalid business document type.');
    }
    if (!file) throw new ForbiddenException('No file uploaded');
    return this.admin.uploadBusinessVerificationDocument(
      req.user.sub,
      id,
      file,
      dto.documentType as 'TRADE_LICENSE' | 'TIN_CERTIFICATE',
    );
  }
}

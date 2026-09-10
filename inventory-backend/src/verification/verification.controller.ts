// src/verification/verification.controller.ts
import { FileInterceptor } from '@nestjs/platform-express';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { UploadDocumentDto } from './dto/verification.dto';
import { verificationMulterOptions } from './verification-upload.config';
import type { UploadedFileShape } from './verification-upload.config';
import { VerificationService } from './verification.service';

@Controller('verification')
@AllowUnverified()
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  /** The user's own verification state (account + owned businesses + documents). */
  @Get('me')
  getMyVerification(@Req() req: RequestWithUser) {
    return this.verification.getMyVerification(req.user.sub);
  }

  /** Upload / re-upload the national ID for the caller's user account. */
  @Post('user/documents')
  @UseInterceptors(FileInterceptor('file', verificationMulterOptions))
  uploadUserDocument(
    @Req() req: RequestWithUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: UploadedFileShape,
  ) {
    if (dto.documentType !== 'NATIONAL_ID') {
      throw new BadRequestException(
        'User accounts only require a national ID document.',
      );
    }
    if (!file) throw new BadRequestException('No file uploaded');
    return this.verification.uploadUserDocument(req.user.sub, file);
  }

  /** Upload / re-upload a business document: trade license (required) or TIN (optional). */
  @Post('business/:orgId/documents')
  @UseInterceptors(FileInterceptor('file', verificationMulterOptions))
  uploadBusinessDocument(
    @Req() req: RequestWithUser,
    @Param('orgId', ParseIntPipe) orgId: number,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: UploadedFileShape,
  ) {
    if (!['TRADE_LICENSE', 'TIN_CERTIFICATE'].includes(dto.documentType)) {
      throw new BadRequestException('Invalid business document type.');
    }
    if (!file) throw new BadRequestException('No file uploaded');
    return this.verification.uploadBusinessDocument(
      req.user.sub,
      orgId,
      file,
      dto.documentType as 'TRADE_LICENSE' | 'TIN_CERTIFICATE',
    );
  }

  /** Stream an uploaded verification document (owner, org member, or admin only). */
  @Get('documents/:id/file')
  async getDocumentFile(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.verification.getAuthorizedDocument(id, req.user);
    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${doc.fileName}"`,
      'Cache-Control': 'private, max-age=0, no-store',
    });
    return new StreamableFile(createReadStream(doc.filePath));
  }
}

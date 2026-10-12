// src/uploads/uploads.controller.ts
// Catalogue image upload (authenticated) + public image serving.
//
// - POST /uploads/catalog-image  → stores a JPG/PNG/WEBP under
//   uploads/catalog-images (UUID name) and returns { file } to save on the item.
// - GET  /public/image/:file      → serves a catalogue image by name. Public
//   (marketing assets shown on the guest page) but restricted to the
//   catalog-images directory and validated file names, so no internal path is
//   ever exposed.
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { existsSync, createReadStream } from 'node:fs';
import * as path from 'node:path';
import { Public } from '../common/decorators/public.decorator';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import {
  catalogImageMulterOptions,
  contentTypeForFile,
  documentDir,
} from '../common/upload.config';
import type { UploadedFileShape } from '../common/upload.config';

@Controller()
export class UploadsController {
  /** Store a catalogue image; returns the file name to save on the record. */
  @Post('uploads/catalog-image')
  @Permissions('products.manage')
  @UseInterceptors(FileInterceptor('file', catalogImageMulterOptions))
  uploadCatalogImage(@UploadedFile() file?: UploadedFileShape) {
    if (!file) throw new BadRequestException('No file uploaded');
    return { file: file.filename };
  }

  /** Serve a catalogue image by name (public, catalog-images only). */
  @Get('public/image/:file')
  @Public()
  @AllowUnverified()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  serveCatalogImage(
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Only a bare file name inside catalog-images — no path traversal.
    if (!/^[A-Za-z0-9-]+\.[A-Za-z0-9]+$/.test(file)) {
      throw new BadRequestException('Invalid file name');
    }
    const full = path.join(documentDir('catalog-images'), file);
    if (!existsSync(full)) throw new BadRequestException('Not found');
    res.set({ 'Content-Type': contentTypeForFile(file), 'Cache-Control': 'public, max-age=86400' });
    return new StreamableFile(createReadStream(full));
  }
}

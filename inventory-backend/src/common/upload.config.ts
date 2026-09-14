// src/common/upload.config.ts
// Shared multer configuration for document uploads (verification documents,
// guest ID scans, …). Files land under <UPLOAD_DIR>/<subdir>/ with a UUID name
// and are always served back through permissioned API routes — never statically,
// so tenant scoping and permissions are enforced on every read.
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';

// Minimal shape of a multer-processed file (avoids a @types/multer dependency).
export interface UploadedFileShape {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
}

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

// Fallback for clients that report a generic MIME (e.g. application/octet-stream)
// for an otherwise valid file. The canonical MIME is derived from the extension.
const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
};

/** Absolute directory for a document category (created on demand). */
export function documentDir(subdir: string): string {
  return path.join(UPLOAD_ROOT, subdir);
}

/** Content-Type for a stored document, from its extension (defaults to JPG). */
export function contentTypeForFile(fileName: string): string {
  return EXT_TO_MIME[path.extname(fileName).toLowerCase()] ?? 'image/jpeg';
}

/**
 * Multer options for an upload category. Same allow-list (JPG/PNG/WEBP/HEIC/PDF,
 * 10 MB) for every document type so clients behave identically everywhere.
 */
export function createDocumentUploadOptions(subdir: string) {
  const dir = documentDir(subdir);
  return {
    storage: diskStorage({
      destination: (_req: unknown, _file: unknown, cb) => {
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req: unknown, file: UploadedFileShape, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (
      _req: unknown,
      file: UploadedFileShape,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      // Trust the browser's MIME type when it's one of the supported formats.
      if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
        return;
      }
      // Otherwise fall back to the file extension: some clients (desktop apps,
      // Android, downloads) report a generic application/octet-stream for files
      // that are perfectly valid JPG/PNG/WEBP/PDF. Normalize the MIME so the AI
      // reviewer and the Content-Type header still work correctly.
      const ext = path.extname(file.originalname).toLowerCase();
      const canonical = EXT_TO_MIME[ext];
      if (!canonical) {
        cb(
          new BadRequestException(
            'Only JPG, PNG, WEBP, HEIC or PDF files are allowed',
          ),
          false,
        );
        return;
      }
      file.mimetype = canonical;
      cb(null, true);
    },
  };
}

/** Guest ID scans live beside the KYC documents, in their own folder. */
export const guestIdMulterOptions = createDocumentUploadOptions('guests');

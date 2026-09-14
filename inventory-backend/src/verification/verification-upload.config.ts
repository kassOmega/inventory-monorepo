// src/verification/verification-upload.config.ts
// Verification-document uploads (self-service verification + admin uploads).
// The multer wiring is shared with other document uploads — see common/upload.config.
import { createDocumentUploadOptions } from '../common/upload.config';

export type { UploadedFileShape } from '../common/upload.config';

export const verificationMulterOptions =
  createDocumentUploadOptions('verification');

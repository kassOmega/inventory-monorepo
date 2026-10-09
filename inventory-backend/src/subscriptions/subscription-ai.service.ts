// src/subscriptions/subscription-ai.service.ts
// Reviews a subscription payment receipt with Gemini vision. It extracts the
// payer name, bank/account and amount printed on the receipt and compares them
// with what the platform admin configured (the receiving bank account + the
// expected price for the chosen term). When the AI is unavailable (no key,
// unsupported file, upstream error) it returns `unavailable: true` and the
// payment is left for a human admin — the submit itself never fails.
import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { GeminiService } from '../ai/gemini.service';

export interface ReceiptReviewRequest {
  filePath: string;
  mimeType: string;
  /** Business/tenant name, for a soft name comparison. */
  businessName: string;
  /** Payer name the client typed in the form (may be blank). */
  claimedPayerName?: string;
  /** Expected receiving account (admin-configured). */
  expectedAccountName?: string;
  expectedAccountNumber?: string;
  expectedBankName?: string;
  /** Expected amount for the chosen term (admin price / override). */
  expectedAmount: number;
  currency: string;
}

export interface ReceiptExtracted {
  payerName: string | null;
  bankName: string | null;
  accountNumber: string | null;
  amount: number | null;
  date: string | null;
  reference: string | null;
}

export interface ReceiptReviewResult {
  /** APPROVE = auto-extend, FLAG = needs an admin, REJECT = clearly not a receipt. */
  decision: 'APPROVE' | 'FLAG' | 'REJECT';
  confidence: number;
  reasons: string[];
  extracted: ReceiptExtracted;
  unavailable: boolean;
}

const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_AI_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

const SYSTEM_INSTRUCTION =
  'You verify bank transfer receipts for a software subscription payment. ' +
  'You are strict and literal: only use what is actually printed on the receipt. ' +
  'Read the payer (sender) name, the receiving bank and account number, the ' +
  'amount and the date. If the image is not a bank receipt / transfer slip, say so.';

/** Confidence at/above which a fully-matching receipt is auto-approved. */
const AUTO_APPROVE_CONFIDENCE = 0.75;

/** Amount tolerance (fraction) — allow small rounding differences. */
const AMOUNT_TOLERANCE = 0.02;

/** Normalize a person/business name for comparison. */
export function normName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u1200-\u137f]+/gi, ' ')
    .trim();
}

/** Normalize an account number for comparison (digits only). */
export function normAcct(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}

/** True when two names share a meaningful token (soft match). */
export function namesMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Require tokens of at least 4 characters so short/common words (\"Ltd\",
  // \"co\", 3-letter first names) don't create false positives.
  const ta = new Set(na.split(' ').filter((t) => t.length >= 4));
  return nb.split(' ').some((t) => t.length >= 4 && ta.has(t));
}

@Injectable()
export class SubscriptionAiService {
  private readonly logger = new Logger(SubscriptionAiService.name);

  constructor(private readonly gemini: GeminiService) {}

  async review(req: ReceiptReviewRequest): Promise<ReceiptReviewResult> {
    const empty: ReceiptExtracted = {
      payerName: null,
      bankName: null,
      accountNumber: null,
      amount: null,
      date: null,
      reference: null,
    };

    if (!AI_IMAGE_TYPES.includes(req.mimeType)) {
      return {
        decision: 'FLAG',
        confidence: 0,
        reasons: ['Unsupported file type — requires manual review.'],
        extracted: empty,
        unavailable: true,
      };
    }

    let base64: string;
    try {
      const buffer = readFileSync(req.filePath);
      if (buffer.byteLength > MAX_AI_FILE_BYTES) {
        return {
          decision: 'FLAG',
          confidence: 0,
          reasons: ['File is too large for AI review — requires manual review.'],
          extracted: empty,
          unavailable: true,
        };
      }
      base64 = buffer.toString('base64');
    } catch (err) {
      this.logger.warn(`Could not read receipt file: ${(err as Error).message}`);
      return {
        decision: 'FLAG',
        confidence: 0,
        reasons: ['Receipt file could not be read — requires manual review.'],
        extracted: empty,
        unavailable: true,
      };
    }

    try {
      const result = await this.gemini.analyzeImage<{
        isReceipt: boolean;
        confidence: number;
        payerName?: string | null;
        bankName?: string | null;
        accountNumber?: string | null;
        amount?: number | null;
        date?: string | null;
        reference?: string | null;
        reasons: string[];
      }>({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt:
          `Extract the details from this subscription payment receipt.\n` +
          `The business this is expected to cover is "${req.businessName}".\n` +
          (req.expectedBankName ? `Expected receiving bank: "${req.expectedBankName}".\n` : '') +
          (req.expectedAccountName ? `Expected account name: "${req.expectedAccountName}".\n` : '') +
          (req.expectedAccountNumber ? `Expected account number: "${req.expectedAccountNumber}".\n` : '') +
          `Expected amount: ${req.expectedAmount} ${req.currency}.\n` +
          `Report exactly what is printed. If the image is not a bank receipt, set isReceipt=false.`,
        imageMimeType: req.mimeType,
        imageBase64: base64,
        schema: {
          type: 'object',
          properties: {
            isReceipt: { type: 'boolean' },
            confidence: { type: 'number' },
            payerName: { type: 'string', nullable: true },
            bankName: { type: 'string', nullable: true },
            accountNumber: { type: 'string', nullable: true },
            amount: { type: 'number', nullable: true },
            date: { type: 'string', nullable: true },
            reference: { type: 'string', nullable: true },
            reasons: { type: 'array', items: { type: 'string' } },
          },
          required: ['isReceipt', 'confidence', 'reasons'],
        },
      });

      const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
      const reasons = Array.isArray(result.reasons)
        ? result.reasons.map((r) => String(r).slice(0, 300)).filter(Boolean)
        : [];
      const extracted: ReceiptExtracted = {
        payerName: result.payerName ? String(result.payerName) : null,
        bankName: result.bankName ? String(result.bankName) : null,
        accountNumber: result.accountNumber ? String(result.accountNumber) : null,
        amount:
          result.amount != null && !Number.isNaN(Number(result.amount))
            ? Number(result.amount)
            : null,
        date: result.date ? String(result.date) : null,
        reference: result.reference ? String(result.reference) : null,
      };

      // Not a receipt at all → reject outright.
      if (result.isReceipt === false) {
        return {
          decision: 'REJECT',
          confidence,
          reasons: reasons.length
            ? reasons
            : ['The uploaded file does not look like a bank receipt.'],
          extracted,
          unavailable: false,
        };
      }

      // --- Field checks against the admin-configured expectations -----------
      const mismatches: string[] = [];

      if (extracted.amount == null) {
        mismatches.push('No amount could be read from the receipt.');
      } else if (extracted.amount + 0.001 < req.expectedAmount * (1 - AMOUNT_TOLERANCE)) {
        mismatches.push(
          `Amount on the receipt (${extracted.amount} ${req.currency}) is less than the expected ${req.expectedAmount} ${req.currency}.`,
        );
      }

      const expectedAcct = normAcct(req.expectedAccountNumber);
      const receiptAcct = normAcct(extracted.accountNumber);
      if (expectedAcct && receiptAcct && expectedAcct !== receiptAcct) {
        mismatches.push('The receiving account number does not match the configured account.');
      } else if (expectedAcct && !receiptAcct) {
        mismatches.push('No account number could be read from the receipt.');
      }

      const payerOk =
        namesMatch(extracted.payerName ?? '', req.businessName) ||
        namesMatch(extracted.payerName ?? '', req.claimedPayerName ?? '');
      if (!payerOk) {
        mismatches.push(
          extracted.payerName
            ? `The payer name ("${extracted.payerName}") does not match the business or the name you entered.`
            : 'No payer name could be read from the receipt.',
        );
      }

      if (mismatches.length > 0) {
        return {
          decision: 'FLAG',
          confidence,
          reasons: [...mismatches, ...reasons].slice(0, 8),
          extracted,
          unavailable: false,
        };
      }

      // Everything matched but the model was unsure → still a human's call.
      if (confidence < AUTO_APPROVE_CONFIDENCE) {
        return {
          decision: 'FLAG',
          confidence,
          reasons: [...reasons, 'AI confidence was low — requires manual review.'],
          extracted,
          unavailable: false,
        };
      }

      return {
        decision: 'APPROVE',
        confidence,
        reasons: reasons.length ? reasons : ['Receipt matches the expected details.'],
        extracted,
        unavailable: false,
      };
    } catch (err) {
      this.logger.warn(
        `Subscription receipt AI review failed: ${(err as Error).message}`,
      );
      return {
        decision: 'FLAG',
        confidence: 0,
        reasons: ['AI review was unavailable — requires manual review.'],
        extracted: empty,
        unavailable: true,
      };
    }
  }
}

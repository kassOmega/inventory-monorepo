// src/subscriptions/subscription-ai.service.spec.ts
// The receipt field matchers are pure and decide auto-approve vs flag, so they
// get direct coverage (the Gemini call itself is not exercised here).
import { namesMatch, normAcct, normName } from './subscription-ai.service';

describe('subscription-ai matchers', () => {
  it('normalizes names (case, punctuation, spacing)', () => {
    expect(normName('  Meron   Labiyajo! ')).toBe('meron labiyajo');
    expect(normName(null)).toBe('');
  });

  it('matches a business name against the payer name on a shared token', () => {
    expect(namesMatch('Meron Labiyajo Trading', 'Meron Labiyajo')).toBe(true);
    expect(namesMatch('Abebe Kebede', 'Meron Labiyajo')).toBe(false);
    // Too-short tokens must not create false positives.
    expect(namesMatch('Ali Co', 'Ali Ltd')).toBe(false);
  });

  it('normalizes account numbers to digits only', () => {
    expect(normAcct('1000-2345-6789')).toBe('100023456789');
    expect(normAcct(null)).toBe('');
  });

  it('compares account numbers by digits', () => {
    expect(normAcct('1000 2345 6789')).toBe(normAcct('100023456789'));
  });
});

// src/common/phone.util.spec.ts
import { normalizePhone, looksLikeEmail } from './phone.util';

describe('phone.util', () => {
  it('normalizes separators and keeps the country-code form', () => {
    expect(normalizePhone('0911 234 567')).toBe('0911234567');
    expect(normalizePhone('0911-234-567')).toBe('0911234567');
    expect(normalizePhone('+251 911 234 567')).toBe('+251911234567');
    expect(normalizePhone(' +251-911-234-567 ')).toBe('+251911234567');
  });

  it('returns null for empty / digit-less input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
  });

  it('detects email vs phone', () => {
    expect(looksLikeEmail('a@b.com')).toBe(true);
    expect(looksLikeEmail('0911234567')).toBe(false);
  });
});

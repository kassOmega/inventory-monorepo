import {
  asNumericId,
  formatBusinessNumber,
  isPublicId,
} from './business-number.util';

describe('business-number.util', () => {
  const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  describe('formatBusinessNumber', () => {
    it('zero-pads to three digits', () => {
      expect(formatBusinessNumber('CUST', 7)).toBe('CUST-007');
      expect(formatBusinessNumber('REQ', 1)).toBe('REQ-001');
    });

    it('keeps numbers longer than three digits untouched', () => {
      expect(formatBusinessNumber('CR', 1234)).toBe('CR-1234');
    });

    it('returns null when there is no number (un-backfilled rows)', () => {
      expect(formatBusinessNumber('USR', null)).toBeNull();
      expect(formatBusinessNumber('USR', undefined)).toBeNull();
    });
  });

  describe('isPublicId', () => {
    it('detects uuids', () => {
      expect(isPublicId(UUID)).toBe(true);
      expect(isPublicId(UUID.toUpperCase())).toBe(true);
    });

    it('rejects numeric ids', () => {
      expect(isPublicId('42')).toBe(false);
    });
  });

  describe('asNumericId', () => {
    it('parses plain integers', () => {
      expect(asNumericId('42')).toBe(42);
    });

    it('returns null for uuids and non-numeric refs', () => {
      expect(asNumericId(UUID)).toBeNull();
      expect(asNumericId('abc')).toBeNull();
      expect(asNumericId('')).toBeNull();
    });
  });
});

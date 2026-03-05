import { describe, it, expect } from 'vitest';
import { sanitizePII } from './pii';

describe('sanitizePII', () => {
  it('returns unchanged text when no PII present', () => {
    const text = 'This is a normal message about code.';
    const { sanitized, replacements } = sanitizePII(text);
    expect(sanitized).toBe(text);
    expect(replacements).toHaveLength(0);
  });

  it('returns empty results for empty/null input', () => {
    expect(sanitizePII('').sanitized).toBe('');
    expect(sanitizePII('').replacements).toHaveLength(0);
  });

  describe('credit cards', () => {
    it('replaces Visa card number', () => {
      const { sanitized, replacements } = sanitizePII(
        'My card is 4111 1111 1111 1111 please charge it'
      );
      expect(sanitized).toContain('__CREDIT_CARD_0__');
      expect(sanitized).not.toContain('4111');
      expect(replacements).toHaveLength(1);
      expect(replacements[0].type).toBe('CREDIT_CARD');
    });

    it('replaces Mastercard with dashes', () => {
      const { sanitized } = sanitizePII('Card: 5500-0000-0000-0004');
      expect(sanitized).toContain('__CREDIT_CARD_0__');
    });

    it('replaces Amex card', () => {
      const { sanitized } = sanitizePII('Amex 3782 822463 10005');
      expect(sanitized).toContain('__CREDIT_CARD_0__');
    });

    it('replaces multiple cards with incrementing counters', () => {
      const { sanitized, replacements } = sanitizePII(
        'Cards: 4111111111111111 and 5500000000000004'
      );
      expect(sanitized).toContain('__CREDIT_CARD_0__');
      expect(sanitized).toContain('__CREDIT_CARD_1__');
      expect(replacements).toHaveLength(2);
    });
  });

  describe('SSN', () => {
    it('replaces SSN format', () => {
      const { sanitized, replacements } = sanitizePII(
        'SSN: 123-45-6789'
      );
      expect(sanitized).toBe('SSN: __SSN_0__');
      expect(replacements[0].type).toBe('SSN');
    });

    it('does not match non-SSN patterns', () => {
      const { replacements } = sanitizePII('Version 1.2.3-45-6789abc');
      const ssnMatches = replacements.filter((r) => r.type === 'SSN');
      expect(ssnMatches).toHaveLength(0);
    });
  });

  describe('phone numbers', () => {
    it('replaces (NNN) NNN-NNNN format', () => {
      const { sanitized } = sanitizePII('Call (555) 867-5309');
      expect(sanitized).toContain('__PHONE_0__');
    });

    it('replaces NNN-NNN-NNNN format', () => {
      const { sanitized } = sanitizePII('Phone: 555-867-5309');
      expect(sanitized).toContain('__PHONE_0__');
    });

    it('replaces +1 prefixed numbers', () => {
      const { sanitized } = sanitizePII('Call +1-555-867-5309');
      expect(sanitized).toContain('__PHONE_0__');
    });

    it('replaces dot-separated format', () => {
      const { sanitized } = sanitizePII('Ph: 555.867.5309');
      expect(sanitized).toContain('__PHONE_0__');
    });
  });

  describe('email', () => {
    it('replaces email addresses', () => {
      const { sanitized, replacements } = sanitizePII(
        'Email me at user@example.com for details'
      );
      expect(sanitized).toBe('Email me at __EMAIL_0__ for details');
      expect(replacements[0].type).toBe('EMAIL');
    });

    it('replaces multiple emails', () => {
      const { sanitized } = sanitizePII(
        'CC: alice@test.org and bob@test.org'
      );
      expect(sanitized).toContain('__EMAIL_0__');
      expect(sanitized).toContain('__EMAIL_1__');
    });
  });

  describe('addresses', () => {
    it('replaces street addresses', () => {
      const { sanitized } = sanitizePII(
        'Send to 123 Main Street please'
      );
      expect(sanitized).toContain('__ADDRESS_0__');
      expect(sanitized).not.toContain('123 Main');
    });

    it('replaces various street suffixes', () => {
      const tests = [
        '456 Oak Ave',
        '789 Pine Blvd',
        '1234 Elm Dr',
        '55 Cedar Lane',
      ];
      for (const addr of tests) {
        const { sanitized } = sanitizePII(addr);
        expect(sanitized).toContain('__ADDRESS_0__');
      }
    });
  });

  describe('mixed PII', () => {
    it('handles multiple PII types in one text', () => {
      const { sanitized, replacements } = sanitizePII(
        'Contact: 555-867-5309, email user@test.com, SSN 123-45-6789'
      );
      expect(sanitized).toContain('__PHONE_0__');
      expect(sanitized).toContain('__EMAIL_0__');
      expect(sanitized).toContain('__SSN_0__');
      expect(replacements).toHaveLength(3);
    });

    it('counters are per-type', () => {
      const { replacements } = sanitizePII(
        'Phones: 555-867-5309 and 415-555-0199. Emails: a@b.com and c@d.com'
      );
      const phones = replacements.filter((r) => r.type === 'PHONE');
      const emails = replacements.filter((r) => r.type === 'EMAIL');
      expect(phones).toHaveLength(2);
      expect(emails).toHaveLength(2);
      expect(phones[0].token).toBe('__PHONE_0__');
      expect(phones[1].token).toBe('__PHONE_1__');
      expect(emails[0].token).toBe('__EMAIL_0__');
      expect(emails[1].token).toBe('__EMAIL_1__');
    });
  });

  describe('hashing', () => {
    it('generates consistent SHA-256 hashes', () => {
      const r1 = sanitizePII('SSN: 123-45-6789');
      const r2 = sanitizePII('SSN: 123-45-6789');
      expect(r1.replacements[0].originalHash).toBe(
        r2.replacements[0].originalHash
      );
    });

    it('generates different hashes for different values', () => {
      const r1 = sanitizePII('SSN: 123-45-6789');
      const r2 = sanitizePII('SSN: 987-65-4321');
      expect(r1.replacements[0].originalHash).not.toBe(
        r2.replacements[0].originalHash
      );
    });
  });

  describe('preserves non-PII content', () => {
    it('does not match git hashes', () => {
      const { replacements } = sanitizePII(
        'Commit abc123def456 on branch main'
      );
      expect(replacements).toHaveLength(0);
    });

    it('does not match timestamps', () => {
      const { replacements } = sanitizePII(
        '2026-03-04T19:12:05.000Z'
      );
      expect(replacements).toHaveLength(0);
    });

    it('does not match port numbers', () => {
      const { replacements } = sanitizePII('localhost:3000');
      expect(replacements).toHaveLength(0);
    });

    it('does not match code that looks like numbers', () => {
      const { replacements } = sanitizePII(
        'const MAX_RETRIES = 1234567890123;'
      );
      // Should not match as credit card (no valid prefix)
      const ccMatches = replacements.filter((r) => r.type === 'CREDIT_CARD');
      expect(ccMatches).toHaveLength(0);
    });
  });
});

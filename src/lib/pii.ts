import { createHash } from 'crypto';

export interface PIIReplacement {
  type: string;
  token: string;
  originalHash: string;
}

interface PIIPattern {
  type: string;
  regex: RegExp;
}

// Patterns ordered by specificity (more specific first to avoid partial matches)
const PII_PATTERNS: PIIPattern[] = [
  // Credit card: Visa (4xxx), Mastercard (51-55xx), Amex (34xx/37xx), Discover (6011/65xx)
  // Supports 4-4-4-4, 4-4-4-1..4, and Amex 4-6-5 groupings
  {
    type: 'CREDIT_CARD',
    regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[\s-]?\d{4,6}[\s-]?\d{4,5}[\s-]?\d{0,4}\b/g,
  },
  // SSN: exactly NNN-NN-NNNN
  {
    type: 'SSN',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  // Phone: US formats — (NNN) NNN-NNNN, NNN-NNN-NNNN, NNN.NNN.NNNN, +1NNNNNNNNNN, etc.
  {
    type: 'PHONE',
    regex: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?[2-9]\d{2}[-.\s]?\d{4}\b/g,
  },
  // Email
  {
    type: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // Street address: number + street name + suffix
  {
    type: 'ADDRESS',
    regex: /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Way|Ct|Court|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway|Hwy|Highway)\.?\b/gi,
  },
];

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Sanitize PII from text using __TYPE_N__ placeholder tokens.
 * Pattern follows the uncloseai.js translation.js preservation approach.
 */
export function sanitizePII(text: string): {
  sanitized: string;
  replacements: PIIReplacement[];
} {
  if (!text) return { sanitized: text, replacements: [] };

  const replacements: PIIReplacement[] = [];
  const counters: Record<string, number> = {};
  let sanitized = text;

  // Track already-replaced ranges to avoid double-matching
  const replaced: Array<{ start: number; end: number; token: string }> = [];

  for (const pattern of PII_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Skip if this range overlaps with an already-replaced range
      if (replaced.some((r) => start < r.end && end > r.start)) continue;

      const count = counters[pattern.type] ?? 0;
      counters[pattern.type] = count + 1;
      const token = `__${pattern.type}_${count}__`;

      replacements.push({
        type: pattern.type,
        token,
        originalHash: sha256(match[0]),
      });

      replaced.push({ start, end, token });
    }
  }

  // Apply replacements from end to start so indices stay valid
  replaced.sort((a, b) => b.start - a.start);
  for (const r of replaced) {
    sanitized = sanitized.slice(0, r.start) + r.token + sanitized.slice(r.end);
  }

  return { sanitized, replacements };
}

import { randomBytes } from 'crypto';

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz23456789';
const CODE_LENGTH = 10;
const ALPHABET_SIZE = CODE_ALPHABET.length;

// 7 * 34 = 238 <= 255 keeps the rejection sampling unbiased.
const REJECTION_BOUND = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE;

/**
 * Generates a short, URL-safe, non-personal public code.
 * Uniqueness is guaranteed by the unique code index plus insert retry.
 */
export function generateQrLinkCode(length: number = CODE_LENGTH): string {
  let code = '';
  while (code.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      if (byte >= REJECTION_BOUND) continue;
      code += CODE_ALPHABET[byte % ALPHABET_SIZE];
      if (code.length === length) break;
    }
  }
  return code;
}

export function isQrLinkCode(value: string): boolean {
  return /^[a-z0-9]{6,32}$/.test(value);
}

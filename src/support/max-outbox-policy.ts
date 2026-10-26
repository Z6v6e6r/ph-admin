/** MAX receipts deliberately exclude provider messages, bodies, headers and identifiers. */
export interface MaxFailure {
  status: number | null;
  code: string;
  category: 'RATE_LIMITED' | 'PROVIDER_REFUSED' | 'DELIVERY_UNKNOWN' | 'INVALID_INPUT';
  stage: 'send';
  observedAt: string;
}

const codes = new Set(['bot.blocked', 'bot.not.started', 'bot.removed', 'chat.not.found',
  'dialog.not.found', 'access.denied', 'forbidden', 'invalid_input']);
export const MAX_DELIVERY_ATTEMPTS = 5;
export function maxFailure(value: unknown, now: number): MaxFailure {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const status = typeof raw.status === 'number' && Number.isInteger(raw.status)
    && raw.status >= 400 && raw.status <= 599 ? raw.status : null;
  const code = typeof raw.code === 'string' && codes.has(raw.code) ? raw.code : 'unclassified';
  return { status, code, category: status === 429 ? 'RATE_LIMITED'
    : code === 'invalid_input' ? 'INVALID_INPUT'
    : status !== null && status < 500 ? 'PROVIDER_REFUSED' : 'DELIVERY_UNKNOWN',
  stage: 'send', observedAt: new Date(now).toISOString() };
}

export function maxRetryDelay(attempt: number, rawRetryAfter: unknown, random = Math.random): number {
  // Only explicit rate-limit rejections are retried. Unknown outcomes need reconciliation.
  const requested = typeof rawRetryAfter === 'number' && Number.isFinite(rawRetryAfter)
    ? Math.max(0, Math.min(300, rawRetryAfter)) * 1000 : 0;
  return Math.max(requested, Math.min(300_000, 5000 * 2 ** Math.min(attempt - 1, 6))
    + Math.floor(Math.max(0, Math.min(1, random())) * 1000));
}

import { BadRequestException } from '@nestjs/common';

export const MAX_ALLOWED_HOSTS = 50;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const DOMAIN_PATTERN =
  /^(?:\*\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function fail(message: string): never {
  throw new BadRequestException({
    code: 'QR_ALLOWED_HOST_INVALID',
    message
  });
}

/**
 * Normalizes and validates a single allowed target host entry.
 * Only bare hostnames are accepted (no scheme, path, port or userinfo).
 * Wildcards are explicit: *.example.com matches subdomains but not the apex.
 */
export function normalizeAllowedHost(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) fail('Укажите домен без протокола, например padlhub.ru.');
  if (value.length > 253) fail('Слишком длинный домен.');
  if (CONTROL_CHARACTERS.test(value)) fail('Домен содержит недопустимые символы.');
  if (value.includes('/') || value.includes(':') || value.includes('@') || value.includes('?')) {
    fail('Укажите только домен, без протокола, пути, порта и логина.');
  }
  if (value === 'localhost' || value.endsWith('.localhost')) {
    fail('Локальные адреса запрещены.');
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes('[') || value.includes(']')) {
    fail('IP-адреса запрещены: укажите доменное имя.');
  }
  if (!DOMAIN_PATTERN.test(value)) {
    fail('Некорректный домен. Пример: padlhub.ru или *.padlhub.ru.');
  }
  return value;
}

export function normalizeAllowedHosts(
  rawHosts: unknown,
  reservedHosts: readonly string[] = []
): string[] {
  if (!Array.isArray(rawHosts)) fail('Список доменов должен быть массивом.');
  if (rawHosts.length > MAX_ALLOWED_HOSTS) {
    fail(`Нельзя добавить больше ${MAX_ALLOWED_HOSTS} доменов.`);
  }
  const reserved = new Set(reservedHosts.map((host) => String(host).trim().toLowerCase()));
  const result: string[] = [];
  for (const raw of rawHosts) {
    const host = normalizeAllowedHost(raw);
    if (reserved.has(host)) continue;
    if (!result.includes(host)) result.push(host);
  }
  return result;
}

import { BadRequestException } from '@nestjs/common';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const DEFAULT_ALLOWED_HOSTS = 'padlhub.su,www.padlhub.su,padlhub.ru,www.padlhub.ru';
const DEFAULT_PUBLIC_BASE_URL = 'https://padlhub.su';
const DEFAULT_MAX_LENGTH = 2048;

const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function fail(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function parseAllowedHosts(raw: string | undefined): string[] {
  return String(raw ?? DEFAULT_ALLOWED_HOSTS)
    .split(',')
    .map((item) => normalizeHost(item))
    .filter((item) => item.length > 0);
}

function parseAllowedPorts(raw: string | undefined): string[] {
  const ports = String(raw ?? '443')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (ports.length === 0 || ports.some((port) => !/^\d{1,5}$/.test(port))) {
    throw new Error('QR_LINKS_ALLOWED_TARGET_PORTS must be a comma-separated list of ports');
  }
  return ports;
}

function parsePublicOrigin(raw: string | undefined): string {
  try {
    const url = new URL(String(raw ?? DEFAULT_PUBLIC_BASE_URL).trim());
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('invalid scheme');
    }
    return url.origin;
  } catch (_error) {
    throw new Error('QR_LINKS_PUBLIC_BASE_URL must be an absolute https origin');
  }
}

function parseSelfHosts(publicHost: string, raw: string | undefined): Set<string> {
  const hosts = new Set<string>([publicHost, `www.${publicHost}`]);
  for (const item of String(raw ?? '').split(',')) {
    const host = normalizeHost(item);
    if (host) hosts.add(host);
  }
  return hosts;
}

function isPrivateIpv4(host: string): boolean {
  if (!ipv4Pattern.test(host)) return false;
  const octets = host.split('.').map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && octets[2] === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes(':')) return false;
  if (host === '::' || host === '::1') return true;
  if (/^f[cd][0-9a-f:]*:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
  if (host.startsWith('::ffff:')) {
    return isPrivateIpv4(host.slice('::ffff:'.length));
  }
  return false;
}

export interface QrTargetUrlPolicyConfig {
  publicBaseUrl: string;
  allowedHosts: string[];
  allowedPorts: string[];
  selfHosts: Set<string>;
  maxLength: number;
}

/**
 * Validates operator-supplied destination URLs for permanent QR links.
 *
 * The destination is chosen explicitly by staff and must never be derived from
 * request parameters. Only absolute https URLs on a trusted host list pass.
 */
export class QrTargetUrlPolicy {
  readonly config: QrTargetUrlPolicyConfig;

  constructor(environment: NodeJS.ProcessEnv = process.env, extraHosts: readonly string[] = []) {
    const publicOrigin = parsePublicOrigin(environment.QR_LINKS_PUBLIC_BASE_URL);
    const publicHost = new URL(publicOrigin).hostname.toLowerCase();
    const hostSet = new Set([
      ...parseAllowedHosts(environment.QR_LINKS_ALLOWED_TARGET_HOSTS),
      ...extraHosts.map((host) => normalizeHost(host)).filter((host) => host.length > 0)
    ]);
    this.config = {
      publicBaseUrl: publicOrigin,
      allowedHosts: [...hostSet],
      allowedPorts: parseAllowedPorts(environment.QR_LINKS_ALLOWED_TARGET_PORTS),
      selfHosts: parseSelfHosts(publicHost, environment.QR_LINKS_SELF_HOSTS),
      maxLength: parsePositiveInteger(
        environment.QR_LINKS_TARGET_URL_MAX_LENGTH,
        DEFAULT_MAX_LENGTH
      )
    };
    if (this.config.allowedHosts.length === 0) {
      throw new Error('QR_LINKS_ALLOWED_TARGET_HOSTS must not be empty');
    }
  }

  get publicBaseUrl(): string {
    return this.config.publicBaseUrl;
  }

  shortUrl(code: string): string {
    return `${this.config.publicBaseUrl}/q/${code}`;
  }

  /**
   * Re-validates a destination that was already accepted and stored.
   * The mutable allowlist is intentionally not re-applied here: removing a
   * domain later must not break already printed QR codes. Structural and
   * self-redirect checks still apply.
   */
  validateStoredTarget(rawValue: string): string {
    return this.validate(rawValue, { checkHosts: false });
  }

  validate(rawValue: string, options: { checkHosts?: boolean } = {}): string {
    const value = String(rawValue ?? '').trim();
    if (!value) fail('QR_TARGET_URL_INVALID', 'Укажите целевой адрес.');
    if (value.length > this.config.maxLength) {
      fail('QR_TARGET_URL_TOO_LONG', 'Целевой адрес слишком длинный.');
    }
    if (CONTROL_CHARACTERS.test(value)) {
      fail('QR_TARGET_URL_CONTROL_CHARS', 'Целевой адрес содержит недопустимые символы.');
    }
    if (value.startsWith('//')) {
      fail('QR_TARGET_URL_INVALID', 'Укажите полный адрес, начиная с https://.');
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch (_error) {
      return fail('QR_TARGET_URL_INVALID', 'Некорректный целевой адрес.');
    }

    if (url.protocol !== 'https:') {
      fail('QR_TARGET_URL_HTTPS_REQUIRED', 'Целевой адрес должен начинаться с https://.');
    }
    if (url.username || url.password) {
      fail('QR_TARGET_URL_CREDENTIALS_FORBIDDEN', 'В целевом адресе нельзя указывать логин или пароль.');
    }

    const hostname = url.hostname.toLowerCase();
    if (!hostname) {
      fail('QR_TARGET_URL_INVALID', 'Некорректный целевой адрес.');
    }
    if (hostname.endsWith('.')) {
      fail('QR_TARGET_URL_HOST_NOT_ALLOWED', 'Домен целевой страницы не входит в разрешённый список.');
    }
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      fail('QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN', 'Локальные адреса запрещены.');
    }
    if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
      fail('QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN', 'Локальные и внутренние адреса запрещены.');
    }

    if (options.checkHosts !== false && !this.hostAllowed(hostname)) {
      fail('QR_TARGET_URL_HOST_NOT_ALLOWED', 'Домен целевой страницы не входит в разрешённый список.');
    }

    const port = url.port || '443';
    if (!this.config.allowedPorts.includes(port)) {
      fail('QR_TARGET_URL_PORT_NOT_ALLOWED', 'Порт целевой страницы не разрешён.');
    }

    const pathname = url.pathname || '/';
    if (this.config.selfHosts.has(hostname) && (pathname === '/q' || pathname.startsWith('/q/'))) {
      fail(
        'QR_TARGET_URL_SELF_REDIRECT_FORBIDDEN',
        'Нельзя направлять QR на другую короткую ссылку ЦУП.'
      );
    }

    return url.toString();
  }

  private hostAllowed(hostname: string): boolean {
    return this.config.allowedHosts.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const base = pattern.slice(2);
        return hostname !== base && hostname.endsWith(`.${base}`);
      }
      return hostname === pattern;
    });
  }
}

export function publicBaseUrlFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string {
  return parsePublicOrigin(environment.QR_LINKS_PUBLIC_BASE_URL);
}

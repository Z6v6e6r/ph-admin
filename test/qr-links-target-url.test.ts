import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  QrTargetUrlPolicy,
  publicBaseUrlFromEnvironment
} from '../src/qr-links/qr-target-url-policy';

const BASE_ENV: Record<string, string> = {
  QR_LINKS_PUBLIC_BASE_URL: 'https://padlhub.su',
  QR_LINKS_ALLOWED_TARGET_HOSTS: 'padlhub.su,www.padlhub.su,padlhub.ru',
  QR_LINKS_ALLOWED_TARGET_PORTS: '443'
};

function policy(overrides: Record<string, string | undefined> = {}): QrTargetUrlPolicy {
  return new QrTargetUrlPolicy({ ...BASE_ENV, ...overrides } as NodeJS.ProcessEnv);
}

function responseCode(error: unknown): string | undefined {
  assert.ok(error instanceof BadRequestException, `expected BadRequestException, got ${String(error)}`);
  return (error.getResponse() as { code?: string }).code;
}

function expectAccepted(value: string, expected?: string, instance = policy()): string {
  const actual = instance.validate(value);
  if (expected !== undefined) {
    assert.equal(actual, expected, `validate(${value}) must normalise to the stored value`);
  }
  return actual;
}

function expectRejected(value: string, code: string, instance = policy()): void {
  let failure: unknown;
  try {
    instance.validate(value);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure !== undefined, `validate(${JSON.stringify(value)}) must be rejected with ${code}`);
  assert.equal(responseCode(failure), code, `validate(${JSON.stringify(value)}) rejection code`);
}

function expectConfigurationError(factory: () => unknown, pattern: RegExp): void {
  assert.throws(factory, pattern);
}

async function main(): Promise<void> {
  // Configuration is derived from the injected environment only (no process.env coupling).
  const defaultPolicy = policy();
  assert.equal(defaultPolicy.publicBaseUrl, 'https://padlhub.su');
  assert.deepEqual(defaultPolicy.config.allowedHosts, ['padlhub.su', 'www.padlhub.su', 'padlhub.ru']);
  assert.deepEqual(defaultPolicy.config.allowedPorts, ['443']);
  assert.equal(defaultPolicy.config.selfHosts.has('padlhub.su'), true);
  assert.equal(defaultPolicy.config.selfHosts.has('www.padlhub.su'), true);
  assert.equal(defaultPolicy.config.maxLength, 2048);

  // Permanent short links are derived from the public base URL, never from the destination.
  assert.equal(defaultPolicy.shortUrl('abc2345678'), 'https://padlhub.su/q/abc2345678');
  assert.equal(
    policy({ QR_LINKS_PUBLIC_BASE_URL: 'https://cup.padlhub.ru/' }).shortUrl('abc2345678'),
    'https://cup.padlhub.ru/q/abc2345678'
  );
  assert.equal(
    publicBaseUrlFromEnvironment({ QR_LINKS_PUBLIC_BASE_URL: 'https://padlhub.su/qr/' } as NodeJS.ProcessEnv),
    'https://padlhub.su'
  );
  assert.equal(publicBaseUrlFromEnvironment({} as NodeJS.ProcessEnv), 'https://padlhub.su');

  // Accepted absolute https destinations on the configured host allow-list.
  expectAccepted('https://padlhub.su/booking', 'https://padlhub.su/booking');
  expectAccepted('https://www.padlhub.su/page', 'https://www.padlhub.su/page');
  expectAccepted('https://padlhub.ru', 'https://padlhub.ru/');
  expectAccepted('https://PADLHUB.RU/X', 'https://padlhub.ru/X');
  expectAccepted('https://padlhub.ru:443/season', 'https://padlhub.ru/season');

  // Query strings are preserved byte-for-byte (only URL normalisation applies).
  const withQuery = expectAccepted('https://padlhub.ru/annual?utm_source=qr&utm_medium=link&v=2');
  const parsedQuery = new URL(withQuery);
  assert.equal(parsedQuery.search, '?utm_source=qr&utm_medium=link&v=2');
  assert.equal(parsedQuery.searchParams.get('utm_source'), 'qr');
  assert.equal(parsedQuery.hash, '');

  const fragment = expectAccepted('https://padlhub.ru/promo#section-2');
  assert.equal(new URL(fragment).hash, '#section-2');

  // A host is trusted only when explicitly configured or matched by an explicit wildcard.
  const withoutSubdomain = policy({ QR_LINKS_ALLOWED_TARGET_HOSTS: 'padlhub.su,padlhub.ru' });
  expectRejected('https://lk.padlhub.ru/login', 'QR_TARGET_URL_HOST_NOT_ALLOWED', withoutSubdomain);
  const withExplicitSubdomain = policy({
    QR_LINKS_ALLOWED_TARGET_HOSTS: 'padlhub.su,padlhub.ru,lk.padlhub.ru'
  });
  expectAccepted('https://lk.padlhub.ru/login', 'https://lk.padlhub.ru/login', withExplicitSubdomain);
  const withWildcard = policy({ QR_LINKS_ALLOWED_TARGET_HOSTS: '*.padlhub.ru' });
  expectAccepted('https://go.padlhub.ru/x', 'https://go.padlhub.ru/x', withWildcard);
  expectRejected('https://padlhub.ru/x', 'QR_TARGET_URL_HOST_NOT_ALLOWED', withWildcard);
  expectRejected('https://evilpadlhub.ru/x', 'QR_TARGET_URL_HOST_NOT_ALLOWED', withWildcard);

  // Only https is accepted; javascript/data/file/protocol-relative forms are rejected.
  expectRejected('', 'QR_TARGET_URL_INVALID');
  expectRejected('   ', 'QR_TARGET_URL_INVALID');
  expectRejected('not a url', 'QR_TARGET_URL_INVALID');
  expectRejected('//evil.example/phish', 'QR_TARGET_URL_INVALID');
  expectRejected('http://padlhub.su/booking', 'QR_TARGET_URL_HTTPS_REQUIRED');
  expectRejected('ftp://padlhub.su/booking', 'QR_TARGET_URL_HTTPS_REQUIRED');
  expectRejected('javascript:alert(document.cookie)', 'QR_TARGET_URL_HTTPS_REQUIRED');
  expectRejected('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'QR_TARGET_URL_HTTPS_REQUIRED');
  expectRejected('file:///etc/passwd', 'QR_TARGET_URL_HTTPS_REQUIRED');

  // Credentials in the authority are rejected.
  expectRejected('https://user:pass@padlhub.su/booking', 'QR_TARGET_URL_CREDENTIALS_FORBIDDEN');
  expectRejected('https://user@padlhub.su/booking', 'QR_TARGET_URL_CREDENTIALS_FORBIDDEN');

  // Header-injection style control characters are rejected before URL parsing.
  expectRejected('https://padlhub.su/a\r\nX-Injected: 1', 'QR_TARGET_URL_CONTROL_CHARS');
  expectRejected('https://padlhub.su/a\u0000b', 'QR_TARGET_URL_CONTROL_CHARS');
  expectRejected('https://padlhub.su/a\tb', 'QR_TARGET_URL_CONTROL_CHARS');
  expectRejected('https://padlhub.su/a\u007fb', 'QR_TARGET_URL_CONTROL_CHARS');

  // Local, loopback, link-local and private network targets are rejected (SSRF guard).
  expectRejected('https://localhost/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://app.localhost/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://127.0.0.1/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://127.1.2.3:443/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://0.0.0.0/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://10.0.0.1/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://172.16.0.5/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://192.168.1.10/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://169.254.169.254/latest/meta-data', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://[::1]/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');
  expectRejected('https://[fd00::1]/x', 'QR_TARGET_URL_PRIVATE_HOST_FORBIDDEN');

  // Look-alike / adjacent domains must not pass the allow-list.
  expectRejected('https://padlhub.su.evil.com/x', 'QR_TARGET_URL_HOST_NOT_ALLOWED');
  expectRejected('https://evilpadlhub.su/x', 'QR_TARGET_URL_HOST_NOT_ALLOWED');
  expectRejected('https://padlhub.ru.evil.example/x', 'QR_TARGET_URL_HOST_NOT_ALLOWED');
  expectRejected('https://padlhub.su./x', 'QR_TARGET_URL_HOST_NOT_ALLOWED');
  expectRejected('https://evil.example/x', 'QR_TARGET_URL_HOST_NOT_ALLOWED');

  // Ports other than the configured allow-list are rejected.
  expectRejected('https://padlhub.su:8443/x', 'QR_TARGET_URL_PORT_NOT_ALLOWED');
  expectRejected('https://padlhub.ru:80/x', 'QR_TARGET_URL_PORT_NOT_ALLOWED');
  expectAccepted(
    'https://padlhub.su:8443/x',
    'https://padlhub.su:8443/x',
    policy({ QR_LINKS_ALLOWED_TARGET_PORTS: '443,8443' })
  );

  // The permanent short-link namespace cannot itself become a destination (no redirect loops).
  expectRejected('https://padlhub.su/q/abc2345678', 'QR_TARGET_URL_SELF_REDIRECT_FORBIDDEN');
  expectRejected('https://padlhub.su/q', 'QR_TARGET_URL_SELF_REDIRECT_FORBIDDEN');
  expectRejected('https://www.padlhub.su/q/abc2345678', 'QR_TARGET_URL_SELF_REDIRECT_FORBIDDEN');
  expectAccepted('https://padlhub.su/qq/abc2345678', 'https://padlhub.su/qq/abc2345678');
  expectRejected(
    'https://cup.padlhub.ru/q/abc2345678',
    'QR_TARGET_URL_SELF_REDIRECT_FORBIDDEN',
    policy({
      QR_LINKS_ALLOWED_TARGET_HOSTS: 'padlhub.su,padlhub.ru,cup.padlhub.ru',
      QR_LINKS_SELF_HOSTS: 'cup.padlhub.ru'
    })
  );

  // Hard length cap keeps stored redirects bounded.
  expectRejected('https://padlhub.ru/' + 'a'.repeat(2100), 'QR_TARGET_URL_TOO_LONG');
  expectAccepted('https://padlhub.ru/' + 'a'.repeat(2029));
  expectRejected(
    'https://padlhub.ru/' + 'a'.repeat(60),
    'QR_TARGET_URL_TOO_LONG',
    policy({ QR_LINKS_TARGET_URL_MAX_LENGTH: '40' })
  );

  // Configuration errors are loud instead of silently widening the allow-list.
  expectConfigurationError(
    () => policy({ QR_LINKS_ALLOWED_TARGET_PORTS: 'abc' }),
    /QR_LINKS_ALLOWED_TARGET_PORTS/
  );
  expectConfigurationError(
    () => policy({ QR_LINKS_PUBLIC_BASE_URL: 'http://padlhub.su' }),
    /QR_LINKS_PUBLIC_BASE_URL/
  );
  expectConfigurationError(
    () => policy({ QR_LINKS_PUBLIC_BASE_URL: 'https://user:pass@padlhub.su' }),
    /QR_LINKS_PUBLIC_BASE_URL/
  );
  expectConfigurationError(
    () => policy({ QR_LINKS_ALLOWED_TARGET_HOSTS: '' }),
    /QR_LINKS_ALLOWED_TARGET_HOSTS/
  );

  console.log('QR target URL policy tests passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

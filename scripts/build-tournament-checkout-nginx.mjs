#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOW_HEADERS = 'Origin, Content-Type, Accept, Authorization, Range, X-PadlHub-Auth-Source, X-PadlHub-Tenant-Key';
const HEADER = `    add_header Access-Control-Allow-Headers "${ALLOW_HEADERS}" always;`;
const OPTIONS = '     if ($request_method = OPTIONS) { return 204; }';
const CHECKOUT_HEADERS = [
  `    set $phab_api_cors_headers "${ALLOW_HEADERS}";`,
  '    if ($request_uri ~ "^/api/tournaments/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/checkout/?([?].*)?$") {',
  '        set $phab_api_cors_headers "$phab_api_cors_headers, Idempotency-Key";',
  '    }'
].join('\n');

export function buildTournamentCheckoutNginx(source, expectedSha256) {
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== expectedSha256) {
    throw new Error(`nginx preimage SHA-256 mismatch: ${digest}`);
  }
  const config = source.toString('utf8');
  const locations = [...config.matchAll(/^location \^~ \/api\/ \{\n[\s\S]*?^\}/gm)];
  if (locations.length !== 1) {
    throw new Error('expected exactly one unindented /api/ location');
  }

  const [{ 0: location, index }] = locations;
  const lines = location.split('\n');
  if (lines[1] !== OPTIONS || lines.filter(line => line === HEADER).length !== 1
    || !lines.includes('    add_header Access-Control-Allow-Origin "https://padlhub.ru" always;')) {
    throw new Error('the /api/ CORS directives differ from the audited preimage');
  }
  const candidate = location
    .replace(OPTIONS, `${CHECKOUT_HEADERS}\n    ${OPTIONS.trimStart()}`)
    .replace(HEADER, '    add_header Access-Control-Allow-Headers $phab_api_cors_headers always;');
  return config.slice(0, index) + candidate + config.slice(index + location.length);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , sourcePath, sha256] = process.argv;
  if (!sourcePath || !/^[0-9a-f]{64}$/.test(sha256 ?? '') || process.argv.length !== 4) {
    throw new Error('usage: build-tournament-checkout-nginx.mjs <source-config> <expected-sha256>');
  }
  process.stdout.write(buildTournamentCheckoutNginx(readFileSync(sourcePath), sha256));
}

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previous = {
    mongoUri: process.env.MONGODB_URI,
    staticToken: process.env.VIVA_ADMIN_API_TOKEN,
    baseUrl: process.env.VIVA_ADMIN_API_BASE_URL
  };
  process.env.MONGODB_URI = '';
  process.env.VIVA_ADMIN_API_TOKEN = 'test-static-token';
  process.env.VIVA_ADMIN_API_BASE_URL = 'https://provider.example';

  const messages: string[] = [];
  const service = new VivaAdminService();
  const logger = (service as unknown as {
    logger: { warn: (message: unknown) => void };
  }).logger;
  logger.warn = (message: unknown) => {
    messages.push(String(message));
  };

  try {
    globalThis.fetch = (async () => {
      throw new Error(
        'request failed phone=79991234567 email=player@example.test Authorization=Bearer secret-token'
      );
    }) as typeof fetch;
    await service.lookupClientCabinetByPhone('+7 999 123-45-67');

    globalThis.fetch = (async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({
        phone: '79997654321',
        email: 'provider@example.test',
        access_token: 'raw-provider-token'
      })
    } as Response)) as typeof fetch;
    await service.lookupClientCabinetByPhone('+7 999 765-43-21');

    const output = messages.join('\n');
    assert.match(output, /phone:\*\*\*4567/);
    assert.match(output, /phone:\*\*\*4321/);
    assert.doesNotMatch(output, /79991234567|79997654321/);
    assert.doesNotMatch(output, /player@example\.test|provider@example\.test/);
    assert.doesNotMatch(output, /secret-token|raw-provider-token|Authorization|Bearer/);

    const tournamentSource = readFileSync('src/tournaments/tournaments.service.ts', 'utf8');
    assert.match(tournamentSource, /Failed to enrich tournament participant \$\{this\.maskPhoneForLog\(normalizedPhone\)\}/);
    assert.doesNotMatch(
      tournamentSource,
      /Failed to enrich tournament participant \$\{normalizedPhone\}/
    );
    assert.doesNotMatch(
      tournamentSource,
      /Failed to load Viva (?:payment types|product catalog)[^`]*\$\{String\(error\)\}/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.mongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previous.mongoUri;
    if (previous.staticToken === undefined) delete process.env.VIVA_ADMIN_API_TOKEN;
    else process.env.VIVA_ADMIN_API_TOKEN = previous.staticToken;
    if (previous.baseUrl === undefined) delete process.env.VIVA_ADMIN_API_BASE_URL;
    else process.env.VIVA_ADMIN_API_BASE_URL = previous.baseUrl;
  }

  console.log('Viva admin payment log redaction test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

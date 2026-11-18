import * as assert from 'node:assert/strict';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';

/** Synthetic fetch only; no Viva is reached. */
async function main() {
  process.env.VIVA_ADMIN_API_TOKEN = 'admin-token';
  process.env.VIVA_ADMIN_API_BASE_URL = 'https://api.vivacrm.ru';
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: unknown; auth?: string }> = [];
  const respond = (status: number | 'THROW', body: unknown = null) => {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null,
        auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (status === 'THROW') throw new Error('socket hang up');
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  };
  const input = { exerciseId: 'exercise-1', clientId: 'client-1', phone: '+7 (912) 345-67-89' };
  try {
    respond(200, { id: 'booking-1', status: 'ACTIVE' });
    assert.deepEqual(await new VivaAdminService().createExerciseBooking(input), { outcome: 'CREATED', bookingId: 'booking-1' });
    const sent = requests.at(-1)!;
    assert.equal(sent.url, 'https://api.vivacrm.ru/api/v1/exercises/exercise-1/bookings');
    assert.equal(sent.method, 'POST');
    assert.equal(sent.auth, 'Bearer admin-token');
    assert.deepEqual(sent.body, { phone: '79123456789', clientId: 'client-1', paymentType: 'ON_PLACE' });

    for (const status of [400, 404, 409, 422, 429]) {
      respond(status, { message: 'Нет мест' });
      assert.deepEqual(await new VivaAdminService().createExerciseBooking(input), { outcome: 'REJECTED', reasonCode: `PROVIDER_${status}` });
    }
    for (const status of [408, 500, 502, 504]) {
      respond(status);
      assert.deepEqual(await new VivaAdminService().createExerciseBooking(input), { outcome: 'UNKNOWN', reasonCode: `PROVIDER_${status}` });
    }
    respond('THROW');
    assert.deepEqual(await new VivaAdminService().createExerciseBooking(input), { outcome: 'UNKNOWN', reasonCode: 'PROVIDER_TRANSPORT' });
    respond(200, { status: 'ACTIVE' });
    assert.deepEqual(await new VivaAdminService().createExerciseBooking(input), { outcome: 'UNKNOWN', reasonCode: 'PROVIDER_RESPONSE_WITHOUT_ID' });

    const before = requests.length;
    respond(200, { id: 'x' });
    assert.equal((await new VivaAdminService().createExerciseBooking({ ...input, clientId: '' })).outcome, 'REJECTED');
    assert.equal((await new VivaAdminService().createExerciseBooking({ ...input, phone: 'abc' })).outcome, 'REJECTED');
    assert.equal(requests.length, before, 'invalid input never reaches Viva');
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('viva-admin exercise booking tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

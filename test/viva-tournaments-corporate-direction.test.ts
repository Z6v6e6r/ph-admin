import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { Tournament } from '../src/tournaments/tournaments.types';

async function main(): Promise<void> {
  const keys = ['VIVA_END_USER_WIDGET_IDS', 'VIVA_TOURNAMENT_EXERCISE_TYPE_IDS'];
  const originalEnv = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  process.env.VIVA_END_USER_WIDGET_IDS = 'widget-test';
  process.env.VIVA_TOURNAMENT_EXERCISE_TYPE_IDS = '839,1013';
  const oldDate = '2026-09-20';
  const corporateDate = '2026-09-21';
  const corporate = {
    id: 'corporate-event',
    direction: { id: 6078, name: '1,5 часовая игра юр лицо' },
    type: { id: 840, name: 'Закрытые категории', format: 'GROUP' },
    timeFrom: `${corporateDate}T08:00:00+03:00`,
    timeTo: `${corporateDate}T09:30:00+03:00`,
    studio: { id: 'test-studio', name: 'Тестовая площадка' },
    maxClientsCount: 8,
    clientsCount: 0
  };
  const requests: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.ok(!init?.method || init.method === 'GET', 'discovery must only read Viva');
    const url = new URL(String(input));
    requests.push(url);
    let payload: unknown;
    if (url.pathname.endsWith('/studios') || url.pathname.endsWith('/trainers')) {
      payload = [];
    } else if (url.pathname.endsWith('/profile')) {
      payload = {};
    } else if (url.pathname.endsWith('/exercises/dates')) {
      const types = url.searchParams.getAll('exerciseTypeIds');
      payload = [oldDate, ...(types.includes('840') ? [corporateDate] : [])];
    } else if (url.pathname.endsWith('/exercises')) {
      const date = url.searchParams.get('date');
      payload = date === corporateDate
        ? [corporate, { ...corporate, id: 'unrelated-closed', direction: { id: 9999, name: corporate.direction.name } }]
        : [{ ...corporate, id: 'old-tournament', type: { id: 839 }, timeFrom: `${oldDate}T08:00:00+03:00` }];
    } else if (url.pathname.endsWith('/exercises/corporate-event')) {
      payload = corporate;
    } else {
      payload = [];
    }
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const service = new VivaTournamentsService();
    const map = (record: Record<string, unknown>): Tournament | null =>
      (service as any).toTournament(record, new Map(), new Map(), new Map());
    const accepted = map(corporate);
    assert.ok(accepted, 'closed category direction 6078 must be available for a CUP skin');
    assert.equal(accepted.exerciseTypeId, '840', 'retain the provider category');
    assert.equal(accepted.name, corporate.direction.name);
    assert.equal(accepted.maxPlayers, 8);
    assert.equal(accepted.isPublic, false, 'closed source must default to a private skin');
    assert.equal(map({ ...corporate, direction: undefined }), null);
    assert.equal(map({ ...corporate, direction: { id: 9999, name: corporate.direction.name } }), null);
    assert.equal(map({ ...corporate, type: { id: 605, name: 'Тренировка' } }), null);
    assert.ok(map({ ...corporate, direction: { id: '6078' } }), 'string direction IDs are supported');
    for (const id of [839, 1013]) {
      const ordinary = map({ ...corporate, type: { id }, direction: { id: 9999, name: 'Обычное событие' } });
      assert.ok(ordinary);
      assert.equal(ordinary.isPublic, undefined, 'ordinary tournament default remains unchanged');
    }

    const list = await service.listTournaments({ from: oldDate, to: corporateDate });
    assert.deepEqual(list?.map((item) => item.id), ['old-tournament', 'corporate-event'],
      'discover the closed-only day even when the ordinary tournament date query is nonempty');
    const dates = requests.filter((url) => url.pathname.endsWith('/exercises/dates'));
    assert.equal(dates.length, 1, 'extend the existing date query without another request');
    assert.deepEqual(dates[0].searchParams.getAll('exerciseTypeIds'), ['839', '1013', '840']);

    requests.length = 0;
    const day = await service.listTournaments({ date: corporateDate, includePast: true });
    assert.deepEqual(day?.map((item) => item.id), ['corporate-event']);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get('includePast'), 'true');
    assert.equal((await service.findTournamentById('corporate-event'))?.id, corporate.id);

    const tournaments = new TournamentsService(
      {} as never, service, {} as never,
      { isEnabled: () => true, listCustomTournaments: async () => [] } as never,
      {} as never, {} as never, undefined, undefined,
      { listTournaments: async () => day, getFreshnessMetadata: () => undefined } as never
    );
    const admin = await tournaments.findAll({ date: corporateDate });
    assert.equal(admin[0]?.id, corporate.id, 'source remains visible in CUP');
    assert.equal((await tournaments.listPublicDirectory({ date: corporateDate })).count, 0,
      'source import alone must not publish a public tournament');
    const skin = (tournaments as any).buildCreateMutation(accepted, {});
    assert.equal(skin.isPublic, false, 'existing skin creation honors the private source default');
    assert.equal((tournaments as any).buildCreateMutation(accepted, { isPublic: true }).isPublic, true,
      'an explicit administrator publication choice remains supported');
    console.log('Corporate Viva direction discovery and CUP/public boundary tests passed');
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (originalEnv[index] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[index];
    });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

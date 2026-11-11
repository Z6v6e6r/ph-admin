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
  const ordinaryDate = '2026-11-11';
  const corporateDate = '2026-11-12';
  const corporate = [
    'ВСК турнир', 'Предприниматели-патриоты турнир', 'Пулково Турнир'
  ].map((name, index) => ({
    id: `corporate-tournament-${index}`,
    name: `Корпоративное событие ${index}`,
    direction: { id: `test-direction-${index}`, name },
    type: { id: 2349, name: 'Корпоративные клиенты', format: 'GROUP' },
    timeFrom: `${corporateDate}T10:00:00+03:00`,
    timeTo: `${corporateDate}T12:00:00+03:00`,
    studio: { id: 'test-studio', name: 'Тестовая площадка' },
    maxClientsCount: 12,
    clientsCount: 0
  }));
  const gamesAndTrainings = [
    'Атланты', 'ВСК игра', 'ВСК тренировка',
    'Предприниматели-патриоты тренировка', 'Предприниматели патриоты - игра',
    'Пулково Игры', 'Топократы игра', 'Топократы тренировка + игра'
  ].map((name, index) => ({ ...corporate[0], id: `other-${index}`, name, direction: { id: 'other', name } }));
  const ordinary = {
    ...corporate[0], id: 'ordinary-tournament', type: { id: 839, name: 'Падел Турнир', format: 'TOURNAMENT' },
    timeFrom: `${ordinaryDate}T10:00:00+03:00`, timeTo: `${ordinaryDate}T12:00:00+03:00`
  };
  const requests: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.ok(!init?.method || init.method === 'GET', 'discovery must only read Viva');
    const url = new URL(String(input));
    requests.push(url);
    let payload: unknown = [];
    if (url.pathname.endsWith('/profile')) payload = {};
    else if (url.pathname.endsWith('/exercises/dates')) {
      const types = url.searchParams.getAll('exerciseTypeIds');
      payload = [ordinaryDate, ...(types.includes('2349') ? [corporateDate] : [])];
    } else if (url.pathname.endsWith('/exercises')) {
      payload = url.searchParams.get('date') === corporateDate
        ? [...corporate, ...gamesAndTrainings] : [ordinary];
    } else {
      payload = corporate.find((item) => url.pathname.endsWith(`/exercises/${item.id}`)) ?? [];
    }
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const service = new VivaTournamentsService();
    const map = (record: Record<string, unknown>): Tournament | null =>
      (service as any).toTournament(record, new Map(), new Map(), new Map());
    for (const record of corporate) {
      const accepted = map(record);
      assert.ok(accepted, record.direction.name);
      assert.equal(accepted.name, record.name, 'custom title must not mask the tournament direction');
      assert.equal(accepted.exerciseTypeId, '2349');
      assert.equal(accepted.gameId, record.direction.id);
      assert.equal(accepted.maxPlayers, 12);
      assert.equal(accepted.isPublic, false, 'corporate import must not automatically publish a skin');
      assert.ok(map({ ...record, type: { ...record.type, id: '2349' }, direction: {
        ...record.direction, name: `  ${record.direction.name.toUpperCase().replace(/ /g, '\u00a0  ')}  `
      } }));
      assert.equal(map({ ...record, direction: undefined }), null);
      assert.equal(map({ ...record, type: { id: 605, name: 'Тренировка' } }), null);
    }
    for (const record of gamesAndTrainings) assert.equal(map(record), null, record.direction.name);
    const list = await service.listTournaments({ from: ordinaryDate, to: corporateDate });
    assert.deepEqual(list?.map((item) => item.id), [ordinary.id, ...corporate.map((item) => item.id)]);
    const dates = requests.filter((url) => url.pathname.endsWith('/exercises/dates'));
    assert.equal(dates.length, 1, 'extend the existing query without extra date requests');
    assert.deepEqual(dates[0].searchParams.getAll('exerciseTypeIds'), ['839', '1013', '840', '2349']);
    for (const record of corporate) {
      assert.equal((await service.findTournamentById(record.id))?.id, record.id);
    }
    const day = await service.listTournaments({ date: corporateDate });
    assert.deepEqual(day?.map((item) => item.id), corporate.map((item) => item.id));
    const tournaments = new TournamentsService(
      {} as never, service, {} as never,
      { isEnabled: () => true, listCustomTournaments: async () => [] } as never,
      {} as never, {} as never, undefined, undefined,
      { listTournaments: async () => day, getFreshnessMetadata: () => undefined } as never
    );
    assert.equal((await tournaments.findAll({ date: corporateDate })).length, 3, 'CUP lists all three sources');
    assert.equal((await tournaments.listPublicDirectory({ date: corporateDate })).count, 0);
    for (const source of day ?? []) {
      const skin = (tournaments as any).buildCreateMutation(source, {});
      assert.equal(skin.isPublic, false);
      assert.equal((tournaments as any).buildCreateMutation(source, { isPublic: true }).isPublic, true);
    }
    console.log('Corporate tournament category discovery, skin defaults and public boundary tests passed');
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (originalEnv[index] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[index];
    });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

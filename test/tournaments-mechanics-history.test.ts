import * as assert from 'node:assert/strict';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

const DEFAULT_WEIGHTS = {
  partnerRepeat: 1000,
  partnerImmediateRepeat: 1200,
  opponentRepeat: 150,
  opponentRecentRepeat: 250,
  balance: 100,
  unevenBye: 300,
  consecutiveBye: 700,
  pairInternalImbalance: 30
};

async function main(): Promise<void> {
  const service = new TournamentsPersistenceService();
  const existingDocument = {
    id: 'custom-tournament-1',
    slug: 'test-mechanics',
    name: 'Тестовая карточка',
    status: 'REGISTRATION',
    tournamentType: 'Американо',
    accessLevels: ['D', 'D+'],
    gender: 'MIXED',
    maxPlayers: 12,
    participants: [],
    waitlist: [],
    allowedManagerPhones: [],
    skin: {
      title: 'Тестовая карточка'
    },
    mechanics: {
      enabled: true,
      config: {
        mode: 'short_americano',
        rounds: null,
        courts: null,
        useRatings: true,
        firstRoundSeeding: 'auto',
        roundExactThreshold: 12,
        balanceOutlierThreshold: 1.1,
        balanceOutlierWeight: 120,
        strictPartnerUniqueness: 'high',
        strictBalance: 'medium',
        avoidRepeatOpponents: true,
        avoidRepeatPartners: true,
        distributeByesEvenly: true,
        historyDepth: 0,
        localSearchIterations: 6,
        pairingExactThreshold: 16,
        matchExactThreshold: 12,
        weights: DEFAULT_WEIGHTS
      }
    },
    createdAt: '2026-04-12T10:00:00.000Z',
    updatedAt: '2026-04-12T10:00:00.000Z',
    changeLog: []
  };

  let updatePayload: Record<string, unknown> | null = null;
  (service as unknown as { collection: () => Promise<unknown> }).collection = async () =>
    ({
      findOne: async () => existingDocument,
      updateOne: async (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
        updatePayload = update.$set ?? null;
      }
    });

  const updated = await service.updateCustomTournament(existingDocument.id, {
    mechanics: {
      enabled: true,
      notes: 'Используем более строгий баланс',
      config: {
        ...existingDocument.mechanics.config,
        rounds: 5,
        strictBalance: 'high',
        weights: {
          ...DEFAULT_WEIGHTS,
          balance: 140
        }
      }
    },
    actor: {
      id: 'user-1',
      login: 'tournament_admin',
      name: 'Турнирный админ'
    }
  });

  assert(updated, 'updated tournament should be returned');
  assert.equal(updated?.mechanics.notes, 'Используем более строгий баланс');
  assert.equal(updated?.mechanics.config.rounds, 5);
  assert.equal(updated?.mechanics.config.strictBalance, 'high');
  assert.equal(updated?.changeLog.length, 1);

  const [entry] = updated?.changeLog ?? [];
  assert(entry, 'change log entry should be created');
  assert.equal(entry.scope, 'MECHANICS');
  assert.equal(entry.actor?.name, 'Турнирный админ');
  assert(
    entry.changes.some((change) => change.field === 'mechanics.config.rounds' && change.after === '5'),
    'rounds change should be captured in history'
  );
  assert(
    entry.changes.some(
      (change) => change.field === 'mechanics.config.strictBalance' && change.after === 'high'
    ),
    'strictBalance change should be captured in history'
  );
  assert(
    entry.changes.some(
      (change) =>
        change.field === 'mechanics.config.weights.balance'
        && change.before === '100'
        && change.after === '140'
    ),
    'weight change should be captured in history'
  );

  assert(updatePayload, 'Mongo update payload should be prepared');
  const persistedPayload = updatePayload as Record<string, unknown>;
  assert.equal(
    (persistedPayload.updatedBy as { name?: string } | undefined)?.name,
    'Турнирный админ'
  );
  assert(Array.isArray(persistedPayload.changeLog), 'changeLog should be persisted');

  console.log('Tournament mechanics history test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

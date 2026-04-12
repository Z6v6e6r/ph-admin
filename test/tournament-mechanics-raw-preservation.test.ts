import * as assert from 'node:assert/strict';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

async function main(): Promise<void> {
  const service = new TournamentsPersistenceService();

  const existingDocument = {
    id: 'custom-tournament-raw-1',
    slug: 'raw-preservation',
    name: 'Турнир с raw-механикой',
    status: 'REGISTRATION',
    tournamentType: 'Американо',
    accessLevels: ['C'],
    gender: 'MIXED',
    maxPlayers: 12,
    participants: [],
    waitlist: [],
    allowedManagerPhones: [],
    skin: {
      title: 'Турнир с raw-механикой'
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
        weights: {
          partnerRepeat: 1000,
          partnerImmediateRepeat: 1200,
          opponentRepeat: 150,
          opponentRecentRepeat: 250,
          balance: 100,
          unevenBye: 300,
          consecutiveBye: 700,
          pairInternalImbalance: 30
        }
      },
      raw: {
        statistics: {
          standings: [
            {
              participant: 'Никита',
              wins: 3,
              draws: 0,
              losses: 1,
              points: 54,
              bye: 0,
              difference: 16
            }
          ]
        }
      }
    },
    createdAt: '2026-04-12T10:00:00.000Z',
    updatedAt: '2026-04-12T10:00:00.000Z',
    changeLog: []
  };

  let persistedPayload: Record<string, unknown> | null = null;
  (service as unknown as { collection: () => Promise<unknown> }).collection = async () =>
    ({
      findOne: async () => existingDocument,
      updateOne: async (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
        persistedPayload = update.$set ?? null;
      }
    });

  const updated = await service.updateCustomTournament(existingDocument.id, {
    mechanics: {
      enabled: true,
      notes: 'Обновили конфиг, raw должен сохраниться',
      raw: existingDocument.mechanics.raw,
      config: {
        ...existingDocument.mechanics.config,
        strictBalance: 'high'
      }
    }
  });

  assert(updated, 'updated tournament should be returned');
  assert(updated.mechanics.raw, 'raw payload should be present in response');
  const statistics = (updated.mechanics.raw as Record<string, unknown>).statistics as Record<string, unknown>;
  assert(Array.isArray(statistics.standings), 'standings should be preserved inside raw payload');

  assert(persistedPayload, 'Mongo update payload should be prepared');
  const payload = persistedPayload as Record<string, unknown>;
  const mechanics = (payload.mechanics as Record<string, unknown>) || {};
  assert(mechanics.raw, 'raw payload should be persisted');
  const raw = mechanics.raw as Record<string, unknown>;
  assert(raw.statistics, 'statistics section should stay in persisted raw payload');

  console.log('Tournament mechanics raw preservation test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

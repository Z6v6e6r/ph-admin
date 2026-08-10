import * as assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { TournamentResultsExportService } from '../src/tournaments/tournament-results-export.service';
import { Tournament, TournamentResultsView, TournamentStatus } from '../src/tournaments/tournaments.types';

function tournament(input: Partial<Tournament> & Pick<Tournament, 'id' | 'name'>): Tournament {
  return {
    source: 'VIVA',
    status: TournamentStatus.FINISHED,
    ...input
  };
}

function results(
  tournamentId: string,
  standings: TournamentResultsView['standings'],
  matches: TournamentResultsView['matches']
): TournamentResultsView {
  return {
    tournamentId,
    resolvedTournamentId: tournamentId,
    summary: {
      totalGames: matches.length,
      gamesWithResult: matches.filter((match) => match.resultLines.length > 0).length,
      uniquePlayers: standings.length
    },
    games: [],
    matches,
    standings
  };
}

async function main() {
  const user = { id: 'manager-1', roles: [] } as unknown as RequestUser;
  const tournaments = [
    tournament({
      id: 'tournament-1',
      exerciseId: 'source-1',
      name: '💥 ВРЕМЯ НА ДРУЗЕЙ D/C 💥',
      startsAt: '2026-08-01T09:30:00+03:00',
      studioId: 'station-seliger',
      studioName: 'Селигерская',
      participants: [
        { id: 'player-alice', name: 'Алиса' },
        { id: 'player-bob', name: 'Борис' }
      ],
      details: {
        sourceTournamentSnapshot: { name: 'Время на друзей' }
      }
    }),
    tournament({
      id: 'tournament-2',
      exerciseId: 'source-2',
      name: '💪 ВРЕМЯ НА ДРУЗЕЙ D/D+ 💪',
      startsAt: '2026-08-04T19:00:00+03:00',
      studioId: 'station-terehovo',
      studioName: 'Терехово',
      participants: [
        { id: 'player-alice', name: 'Алиса' },
        { id: 'player-carol', name: 'Карина' }
      ],
      details: {
        sourceTournamentSnapshot: { name: 'Время на друзей' }
      }
    }),
    tournament({
      id: 'tournament-other',
      exerciseId: 'source-other',
      name: 'Американо',
      startsAt: '2026-08-03T12:00:00+03:00',
      studioId: 'station-terehovo',
      studioName: 'Терехово',
      details: {
        sourceTournamentSnapshot: { name: 'Американо' }
      }
    })
  ];

  const resultsById = new Map<string, TournamentResultsView>([
    [
      'tournament-1',
      results(
        'tournament-1',
        [
          {
            player: 'Алиса',
            playedGames: 2,
            wins: 1,
            losses: 0,
            scoredPoints: 15,
            concededPoints: 13,
            pointsDiff: 2,
            totalDelta: 0.1
          },
          {
            player: 'Борис',
            playedGames: 1,
            wins: 0,
            losses: 1,
            scoredPoints: 8,
            concededPoints: 10,
            pointsDiff: -2,
            totalDelta: -0.1
          }
        ],
        [
          {
            gameId: 'match-1',
            title: 'Матч 1',
            startsAt: '2026-08-01T09:30:00+03:00',
            teams: [
              { name: 'A', players: ['Алиса'] },
              { name: 'B', players: ['Борис'] }
            ],
            resultLines: ['10:8'],
            ratingDeltaLines: [
              'Алиса: 2 -> 2.1 (+0.1)',
              'Борис: 2 -> 1.9 (-0.1)'
            ]
          },
          {
            gameId: 'match-2',
            title: 'Матч 2',
            startsAt: '2026-08-01T10:00:00+03:00',
            teams: [
              { name: 'A', players: ['Алиса'] },
              { name: 'B', players: ['Карина'] }
            ],
            resultLines: ['5:5'],
            ratingDeltaLines: []
          }
        ]
      )
    ],
    [
      'tournament-2',
      results(
        'tournament-2',
        [
          {
            player: 'Карина',
            playedGames: 1,
            wins: 1,
            losses: 0,
            scoredPoints: 10,
            concededPoints: 8,
            pointsDiff: 2,
            totalDelta: 0.05
          },
          {
            player: 'Алиса',
            playedGames: 1,
            wins: 0,
            losses: 1,
            scoredPoints: 8,
            concededPoints: 10,
            pointsDiff: -2,
            totalDelta: 0.05
          }
        ],
        [
          {
            gameId: 'match-3',
            title: 'Матч 3',
            startsAt: '2026-08-04T19:00:00+03:00',
            teams: [
              { name: 'A', players: ['Карина'] },
              { name: 'B', players: ['Алиса'] }
            ],
            resultLines: ['10:8'],
            ratingDeltaLines: [
              'Карина: 2.2 -> 2.25 (+0.05)',
              'Алиса: 2.1 -> 2.15 (+0.05)'
            ]
          }
        ]
      )
    ],
    ['tournament-other', results('tournament-other', [], [])]
  ]);

  const observedUsers: Array<RequestUser | undefined> = [];
  const service = new TournamentResultsExportService({
    async findAll(options: { user?: RequestUser }) {
      observedUsers.push(options.user);
      return tournaments;
    },
    async getResults(id: string, requestUser?: RequestUser) {
      observedUsers.push(requestUser);
      const value = resultsById.get(id);
      assert(value, `Missing result fixture for ${id}`);
      return value;
    }
  } as never, {
    async findByTournamentIds() {
      return null;
    }
  } as never);

  const exported = await service.buildExport({
    from: '2026-08-01',
    to: '2026-08-10',
    station: 'ALL',
    direction: 'name:время на друзей',
    user
  });

  assert.equal(exported.fileName, 'tournament-results-2026-08-01_to_2026-08-10.xlsx');
  assert.equal(exported.tournamentsCount, 2);
  assert.equal(exported.resultRowsCount, 4);
  assert.equal(exported.uniqueParticipantsCount, 3);
  assert(observedUsers.every((observed) => observed === user), 'Station-scoped user must propagate');

  const fixturePath = String(process.env.TOURNAMENT_EXPORT_FIXTURE_PATH || '').trim();
  if (fixturePath) {
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, exported.buffer);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(exported.buffer).buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Результаты',
    'Уникальные участники'
  ]);

  const resultSheet = workbook.getWorksheet('Результаты');
  assert(resultSheet);
  assert.deepEqual(Array.from(resultSheet.getRow(1).values as unknown[]).slice(1), [
    'start',
    'station',
    'tournament',
    'player',
    'rank',
    'matches',
    'wins',
    'losses',
    'draws',
    'points_for',
    'points_against',
    'point_diff',
    'total_points',
    'rating_before',
    'rating_after',
    'rating_delta'
  ]);
  assert.equal(resultSheet.rowCount, 5);
  assert.equal(resultSheet.getCell('B2').value, 'Селигерская');
  assert.equal(resultSheet.getCell('D2').value, 'Алиса');
  assert.equal(resultSheet.getCell('E2').value, 1);
  assert.equal(resultSheet.getCell('I2').value, 1, 'Draw must be derived from tied match');
  assert.equal(resultSheet.getCell('N2').value, 2);
  assert.equal(resultSheet.getCell('O2').value, 2.1);
  assert.equal(resultSheet.getCell('P2').value, 0.1);
  const firstStart = resultSheet.getCell('A2').value;
  assert(firstStart instanceof Date);
  assert.equal(firstStart.getUTCHours(), 9, 'Excel date must preserve Moscow wall-clock time');

  const uniqueSheet = workbook.getWorksheet('Уникальные участники');
  assert(uniqueSheet);
  const uniqueRows = new Map<string, ExcelJS.Row>();
  uniqueSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      uniqueRows.set(String(row.getCell(2).value), row);
    }
  });
  const alice = uniqueRows.get('Алиса');
  assert(alice);
  assert.equal(alice.getCell(1).value, 'player-alice');
  assert.equal(alice.getCell(3).value, 2);
  assert.equal(alice.getCell(8).value, 3);
  assert.equal(alice.getCell(20).value, 2);
  assert.equal(alice.getCell(21).value, 2.15);
  assert.equal(alice.getCell(22).value, 0.15);

  const stationOnly = await service.buildExport({
    from: '2026-08-01',
    to: '2026-08-10',
    station: 'name:селигерская',
    direction: 'name:время на друзей'
  });
  assert.equal(stationOnly.tournamentsCount, 1);
  assert.equal(stationOnly.resultRowsCount, 2);

  const observedStoredIds: string[][] = [];
  const canonicalService = new TournamentResultsExportService({
    async findAll() {
      return tournaments;
    },
    async getResults() {
      throw new Error('Legacy game results must not be read when canonical store is available');
    }
  } as never, {
    async findByTournamentIds(ids: string[]) {
      observedStoredIds.push(ids);
      return new Map([
        ['source-1', {
          tournamentId: 'source-1',
          standings: [
            {
              id: 'player-alice',
              name: 'Алиса',
              rank: 1,
              matchesPlayed: 2,
              wins: 1,
              losses: 0,
              draws: 1,
              pointsFor: 15,
              pointsAgainst: 13,
              pointDiff: 2,
              totalPoints: 15,
              ratingBefore: 2,
              ratingAfter: 2.1,
              ratingDelta: 0.1
            },
            {
              id: 'player-bob',
              name: 'Борис',
              rank: 2,
              matchesPlayed: 2,
              wins: 0,
              losses: 1,
              draws: 1,
              pointsFor: 13,
              pointsAgainst: 15,
              pointDiff: -2,
              totalPoints: 13,
              ratingBefore: 2,
              ratingAfter: 1.9,
              ratingDelta: -0.1
            }
          ]
        }],
        ['source-2', {
          tournamentId: 'source-2',
          standings: [
            {
              id: 'player-carol',
              name: 'Карина',
              rank: 1,
              matchesPlayed: 1,
              wins: 1,
              losses: 0,
              draws: 0,
              pointsFor: 10,
              pointsAgainst: 8,
              pointDiff: 2,
              totalPoints: 10,
              ratingBefore: 2.2,
              ratingAfter: 2.25,
              ratingDelta: 0.05
            },
            {
              id: 'player-alice',
              name: 'Алиса',
              rank: 2,
              matchesPlayed: 1,
              wins: 0,
              losses: 1,
              draws: 0,
              pointsFor: 8,
              pointsAgainst: 10,
              pointDiff: -2,
              totalPoints: 8,
              ratingBefore: 2.1,
              ratingAfter: 2.15,
              ratingDelta: 0.05
            }
          ]
        }]
      ]);
    }
  } as never);
  const canonicalExport = await canonicalService.buildExport({
    from: '2026-08-01',
    to: '2026-08-10',
    direction: 'name:время на друзей'
  });
  assert.equal(canonicalExport.tournamentsCount, 2);
  assert.equal(canonicalExport.resultRowsCount, 4);
  assert.equal(canonicalExport.uniqueParticipantsCount, 3);
  assert(observedStoredIds[0].includes('source-1'));
  assert(observedStoredIds[0].includes('source-2'));
  const canonicalWorkbook = new ExcelJS.Workbook();
  await canonicalWorkbook.xlsx.load(Uint8Array.from(canonicalExport.buffer).buffer);
  const canonicalResults = canonicalWorkbook.getWorksheet('Результаты');
  assert(canonicalResults);
  assert.equal(canonicalResults.getCell('D2').value, 'Алиса');
  assert.equal(canonicalResults.getCell('I2').value, 1);
  assert.equal(canonicalResults.getCell('P2').value, 0.1);
  const canonicalUnique = canonicalWorkbook.getWorksheet('Уникальные участники');
  assert(canonicalUnique);
  const canonicalAlice = canonicalUnique.getRow(2);
  assert.equal(canonicalAlice.getCell(1).value, 'player-alice');
  assert.equal(canonicalAlice.getCell(3).value, 2);
  assert.equal(canonicalAlice.getCell(22).value, 0.15);
  const canonicalFixturePath = String(
    process.env.TOURNAMENT_EXPORT_CANONICAL_FIXTURE_PATH || ''
  ).trim();
  if (canonicalFixturePath) {
    await mkdir(dirname(canonicalFixturePath), { recursive: true });
    await writeFile(canonicalFixturePath, canonicalExport.buffer);
  }

  const legacyFallbackIds: string[] = [];
  const mixedService = new TournamentResultsExportService({
    async findAll() {
      return tournaments;
    },
    async getResults(id: string) {
      legacyFallbackIds.push(id);
      const value = resultsById.get(id);
      assert(value, `Missing fallback fixture for ${id}`);
      return value;
    }
  } as never, {
    async findByTournamentIds() {
      return new Map([
        ['source-1', {
          tournamentId: 'source-1',
          standings: [
            {
              id: 'player-alice',
              name: 'Алиса',
              rank: 1,
              matchesPlayed: 2,
              wins: 1,
              losses: 0,
              draws: 1,
              pointsFor: 15,
              pointsAgainst: 13,
              pointDiff: 2,
              totalPoints: 15,
              ratingBefore: 2,
              ratingAfter: 2.1,
              ratingDelta: 0.1
            }
          ]
        }]
      ]);
    }
  } as never);
  const mixedExport = await mixedService.buildExport({
    from: '2026-08-01',
    to: '2026-08-10',
    direction: 'name:время на друзей'
  });
  assert.equal(mixedExport.tournamentsCount, 2);
  assert.equal(mixedExport.resultRowsCount, 3);
  assert.deepEqual(legacyFallbackIds, ['tournament-2']);

  await assert.rejects(
    service.buildExport({ from: '2026-08-10', to: '2026-08-01' }),
    (error: unknown) => error instanceof BadRequestException
  );
  await assert.rejects(
    service.buildExport({ from: '2025-01-01', to: '2026-08-10' }),
    (error: unknown) => error instanceof BadRequestException
  );
  await assert.rejects(
    service.buildExport({ from: '2026-02-30', to: '2026-03-01' }),
    (error: unknown) => error instanceof BadRequestException
  );

  console.log('Tournament results export test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

require('reflect-metadata');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Module, ForbiddenException } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');

const dist = process.env.RATING_CUP_DIST;
const fromCup = name => require(path.join(dist, name));
const { TournamentsController } = fromCup('tournaments/tournaments.controller');
const { TournamentsService } = fromCup('tournaments/tournaments.service');
const { TournamentsPersistenceService } = fromCup('tournaments/tournaments-persistence.service');
const { TournamentsVivaStatusSyncService } = fromCup('tournaments/tournaments-viva-status-sync.service');
const { TournamentResultsExportService } = fromCup('tournaments/tournament-results-export.service');
const { TournamentCheckoutService } = fromCup('tournaments/tournament-checkout.service');
const { TournamentServerBookingService } = fromCup('tournaments/tournament-server-booking.service');
const { PlayerRatingRepository } = fromCup('player-ratings/player-ratings.repository');
const { PlayerRatingsService } = fromCup('player-ratings/player-ratings.service');
const { PlayerLevelProjectionService } = fromCup('player-ratings/player-level-projection.service');
const { actor, auth, ownerToken } = require('./identity.cjs');

async function start() {
  const uri = new URL(process.env.TOURNAMENTS_MONGODB_URI);
  assert.equal(uri.hostname, '127.0.0.1');
  assert.equal(uri.searchParams.get('replicaSet'), 'ratingRecovery');
  assert.equal(process.env.TOURNAMENTS_MONGODB_DB, 'rating_recovery_fixture');
  assert.equal(process.env.PLAYER_RATINGS_MONGODB_DB, 'rating_recovery_fixture');

  const persistence = new TournamentsPersistenceService();
  const repository = new PlayerRatingRepository();
  const ratings = new PlayerRatingsService(repository);
  const projection = new PlayerLevelProjectionService(repository);
  const verifyTrustedBearer = async value => {
    if (value !== auth) throw new ForbiddenException();
    return { actor };
  };
  const identity = {
    verifyTrustedBearer,
    verify(value, token) {
      if (token !== ownerToken) throw new ForbiddenException();
      return verifyTrustedBearer(value);
    },
  };
  const tournaments = Object.create(TournamentsService.prototype);
  Object.assign(tournaments, {
    tournamentsPersistence: persistence,
    trustedRegistrationIdentities: new WeakMap(),
    lkIdentityService: identity,
    playerRatingsService: ratings,
    requireCustomByPublicRef: ref => persistence.findCheckoutTournamentByExerciseId(ref).then(row => row.tournament),
  });
  const checkout = new TournamentCheckoutService(tournaments, persistence);
  let providerCalls = 0;
  checkout.http = async () => {
    providerCalls++;
    throw new Error('Unexpected CUP provider request in isolated rehearsal');
  };
  const serverBooking = new TournamentServerBookingService(tournaments, persistence);
  class FixtureModule {}
  Module({
    controllers: [TournamentsController],
    providers: [
      { provide: TournamentsService, useValue: tournaments },
      { provide: TournamentsVivaStatusSyncService, useValue: {} },
      { provide: TournamentResultsExportService, useValue: {} },
      { provide: TournamentCheckoutService, useValue: checkout },
      { provide: TournamentServerBookingService, useValue: serverBooking },
    ],
  })(FixtureModule);
  const app = await NestFactory.create(FixtureModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  process.send({ ready: app.getHttpServer().address().port, pid: process.pid });
  process.on('message', async command => {
    try {
      if (command === 'seed-rating') {
        const result = await ratings.assign({
          clientId: actor.clientId, ratingNumeric: 3.375,
          reason: 'Synthetic canonical level for restart rehearsal',
          idempotencyKey: 'synthetic-recovery-rating-initial',
        }, { clientId: actor.clientId, phone: actor.phoneNorm, displayName: 'Synthetic shared player' },
        { id: 'synthetic-coach-authorized', title: 'Synthetic coach' });
        await projection.runCycle();
        process.send({ eventId: result.event.id });
      } else if (command === 'projection-cycle') {
        await projection.runCycle();
        process.send({ metrics: projection.metricsSnapshot() });
      } else if (command === 'provider-calls') {
        process.send({ providerCalls });
      }
    } catch (error) {
      process.send({ error: error.stack });
    }
  });
  process.once('SIGTERM', async () => {
    await app.close();
    await persistence.onModuleDestroy();
    await repository.close();
  });
}

start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

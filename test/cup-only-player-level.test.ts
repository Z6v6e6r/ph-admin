import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/common/rbac/roles.guard';
import { PlayerRatingRepository } from '../src/player-ratings/player-ratings.repository';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { PlayerRatingsService } from '../src/player-ratings/player-ratings.service';
import { PlayerRatingsController } from '../src/player-ratings/player-ratings.controller';
import { PlayerLevelProjectionService } from '../src/player-ratings/player-level-projection.service';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';

async function main() {
  const events: any[] = []; let written: any; let outcome = 'ok';
  const repository: any = { connect: async () => {}, close: async () => {},
    eventByIdempotencyKey: async (key: string) => events.find(event => event.idempotencyKey === key),
    eventById: async (id: string) => events.find(event => event.id === id), latestOutbox: async () => null,
    stateByKey: async () => written?.nextState,
    runAtomicInitialAssignment: async (input: any) => { if (outcome === 'ok') { written = input; events.push(input.event); } return outcome; },
    isDuplicateKey: () => false };
  const service = new PlayerRatingsService(repository);
  const actor: any = { id: 'synthetic-admin', title: 'Synthetic Admin', authSource: 'token', permissions: ['*'], stationIds: [] };
  const dto = { clientId: 'synthetic-client', ratingNumeric: 3.12345, reason: 'Initial assessment by coach', idempotencyKey: 'synthetic-assignment-1' };
  const identity = { clientId: dto.clientId, displayName: 'Synthetic Player' };
  const assigned = await service.assign(dto, identity, actor);
  assert.equal(assigned.state.ratingNumeric, dto.ratingNumeric); assert.equal(assigned.state.rating, 'C');
  assert.equal(assigned.event.eventType, 'RATING_INITIAL_ASSIGNED'); assert.equal(assigned.event.before, null);
  assert.equal(assigned.projection.status, 'NOT_REQUIRED'); assert.equal(written.outbox, undefined);
  const repeated = await service.assign(dto, identity, actor); assert.equal(repeated.event.id, assigned.event.id); assert.equal(events.length, 1);
  await assert.rejects(service.assign({ ...dto, ratingNumeric: 4 }, identity, actor), (error: any) => error.status === 409);
  await assert.rejects(service.assign({ ...dto, reason: '          ', idempotencyKey: 'synthetic-spaces-1' }, identity, actor), (error: any) => error.status === 400);
  await assert.rejects(service.assign(dto, { ...identity, clientId: 'foreign' }, actor), (error: any) => error.status === 400);
  outcome = 'conflict';
  await assert.rejects(service.assign({ ...dto, idempotencyKey: 'synthetic-existing-1' }, identity, actor), (error: any) => error.status === 409);
  await assert.rejects(service.retryProjection('client:synthetic-client', actor), (error: any) => error.response.code === 'VIVA_LEVEL_PROJECTION_RETIRED');
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PlayerRatingsController.prototype.assign), ['player-ratings:write']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PlayerRatingsController.prototype.change), ['player-ratings:write']);
  for (const permissions of [[], ['player-ratings:read'], ['player-ratings:write']]) {
    const auth: any = { resolveUserFromRequest: async () => ({ user: { id: 'synthetic-coach', roles: ['CLIENT'], permissions }, source: 'token' }), shouldRequireStaffToken: () => false };
    const guard = new RolesGuard(new Reflector(), auth);
    const context: any = { switchToHttp: () => ({ getRequest: () => ({}) }), getHandler: () => PlayerRatingsController.prototype.assign, getClass: () => PlayerRatingsController };
    assert.equal(await guard.canActivate(context), permissions.includes('player-ratings:write'));
  }
  // A transactional retry which discovers a competing assignment must not retain a prior success.
  const transactional: any = new PlayerRatingRepository(); let secondAttempt = false;
  transactional.requireClient = () => ({ startSession: () => ({ withTransaction: async (work: any) => { await work(); secondAttempt = true; await work(); }, endSession: async () => {} }) });
  transactional.states = () => ({ findOne: async () => secondAttempt ? {} : null, insertOne: async () => {} });
  transactional.events = () => ({ findOne: async () => null, insertOne: async () => {} });
  transactional.compatibility = () => ({ findOne: async () => null, insertOne: async () => {} });
  assert.equal(await transactional.runAtomicInitialAssignment({ event: written.event, nextState: written.nextState, compatibility: {} }), 'conflict');
  const projection: any = new PlayerLevelProjectionService(repository);
  const payload = projection.payloadFromState({ ...written.nextState, lastEventType: 'RATING_INITIAL_ASSIGNED' });
  assert.equal(payload.source.eventType, 'RATING_MANUALLY_CHANGED', 'LK2 wire contract remains supported');
  // Strict identity mode must reject a successful provider body without an actual matching ID.
  const viva: any = Object.create(VivaAdminService.prototype);
  viva.requireAccessToken = async () => 'synthetic'; viva.getResolvedSettings = async () => ({ config: { baseUrl: 'https://synthetic.invalid' } });
  viva.fetchAdminJson = async () => ({ firstName: 'Synthetic' });
  await assert.rejects(viva.getClientProfile('synthetic-client', true), (error: any) => error.status === 400);
  console.log('CUP-only initial assignment, idempotency, strict identity, permissions and LK2 compatibility passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { CreateStationDto } from '../src/messenger/dto/create-station.dto';
import { UpdateStationDto } from '../src/messenger/dto/update-station.dto';
import { MessengerPersistenceService } from '../src/messenger/messenger-persistence.service';
import { MessengerService } from '../src/messenger/messenger.service';
import { MessengerStationConfig } from '../src/messenger/messenger.types';

const BOX_ID = '7ff7af60-53e4-4cbc-89c3-4170b93697dc';

function createUser(): RequestUser {
  return {
    id: 'super-admin-1',
    roles: [Role.SUPER_ADMIN],
    stationIds: [],
    connectorRoutes: []
  };
}

function createSupportUser(): RequestUser {
  return {
    id: 'support-1',
    roles: [Role.SUPPORT],
    stationIds: [],
    connectorRoutes: []
  };
}

function createManagerUser(): RequestUser {
  return {
    id: 'manager-1',
    roles: [Role.MANAGER],
    stationIds: [],
    connectorRoutes: []
  };
}

async function validateDto<T extends object>(
  metatype: new () => T,
  payload: Record<string, unknown>
): Promise<T> {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });
  return pipe.transform(payload, { type: 'body', metatype }) as Promise<T>;
}

async function main(): Promise<void> {
  const validCreate = await validateDto(CreateStationDto, {
    stationId: 'box-test',
    stationName: 'Тестовая станция',
    tournamentBroadcastBoxId: BOX_ID
  });
  assert.equal(validCreate.tournamentBroadcastBoxId, BOX_ID);

  await assert.rejects(
    validateDto(CreateStationDto, {
      stationId: 'invalid-box-test',
      tournamentBroadcastBoxId: `${BOX_ID}a`
    })
  );
  const clearUpdate = await validateDto(UpdateStationDto, {
    tournamentBroadcastBoxId: null
  });
  assert.equal(clearUpdate.tournamentBroadcastBoxId, null);

  const persisted: MessengerStationConfig[] = [];
  const service = new MessengerService(
    {} as never,
    { listRules: () => [] } as never,
    {
      persistStation(station: MessengerStationConfig) {
        persisted.push(structuredClone(station));
      }
    } as unknown as MessengerPersistenceService
  );
  const user = createUser();
  const created = service.createStationConfig(validCreate, user);
  assert.equal(created.tournamentBroadcastBoxId, BOX_ID);
  assert.equal(persisted.at(-1)?.tournamentBroadcastBoxId, BOX_ID);
  assert.equal(
    service.listStationConfigs(user).find((station) => station.stationId === 'box-test')
      ?.tournamentBroadcastBoxId,
    BOX_ID
  );
  assert.equal(
    service
      .listStationConfigs(createManagerUser())
      .find((station) => station.stationId === 'box-test')?.tournamentBroadcastBoxId,
    BOX_ID
  );
  assert.equal(
    'tournamentBroadcastBoxId' in
      (service
        .listStationConfigs(createSupportUser())
        .find((station) => station.stationId === 'box-test') ?? {}),
    false
  );
  assert.throws(() =>
    service.updateStationConfig(
      'box-test',
      { tournamentBroadcastBoxId: 'b9dcfdb5-b8f5-4b1d-b251-f2cb4f73a641' },
      createSupportUser()
    )
  );

  const unchanged = service.updateStationConfig('box-test', { isActive: false }, user);
  assert.equal(unchanged.tournamentBroadcastBoxId, BOX_ID);

  const cleared = service.updateStationConfig('box-test', clearUpdate, user);
  assert.equal('tournamentBroadcastBoxId' in cleared, false);
  assert.equal('tournamentBroadcastBoxId' in (persisted.at(-1) ?? {}), false);

  const mongoCalls: Array<{ filter: unknown; update: unknown; options: unknown }> = [];
  const persistence = new MessengerPersistenceService();
  (persistence as unknown as { db: unknown }).db = {
    collection(name: string) {
      assert.equal(name, 'messenger_station_configs');
      return {
        async updateOne(filter: unknown, update: unknown, options: unknown) {
          mongoCalls.push({ filter, update, options });
        }
      };
    }
  };
  persistence.persistStation(created);
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  assert.deepEqual(mongoCalls.at(-1)?.update, { $set: created });

  persistence.persistStation(cleared);
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  assert.deepEqual(mongoCalls.at(-1)?.update, {
    $set: cleared,
    $unset: { tournamentBroadcastBoxId: '' }
  });

  const adminUiSource = readFileSync(
    resolve(process.cwd(), 'client-sdk/phab-admin-panel.js'),
    'utf8'
  );
  assert.match(adminUiSource, /ID приставки трансляции/);
  assert.match(adminUiSource, /station\.tournamentBroadcastBoxId \|\| 'не привязана'/);
  assert.match(
    adminUiSource,
    /tournamentBroadcastBoxId: tournamentBroadcastBoxId \|\| null/
  );

  console.log('Messenger station broadcast settings test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

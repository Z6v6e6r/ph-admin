import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  BadRequestException,
  HttpException,
  RequestMethod,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import {
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA
} from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { STAFF_ROLES, Role } from '../src/common/rbac/role.enum';
import { ROLES_KEY } from '../src/common/rbac/roles.decorator';
import {
  normalizeResidentPhotoUrl,
  SubscriptionsVivaResidentProfileAdapter
} from '../src/residency-check/resident-profile.adapter';
import { ResidentProfileController } from '../src/residency-check/resident-profile.controller';
import { ResidentProfileService } from '../src/residency-check/resident-profile.service';
import {
  RESIDENT_PROFILE_PORT,
  ResidentProfilePort,
  ResidentProfileRecord
} from '../src/residency-check/residency-check.types';

class FakeResidentProfilePort implements ResidentProfilePort {
  readonly calls: string[] = [];

  constructor(
    private readonly result: ResidentProfileRecord | null | Error = null
  ) {}

  async profileBySubscriptionInstance(
    subscriptionInstanceId: string
  ): Promise<ResidentProfileRecord | null> {
    this.calls.push(subscriptionInstanceId);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function staffUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 'staff-1',
    login: 'manager',
    title: 'Администратор',
    roles: [Role.STATION_ADMIN],
    permissions: ['resident-services:issue'],
    stationIds: ['Yasenevo'],
    connectorRoutes: [],
    ...overrides
  };
}

function exceptionBody(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof HttpException, 'expected an HttpException');
  const body = error.getResponse();
  return typeof body === 'string'
    ? { message: body }
    : (body as Record<string, unknown>);
}

async function expectReject(
  run: () => Promise<unknown>,
  expected: new (...args: never[]) => HttpException
): Promise<HttpException> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof expected, 'unexpected exception type');
    return error;
  }
  assert.fail('expected the call to reject');
}

async function main(): Promise<void> {
  process.env.RESIDENCY_CHECK_ENABLED = 'true';
  /* -------------------- normalizeResidentPhotoUrl -------------------- */
  assert.equal(
    normalizeResidentPhotoUrl('https://cdn.example/resident.jpg'),
    'https://cdn.example/resident.jpg'
  );
  assert.equal(
    normalizeResidentPhotoUrl('  https://cdn.example/resident.jpg  '),
    'https://cdn.example/resident.jpg'
  );
  assert.equal(
    normalizeResidentPhotoUrl('/assets/residency/demo-resident.svg'),
    '/assets/residency/demo-resident.svg'
  );
  assert.equal(
    normalizeResidentPhotoUrl('  /assets/residency/demo.svg  '),
    '/assets/residency/demo.svg'
  );
  assert.match(
    String(normalizeResidentPhotoUrl('HTTPS://CDN.EXAMPLE/RESIDENT.JPG')),
    /^https:\/\/cdn\.example\//i
  );
  for (const rejected of [
    'http://cdn.example/resident.jpg',
    'ftp://cdn.example/resident.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//evil.example/resident.jpg',
    'https://user:pass@cdn.example/resident.jpg',
    'https://user@cdn.example/resident.jpg',
    '',
    '   ',
    null,
    undefined,
    42
  ]) {
    assert.equal(
      normalizeResidentPhotoUrl(rejected),
      null,
      'photo URL must be rejected: ' + String(rejected)
    );
  }
  assert.equal(normalizeResidentPhotoUrl('/'), '/');

  /* -------------------- adapter bridge -------------------- */
  const adapterRecord = await new SubscriptionsVivaResidentProfileAdapter(
    {
      runtimeInstanceById: async (id: string) => ({
        subscriptionInstanceId: id,
        providerClientId: 'provider-client-1'
      })
    } as never,
    {
      getClientProfile: async (clientId: string) => {
        assert.equal(clientId, 'provider-client-1');
        return {
          displayName: '  Иван Резидентов  ',
          avatarUrl: 'https://cdn.example/i.jpg'
        };
      }
    } as never
  ).profileBySubscriptionInstance('subscription_instance:abc');
  assert.deepEqual(adapterRecord, {
    displayName: 'Иван Резидентов',
    avatarUrl: 'https://cdn.example/i.jpg'
  });

  const adapterUnsafeAvatar = await new SubscriptionsVivaResidentProfileAdapter(
    {
      runtimeInstanceById: async () => ({ providerClientId: 'provider-client-1' })
    } as never,
    {
      getClientProfile: async () => ({
        displayName: 'Иван',
        avatarUrl: 'javascript:alert(1)'
      })
    } as never
  ).profileBySubscriptionInstance('subscription_instance:abc');
  assert.equal(adapterUnsafeAvatar?.avatarUrl, null);

  const adapterMissingInstance = await new SubscriptionsVivaResidentProfileAdapter(
    { runtimeInstanceById: async () => null } as never,
    { getClientProfile: async () => null } as never
  ).profileBySubscriptionInstance('subscription_instance:abc');
  assert.equal(adapterMissingInstance, null);

  const adapterFailure = await new SubscriptionsVivaResidentProfileAdapter(
    {
      runtimeInstanceById: async () => {
        throw new Error('viva should not leak');
      }
    } as never,
    { getClientProfile: async () => null } as never
  ).profileBySubscriptionInstance('subscription_instance:abc');
  assert.equal(adapterFailure, null);

  /* -------------------- service mapping -------------------- */
  assert.equal(typeof RESIDENT_PROFILE_PORT, 'symbol');
  assert.equal(RESIDENT_PROFILE_PORT.toString(), 'Symbol(RESIDENT_PROFILE_PORT)');

  const mappingPort = new FakeResidentProfilePort({
    displayName: '  Анна Резидентова  ',
    avatarUrl: 'https://cdn.example/a.jpg'
  });
  const service = new ResidentProfileService(mappingPort);
  const mapped = await service.resolve('subscription_instance:abc-123');
  assert.deepEqual(mappingPort.calls, ['subscription_instance:abc-123']);
  assert.deepEqual(mapped, {
    subscriptionInstanceId: 'subscription_instance:abc-123',
    fullName: 'Анна Резидентова',
    photoUrl: 'https://cdn.example/a.jpg'
  });

  const relativePhotoPort = new FakeResidentProfilePort({
    displayName: 'Анна',
    avatarUrl: '/assets/residency/anna.svg'
  });
  assert.equal(
    (await new ResidentProfileService(relativePhotoPort).resolve('subscription_instance:abc')).photoUrl,
    '/assets/residency/anna.svg'
  );

  const unsafePhotoPort = new FakeResidentProfilePort({
    displayName: 'Анна',
    avatarUrl: 'http://cdn.example/insecure.jpg'
  });
  assert.equal(
    (await new ResidentProfileService(unsafePhotoPort).resolve('subscription_instance:abc')).photoUrl,
    null
  );

  const longNamePort = new FakeResidentProfilePort({
    displayName: 'Ж'.repeat(300),
    avatarUrl: 'https://cdn.example/a.jpg'
  });
  const longName = await new ResidentProfileService(longNamePort).resolve(
    'subscription_instance:abc'
  );
  assert.equal(longName.fullName.length, 240);
  assert.equal(longName.fullName, 'Ж'.repeat(240));

  const emptyNamePort = new FakeResidentProfilePort({
    displayName: '   ',
    avatarUrl: null
  });
  assert.equal(
    (await new ResidentProfileService(emptyNamePort).resolve('subscription_instance:abc')).fullName,
    'Резидент'
  );

  const nullRecordPort = new FakeResidentProfilePort(null);
  assert.deepEqual(
    await new ResidentProfileService(nullRecordPort).resolve('subscription_instance:abc'),
    {
      subscriptionInstanceId: 'subscription_instance:abc',
      fullName: 'Резидент',
      photoUrl: null
    }
  );

  const failingPort = new FakeResidentProfilePort(new Error('viva private detail'));
  const fallback = await new ResidentProfileService(failingPort).resolve(
    'subscription_instance:abc'
  );
  assert.deepEqual(fallback, {
    subscriptionInstanceId: 'subscription_instance:abc',
    fullName: 'Резидент',
    photoUrl: null
  });
  assert.doesNotMatch(JSON.stringify(fallback), /viva private detail/);

  const trimmedPort = new FakeResidentProfilePort({
    displayName: 'Анна',
    avatarUrl: '/a.svg'
  });
  const trimmedInstance = await new ResidentProfileService(trimmedPort).resolve(
    '  subscription_instance:trimmed  '
  );
  assert.equal(trimmedInstance.subscriptionInstanceId, 'subscription_instance:trimmed');
  assert.deepEqual(trimmedPort.calls, ['subscription_instance:trimmed']);

  /* -------------------- id validation -------------------- */
  for (const invalidId of [
    undefined,
    '',
    '   ',
    'a',
    'ab',
    ':starts-with-separator',
    'has space',
    'has/slash',
    'a'.repeat(201),
    'subscription|instance'
  ]) {
    const invalidPort = new FakeResidentProfilePort({
      displayName: 'Анна',
      avatarUrl: '/a.svg'
    });
    const invalidService = new ResidentProfileService(invalidPort);
    const error = await expectReject(
      () => invalidService.resolve(invalidId),
      BadRequestException
    );
    assert.equal(error.getStatus(), 400);
    const body = exceptionBody(error);
    assert.equal(body.code, 'RESIDENCY_REQUEST_INVALID');
    assert.equal(body.message, 'Subscription instance id is invalid');
    assert.deepEqual(invalidPort.calls, []);
    if (typeof invalidId === 'string' && invalidId.trim().length > 2) {
      assert.ok(
        !JSON.stringify(body).includes(invalidId.trim()),
        'thrown message must not echo the raw identifier'
      );
    }
  }

  /* -------------------- controller metadata -------------------- */
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, ResidentProfileController),
    'v1/admin/residency'
  );
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, ResidentProfileController), STAFF_ROLES);
  assert.equal(
    Reflect.getMetadata(PERMISSIONS_KEY, ResidentProfileController),
    undefined,
    'controller class must not declare permissions'
  );

  const handler = ResidentProfileController.prototype.profile;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'profile');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.GET);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, handler), ['resident-services:issue']);
  const headerMetadata = Reflect.getMetadata(HEADERS_METADATA, handler) as Array<{
    name: string;
    value: string;
  }>;
  assert.ok(
    headerMetadata.some(
      (header) => header.name === 'Cache-Control' && header.value === 'private, no-store'
    ),
    'profile response must be private and non-cacheable'
  );
  const routeArgs = Object.values(
    Reflect.getMetadata(ROUTE_ARGS_METADATA, ResidentProfileController, 'profile') ?? {}
  ) as Array<{ index: number; data?: string }>;
  assert.ok(
    routeArgs.some((argument) => argument.data === 'subscriptionInstanceId'),
    'subscriptionInstanceId must be bound from the query string'
  );
  assert.deepEqual(
    routeArgs.map((argument) => argument.index).sort((left, right) => left - right),
    [0, 1]
  );

  /* -------------------- controller behaviour -------------------- */
  const controllerPort = new FakeResidentProfilePort({
    displayName: '  Анна Резидентова ',
    avatarUrl: 'https://cdn.example/a.jpg'
  });
  const controller = new ResidentProfileController(
    new ResidentProfileService(controllerPort)
  );
  const user = staffUser();
  const response = await controller.profile('subscription_instance:abc', user);
  assert.deepEqual(response, {
    subscriptionInstanceId: 'subscription_instance:abc',
    fullName: 'Анна Резидентова',
    photoUrl: 'https://cdn.example/a.jpg'
  });
  assert.deepEqual(controllerPort.calls, ['subscription_instance:abc']);

  const unauthorized = await expectReject(
    () => controller.profile('subscription_instance:abc', undefined),
    UnauthorizedException
  );
  assert.equal(unauthorized.getStatus(), 401);
  const unauthorizedBody = exceptionBody(unauthorized);
  assert.equal(unauthorizedBody.code, 'RESIDENCY_AUTH_REQUIRED');
  assert.ok(
    !JSON.stringify(unauthorizedBody).includes('subscription_instance:abc'),
    'authorization errors must not echo request data'
  );
  assert.deepEqual(controllerPort.calls, ['subscription_instance:abc']);

  const invalidQuery = await expectReject(
    () => controller.profile('', staffUser()),
    BadRequestException
  );
  assert.equal(invalidQuery.getStatus(), 400);
  assert.equal(exceptionBody(invalidQuery).code, 'RESIDENCY_REQUEST_INVALID');

  /* -------------------- disabled feature -------------------- */
  process.env.RESIDENCY_CHECK_ENABLED = 'false';
  const disabled = await expectReject(
    () => new ResidentProfileService(new FakeResidentProfilePort()).resolve('subscription_instance:abc'),
    ServiceUnavailableException
  );
  assert.equal(disabled.getStatus(), 503);
  assert.equal(exceptionBody(disabled).code, 'RESIDENCY_CHECK_DISABLED');
  process.env.RESIDENCY_CHECK_ENABLED = 'true';

  console.log(
    'Resident profile: photo URL policy, adapter bridge, name/photo mapping, fallbacks, id validation, controller metadata and auth tests passed'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

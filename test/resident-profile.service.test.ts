import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Request } from 'express';
import {
  BadRequestException,
  ForbiddenException,
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
import {
  ResidentProfileController,
  trustedResidencyOrigins
} from '../src/residency-check/resident-profile.controller';
import { ResidentProfileService } from '../src/residency-check/resident-profile.service';
import {
  RESIDENT_PASS_TOKEN_PATTERN,
  RESIDENT_PREVIEW_PORT,
  RESIDENT_PROFILE_PORT,
  ResidentPreviewError,
  ResidentPreviewEvidence,
  ResidentPreviewPort,
  ResidentPreviewRequest,
  ResidentProfilePort,
  ResidentProfileRecord,
  ResidentStaffSession
} from '../src/residency-check/residency-check.types';

const VALID_PASS = 'rsp1_' + 'A'.repeat(43);
const OTHER_PASS = 'rsp1_' + 'B'.repeat(43);
const INSTANCE_ID = 'subscription_instance:abc-123';
const OTHER_INSTANCE_ID = 'subscription_instance:other-456';
const STAFF_SESSION: ResidentStaffSession = { cookie: 'phab_admin_session=token-1' };

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

class FakeResidentPreviewPort implements ResidentPreviewPort {
  readonly calls: ResidentPreviewRequest[] = [];

  constructor(
    private readonly result:
      | ResidentPreviewEvidence
      | Error
      | ((request: ResidentPreviewRequest) => Promise<ResidentPreviewEvidence>) = {
      passId: 'resident_pass:abc',
      subscriptionInstanceId: INSTANCE_ID,
      stationId: 'Piter',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }
  ) {}

  async previewPass(request: ResidentPreviewRequest): Promise<ResidentPreviewEvidence> {
    this.calls.push(request);
    if (this.result instanceof Error) throw this.result;
    if (typeof this.result === 'function') return this.result(request);
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

function createRequest(headers: Record<string, string> = {}): Request {
  return {
    protocol: 'https',
    originalUrl: '/api/v1/admin/residency/profile',
    headers,
    get: (name: string) => (name.toLowerCase() === 'host' ? 'padlhub.su' : undefined)
  } as unknown as Request;
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
    assert.ok(error instanceof expected, 'unexpected exception type: ' + String(error));
    return error;
  }
  assert.fail('expected the call to reject');
}

/** No error response may carry the pass token or any resident identifier. */
function assertNoPiiInError(error: HttpException, ...secrets: string[]): void {
  const serialized = JSON.stringify(exceptionBody(error));
  for (const secret of secrets) {
    if (!secret) continue;
    assert.ok(
      !serialized.includes(secret),
      'error payload must not echo request data: ' + secret
    );
  }
  assert.doesNotMatch(
    serialized,
    /Резидентова|Иван|cdn\.example|subscription_instance:/,
    'error payload must not contain resident PII'
  );
}

async function main(): Promise<void> {
  process.env.RESIDENCY_CHECK_ENABLED = 'true';
  const previousNodeEnv = process.env.NODE_ENV;
  const previousOrigins = process.env.RESIDENCY_CHECK_ADMIN_ORIGINS;
  delete process.env.NODE_ENV;
  delete process.env.RESIDENCY_CHECK_ADMIN_ORIGINS;

  /* -------------------- photo URL policy + adapter bridge -------------------- */
  assert.equal(
    normalizeResidentPhotoUrl('https://cdn.example/resident.jpg'),
    'https://cdn.example/resident.jpg'
  );
  assert.equal(
    normalizeResidentPhotoUrl('/assets/residency/demo-resident.svg'),
    '/assets/residency/demo-resident.svg'
  );
  for (const rejected of [
    'http://cdn.example/resident.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//evil.example/resident.jpg',
    'https://user:pass@cdn.example/resident.jpg',
    '',
    null,
    42
  ]) {
    assert.equal(
      normalizeResidentPhotoUrl(rejected),
      null,
      'photo URL must be rejected: ' + String(rejected)
    );
  }

  const adapterRecord = await new SubscriptionsVivaResidentProfileAdapter(
    {
      runtimeInstanceById: async (id: string) => ({
        subscriptionInstanceId: id,
        providerClientId: 'provider-client-1'
      })
    } as never,
    {
      getClientProfile: async () => ({
        displayName: '  Иван Резидентов  ',
        avatarUrl: 'https://cdn.example/i.jpg'
      })
    } as never
  ).profileBySubscriptionInstance(INSTANCE_ID);
  assert.deepEqual(adapterRecord, {
    displayName: 'Иван Резидентов',
    avatarUrl: 'https://cdn.example/i.jpg'
  });

  assert.equal(typeof RESIDENT_PROFILE_PORT, 'symbol');
  assert.equal(typeof RESIDENT_PREVIEW_PORT, 'symbol');

  /* -------------------- token contract -------------------- */
  assert.equal(RESIDENT_PASS_TOKEN_PATTERN.test(VALID_PASS), true);
  assert.equal(RESIDENT_PASS_TOKEN_PATTERN.test('rsp1_short'), false);
  assert.equal(RESIDENT_PASS_TOKEN_PATTERN.test('RS1_' + 'A'.repeat(43)), false);
  assert.equal(RESIDENT_PASS_TOKEN_PATTERN.test(VALID_PASS + ' '), false);
  assert.equal(RESIDENT_PASS_TOKEN_PATTERN.test('rsp1_' + 'A'.repeat(200)), false);

  /* -------------------- success path: verified preview instance only -------------------- */
  {
    const profilePort = new FakeResidentProfilePort({
      displayName: '  Анна Резидентова  ',
      avatarUrl: 'https://cdn.example/a.jpg'
    });
    const previewPort = new FakeResidentPreviewPort();
    const service = new ResidentProfileService(profilePort, previewPort);
    const response = await service.resolve(
      {
        passToken: VALID_PASS,
        stationId: 'Piter',
        subscriptionInstanceId: INSTANCE_ID
      },
      STAFF_SESSION
    );
    assert.deepEqual(response, {
      subscriptionInstanceId: INSTANCE_ID,
      fullName: 'Анна Резидентова',
      photoUrl: 'https://cdn.example/a.jpg'
    });
    assert.equal(previewPort.calls.length, 1);
    assert.deepEqual(previewPort.calls[0], {
      passToken: VALID_PASS,
      stationId: 'Piter',
      staffSession: STAFF_SESSION
    });
    assert.deepEqual(profilePort.calls, [INSTANCE_ID]);
  }

  {
    // Without a cross-check id the verified preview instance drives the lookup.
    const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
    const previewPort = new FakeResidentPreviewPort();
    const service = new ResidentProfileService(profilePort, previewPort);
    const response = await service.resolve({ passToken: VALID_PASS, stationId: 'Piter' }, STAFF_SESSION);
    assert.equal(response.subscriptionInstanceId, INSTANCE_ID);
    assert.deepEqual(profilePort.calls, [INSTANCE_ID]);
  }

  {
    // A different previewed pass must win: the request id is never a lookup key.
    const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
    const previewPort = new FakeResidentPreviewPort({
      passId: 'resident_pass:other',
      subscriptionInstanceId: OTHER_INSTANCE_ID,
      stationId: 'Piter',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const service = new ResidentProfileService(profilePort, previewPort);
    const response = await service.resolve(
      { passToken: OTHER_PASS, stationId: 'Piter', subscriptionInstanceId: '' },
      STAFF_SESSION
    );
    assert.equal(response.subscriptionInstanceId, OTHER_INSTANCE_ID);
    assert.deepEqual(profilePort.calls, [OTHER_INSTANCE_ID]);
  }

  /* -------------------- S-08 negatives: mismatch / refused preview -------------------- */
  {
    const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
    const previewPort = new FakeResidentPreviewPort();
    const service = new ResidentProfileService(profilePort, previewPort);
    const error = await expectReject(
      () =>
        service.resolve(
          {
            passToken: VALID_PASS,
            stationId: 'Piter',
            subscriptionInstanceId: OTHER_INSTANCE_ID
          },
          STAFF_SESSION
        ),
      ForbiddenException
    );
    assert.equal(error.getStatus(), 403);
    assert.equal(exceptionBody(error).code, 'RESIDENCY_PROFILE_FORBIDDEN');
    assert.equal(profilePort.calls.length, 0, 'no profile read for an unverified instance id');
    assertNoPiiInError(error, VALID_PASS, OTHER_INSTANCE_ID, INSTANCE_ID);
  }

  for (const [failure, expectedType, status, code] of [
    ['REJECTED', ForbiddenException, 403, 'RESIDENCY_PASS_NOT_VERIFIED'],
    ['UNAUTHENTICATED', UnauthorizedException, 401, 'RESIDENCY_AUTH_REQUIRED'],
    ['UNAVAILABLE', ServiceUnavailableException, 503, 'RESIDENCY_PASS_PREVIEW_UNAVAILABLE']
  ] as const) {
    const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
    const previewPort = new FakeResidentPreviewPort(
      new ResidentPreviewError(failure, 'UPSTREAM_CODE_WITH_TOKEN_' + VALID_PASS)
    );
    const service = new ResidentProfileService(profilePort, previewPort);
    const error = await expectReject(
      () => service.resolve({ passToken: VALID_PASS, stationId: 'Piter' }, STAFF_SESSION),
      expectedType
    );
    assert.equal(error.getStatus(), status);
    assert.equal(exceptionBody(error).code, code);
    assert.equal(profilePort.calls.length, 0, 'PII is never read on a preview refusal');
    assertNoPiiInError(error, VALID_PASS);
    assert.doesNotMatch(JSON.stringify(exceptionBody(error)), /UPSTREAM_CODE/);
  }

  {
    // An unexpected upstream error still fails closed without PII.
    const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
    const previewPort = new FakeResidentPreviewPort(new Error('boom ' + VALID_PASS));
    const service = new ResidentProfileService(profilePort, previewPort);
    const error = await expectReject(
      () => service.resolve({ passToken: VALID_PASS, stationId: 'Piter' }, STAFF_SESSION),
      ServiceUnavailableException
    );
    assert.equal(exceptionBody(error).code, 'RESIDENCY_PASS_PREVIEW_UNAVAILABLE');
    assert.equal(profilePort.calls.length, 0);
    assertNoPiiInError(error, VALID_PASS);
    assert.doesNotMatch(JSON.stringify(exceptionBody(error)), /boom/);
  }

  {
    // Malformed preview evidence (no confirmed instance) must not reach PII.
    for (const evidence of [
      { passId: 'p', subscriptionInstanceId: '', stationId: 'Piter', expiresAt: '' },
      { passId: 'p', subscriptionInstanceId: 'x', stationId: 'Piter', expiresAt: '' },
      { passId: 'p', subscriptionInstanceId: 'bad id', stationId: 'Piter', expiresAt: '' }
    ] as ResidentPreviewEvidence[]) {
      const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
      const previewPort = new FakeResidentPreviewPort(evidence);
      const service = new ResidentProfileService(profilePort, previewPort);
      const error = await expectReject(
        () => service.resolve({ passToken: VALID_PASS, stationId: 'Piter' }, STAFF_SESSION),
        ForbiddenException
      );
      assert.equal(exceptionBody(error).code, 'RESIDENCY_PROFILE_FORBIDDEN');
      assert.equal(profilePort.calls.length, 0);
    }
  }

  {
    // Missing forwarded staff session: fail before any upstream call.
    const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
    const previewPort = new FakeResidentPreviewPort();
    const service = new ResidentProfileService(profilePort, previewPort);
    for (const session of [undefined, {}, { cookie: '   ' }] as Array<
      ResidentStaffSession | undefined
    >) {
      const error = await expectReject(
        () => service.resolve({ passToken: VALID_PASS, stationId: 'Piter' }, session),
        UnauthorizedException
      );
      assert.equal(error.getStatus(), 401);
      assert.equal(exceptionBody(error).code, 'RESIDENCY_AUTH_REQUIRED');
    }
    assert.equal(previewPort.calls.length, 0);
    assert.equal(profilePort.calls.length, 0);
  }

  /* -------------------- request validation -------------------- */
  for (const body of [
    undefined,
    {},
    { passToken: '', stationId: 'Piter' },
    { passToken: 'abc', stationId: 'Piter' },
    { passToken: VALID_PASS.slice(0, 20) + ' ' + VALID_PASS.slice(20), stationId: 'Piter' },
    { passToken: VALID_PASS, stationId: '' },
    { passToken: VALID_PASS, stationId: 'a' },
    { passToken: VALID_PASS, stationId: 'has space' },
    { passToken: VALID_PASS, stationId: 'Piter', subscriptionInstanceId: 'bad space' },
    { passToken: 42, stationId: 'Piter' }
  ]) {
    const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
    const previewPort = new FakeResidentPreviewPort();
    const service = new ResidentProfileService(profilePort, previewPort);
    const error = await expectReject(
      () => service.resolve(body as never, STAFF_SESSION),
      BadRequestException
    );
    assert.equal(error.getStatus(), 400);
    assert.equal(exceptionBody(error).code, 'RESIDENCY_REQUEST_INVALID');
    assert.equal(previewPort.calls.length, 0, 'invalid body never reaches D');
    assert.equal(profilePort.calls.length, 0);
    assertNoPiiInError(error, VALID_PASS);
  }

  /* -------------------- profile source degradation -------------------- */
  {
    const failing = new FakeResidentProfilePort(new Error('viva private detail'));
    const service = new ResidentProfileService(failing, new FakeResidentPreviewPort());
    const response = await service.resolve({ passToken: VALID_PASS, stationId: 'Piter' }, STAFF_SESSION);
    assert.deepEqual(response, {
      subscriptionInstanceId: INSTANCE_ID,
      fullName: 'Резидент',
      photoUrl: null
    });
    assert.doesNotMatch(JSON.stringify(response), /viva private detail/);
  }

  {
    const longName = new FakeResidentProfilePort({
      displayName: 'Ж'.repeat(300),
      avatarUrl: 'https://cdn.example/a.jpg'
    });
    const response = await new ResidentProfileService(longName, new FakeResidentPreviewPort()).resolve(
      { passToken: VALID_PASS, stationId: 'Piter' },
      STAFF_SESSION
    );
    assert.equal(response.fullName.length, 240);
    assert.equal(response.photoUrl, 'https://cdn.example/a.jpg');
  }

  {
    const unsafe = new FakeResidentProfilePort({
      displayName: 'Анна',
      avatarUrl: 'http://cdn.example/insecure.jpg'
    });
    const response = await new ResidentProfileService(unsafe, new FakeResidentPreviewPort()).resolve(
      { passToken: VALID_PASS, stationId: 'Piter' },
      STAFF_SESSION
    );
    assert.equal(response.photoUrl, null);
  }

  /* -------------------- disabled feature -------------------- */
  {
    process.env.RESIDENCY_CHECK_ENABLED = 'false';
    const profilePort = new FakeResidentProfilePort({ displayName: 'Анна' });
    const previewPort = new FakeResidentPreviewPort();
    const disabled = await expectReject(
      () =>
        new ResidentProfileService(profilePort, previewPort).resolve(
          { passToken: VALID_PASS, stationId: 'Piter' },
          STAFF_SESSION
        ),
      ServiceUnavailableException
    );
    assert.equal(disabled.getStatus(), 503);
    assert.equal(exceptionBody(disabled).code, 'RESIDENCY_CHECK_DISABLED');
    assert.equal(previewPort.calls.length, 0);
    assert.equal(profilePort.calls.length, 0);
    process.env.RESIDENCY_CHECK_ENABLED = 'true';
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
  assert.equal(
    Reflect.getMetadata(METHOD_METADATA, handler),
    RequestMethod.POST,
    'profile lookup must be a POST that carries the pass token in the body'
  );
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
  assert.deepEqual(
    routeArgs.map((argument) => argument.index).sort((left, right) => left - right),
    [0, 1, 2],
    'body, request and current user are bound'
  );

  /* -------------------- controller behaviour -------------------- */
  {
    const profilePort = new FakeResidentProfilePort({
      displayName: '  Анна Резидентова ',
      avatarUrl: 'https://cdn.example/a.jpg'
    });
    const previewPort = new FakeResidentPreviewPort();
    const controller = new ResidentProfileController(
      new ResidentProfileService(profilePort, previewPort)
    );
    const response = await controller.profile(
      { passToken: VALID_PASS, stationId: 'Piter', subscriptionInstanceId: INSTANCE_ID },
      createRequest({
        cookie: 'phab_admin_session=token-1',
        origin: 'https://padlhub.su'
      }),
      staffUser()
    );
    assert.deepEqual(response, {
      subscriptionInstanceId: INSTANCE_ID,
      fullName: 'Анна Резидентова',
      photoUrl: 'https://cdn.example/a.jpg'
    });
    assert.equal(previewPort.calls.length, 1);
    assert.equal(previewPort.calls[0].staffSession.cookie, 'phab_admin_session=token-1');
  }

  {
    // Bearer sessions are forwarded as authorization, not as a cookie.
    const previewPort = new FakeResidentPreviewPort();
    const controller = new ResidentProfileController(
      new ResidentProfileService(new FakeResidentProfilePort(), previewPort)
    );
    await controller.profile(
      { passToken: VALID_PASS, stationId: 'Piter' },
      createRequest({ authorization: 'Bearer staff-jwt' }),
      staffUser()
    );
    assert.deepEqual(previewPort.calls[0].staffSession, {
      authorization: 'Bearer staff-jwt'
    });
  }

  {
    // No authenticated staff user: 401 and nothing is read or forwarded.
    const previewPort = new FakeResidentPreviewPort();
    const controller = new ResidentProfileController(
      new ResidentProfileService(new FakeResidentProfilePort(), previewPort)
    );
    const error = await expectReject(
      () =>
        controller.profile(
          { passToken: VALID_PASS, stationId: 'Piter' },
          createRequest({ cookie: 'phab_admin_session=token-1' }),
          undefined
        ),
      UnauthorizedException
    );
    assert.equal(exceptionBody(error).code, 'RESIDENCY_AUTH_REQUIRED');
    assert.equal(previewPort.calls.length, 0);
    assertNoPiiInError(error, VALID_PASS);
  }

  {
    // Cross-site origin is refused before any upstream call (credentialed PII POST).
    const previewPort = new FakeResidentPreviewPort();
    const controller = new ResidentProfileController(
      new ResidentProfileService(new FakeResidentProfilePort(), previewPort)
    );
    const error = await expectReject(
      () =>
        controller.profile(
          { passToken: VALID_PASS, stationId: 'Piter' },
          createRequest({
            cookie: 'phab_admin_session=token-1',
            origin: 'https://evil.example'
          }),
          staffUser()
        ),
      ForbiddenException
    );
    assert.equal(exceptionBody(error).code, 'RESIDENCY_ORIGIN_FORBIDDEN');
    assert.equal(previewPort.calls.length, 0);
    assertNoPiiInError(error, VALID_PASS);

    // Missing Origin (curl / server-side caller) is allowed.
    const ok = await controller.profile(
      { passToken: VALID_PASS, stationId: 'Piter' },
      createRequest({ cookie: 'phab_admin_session=token-1' }),
      staffUser()
    );
    assert.equal(ok.subscriptionInstanceId, INSTANCE_ID);
  }

  {
    // Configurable trusted origin + production default.
    process.env.RESIDENCY_CHECK_ADMIN_ORIGINS = 'https://cup.example, not-a-url';
    assert.equal(trustedResidencyOrigins().has('https://cup.example'), true);
    assert.equal(trustedResidencyOrigins().has('https://padlhub.su'), false);
    process.env.NODE_ENV = 'production';
    assert.equal(trustedResidencyOrigins().has('http://localhost:3000'), false);
    delete process.env.NODE_ENV;
    delete process.env.RESIDENCY_CHECK_ADMIN_ORIGINS;
    assert.equal(trustedResidencyOrigins().has('https://padlhub.su'), true);
    assert.equal(trustedResidencyOrigins().has('http://localhost:3000'), true);
  }

  {
    // Forwarded credentials are taken from headers only and bounded.
    const previewPort = new FakeResidentPreviewPort();
    const controller = new ResidentProfileController(
      new ResidentProfileService(new FakeResidentProfilePort(), previewPort)
    );
    const error = await expectReject(
      () =>
        controller.profile(
          { passToken: VALID_PASS, stationId: 'Piter' },
          createRequest({ cookie: 'x'.repeat(9000) }),
          staffUser()
        ),
      UnauthorizedException
    );
    assert.equal(exceptionBody(error).code, 'RESIDENCY_AUTH_REQUIRED');
    assert.equal(previewPort.calls.length, 0);
  }

  if (previousNodeEnv !== undefined) process.env.NODE_ENV = previousNodeEnv;
  if (previousOrigins !== undefined) {
    process.env.RESIDENCY_CHECK_ADMIN_ORIGINS = previousOrigins;
  }
  process.env.RESIDENCY_CHECK_ENABLED = 'true';

  console.log(
    'Resident profile: pass-verified object authorization, PII-safe refusals, preview error mapping, ' +
      'origin guard, staff-session forwarding, name/photo fallbacks and controller metadata tests passed'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

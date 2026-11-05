import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { ROLES_KEY } from '../src/common/rbac/roles.decorator';
import { ResidentPassesInternalController } from '../src/resident-services/resident-passes.internal.controller';
import { ResidentServicesAdminController } from '../src/resident-services/resident-services.admin.controller';

const EXPECTED_PERMISSIONS: Record<string, string> = {
  previewPass: 'resident-services:issue',
  issue: 'resident-services:issue',
  returnItems: 'resident-services:return',
  issuance: 'resident-services:read',
  journal: 'resident-services:read',
  benefitRules: 'resident-services:read',
  createBenefitRule: 'resident-services:configure',
  updateBenefitRule: 'resident-services:configure'
};

function main(): void {
  process.env.RESIDENT_SERVICES_ADMIN_ORIGINS = 'https://padlhub.su';
  const controller = new ResidentServicesAdminController(
    null as never,
    null as never,
    null as never
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, ResidentServicesAdminController),
    'v1/admin/resident-services'
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, ResidentPassesInternalController),
    'internal/subscriptions/resident-passes'
  );
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, ResidentPassesInternalController),
    []
  );

  const internalPrototype = ResidentPassesInternalController.prototype as unknown as {
    status: (...args: unknown[]) => unknown;
  };
  assert.equal(typeof internalPrototype.status, 'function', 'internal status handler missing');
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, internalPrototype.status),
    ':passId',
    'internal pass status path mismatch'
  );
  assert.equal(
    Reflect.getMetadata(METHOD_METADATA, internalPrototype.status),
    RequestMethod.GET,
    'internal pass status must be a GET route'
  );
  assert.equal(
    Reflect.getMetadata(PERMISSIONS_KEY, internalPrototype.status),
    undefined,
    'internal pass status must not require a CUP staff permission'
  );

  const prototype = ResidentServicesAdminController.prototype as unknown as Record<
    string,
    unknown
  >;
  for (const [method, permission] of Object.entries(EXPECTED_PERMISSIONS)) {
    const handler = prototype[method] as (...args: unknown[]) => unknown;
    assert.equal(typeof handler, 'function', 'handler missing: ' + method);
    assert.deepEqual(
      Reflect.getMetadata(PERMISSIONS_KEY, handler),
      [permission],
      'handler permission mismatch: ' + method
    );
  }
  const publicHandlers = Object.getOwnPropertyNames(prototype).filter(
    (name) => name !== 'constructor'
      && typeof (prototype[name] as unknown) === 'function'
      && !name.startsWith('assert')
  );
  for (const name of publicHandlers) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(EXPECTED_PERMISSIONS, name),
      'unexpected admin handler without an explicit expectation: ' + name
    );
  }

  const originCheck = controller as unknown as {
    assertTrustedOrigin(request: { headers: Record<string, string> }): void;
  };
  assert.doesNotThrow(() => originCheck.assertTrustedOrigin({
    headers: { origin: 'https://padlhub.su' }
  }));
  assert.doesNotThrow(() => originCheck.assertTrustedOrigin({
    headers: { origin: 'https://evil.example', authorization: 'Bearer test' }
  }));
  try {
    originCheck.assertTrustedOrigin({ headers: { origin: 'https://evil.example' } });
    assert.fail('untrusted cookie origin must be rejected');
  } catch (error) {
    assert.ok(error instanceof ForbiddenException);
    assert.equal(
      (error.getResponse() as { code?: string }).code,
      'RESIDENT_SERVICES_UNTRUSTED_ORIGIN'
    );
  }
  console.log('resident-services-admin-controller: ok');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

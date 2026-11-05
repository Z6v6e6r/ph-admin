import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_PERMISSION_CATALOG } from '../src/common/rbac/permissions';

const RESIDENT_KEYS = [
  'resident-services:read',
  'resident-services:issue',
  'resident-services:return',
  'resident-services:configure'
];

function main(): void {
  const catalog = new Set<string>(ADMIN_PERMISSION_CATALOG.map((item) => String(item.key)));
  const panel = readFileSync(
    join(process.cwd(), 'client-sdk', 'phab-admin-panel.js'),
    'utf8'
  );
  for (const key of RESIDENT_KEYS) {
    assert.equal(catalog.has(key), true, 'permission catalog is missing ' + key);
    assert.equal(
      panel.includes("['" + key + "'"),
      true,
      'admin panel role editor is missing ' + key
    );
  }
  // Role editor saves only options listed in the panel; a missing key would be
  // silently stripped from a role on save.
  console.log('resident-services-permissions: ok');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
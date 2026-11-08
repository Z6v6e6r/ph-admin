/**
 * Staff who is not signed in scans a resident QR: the check page 302s to the
 * login page and the browser carries the #pass= fragment along. The login page
 * must drop the fragment from its own address bar, never send it anywhere, and
 * return staff to the same residency check (with the pass) after sign-in.
 * Runs the real rendered login script in a VM with a scripted fetch.
 */
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { Request, Response } from 'express';
import { AuthService } from '../src/auth/auth.service';
import { UiController } from '../src/ui/ui.controller';

const PASS_FRAGMENT = '#pass=rsp1_' + 'C'.repeat(43);

function renderLogin(next: string): string {
  const authService = { isEnabled: () => true } as unknown as AuthService;
  let html = '';
  const response = {
    setHeader() {
      return this;
    },
    send(payload: string) {
      html = payload;
      return this;
    },
    redirect() {
      return this;
    }
  } as unknown as Response;
  new UiController(authService).adminLogin({} as Request, response, { next });
  return html;
}

interface Outcome {
  href: string;
  addressAfterLoad: string;
  fetchBodies: string[];
  fetchUrls: string[];
}

async function runLogin(html: string, hash: string, loginOk = true): Promise<Outcome> {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0, 'login page has an inline script');
  const elements: Record<string, { value: string; disabled: boolean; textContent: string; className: string; listeners: Record<string, () => unknown>; addEventListener(type: string, fn: () => unknown): void }> = {};
  const element = () => ({
    value: '',
    disabled: false,
    textContent: '',
    className: '',
    listeners: {} as Record<string, () => unknown>,
    addEventListener(type: string, fn: () => unknown) {
      this.listeners[type] = fn;
    }
  });
  for (const id of ['login', 'password', 'submit', 'status']) elements[id] = element();
  elements.login.value = 'staff';
  elements.password.value = 'synthetic-password';
  const location = {
    hash,
    pathname: '/api/ui/admin/login',
    search: '?next=x',
    href: '/api/ui/admin/login?next=x' + hash
  };
  const fetchBodies: string[] = [];
  const fetchUrls: string[] = [];
  const window = {
    location,
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        location.hash = '';
        location.href = url;
      }
    },
    localStorage: { removeItem() {} }
  };
  const context = vm.createContext({
    window,
    document: { getElementById: (id: string) => elements[id] ?? null },
    fetch: async (url: string, init: { body?: string }) => {
      fetchUrls.push(url);
      fetchBodies.push(String(init?.body ?? ''));
      return { ok: loginOk, status: loginOk ? 200 : 401, text: async () => 'denied' };
    },
    JSON,
    String,
    Error
  });
  vm.runInContext(scripts[scripts.length - 1], context);
  const addressAfterLoad = location.href;
  await elements.submit.listeners.click();
  return { href: location.href, addressAfterLoad, fetchBodies, fetchUrls };
}

async function main(): Promise<void> {
  const checkPath = '/api/ui/admin/residency/check?stationId=station%3Aalpha';

  const returned = await runLogin(renderLogin(checkPath), PASS_FRAGMENT);
  assert.equal(returned.addressAfterLoad, '/api/ui/admin/login?next=x', 'fragment is removed from the login page URL');
  assert.equal(returned.href, checkPath + PASS_FRAGMENT, 'staff returns to the same pass after sign-in');
  assert.deepEqual(returned.fetchUrls, ['/api/auth/login']);
  assert.ok(returned.fetchBodies.every((body) => !body.includes('rsp1_')), 'the pass token is never sent to the server');

  const plainCheck = await runLogin(renderLogin('/api/ui/admin/residency/check'), PASS_FRAGMENT);
  assert.equal(plainCheck.href, '/api/ui/admin/residency/check' + PASS_FRAGMENT);

  const otherTarget = await runLogin(renderLogin('/api/ui/admin'), PASS_FRAGMENT);
  assert.equal(otherTarget.href, '/api/ui/admin', 'the pass is never forwarded to another admin page');

  const lookalike = await runLogin(renderLogin('/api/ui/admin/residency/check-other'), PASS_FRAGMENT);
  assert.equal(lookalike.href, '/api/ui/admin/residency/check-other', 'prefix lookalikes do not receive the pass');

  const foreignFragment = await runLogin(renderLogin(checkPath), '#section=reports');
  assert.equal(foreignFragment.addressAfterLoad, '/api/ui/admin/login?next=x#section=reports', 'other fragments are untouched');
  assert.equal(foreignFragment.href, checkPath, 'a non-pass fragment is not forwarded');

  const failed = await runLogin(renderLogin(checkPath), PASS_FRAGMENT, false);
  assert.equal(failed.href, '/api/ui/admin/login?next=x', 'failed sign-in neither navigates nor restores the token to the URL');

  console.log('residency-check-login-return: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

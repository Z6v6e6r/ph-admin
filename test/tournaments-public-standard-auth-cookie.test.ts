import * as assert from 'node:assert/strict';
import { Request } from 'express';
import { TournamentsPublicSessionService } from '../src/tournaments/tournaments-public-session.service';

function requestWith(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

async function main(): Promise<void> {
  const service = new TournamentsPublicSessionService();

  assert.equal(
    service.resolveLkAuthorizationHeader(requestWith({ authorization: 'Bearer header-token' })),
    'Bearer header-token'
  );
  assert.equal(
    service.resolveLkAuthorizationHeader(requestWith({
      cookie: 'unrelated=value; padlhubAuthToken=standard-lk-token'
    })),
    'Bearer standard-lk-token'
  );
  assert.equal(
    service.resolveLkAuthorizationHeader(requestWith({
      cookie: 'iSkq6GAuthToken=tenant-token; padlhubRefreshToken=must-not-be-used'
    })),
    'Bearer tenant-token'
  );
  assert.equal(
    service.resolveLkAuthorizationHeader(requestWith({
      cookie: 'padlhubRefreshToken=refresh-only; unrelated=value'
    })),
    undefined
  );

  console.log('Tournament public standard auth cookie test passed');
}

void main();

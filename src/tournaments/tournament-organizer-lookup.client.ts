import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createPrivateKey, randomUUID, sign, KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { object, uuid } from './tournament-local-operation.contract';

export type OrganizerLookupInput = { contractVersion: 1; requestId: string; assignmentOperationId: string; tournamentId: string; selectedUserId: string; expectedAssignmentRevision: number };
export type OrganizerProfileProof = { profile: { userId: string; displayName: string }; expiresAt: string; ownerTenantKey: string };
export type OrganizerLookupConfig = { tenantId: string; tenantKey: string; expectedOwnerTenantKey: string; enabled: boolean; origin?: string;
  issuer?: string; audience?: string; subject?: string; kid?: string; privateKey?: KeyObject };
const unavailable = () => new ServiceUnavailableException({ code: 'TOURNAMENT_ORGANIZER_LOOKUP_UNAVAILABLE' });
export function organizerLookupConfig(env: NodeJS.ProcessEnv): OrganizerLookupConfig {
  const tenantId = env.TOURNAMENT_ORGANIZER_LOOKUP_TENANT_ID ?? '', tenantKey = env.TOURNAMENT_ORGANIZER_LOOKUP_TENANT_KEY ?? '';
  const config: OrganizerLookupConfig = { tenantId, tenantKey, expectedOwnerTenantKey: env.LK_IDENTITY_EXPECTED_TENANT_KEY ?? '', enabled: env.TOURNAMENT_ORGANIZER_LOOKUP_ENABLED === 'true' };
  if (!config.enabled) return config;
  const origin = env.TOURNAMENT_ORGANIZER_LOOKUP_BASE_URL, file = env.TOURNAMENT_ORGANIZER_LOOKUP_PRIVATE_KEY_FILE;
  const issuer = env.TOURNAMENT_ORGANIZER_LOOKUP_ISSUER, audience = env.TOURNAMENT_ORGANIZER_LOOKUP_AUDIENCE,
    subject = env.TOURNAMENT_ORGANIZER_LOOKUP_SUBJECT, kid = env.TOURNAMENT_ORGANIZER_LOOKUP_KEY_ID;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(config.expectedOwnerTenantKey) || !uuid(tenantId) || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(tenantKey) || !origin || !file || !issuer || !audience || !subject || !kid
    || !/^[A-Za-z0-9_-]{1,64}$/.test(kid) || [issuer,audience,subject].some(x => x.length > 200)) throw unavailable();
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw unavailable();
  const bytes = readFileSync(file);
  if (bytes.length > 16384) throw unavailable();
  const privateKey = createPrivateKey(bytes);
  if (privateKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw unavailable();
  return { ...config, origin: url.origin, issuer, audience, subject, kid, privateKey };
}
export function organizerLookupBodyBytes(input: OrganizerLookupInput): string {
  return JSON.stringify({ contractVersion: 1, requestId: input.requestId, assignmentOperationId: input.assignmentOperationId,
    tournamentId: input.tournamentId, selectedUserId: input.selectedUserId, expectedAssignmentRevision: input.expectedAssignmentRevision });
}
@Injectable()
export class TournamentOrganizerLookupClient {
  readonly config: OrganizerLookupConfig;
  private failures = 0;
  private openedUntil = 0;
  readonly metrics = { success: 0, denied: 0, unavailable: 0 };
  constructor() { this.config = organizerLookupConfig(process.env); }
  async lookup(input: OrganizerLookupInput, correlationId: string): Promise<OrganizerProfileProof> {
    const c = this.config;
    if (!c.enabled || !c.privateKey || !c.origin || !c.kid || this.openedUntil > Date.now()) throw unavailable();
    const path = `/internal/api/v1/${c.tenantKey}/tournament-organizer-profile-lookups`;
    const now = Math.floor(Date.now() / 1000), exp = now + 30;
    const body = organizerLookupBodyBytes(input);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'phub-tournament-organizer-lookup+jwt', kid: c.kid })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ contract_version: 1, iss: c.issuer, aud: c.audience, sub: c.subject,
      scope: 'tournaments.organizer-profile.read', tenant_id: c.tenantId, tenant_key: c.tenantKey,
      method: 'POST', path, request_sha256: createHash('sha256').update(body).digest('hex'), correlation_id: correlationId,
      jti: randomUUID(), iat: now, nbf: now, exp })).toString('base64url');
    const token = `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), c.privateKey).toString('base64url')}`;
    let dependencyFailure = true;
    try {
      const response = await fetch(c.origin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-correlation-id': correlationId }, body });
      if ([400,401,403,404,409].includes(response.status)) { dependencyFailure = false; this.metrics.denied++; throw unavailable(); }
      if (!response.ok || !response.body) throw unavailable();
      const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
      try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length;
        if (bytes > 4096) throw unavailable(); chunks.push(next.value); } } finally { await reader.cancel(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!object(value) || Object.keys(value).sort().join(',') !== 'assignmentOperationId,checkedAt,contractVersion,expectedAssignmentRevision,expiresAt,ownerTenantKey,profile,requestId,selectedUserId,tenantId,tenantKey,tournamentId'
        || Object.entries(input).some(([key, val]) => value[key] !== val) || value.tenantId !== c.tenantId || value.tenantKey !== c.tenantKey || value.ownerTenantKey !== c.expectedOwnerTenantKey
        || !object(value.profile) || Object.keys(value.profile).sort().join(',') !== 'displayName,userId' || value.profile.userId !== input.selectedUserId
        || typeof value.profile.displayName !== 'string' || !value.profile.displayName || value.profile.displayName.length > 200
        || value.expiresAt !== new Date(exp * 1000).toISOString() || typeof value.checkedAt !== 'string'
        || !Number.isFinite(Date.parse(value.checkedAt)) || Date.parse(value.checkedAt) < now * 1000 || Date.parse(value.checkedAt) >= exp * 1000
        || Date.now() >= exp * 1000) throw unavailable();
      this.failures = 0; this.metrics.success++;
      return { profile: { userId: value.profile.userId, displayName: value.profile.displayName }, expiresAt: value.expiresAt, ownerTenantKey: value.ownerTenantKey };
    } catch {
      if (dependencyFailure) { this.metrics.unavailable++; if (++this.failures >= 3) this.openedUntil = Date.now() + 10000; }
      throw unavailable();
    }
  }
}

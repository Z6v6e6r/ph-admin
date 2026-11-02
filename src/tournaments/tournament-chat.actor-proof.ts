import { Injectable } from '@nestjs/common';
import { createHash, createPublicKey, KeyObject, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { uuid, object } from './tournament-local-operation.contract';
import { ChatActor, denied, keys, unavailable } from './tournament-chat.contract';

export type ChatProofConfig = { enabled: boolean; tenantId: string; tenantKey: string; ownerTenantKey: string;
  issuer?: string; kid?: string; publicKey?: KeyObject };
export function chatProofConfig(env: NodeJS.ProcessEnv): ChatProofConfig {
  const c: ChatProofConfig = { enabled: env.TOURNAMENT_CHAT_ENABLED === 'true', tenantId: env.TOURNAMENT_CHAT_TENANT_ID ?? '',
    tenantKey: env.TOURNAMENT_CHAT_TENANT_KEY ?? '', ownerTenantKey: env.LK_IDENTITY_EXPECTED_TENANT_KEY ?? '' };
  if (!c.enabled) return c;
  const file = env.TOURNAMENT_CHAT_ACTOR_PUBLIC_KEY_FILE, issuer = env.TOURNAMENT_CHAT_ACTOR_ISSUER, kid = env.TOURNAMENT_CHAT_ACTOR_KEY_ID;
  if (!uuid(c.tenantId) || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(c.tenantKey) || !/^[A-Za-z0-9_-]{1,200}$/.test(c.ownerTenantKey)
    || !file || !issuer || issuer.length > 200 || !kid || !/^[A-Za-z0-9_-]{1,64}$/.test(kid)) throw unavailable();
  const bytes = readFileSync(file); if (bytes.length > 16384) throw unavailable();
  const publicKey = createPublicKey(bytes);
  if (publicKey.asymmetricKeyType !== 'rsa' || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw unavailable();
  return { ...c, issuer, kid, publicKey };
}
@Injectable()
export class TournamentChatActorProof {
  readonly config: ChatProofConfig;
  constructor() { this.config = chatProofConfig(process.env); }
  verify(authorization: unknown, path: string, body: string, correlationId: unknown, now = Date.now()): ChatActor {
    const c = this.config;
    if (!c.enabled || !c.publicKey) throw unavailable();
    try {
      if (typeof authorization !== 'string' || authorization.length > 8192 || !authorization.startsWith('Bearer ') || !uuid(correlationId)) throw denied();
      const parts = authorization.slice(7).split('.');
      if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw denied();
      const decode = (s: string) => { const b = Buffer.from(s, 'base64url'); if (b.toString('base64url') !== s) throw denied(); return JSON.parse(b.toString('utf8')); };
      const h = decode(parts[0]), p = decode(parts[1]);
      if (!object(h) || !keys(h, 'alg,kid,typ') || h.alg !== 'RS256' || h.typ !== 'phub-tournament-chat-actor+jwt' || h.kid !== c.kid
        || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), c.publicKey, Buffer.from(parts[2], 'base64url'))) throw denied();
      if (!object(p) || !keys(p, 'aud,contract_version,correlation_id,exp,iat,iss,jti,method,nbf,owner_tenant_key,path,provider_client_id,request_sha256,scope,session_id,sub,tenant_id,tenant_key')
        || p.contract_version !== 1 || p.iss !== c.issuer || p.aud !== 'cup-tournament-chat-v1' || p.scope !== 'tournaments.chat.actor'
        || p.tenant_id !== c.tenantId || p.tenant_key !== c.tenantKey || p.owner_tenant_key !== c.ownerTenantKey
        || !uuid(p.sub) || !uuid(p.session_id) || !uuid(p.jti) || p.correlation_id !== correlationId
        || typeof p.provider_client_id !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(p.provider_client_id)
        || p.method !== 'POST' || p.path !== path || p.request_sha256 !== createHash('sha256').update(body).digest('hex')
        || !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) || p.nbf !== p.iat
        || p.exp <= p.iat || p.exp - p.iat > 30 || p.iat * 1000 > now || p.exp * 1000 <= now) throw denied();
      return { tenantId: p.tenant_id, tenantKey: p.tenant_key, ownerTenantKey: p.owner_tenant_key, providerClientId: p.provider_client_id,
        userId: p.sub, sessionId: p.session_id, expiresAt: p.exp * 1000, correlationId };
    } catch { throw denied(); }
  }
}

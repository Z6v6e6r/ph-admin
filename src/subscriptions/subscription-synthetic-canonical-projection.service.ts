import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Injectable } from '@nestjs/common';
import {
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionCanonicalTargetSnapshot
} from './subscription-runtime-contracts';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionCanonicalTargetSnapshot,
  SubscriptionAction
} from './subscriptions.types';

const REQUIRED_KEYS = new Set([
  'schemaVersion',
  'sourceMode',
  'tenantId',
  'targetId',
  'action',
  'state',
  'revision',
  'stationId',
  'category',
  'externalEventTypeId',
  'productTypeId',
  'durationMinutes',
  'startsAt',
  'basePriceMinor',
  'currency',
  'dictionaryRevision',
  'evidenceRef',
  'priceEvidenceRef',
  'observedAt',
  'expiresAt'
]);

const SYNTHETIC_DATABASE_PATTERN =
  /^phab_subscriptions_(dev|test)_gate_d_synthetic_[A-Za-z0-9_-]+$/;

export interface SyntheticCanonicalProjectionResult {
  status: 'INSERTED' | 'REPLAY';
  snapshotId: string;
  tenantId: string;
  targetId: string;
  action: SubscriptionAction;
  revision: number;
}

const fail = (code: string): never => {
  throw new SubscriptionRuntimeContractError(code);
};

const flag = (name: string): boolean => ['1', 'true', 'yes'].includes(
  String(process.env[name] ?? '').trim().toLowerCase()
);

const requirePrefix = (value: unknown, prefix: string, code: string): void => {
  if (typeof value !== 'string' || !value.startsWith(prefix)) fail(code);
};

const canonicalInput = (value: Record<string, unknown>): string => JSON.stringify({
  tenantId: value.tenantId,
  targetId: value.targetId,
  action: value.action,
  revision: value.revision
});

export function syntheticProjectionTargetFingerprint(): string {
  const uri = String(process.env.SUBSCRIPTIONS_MONGODB_URI ?? '').trim();
  const database = String(process.env.SUBSCRIPTIONS_MONGODB_DB ?? '').trim();
  if (!uri) fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_EXPLICIT_URI_REQUIRED');
  if (!SYNTHETIC_DATABASE_PATTERN.test(database)) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_DEV_DATABASE_REQUIRED');
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_URI_INVALID');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (parsed.protocol !== 'mongodb:'
    || !['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_LOOPBACK_URI_REQUIRED');
  }
  const uriDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (uriDatabase && uriDatabase !== database) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_URI_DATABASE_MISMATCH');
  }
  const targetDescriptor = `${hostname}:${parsed.port || '27017'}\u0000${database}`;
  return `sha256:${createHash('sha256')
    .update(targetDescriptor, 'utf8')
    .digest('hex')}`;
}

export function assertSyntheticProjectionApplyBoundary(): void {
  if (!flag('SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED')) {
    fail('SUBSCRIPTIONS_RUNTIME_CONTRACTS_DISABLED');
  }
  if (!flag('SUBSCRIPTIONS_SYNTHETIC_CANONICAL_PROJECTION_ENABLED')) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_DISABLED');
  }
  if (process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_APPLY !== 'CONFIRM') {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_CONFIRM_REQUIRED');
  }
  const nodeEnv = String(process.env.NODE_ENV ?? '').trim().toLowerCase();
  if (!['development', 'test'].includes(nodeEnv)) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_DEV_ENVIRONMENT_REQUIRED');
  }
  const expectedTarget = String(
    process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_SHA256 ?? ''
  ).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedTarget)) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_ATTESTATION_REQUIRED');
  }
  if (expectedTarget !== syntheticProjectionTargetFingerprint()) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_ATTESTATION_MISMATCH');
  }
  const autoCreate = String(process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES ?? '')
    .trim()
    .toLowerCase();
  if (!['0', 'false', 'no'].includes(autoCreate)) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_AUTO_INDEX_FALSE_REQUIRED');
  }
}

export function buildSyntheticCanonicalTargetSnapshot(
  input: unknown
): StoredSubscriptionCanonicalTargetSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_INPUT_INVALID');
  }
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length !== REQUIRED_KEYS.size
    || keys.some((key) => !REQUIRED_KEYS.has(key))
    || [...REQUIRED_KEYS].some((key) => !(key in value))) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_INPUT_SHAPE_INVALID');
  }
  if (value.schemaVersion !== 1 || value.sourceMode !== 'SYNTHETIC_FIXTURE') {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_SOURCE_INVALID');
  }
  requirePrefix(value.targetId, 'synthetic:', 'SUBSCRIPTIONS_SYNTHETIC_TARGET_REQUIRED');
  requirePrefix(
    value.externalEventTypeId,
    'synthetic_event_type:',
    'SUBSCRIPTIONS_SYNTHETIC_EVENT_TYPE_REQUIRED'
  );
  if (value.productTypeId !== null) {
    requirePrefix(
      value.productTypeId,
      'synthetic_product_type:',
      'SUBSCRIPTIONS_SYNTHETIC_PRODUCT_TYPE_REQUIRED'
    );
  }
  requirePrefix(
    value.dictionaryRevision,
    'synthetic_dictionary:',
    'SUBSCRIPTIONS_SYNTHETIC_DICTIONARY_REQUIRED'
  );
  requirePrefix(
    value.evidenceRef,
    'synthetic_evidence:',
    'SUBSCRIPTIONS_SYNTHETIC_EVIDENCE_REQUIRED'
  );
  requirePrefix(
    value.priceEvidenceRef,
    'synthetic_price_evidence:',
    'SUBSCRIPTIONS_SYNTHETIC_PRICE_EVIDENCE_REQUIRED'
  );

  const observedAt = typeof value.observedAt === 'string'
    ? Date.parse(value.observedAt)
    : Number.NaN;
  const expiresAt = typeof value.expiresAt === 'string'
    ? Date.parse(value.expiresAt)
    : Number.NaN;
  if (!Number.isFinite(observedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= observedAt
    || expiresAt - observedAt > 3_600_000) {
    fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_FRESHNESS_INVALID');
  }

  const snapshot: StoredSubscriptionCanonicalTargetSnapshot = {
    schemaVersion: 1,
    snapshotId: `synthetic_target_snapshot:${createHash('sha256')
      .update(canonicalInput(value))
      .digest('hex')}`,
    tenantId: value.tenantId as string,
    targetId: value.targetId as string,
    action: value.action as StoredSubscriptionCanonicalTargetSnapshot['action'],
    state: value.state as StoredSubscriptionCanonicalTargetSnapshot['state'],
    revision: value.revision as number,
    stationId: value.stationId as string,
    category: value.category as StoredSubscriptionCanonicalTargetSnapshot['category'],
    externalEventTypeId: value.externalEventTypeId as string,
    productTypeId: value.productTypeId as string | null,
    durationMinutes: value.durationMinutes as number,
    startsAt: value.startsAt as string,
    basePriceMinor: value.basePriceMinor as number,
    currency: value.currency as 'RUB',
    dictionaryRevision: value.dictionaryRevision as string,
    evidenceRef: value.evidenceRef as string,
    priceEvidenceRef: value.priceEvidenceRef as string,
    sourceKind: 'CANONICAL_TARGET_PROJECTION',
    observedAt: value.observedAt as string,
    expiresAt: value.expiresAt as string,
    createdAt: value.observedAt as string
  };
  validateStoredSubscriptionCanonicalTargetSnapshot(snapshot);
  return snapshot;
}

@Injectable()
export class SubscriptionSyntheticCanonicalProjectionService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async apply(input: unknown): Promise<SyntheticCanonicalProjectionResult> {
    assertSyntheticProjectionApplyBoundary();
    const snapshot = buildSyntheticCanonicalTargetSnapshot(input);
    this.assertFixtureScope(snapshot);
    await this.repository.connect();
    const lookup = {
      tenantId: snapshot.tenantId,
      targetId: snapshot.targetId,
      action: snapshot.action,
      revision: snapshot.revision
    };
    const existing = await this.repository.runtimeCanonicalTargetSnapshot(lookup);
    if (existing) return this.replayOrConflict(existing, snapshot);

    const latest = await this.repository.runtimeLatestCanonicalTargetSnapshot({
      tenantId: snapshot.tenantId,
      targetId: snapshot.targetId,
      action: snapshot.action
    });
    if (!latest && snapshot.state === 'REVOKED') {
      fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_REVOKE_TARGET_REQUIRED');
    }
    if (!latest && snapshot.revision !== 1) {
      fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_REVISION_NOT_MONOTONIC');
    }
    if (latest) {
      if (latest.state === 'REVOKED') {
        fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_REACTIVATION_FORBIDDEN');
      }
      if (snapshot.revision !== latest.revision + 1) {
        fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_REVISION_NOT_MONOTONIC');
      }
    }

    try {
      await this.repository.insertRuntimeCanonicalTargetSnapshot(snapshot);
      return this.result('INSERTED', snapshot);
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
      const raced = await this.repository.runtimeCanonicalTargetSnapshot(lookup);
      if (!raced) return fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_RACE_UNRESOLVED');
      return this.replayOrConflict(raced, snapshot);
    }
  }

  private assertFixtureScope(snapshot: StoredSubscriptionCanonicalTargetSnapshot): void {
    const tenantId = String(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID ?? '').trim();
    if (!tenantId || tenantId !== snapshot.tenantId) {
      fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TENANT_MISMATCH');
    }
    const stationIds = String(
      process.env.SUBSCRIPTIONS_SYNTHETIC_CANONICAL_STATION_IDS ?? ''
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (stationIds.length === 0 || !stationIds.includes(snapshot.stationId)) {
      fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_STATION_FORBIDDEN');
    }
    const maxStalenessSeconds = Number(
      process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS
    );
    if (!Number.isSafeInteger(maxStalenessSeconds)
      || maxStalenessSeconds < 30
      || maxStalenessSeconds > 3600) {
      fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_STALENESS_CONFIG_INVALID');
    }
    const now = this.now().getTime();
    const observedAt = Date.parse(snapshot.observedAt);
    const expiresAt = Date.parse(snapshot.expiresAt);
    if (observedAt > now
      || now - observedAt > maxStalenessSeconds * 1000
      || expiresAt <= now) {
      fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_NOT_CURRENT');
    }
  }

  protected now(): Date {
    return new Date();
  }

  private replayOrConflict(
    existing: StoredSubscriptionCanonicalTargetSnapshot,
    candidate: StoredSubscriptionCanonicalTargetSnapshot
  ): SyntheticCanonicalProjectionResult {
    if (!isDeepStrictEqual(existing, candidate)) {
      fail('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_IMMUTABLE_CONFLICT');
    }
    return this.result('REPLAY', candidate);
  }

  private result(
    status: SyntheticCanonicalProjectionResult['status'],
    snapshot: StoredSubscriptionCanonicalTargetSnapshot
  ): SyntheticCanonicalProjectionResult {
    return {
      status,
      snapshotId: snapshot.snapshotId,
      tenantId: snapshot.tenantId,
      targetId: snapshot.targetId,
      action: snapshot.action,
      revision: snapshot.revision
    };
  }
}

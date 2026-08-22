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
  'evidenceStatus',
  'approvalRef',
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
  'priceUnit',
  'priceRounding',
  'dictionaryRevision',
  'evidenceRef',
  'priceEvidenceRef',
  'observedAt',
  'expiresAt'
]);

const PROVIDER_EVIDENCE_PATTERN = /^provider_evidence:sha256:[a-f0-9]{64}$/;
const PROVIDER_PRICE_EVIDENCE_PATTERN = /^provider_price_evidence:sha256:[a-f0-9]{64}$/;
const PROVIDER_DICTIONARY_PATTERN = /^provider_dictionary:sha256:[a-f0-9]{64}$/;
const PROVIDER_APPROVAL_PATTERN = /^provider_approval:sha256:[a-f0-9]{64}$/;
const PROVIDER_EVENT_TYPE_PATTERN = /^viva:direction:[A-Za-z0-9._:-]+:type:[A-Za-z0-9._:-]+$/;

interface ParsedProviderProjectionInput {
  approvalRef: string;
  inputSha256: string;
  snapshot: StoredSubscriptionCanonicalTargetSnapshot;
}

export interface ProviderCanonicalProjectionResult {
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

const requirePattern = (value: unknown, pattern: RegExp, code: string): string => {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code);
  return value as string;
};

const canonicalIdentity = (value: Record<string, unknown>): string => JSON.stringify({
  tenantId: value.tenantId,
  targetId: value.targetId,
  action: value.action,
  revision: value.revision
});

const canonicalEvidenceInput = (value: Record<string, unknown>): string => JSON.stringify({
  schemaVersion: value.schemaVersion,
  sourceMode: value.sourceMode,
  evidenceStatus: value.evidenceStatus,
  approvalRef: value.approvalRef,
  tenantId: value.tenantId,
  targetId: value.targetId,
  action: value.action,
  state: value.state,
  revision: value.revision,
  stationId: value.stationId,
  category: value.category,
  externalEventTypeId: value.externalEventTypeId,
  productTypeId: value.productTypeId,
  durationMinutes: value.durationMinutes,
  startsAt: value.startsAt,
  basePriceMinor: value.basePriceMinor,
  currency: value.currency,
  priceUnit: value.priceUnit,
  priceRounding: value.priceRounding,
  dictionaryRevision: value.dictionaryRevision,
  evidenceRef: value.evidenceRef,
  priceEvidenceRef: value.priceEvidenceRef,
  observedAt: value.observedAt,
  expiresAt: value.expiresAt
});

const parseProviderProjectionInput = (input: unknown): ParsedProviderProjectionInput => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_INPUT_INVALID');
  }
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length !== REQUIRED_KEYS.size
    || keys.some((key) => !REQUIRED_KEYS.has(key))
    || [...REQUIRED_KEYS].some((key) => !(key in value))) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_INPUT_SHAPE_INVALID');
  }
  if (value.schemaVersion !== 1 || value.sourceMode !== 'REVIEWED_PROVIDER_EVIDENCE') {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_SOURCE_INVALID');
  }
  if (value.evidenceStatus !== 'APPROVED') {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_EVIDENCE_NOT_APPROVED');
  }
  const approvalRef = requirePattern(
    value.approvalRef,
    PROVIDER_APPROVAL_PATTERN,
    'SUBSCRIPTIONS_PROVIDER_PROJECTION_APPROVAL_REF_INVALID'
  );
  requirePattern(
    value.dictionaryRevision,
    PROVIDER_DICTIONARY_PATTERN,
    'SUBSCRIPTIONS_PROVIDER_PROJECTION_DICTIONARY_EVIDENCE_REQUIRED'
  );
  requirePattern(
    value.evidenceRef,
    PROVIDER_EVIDENCE_PATTERN,
    'SUBSCRIPTIONS_PROVIDER_PROJECTION_TARGET_EVIDENCE_REQUIRED'
  );
  requirePattern(
    value.priceEvidenceRef,
    PROVIDER_PRICE_EVIDENCE_PATTERN,
    'SUBSCRIPTIONS_PROVIDER_PROJECTION_PRICE_EVIDENCE_REQUIRED'
  );
  requirePattern(
    value.externalEventTypeId,
    PROVIDER_EVENT_TYPE_PATTERN,
    'SUBSCRIPTIONS_PROVIDER_PROJECTION_EVENT_TYPE_INVALID'
  );
  if (value.priceUnit !== 'RUB_MINOR' || value.priceRounding !== 'EXACT_INTEGER') {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_PRICE_UNIT_UNVERIFIED');
  }
  const targetPrefix = value.action === 'PURCHASE_ADD_ON_PRODUCT'
    ? 'viva:product:'
    : 'viva:exercise:';
  if (typeof value.targetId !== 'string' || !value.targetId.startsWith(targetPrefix)) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_TARGET_ID_INVALID');
  }
  if (value.action !== 'PURCHASE_ADD_ON_PRODUCT' && value.productTypeId !== null) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_NON_ADD_ON_PRODUCT_TYPE_FORBIDDEN');
  }
  if (value.action === 'PURCHASE_ADD_ON_PRODUCT'
    && (typeof value.productTypeId !== 'string'
      || !value.productTypeId.startsWith('viva:product:'))) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_PRODUCT_TYPE_INVALID');
  }
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
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_FRESHNESS_INVALID');
  }

  const snapshot: StoredSubscriptionCanonicalTargetSnapshot = {
    schemaVersion: 1,
    snapshotId: `provider_target_snapshot:${createHash('sha256')
      .update(canonicalIdentity(value))
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
  return {
    approvalRef,
    inputSha256: `sha256:${createHash('sha256')
      .update(canonicalEvidenceInput(value))
      .digest('hex')}`,
    snapshot
  };
};

export function buildProviderCanonicalTargetSnapshot(
  input: unknown
): StoredSubscriptionCanonicalTargetSnapshot {
  return parseProviderProjectionInput(input).snapshot;
}

export function providerProjectionInputFingerprint(input: unknown): string {
  return parseProviderProjectionInput(input).inputSha256;
}

export function assertProviderProjectionApplyBoundary(input: unknown): void {
  const parsed = parseProviderProjectionInput(input);
  if (!flag('SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED')) {
    fail('SUBSCRIPTIONS_RUNTIME_CONTRACTS_DISABLED');
  }
  if (!flag('SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_ENABLED')) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_DISABLED');
  }
  if (process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_APPLY !== 'CONFIRM') {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_CONFIRM_REQUIRED');
  }
  if (String(process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_INPUT_SHA256 ?? '').trim()
    !== parsed.inputSha256) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_INPUT_ATTESTATION_MISMATCH');
  }
  if (String(process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_APPROVAL_REF ?? '').trim()
    !== parsed.approvalRef) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_APPROVAL_ATTESTATION_MISMATCH');
  }
  const autoCreate = String(process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES ?? '')
    .trim()
    .toLowerCase();
  if (!['0', 'false', 'no'].includes(autoCreate)) {
    fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_AUTO_INDEX_FALSE_REQUIRED');
  }
}

@Injectable()
export class SubscriptionProviderCanonicalProjectionService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async apply(input: unknown): Promise<ProviderCanonicalProjectionResult> {
    assertProviderProjectionApplyBoundary(input);
    const snapshot = buildProviderCanonicalTargetSnapshot(input);
    this.assertProjectionScope(snapshot);
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
      fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_REVOKE_TARGET_REQUIRED');
    }
    if (!latest && snapshot.revision !== 1) {
      fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_REVISION_NOT_MONOTONIC');
    }
    if (latest) {
      if (latest.state === 'REVOKED') {
        fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_REACTIVATION_FORBIDDEN');
      }
      if (snapshot.revision !== latest.revision + 1) {
        fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_REVISION_NOT_MONOTONIC');
      }
    }

    try {
      await this.repository.insertRuntimeCanonicalTargetSnapshot(snapshot);
      return this.result('INSERTED', snapshot);
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
      const raced = await this.repository.runtimeCanonicalTargetSnapshot(lookup);
      if (!raced) return fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_RACE_UNRESOLVED');
      return this.replayOrConflict(raced, snapshot);
    }
  }

  protected now(): Date {
    return new Date();
  }

  private assertProjectionScope(snapshot: StoredSubscriptionCanonicalTargetSnapshot): void {
    const tenantId = String(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID ?? '').trim();
    if (!tenantId || tenantId !== snapshot.tenantId) {
      fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_TENANT_MISMATCH');
    }
    const stationIds = String(process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_STATION_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (stationIds.length === 0 || !stationIds.includes(snapshot.stationId)) {
      fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_STATION_FORBIDDEN');
    }
    const maxStalenessSeconds = Number(
      process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS
    );
    if (!Number.isSafeInteger(maxStalenessSeconds)
      || maxStalenessSeconds < 30
      || maxStalenessSeconds > 3600) {
      fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_STALENESS_CONFIG_INVALID');
    }
    const now = this.now().getTime();
    const observedAt = Date.parse(snapshot.observedAt);
    const expiresAt = Date.parse(snapshot.expiresAt);
    if (observedAt > now
      || now - observedAt > maxStalenessSeconds * 1000
      || expiresAt <= now) {
      fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_NOT_CURRENT');
    }
  }

  private replayOrConflict(
    existing: StoredSubscriptionCanonicalTargetSnapshot,
    candidate: StoredSubscriptionCanonicalTargetSnapshot
  ): ProviderCanonicalProjectionResult {
    if (!isDeepStrictEqual(existing, candidate)) {
      fail('SUBSCRIPTIONS_PROVIDER_PROJECTION_IMMUTABLE_CONFLICT');
    }
    return this.result('REPLAY', candidate);
  }

  private result(
    status: ProviderCanonicalProjectionResult['status'],
    snapshot: StoredSubscriptionCanonicalTargetSnapshot
  ): ProviderCanonicalProjectionResult {
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

import { createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { validateStoredSubscriptionCanonicalTargetSnapshot } from './subscription-runtime-contracts';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionCanonicalTargetSnapshot,
  SubscriptionAction
} from './subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const ACTIONS = [
  'CREATE_GAME',
  'JOIN_GAME',
  'BOOK_GROUP_TRAINING',
  'BOOK_TOURNAMENT',
  'PURCHASE_ADD_ON_PRODUCT'
] as const;
const CATEGORIES = ['GAME', 'GROUP_TRAINING', 'TOURNAMENT', 'ADD_ON_PRODUCT'] as const;
const ACTION_CATEGORY: Record<SubscriptionAction, (typeof CATEGORIES)[number]> = {
  CREATE_GAME: 'GAME',
  JOIN_GAME: 'GAME',
  BOOK_GROUP_TRAINING: 'GROUP_TRAINING',
  BOOK_TOURNAMENT: 'TOURNAMENT',
  PURCHASE_ADD_ON_PRODUCT: 'ADD_ON_PRODUCT'
};

export interface CanonicalTargetIntakeBody {
  readonly targetId: string;
  readonly action: SubscriptionAction;
  readonly revision: number;
  readonly state: 'ACTIVE' | 'REVOKED';
  readonly stationId: string;
  readonly category: (typeof CATEGORIES)[number];
  readonly externalEventTypeId: string;
  readonly productTypeId: string | null;
  readonly durationMinutes: number;
  readonly startsAt: string;
  readonly basePriceMinor: number;
  readonly currency: 'RUB';
  readonly dictionaryRevision: string;
  readonly evidenceRef: string;
  readonly priceEvidenceRef: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export class CanonicalTargetIntakeError extends Error {
  public constructor(
    public readonly status: 400 | 403 | 409 | 503,
    public readonly code: string
  ) {
    super(code);
    this.name = 'CanonicalTargetIntakeError';
  }
}

export interface CanonicalTargetIntakeResult {
  readonly snapshotId: string;
  readonly targetId: string;
  readonly action: SubscriptionAction;
  readonly revision: number;
  readonly replay: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function instant(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function parseCanonicalTargetIntakeBody(value: unknown): CanonicalTargetIntakeBody {
  if (!record(value)) throw new CanonicalTargetIntakeError(400, 'CANONICAL_TARGET_BODY_INVALID');
  const keys = Object.keys(value);
  const expected = [
    'targetId', 'action', 'revision', 'state', 'stationId', 'category',
    'externalEventTypeId', 'productTypeId', 'durationMinutes', 'startsAt',
    'basePriceMinor', 'currency', 'dictionaryRevision', 'evidenceRef',
    'priceEvidenceRef', 'observedAt', 'expiresAt'
  ];
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new CanonicalTargetIntakeError(400, 'CANONICAL_TARGET_BODY_INVALID');
  }
  if (
    !identifier(value.targetId) ||
    !ACTIONS.includes(value.action as SubscriptionAction) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    (value.state !== 'ACTIVE' && value.state !== 'REVOKED') ||
    !identifier(value.stationId) ||
    !CATEGORIES.includes(value.category as (typeof CATEGORIES)[number]) ||
    ACTION_CATEGORY[value.action as SubscriptionAction] !== value.category ||
    !identifier(value.externalEventTypeId) ||
    !(value.productTypeId === null || identifier(value.productTypeId)) ||
    !Number.isSafeInteger(value.durationMinutes) ||
    Number(value.durationMinutes) < 1 ||
    Number(value.durationMinutes) > 1440 ||
    !instant(value.startsAt) ||
    !Number.isSafeInteger(value.basePriceMinor) ||
    Number(value.basePriceMinor) < 0 ||
    value.currency !== 'RUB' ||
    !identifier(value.dictionaryRevision) ||
    !identifier(value.evidenceRef) ||
    !identifier(value.priceEvidenceRef) ||
    !instant(value.observedAt) ||
    !instant(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.observedAt)
  ) {
    throw new CanonicalTargetIntakeError(400, 'CANONICAL_TARGET_BODY_INVALID');
  }
  return value as unknown as CanonicalTargetIntakeBody;
}

/**
 * Server-to-server intake of an authoritative canonical target snapshot for LK2 activities.
 *
 * The caller supplies already-resolved facts (station, duration, start, confirmed base price and
 * evidence references); CUP validates the shape, binds it to the configured runtime tenant and
 * stores it idempotently by `(targetId, action, revision)`. Reusing a revision with different facts
 * is a conflict, never a silent overwrite. No evaluation or booking mutation happens here.
 */
@Injectable()
export class CanonicalTargetIntakeService {
  public constructor(private readonly repository: SubscriptionsRepository) {}

  public async ingest(
    integrationToken: string | undefined,
    body: unknown,
    options: { readonly now?: () => Date } = {}
  ): Promise<CanonicalTargetIntakeResult> {
    this.assertEnabledAndConfigured();
    this.assertIntegrationToken(integrationToken);
    const tenantId = this.runtimeTenantId();
    const target = parseCanonicalTargetIntakeBody(body);
    const createdAt = (options.now?.() ?? new Date()).toISOString();
    const snapshot: StoredSubscriptionCanonicalTargetSnapshot = {
      schemaVersion: 1,
      snapshotId: snapshotIdFor(tenantId, target),
      tenantId,
      targetId: target.targetId,
      action: target.action,
      state: target.state,
      revision: target.revision,
      stationId: target.stationId,
      category: target.category,
      externalEventTypeId: target.externalEventTypeId,
      productTypeId: target.productTypeId,
      durationMinutes: target.durationMinutes,
      startsAt: target.startsAt,
      basePriceMinor: target.basePriceMinor,
      currency: 'RUB',
      dictionaryRevision: target.dictionaryRevision,
      evidenceRef: target.evidenceRef,
      priceEvidenceRef: target.priceEvidenceRef,
      sourceKind: 'CANONICAL_TARGET_PROJECTION',
      observedAt: target.observedAt,
      expiresAt: target.expiresAt,
      createdAt
    };
    validateStoredSubscriptionCanonicalTargetSnapshot(snapshot);
    await this.repository.connect();
    try {
      await this.repository.insertRuntimeCanonicalTargetSnapshot(snapshot);
      return { ...identity(target), snapshotId: snapshot.snapshotId, replay: false };
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
    }
    const existing = await this.repository.runtimeCanonicalTargetSnapshot({
      tenantId,
      targetId: target.targetId,
      action: target.action,
      revision: target.revision
    });
    if (!existing) {
      // The unique index and the document disagree: fail closed instead of overwriting.
      throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_INTAKE_CONFLICT');
    }
    const comparable = { ...existing, createdAt: snapshot.createdAt };
    if (!isDeepStrictEqual(comparable, snapshot)) {
      throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_INTAKE_CONFLICT');
    }
    return { ...identity(target), snapshotId: existing.snapshotId, replay: true };
  }

  private runtimeTenantId(): string {
    const tenantId = String(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenantId)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_TENANT_ID_INVALID',
        message: 'Subscription runtime tenant is not configured'
      });
    }
    return tenantId;
  }

  private assertEnabledAndConfigured(): void {
    if (!['1', 'true', 'yes'].includes(
      String(process.env.SUBSCRIPTIONS_TARGET_INGEST_ENABLED ?? '').trim().toLowerCase()
    )) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_TARGET_INGEST_DISABLED',
        message: 'Canonical target intake is disabled'
      });
    }
  }

  private assertIntegrationToken(supplied: string | undefined): void {
    const expected = String(
      process.env.SUBSCRIPTIONS_TARGET_INGEST_INTEGRATION_TOKEN ?? ''
    ).trim();
    if (Buffer.byteLength(expected, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_TARGET_INGEST_NOT_CONFIGURED',
        message: 'Canonical target intake is not configured'
      });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(String(supplied ?? '').trim());
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw new CanonicalTargetIntakeError(403, 'SUBSCRIPTIONS_TARGET_INGEST_FORBIDDEN');
    }
  }
}

function identity(target: CanonicalTargetIntakeBody) {
  return {
    targetId: target.targetId,
    action: target.action,
    revision: target.revision
  };
}

function snapshotIdFor(tenantId: string, target: CanonicalTargetIntakeBody): string {
  const digest = createHash('sha256')
    .update(`canonical-target:v1\0${tenantId}\0${target.targetId}\0${target.action}\0${target.revision}`)
    .digest('hex')
    .slice(0, 48);
  return `canonical_target:${digest}`;
}

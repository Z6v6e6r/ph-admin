import { assertQuarterCorrespondence, parseQuarterIntake, quarterBinding, quarterTargetEvidence, quarterPriceEvidence, QUARTER_EVENT, CreateQuarterProvenance } from './subscription-create-quarter-contract';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { validateStoredSubscriptionCanonicalTargetSnapshot, validateStoredSubscriptionInstance, validateStoredSubscriptionProviderMapping } from './subscription-runtime-contracts';
import { subscriptionProviderScopeMatchesProjection } from './subscription-provider-scope';
import { SubscriptionTrustedShadowAdapterService } from './subscription-trusted-shadow-adapter.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionCanonicalTargetSnapshot,
  StoredSubscriptionInstance,
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
  public constructor(
    private readonly repository: SubscriptionsRepository,
    @Optional() private readonly trustedIdentity?: SubscriptionTrustedShadowAdapterService
  ) {}

  public async ingest(
    integrationToken: string | undefined,
    body: unknown,
    options: { readonly now?: () => Date; readonly authorizationHeader?: string } = {}
  ): Promise<CanonicalTargetIntakeResult> {
    this.assertEnabledAndConfigured();
    this.assertIntegrationToken(integrationToken);
    if (record(body) && body.contractVersion === 3) {
      return this.ingestActorQuarter(integrationToken, options.authorizationHeader, body, options.now?.() ?? new Date());
    }
    const tenantId = this.runtimeTenantId();
    if (record(body) && Object.prototype.hasOwnProperty.call(body, 'contractVersion')) {
      return this.ingestQuarter(tenantId, body, options.now?.() ?? new Date());
    }
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
    try {
      validateStoredSubscriptionCanonicalTargetSnapshot(snapshot);
    } catch {
      // Contract-invalid facts are a caller error, not an internal failure and never a partial write.
      throw new CanonicalTargetIntakeError(400, 'CANONICAL_TARGET_BODY_INVALID');
    }
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

  private async ingestActorQuarter(
    token: string | undefined, authorization: string | undefined, body: Record<string, unknown>, now: Date
  ): Promise<CanonicalTargetIntakeResult> {
    // Authenticate before any database read. Public LK2 tenant UUIDs are not CUP tenant keys.
    if (!this.trustedIdentity) throw new CanonicalTargetIntakeError(503, 'CANONICAL_TARGET_ACTOR_UNAVAILABLE');
    const actor = await this.trustedIdentity.resolveTargetIntakeIdentity(authorization, token);
    if (Object.prototype.hasOwnProperty.call(body, 'clientRefHash')
      || body.state !== 'ACTIVE' || typeof body.subscriptionInstanceId !== 'string'
      || !ID_PATTERN.test(body.subscriptionInstanceId) || /[\r\n]/.test(body.subscriptionInstanceId)) {
      throw new CanonicalTargetIntakeError(400, 'CANONICAL_TARGET_BODY_INVALID');
    }
    const { subscriptionInstanceId, ...facts } = body;
    let input: ReturnType<typeof parseQuarterIntake>;
    try { input = parseQuarterIntake({ ...facts, contractVersion: 2, clientRefHash: actor.clientRefHash }); }
    catch { throw new CanonicalTargetIntakeError(400, 'CANONICAL_TARGET_BODY_INVALID'); }
    await this.repository.connectReadOnly();
    const instance = await this.repository.runtimeInstanceByTenantAndId(actor.tenantId, subscriptionInstanceId);
    try { if (!instance) throw new Error(); validateStoredSubscriptionInstance(instance); }
    catch { throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_ACTOR_INSTANCE_MISMATCH'); }
    if (!instance || instance.tenantId !== actor.tenantId || instance.clientRefHash !== actor.clientRefHash
      || instance.subscriptionInstanceId !== subscriptionInstanceId || instance.provider !== 'VIVA' || instance.state !== 'ACTIVE'
      || instance.subscriptionTypeId !== input.subscriptionTypeId || instance.policyVersion !== input.policyVersion) {
      throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_ACTOR_INSTANCE_MISMATCH');
    }
    return this.ingestQuarter(actor.tenantId, input, now, instance);
  }

  private async ingestQuarter(tenantId: string, body: unknown, now: Date, ownedInstance?: StoredSubscriptionInstance): Promise<CanonicalTargetIntakeResult> {
    let input: ReturnType<typeof parseQuarterIntake>;
    try { input = parseQuarterIntake(body); } catch { throw new CanonicalTargetIntakeError(400, 'CANONICAL_TARGET_BODY_INVALID'); }
    const staleness = Number(process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS);
    if (!Number.isSafeInteger(staleness) || staleness < 30 || staleness > 3600) {
      throw new CanonicalTargetIntakeError(503, 'CANONICAL_TARGET_QUARTER_UNAVAILABLE');
    }
    if (Date.parse(input.observedAt) > now.getTime() || now.getTime() - Date.parse(input.observedAt) > staleness * 1000
      || Date.parse(input.expiresAt) <= now.getTime() || Date.parse(input.startsAt) <= now.getTime()) {
      throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_QUARTER_STALE');
    }
    // VERIFY_ONLY never creates indexes. The authenticated intake may insert only into the existing target store.
    await this.repository.connectReadOnly();
    const publication = await this.repository.runtimePolicyPublicationByVersion(input.subscriptionTypeId, input.policyVersion);
    if (!publication) throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_QUARTER_UNAVAILABLE');
    if (ownedInstance && (publication.policyDigest !== ownedInstance.policyDigest
      || publication.mappingId !== ownedInstance.mappingId || publication.publicationId !== input.publicationId)) {
      throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_ACTOR_INSTANCE_MISMATCH');
    }
    const mapping = await this.repository.runtimeProviderMappingById(publication.mappingId);
    if (!mapping || mapping.tenantId !== tenantId || mapping.state !== 'VERIFIED' || mapping.provider !== 'VIVA'
      || mapping.subscriptionTypeId !== input.subscriptionTypeId) throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_QUARTER_UNAVAILABLE');
    if (ownedInstance) {
      try { validateStoredSubscriptionProviderMapping(mapping); }
      catch { throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_ACTOR_INSTANCE_MISMATCH'); }
      const fresh = (value: string | null) => Boolean(value && Number.isFinite(Date.parse(value))
        && Date.parse(value) <= now.getTime() && now.getTime() - Date.parse(value) <= staleness * 1000);
      if (mapping.mappingId !== ownedInstance.mappingId || mapping.providerProductId !== ownedInstance.providerProductId
        || (mapping.providerScope.kind === 'TENANT' && mapping.providerScope.scopeId !== tenantId)
        || (mapping.providerScope.kind === 'STATION' && mapping.providerScope.scopeId !== ownedInstance.homeStationId)
        || mapping.providerScope.kind === 'STUDIO'
        || (mapping.providerScope.kind === 'STATION_SET'
          && !subscriptionProviderScopeMatchesProjection(mapping.providerScope, publication.runtimeProjection, tenantId))
        || publication.state === 'DISABLED_FOR_NEW_OPERATIONS' || !fresh(mapping.verifiedAt)
        || ownedInstance.reconciliation.state !== 'CURRENT' || !fresh(ownedInstance.reconciliation.asOf)) {
        throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_ACTOR_INSTANCE_MISMATCH');
      }
    }
    let descriptor: ReturnType<typeof assertQuarterCorrespondence>;
    try { descriptor = assertQuarterCorrespondence(input, publication); }
    catch { throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_QUARTER_MISMATCH'); }
    const proof: CreateQuarterProvenance = { schemaVersion: 1, binding: quarterBinding(input, descriptor),
      subscriptionTypeId: publication.subscriptionTypeId, policyVersion: publication.policyVersion,
      policyDigest: publication.policyDigest, approvalAuditRef: publication.approvalAuditRef, roomId: input.roomId,
      catalogue: input.catalogue, price: input.price };
    const target = { targetId: input.targetId, action: 'CREATE_GAME' as const, revision: input.revision };
    const snapshot: StoredSubscriptionCanonicalTargetSnapshot = { schemaVersion: 2, snapshotId: snapshotIdFor(tenantId, target),
      tenantId, ...target, state: input.state, stationId: input.stationId, category: 'GAME', externalEventTypeId: QUARTER_EVENT,
      productTypeId: null, durationMinutes: 60, startsAt: input.startsAt, basePriceMinor: input.price.amountMinor / 4,
      currency: 'RUB', dictionaryRevision: publication.dictionaryRevision, evidenceRef: quarterTargetEvidence(tenantId, input, proof),
      priceEvidenceRef: quarterPriceEvidence(input), sourceKind: 'CANONICAL_TARGET_PROJECTION', observedAt: input.observedAt,
      expiresAt: input.expiresAt, createdAt: now.toISOString(), createQuarter: proof };
    validateStoredSubscriptionCanonicalTargetSnapshot(snapshot);
    try { await this.repository.insertRuntimeCanonicalTargetSnapshot(snapshot); return { ...target, snapshotId: snapshot.snapshotId, replay: false }; }
    catch (error) { if (!this.repository.isDuplicateKey(error)) throw error; }
    const existing = await this.repository.runtimeCanonicalTargetSnapshot({ tenantId, ...target });
    if (!existing || !isDeepStrictEqual({ ...existing, createdAt: snapshot.createdAt }, snapshot)) {
      throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_INTAKE_CONFLICT');
    }
    return { ...target, snapshotId: existing.snapshotId, replay: true };
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

function snapshotIdFor(tenantId: string, target: Pick<CanonicalTargetIntakeBody, 'targetId' | 'action' | 'revision'>): string {
  const digest = createHash('sha256')
    .update(`canonical-target:v1\0${tenantId}\0${target.targetId}\0${target.action}\0${target.revision}`)
    .digest('hex')
    .slice(0, 48);
  return `canonical_target:${digest}`;
}

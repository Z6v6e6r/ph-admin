import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  assertPolicySupportedByPublicationAdapter,
  LK_NODE_RED_ANNUAL_BOOKING_V1,
  publicationAdapterRuntimeCompatibility,
  SubscriptionPublicationAdapterError
} from './subscription-publication-enforcement-adapter';
import {
  buildSubscriptionProjectionFence,
  subscriptionProjectionFenceBindingDigest,
  subscriptionProjectionFenceId
} from './subscription-projection-fence';
import {
  computeSubscriptionRuntimeProjectionDigest,
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProjectionFence,
  validateStoredSubscriptionProviderMapping
} from './subscription-runtime-contracts';
import { compileSubscriptionRuntimeProjection } from './subscription-runtime-projection';
import type {
  StoredReleaseProgram,
  StoredSubscriptionInstanceProjectorCheckpoint,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionProjectionFence,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionType,
  SubscriptionProviderScope,
  SubscriptionRuntimeCompatibility
} from './subscriptions.types';

export const SUBSCRIPTION_LEGACY_BINDING_PROMOTION_SCHEMA =
  'PHAB_SUBSCRIPTION_LEGACY_RUNTIME_BINDING_PROMOTION_V1' as const;
export const SUBSCRIPTION_LEGACY_BINDING_PROMOTION_CONFIRM =
  'APPLY_PITER_LEGACY_RUNTIME_BINDING_PROMOTION' as const;
export const PITER_TENANT_ID = 'iSkq6G';
export const PITER_PROVIDER_PRODUCT_ID = '8bf334ba-3050-4017-b40a-7eef2db1eb16';
export const HUB_PROVIDER_PRODUCT_ID = 'db7a5250-7369-4f43-8ac5-9111be24bc74';
export const PITER_SUBSCRIPTION_TYPE_ID =
  'subscription_type:608f1030-580c-4438-b001-1f7fc2053a74';
export const PITER_STATION_ID = '1ea77cbf-bc36-49a1-96d6-f35c216a409b';
export const PITER_PRICE_MINOR = 1_980_000;

const TOP_LEVEL_KEYS = [
  'schemaVersion', 'approvalRef', 'providerEvidenceRef', 'resultEvidenceRef',
  'evidence', 'counts', 'tenantId', 'provider', 'providerProductId', 'providerScope',
  'subscriptionTypeId', 'policyVersion', 'publication', 'mapping', 'releaseProgram',
  'stationId', 'price', 'expected', 'targetSha256', 'promotedAt', 'actorId'
] as const;
const EVIDENCE_KEYS = ['observedAt', 'coverageThrough'] as const;
const COUNTS_KEYS = ['sourceItemCount', 'rejectedItemCount', 'duplicateIdentityCount'] as const;
const SCOPE_KEYS = ['kind', 'scopeId'] as const;
const PUBLICATION_KEYS = ['publicationId', 'sourceDigest'] as const;
const MAPPING_KEYS = ['mappingId', 'sourceRevision', 'sourceDigest'] as const;
const PROGRAM_KEYS = [
  'releaseProgramId', 'releasePhaseId', 'sourceRevision', 'sourceDigest'
] as const;
const PRICE_KEYS = ['amountMinor', 'currency'] as const;
const EXPECTED_KEYS = [
  'instanceCount', 'projectorCheckpointCount', 'fenceCount', 'promotionCheckpointCount'
] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_REF_PATTERN = /^[a-z][a-z0-9_]{2,63}:sha256:[a-f0-9]{64}$/;
const APPROVAL_REF_PATTERN = /^provider_approval:sha256:[a-f0-9]{64}$/;

type Digest = `sha256:${string}`;
type JsonObject = Record<string, unknown>;

export interface SubscriptionLegacyBindingPromotionManifest {
  schemaVersion: typeof SUBSCRIPTION_LEGACY_BINDING_PROMOTION_SCHEMA;
  approvalRef: string;
  providerEvidenceRef: string;
  resultEvidenceRef: string;
  evidence: { observedAt: string; coverageThrough: string };
  counts: {
    sourceItemCount: 24;
    rejectedItemCount: 0;
    duplicateIdentityCount: 0;
  };
  tenantId: string;
  provider: 'VIVA';
  providerProductId: string;
  providerScope: { kind: 'STATION'; scopeId: string };
  subscriptionTypeId: string;
  policyVersion: number;
  publication: { publicationId: string; sourceDigest: Digest };
  mapping: { mappingId: string; sourceRevision: number; sourceDigest: Digest };
  releaseProgram: {
    releaseProgramId: string;
    releasePhaseId: string;
    sourceRevision: number;
    sourceDigest: Digest;
  };
  stationId: string;
  price: { amountMinor: 1_980_000; currency: 'RUB' };
  expected: {
    instanceCount: 0;
    projectorCheckpointCount: 0;
    fenceCount: 0;
    promotionCheckpointCount: 0;
  };
  targetSha256: Digest;
  promotedAt: string;
  actorId: string;
  inputSha256: Digest;
}

export interface StoredSubscriptionRuntimeBindingPromotion {
  schemaVersion: 1;
  promotionId: string;
  tenantId: string;
  provider: 'VIVA';
  providerProductId: string;
  providerScope: SubscriptionProviderScope;
  subscriptionTypeId: string;
  policyVersion: number;
  publicationId: string;
  mappingId: string;
  releaseProgramId: string;
  releasePhaseId: string;
  approvalRef: string;
  providerEvidenceRef: string;
  resultEvidenceRef: string;
  inputSha256: Digest;
  planSha256: Digest;
  targetSha256: Digest;
  source: {
    publication: { schemaVersion: 2; digest: Digest };
    mapping: { revision: number; digest: Digest };
    releaseProgram: { revision: number; digest: Digest };
  };
  target: {
    publication: { schemaVersion: 3; digest: Digest };
    mapping: { revision: number; digest: Digest };
    releaseProgram: { revision: number; digest: Digest };
  };
  runtimeCompatibility: SubscriptionRuntimeCompatibility;
  fence: { fenceId: string; revision: 1; digest: Digest };
  promotedAt: string;
  state: 'CURRENT';
  revision: 1;
}

export interface SubscriptionLegacyBindingPromotionIdentity {
  tenantId: string;
  providerProductId: string;
  providerScope: { kind: 'STATION'; scopeId: string };
  subscriptionTypeId: string;
  policyVersion: number;
  publicationId: string;
  mappingId: string;
  releaseProgramId: string;
  releasePhaseId: string;
  promotionId: string;
}

export interface SubscriptionLegacyBindingPromotionSnapshot {
  type: StoredSubscriptionType | null;
  policy: StoredSubscriptionPolicyVersion | null;
  publication: StoredSubscriptionPolicyPublication | null;
  mapping: StoredSubscriptionProviderMapping | null;
  releaseProgram: StoredReleaseProgram | null;
  fence: StoredSubscriptionProjectionFence | null;
  promotion: StoredSubscriptionRuntimeBindingPromotion | null;
  instanceCount: number;
  projectorCheckpointCount: number;
}

export interface SubscriptionLegacyBindingPromotionPlan {
  status: 'READY_TO_PROMOTE' | 'EXACT_REPLAY';
  manifest: SubscriptionLegacyBindingPromotionManifest;
  identity: SubscriptionLegacyBindingPromotionIdentity;
  planSha256: Digest;
  source: null | {
    publication: StoredSubscriptionPolicyPublication;
    mapping: StoredSubscriptionProviderMapping;
    releaseProgram: StoredReleaseProgram;
  };
  target: {
    publication: StoredSubscriptionPolicyPublication;
    mapping: StoredSubscriptionProviderMapping;
    releaseProgram: StoredReleaseProgram;
    fence: StoredSubscriptionProjectionFence;
    promotion: StoredSubscriptionRuntimeBindingPromotion;
  };
}

export interface SubscriptionLegacyBindingPromotionResult {
  status: 'READY_TO_PROMOTE' | 'PROMOTED' | 'EXACT_REPLAY';
  write: boolean;
  promotionId: string;
  subscriptionTypeId: string;
  providerProductId: string;
  publicationId: string;
  mappingId: string;
  releaseProgramId: string;
  releasePhaseId: string;
  inputSha256: Digest;
  planSha256: Digest;
  targetSha256: Digest;
  sourceItemCount: 24;
  rejectedItemCount: 0;
  duplicateIdentityCount: 0;
}

export interface SubscriptionLegacyBindingPromotionRepository {
  connect(): Promise<void>;
  connectReadOnly(): Promise<void>;
  close(): Promise<void>;
  legacyBindingPromotionSnapshot(
    identity: SubscriptionLegacyBindingPromotionIdentity
  ): Promise<SubscriptionLegacyBindingPromotionSnapshot>;
  preflightLegacyBindingPromotion(
    plan: SubscriptionLegacyBindingPromotionPlan
  ): Promise<'READY_TO_PROMOTE' | 'EXACT_REPLAY'>;
  applyLegacyBindingPromotion(
    plan: SubscriptionLegacyBindingPromotionPlan
  ): Promise<'PROMOTED' | 'EXACT_REPLAY'>;
}

function fail(code: string): never {
  throw new SubscriptionRuntimeContractError(code);
}

const exactObject = (value: unknown, keys: readonly string[], code: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const object = value as JsonObject;
  if (!isDeepStrictEqual(Object.keys(object).sort(), [...keys].sort())) fail(code);
  return object;
};

const pattern = (value: unknown, expected: RegExp, code: string): string => {
  if (typeof value !== 'string' || !expected.test(value)) fail(code);
  return value;
};

const instant = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(code);
  return value;
};

const positiveInteger = (value: unknown, code: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(code);
  return Number(value);
};

const exactZero = (value: unknown, code: string): 0 => {
  if (value !== 0) fail(code);
  return 0;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as JsonObject).sort()
    .map((key) => [key, stableValue((value as JsonObject)[key])]));
};

export const subscriptionLegacyBindingPromotionDocumentDigest = (value: unknown): Digest =>
  `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function subscriptionLegacyBindingPromotionInputFingerprint(input: unknown): Digest {
  return parseSubscriptionLegacyBindingPromotionManifest(input).inputSha256;
}

export function subscriptionLegacyBindingPromotionTargetFingerprint(
  uriValue: unknown,
  databaseValue: unknown
): Digest {
  const uri = String(uriValue ?? '').trim();
  const database = String(databaseValue ?? '').trim();
  const match = /^(mongodb(?:\+srv)?):\/\/([^/?#]+)(.*)$/i.exec(uri);
  if (!match || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(database)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_TARGET_INVALID');
  }
  const hosts = match[2].slice(match[2].lastIndexOf('@') + 1).trim().toLowerCase();
  if (!hosts || /[\s/@]/.test(hosts)) fail('SUBSCRIPTIONS_BINDING_PROMOTION_TARGET_INVALID');
  return subscriptionLegacyBindingPromotionDocumentDigest({
    scheme: match[1].toLowerCase(), hosts, database, connectionSuffix: match[3] || ''
  });
}

export function parseSubscriptionLegacyBindingPromotionManifest(
  input: unknown
): SubscriptionLegacyBindingPromotionManifest {
  const value = exactObject(
    input,
    TOP_LEVEL_KEYS,
    'SUBSCRIPTIONS_BINDING_PROMOTION_MANIFEST_SHAPE_INVALID'
  );
  if (value.schemaVersion !== SUBSCRIPTION_LEGACY_BINDING_PROMOTION_SCHEMA
    || value.provider !== 'VIVA') {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_MANIFEST_SCHEMA_INVALID');
  }
  const providerProductId = pattern(
    value.providerProductId,
    ID_PATTERN,
    'SUBSCRIPTIONS_BINDING_PROMOTION_PRODUCT_INVALID'
  );
  if (providerProductId !== PITER_PROVIDER_PRODUCT_ID) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PRODUCT_UNSUPPORTED');
  }
  const tenantId = pattern(value.tenantId, ID_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_TENANT_INVALID');
  const subscriptionTypeId = pattern(
    value.subscriptionTypeId,
    ID_PATTERN,
    'SUBSCRIPTIONS_BINDING_PROMOTION_TYPE_INVALID'
  );
  const stationId = pattern(value.stationId, ID_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_STATION_INVALID');
  if (tenantId !== PITER_TENANT_ID
    || subscriptionTypeId !== PITER_SUBSCRIPTION_TYPE_ID
    || stationId !== PITER_STATION_ID) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_IDENTITY_UNSUPPORTED');
  }
  const scope = exactObject(value.providerScope, SCOPE_KEYS, 'SUBSCRIPTIONS_BINDING_PROMOTION_SCOPE_INVALID');
  if (scope.kind !== 'STATION' || scope.scopeId !== PITER_STATION_ID) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_SCOPE_INVALID');
  }
  const evidence = exactObject(value.evidence, EVIDENCE_KEYS, 'SUBSCRIPTIONS_BINDING_PROMOTION_EVIDENCE_INVALID');
  const observedAt = instant(evidence.observedAt, 'SUBSCRIPTIONS_BINDING_PROMOTION_EVIDENCE_INVALID');
  const coverageThrough = instant(evidence.coverageThrough, 'SUBSCRIPTIONS_BINDING_PROMOTION_EVIDENCE_INVALID');
  if (Date.parse(observedAt) > Date.parse(coverageThrough)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_EVIDENCE_TIME_INVALID');
  }
  const counts = exactObject(value.counts, COUNTS_KEYS, 'SUBSCRIPTIONS_BINDING_PROMOTION_COUNTS_INVALID');
  if (counts.sourceItemCount !== 24) fail('SUBSCRIPTIONS_BINDING_PROMOTION_SOURCE_COUNT_INVALID');
  if (counts.rejectedItemCount !== 0) fail('SUBSCRIPTIONS_BINDING_PROMOTION_REJECTED_RECORDS');
  if (counts.duplicateIdentityCount !== 0) fail('SUBSCRIPTIONS_BINDING_PROMOTION_DUPLICATE_IDENTITIES');
  const publication = exactObject(
    value.publication,
    PUBLICATION_KEYS,
    'SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_ATTESTATION_INVALID'
  );
  const mapping = exactObject(
    value.mapping,
    MAPPING_KEYS,
    'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_ATTESTATION_INVALID'
  );
  const releaseProgram = exactObject(
    value.releaseProgram,
    PROGRAM_KEYS,
    'SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_ATTESTATION_INVALID'
  );
  const price = exactObject(value.price, PRICE_KEYS, 'SUBSCRIPTIONS_BINDING_PROMOTION_PRICE_INVALID');
  if (price.amountMinor !== PITER_PRICE_MINOR || price.currency !== 'RUB') {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PRICE_INVALID');
  }
  const expected = exactObject(value.expected, EXPECTED_KEYS, 'SUBSCRIPTIONS_BINDING_PROMOTION_EXPECTED_INVALID');
  const promotedAt = instant(value.promotedAt, 'SUBSCRIPTIONS_BINDING_PROMOTION_PROMOTED_AT_INVALID');
  if (Date.parse(promotedAt) < Date.parse(coverageThrough)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PROMOTED_AT_INVALID');
  }
  const manifestWithoutHash = clone(value);
  return {
    schemaVersion: SUBSCRIPTION_LEGACY_BINDING_PROMOTION_SCHEMA,
    approvalRef: pattern(value.approvalRef, APPROVAL_REF_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_APPROVAL_REF_INVALID'),
    providerEvidenceRef: pattern(value.providerEvidenceRef, EVIDENCE_REF_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_EVIDENCE_REF_INVALID'),
    resultEvidenceRef: pattern(value.resultEvidenceRef, EVIDENCE_REF_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_EVIDENCE_REF_INVALID'),
    evidence: { observedAt, coverageThrough },
    counts: { sourceItemCount: 24, rejectedItemCount: 0, duplicateIdentityCount: 0 },
    tenantId,
    provider: 'VIVA',
    providerProductId,
    providerScope: { kind: 'STATION', scopeId: PITER_STATION_ID },
    subscriptionTypeId,
    policyVersion: positiveInteger(value.policyVersion, 'SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_VERSION_INVALID'),
    publication: {
      publicationId: pattern(publication.publicationId, ID_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_ATTESTATION_INVALID'),
      sourceDigest: pattern(publication.sourceDigest, DIGEST_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_ATTESTATION_INVALID') as Digest
    },
    mapping: {
      mappingId: pattern(mapping.mappingId, ID_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_ATTESTATION_INVALID'),
      sourceRevision: positiveInteger(mapping.sourceRevision, 'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_ATTESTATION_INVALID'),
      sourceDigest: pattern(mapping.sourceDigest, DIGEST_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_ATTESTATION_INVALID') as Digest
    },
    releaseProgram: {
      releaseProgramId: pattern(releaseProgram.releaseProgramId, ID_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_ATTESTATION_INVALID'),
      releasePhaseId: pattern(releaseProgram.releasePhaseId, ID_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_ATTESTATION_INVALID'),
      sourceRevision: positiveInteger(releaseProgram.sourceRevision, 'SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_ATTESTATION_INVALID'),
      sourceDigest: pattern(releaseProgram.sourceDigest, DIGEST_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_ATTESTATION_INVALID') as Digest
    },
    stationId,
    price: { amountMinor: PITER_PRICE_MINOR, currency: 'RUB' },
    expected: {
      instanceCount: exactZero(expected.instanceCount, 'SUBSCRIPTIONS_BINDING_PROMOTION_EXPECTED_INVALID'),
      projectorCheckpointCount: exactZero(expected.projectorCheckpointCount, 'SUBSCRIPTIONS_BINDING_PROMOTION_EXPECTED_INVALID'),
      fenceCount: exactZero(expected.fenceCount, 'SUBSCRIPTIONS_BINDING_PROMOTION_EXPECTED_INVALID'),
      promotionCheckpointCount: exactZero(expected.promotionCheckpointCount, 'SUBSCRIPTIONS_BINDING_PROMOTION_EXPECTED_INVALID')
    },
    targetSha256: pattern(value.targetSha256, DIGEST_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_TARGET_INVALID') as Digest,
    promotedAt,
    actorId: pattern(value.actorId, ID_PATTERN, 'SUBSCRIPTIONS_BINDING_PROMOTION_ACTOR_INVALID'),
    inputSha256: subscriptionLegacyBindingPromotionDocumentDigest(manifestWithoutHash)
  };
}

export function subscriptionLegacyBindingPromotionIdentity(
  manifest: SubscriptionLegacyBindingPromotionManifest
): SubscriptionLegacyBindingPromotionIdentity {
  const identity = {
    tenantId: manifest.tenantId,
    providerProductId: manifest.providerProductId,
    providerScope: manifest.providerScope,
    subscriptionTypeId: manifest.subscriptionTypeId,
    policyVersion: manifest.policyVersion,
    publicationId: manifest.publication.publicationId,
    mappingId: manifest.mapping.mappingId,
    releaseProgramId: manifest.releaseProgram.releaseProgramId,
    releasePhaseId: manifest.releaseProgram.releasePhaseId
  };
  return {
    ...identity,
    promotionId: `subscription_runtime_binding_promotion:${createHash('sha256')
      .update(`subscription-runtime-binding-promotion:v1\0${JSON.stringify(stableValue(identity))}`)
      .digest('hex')}`
  };
}

const sourcePins = (manifest: SubscriptionLegacyBindingPromotionManifest) => ({
  publication: { schemaVersion: 2 as const, digest: manifest.publication.sourceDigest },
  mapping: { revision: manifest.mapping.sourceRevision, digest: manifest.mapping.sourceDigest },
  releaseProgram: {
    revision: manifest.releaseProgram.sourceRevision,
    digest: manifest.releaseProgram.sourceDigest
  }
});

const buildPromotionCheckpointBase = (input: {
  manifest: SubscriptionLegacyBindingPromotionManifest;
  identity: SubscriptionLegacyBindingPromotionIdentity;
  publication: StoredSubscriptionPolicyPublication;
  mapping: StoredSubscriptionProviderMapping;
  releaseProgram: StoredReleaseProgram;
  fence: StoredSubscriptionProjectionFence;
  compatibility: SubscriptionRuntimeCompatibility;
}) => ({
  schemaVersion: 1 as const,
  promotionId: input.identity.promotionId,
  tenantId: input.identity.tenantId,
  provider: 'VIVA' as const,
  providerProductId: input.identity.providerProductId,
  providerScope: input.identity.providerScope,
  subscriptionTypeId: input.identity.subscriptionTypeId,
  policyVersion: input.identity.policyVersion,
  publicationId: input.identity.publicationId,
  mappingId: input.identity.mappingId,
  releaseProgramId: input.identity.releaseProgramId,
  releasePhaseId: input.identity.releasePhaseId,
  approvalRef: input.manifest.approvalRef,
  providerEvidenceRef: input.manifest.providerEvidenceRef,
  resultEvidenceRef: input.manifest.resultEvidenceRef,
  inputSha256: input.manifest.inputSha256,
  targetSha256: input.manifest.targetSha256,
  source: sourcePins(input.manifest),
  target: {
    publication: {
      schemaVersion: 3 as const,
      digest: subscriptionLegacyBindingPromotionDocumentDigest(input.publication)
    },
    mapping: {
      revision: input.mapping.revision,
      digest: subscriptionLegacyBindingPromotionDocumentDigest(input.mapping)
    },
    releaseProgram: {
      revision: input.releaseProgram.revision,
      digest: subscriptionLegacyBindingPromotionDocumentDigest(input.releaseProgram)
    }
  },
  runtimeCompatibility: input.compatibility,
  fence: {
    fenceId: input.fence.fenceId,
    revision: 1 as const,
    digest: input.fence.bindingDigest
  },
  promotedAt: input.manifest.promotedAt,
  state: 'CURRENT' as const,
  revision: 1 as const
});

function buildPlanHash(input: {
  identity: SubscriptionLegacyBindingPromotionIdentity;
  checkpointBase: ReturnType<typeof buildPromotionCheckpointBase>;
  publication: StoredSubscriptionPolicyPublication;
  mapping: StoredSubscriptionProviderMapping;
  releaseProgram: StoredReleaseProgram;
  fence: StoredSubscriptionProjectionFence;
}): Digest {
  return subscriptionLegacyBindingPromotionDocumentDigest({
    schemaVersion: SUBSCRIPTION_LEGACY_BINDING_PROMOTION_SCHEMA,
    identity: input.identity,
    checkpoint: input.checkpointBase,
    target: {
      publication: input.publication,
      mapping: input.mapping,
      releaseProgram: input.releaseProgram,
      fence: input.fence
    }
  });
}

function validateStaticSource(
  manifest: SubscriptionLegacyBindingPromotionManifest,
  snapshot: SubscriptionLegacyBindingPromotionSnapshot
): {
  publication: StoredSubscriptionPolicyPublication;
  mapping: StoredSubscriptionProviderMapping;
  releaseProgram: StoredReleaseProgram;
  compatibility: SubscriptionRuntimeCompatibility;
} {
  const type = snapshot.type;
  if (!type || type.subscriptionTypeId !== manifest.subscriptionTypeId
    || type.state !== 'ACTIVE' || type.currentPolicyVersion !== manifest.policyVersion) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_TYPE_PRECONDITION_FAILED');
  }
  const policy = snapshot.policy;
  if (!policy || policy.subscriptionTypeId !== manifest.subscriptionTypeId
    || policy.version !== manifest.policyVersion
    || policy.modelVersion !== 3 || policy.status !== 'PUBLISHED') {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_PRECONDITION_FAILED');
  }
  let runtimeProjection;
  try {
    assertPolicySupportedByPublicationAdapter(LK_NODE_RED_ANNUAL_BOOKING_V1, policy);
    runtimeProjection = compileSubscriptionRuntimeProjection(policy);
  } catch (error) {
    if (error instanceof SubscriptionPublicationAdapterError) {
      fail('SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_ADAPTER_UNSUPPORTED');
    }
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_PROJECTION_INVALID');
  }
  const publication = snapshot.publication;
  if (!publication) fail('SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_NOT_FOUND');
  validateStoredSubscriptionPolicyPublication(publication);
  if (publication.schemaVersion !== 2 || publication.state !== 'PUBLISHED'
    || publication.publicationId !== manifest.publication.publicationId
    || publication.subscriptionTypeId !== manifest.subscriptionTypeId
    || publication.policyVersion !== manifest.policyVersion
    || publication.mappingId !== manifest.mapping.mappingId
    || publication.runtimeCompatibility !== undefined
    || !publication.idempotency) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_PRECONDITION_FAILED');
  }
  if (!isDeepStrictEqual(runtimeProjection, publication.runtimeProjection)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_PROJECTION_MISMATCH');
  }
  if (publication.policyDigest !== computeSubscriptionRuntimeProjectionDigest(runtimeProjection)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_DIGEST_MISMATCH');
  }
  if (subscriptionLegacyBindingPromotionDocumentDigest(publication)
    !== manifest.publication.sourceDigest) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_SOURCE_DIGEST_MISMATCH');
  }
  const mapping = snapshot.mapping;
  if (!mapping) fail('SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_NOT_FOUND');
  validateStoredSubscriptionProviderMapping(mapping);
  if (mapping.mappingId !== manifest.mapping.mappingId
    || mapping.tenantId !== manifest.tenantId
    || mapping.provider !== 'VIVA'
    || mapping.providerProductId !== PITER_PROVIDER_PRODUCT_ID
    || mapping.providerScope.kind !== 'STATION'
    || mapping.providerScope.scopeId !== PITER_STATION_ID
    || mapping.subscriptionTypeId !== manifest.subscriptionTypeId
    || mapping.state !== 'VERIFIED'
    || mapping.revision !== manifest.mapping.sourceRevision) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_PRECONDITION_FAILED');
  }
  if (subscriptionLegacyBindingPromotionDocumentDigest(mapping) !== manifest.mapping.sourceDigest) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_SOURCE_DIGEST_MISMATCH');
  }
  const releaseProgram = snapshot.releaseProgram;
  if (!releaseProgram) fail('SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_NOT_FOUND');
  if (releaseProgram.schemaVersion !== 1
    || releaseProgram.releaseProgramId !== manifest.releaseProgram.releaseProgramId
    || releaseProgram.subscriptionTypeId !== manifest.subscriptionTypeId
    || releaseProgram.stationId !== PITER_STATION_ID
    || releaseProgram.state !== 'DRAFT'
    || releaseProgram.revision !== manifest.releaseProgram.sourceRevision) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_PRECONDITION_FAILED');
  }
  const phases = releaseProgram.phases.filter(
    (phase) => phase.releasePhaseId === manifest.releaseProgram.releasePhaseId
  );
  if (phases.length !== 1) fail('SUBSCRIPTIONS_BINDING_PROMOTION_PHASE_AMBIGUOUS');
  const phase = phases[0];
  if (phase.price.amountMinor !== PITER_PRICE_MINOR || phase.price.currency !== 'RUB') {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PHASE_PRICE_INVALID');
  }
  if (phase.providerProductRef !== null) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PHASE_ALREADY_BOUND');
  }
  if (subscriptionLegacyBindingPromotionDocumentDigest(releaseProgram)
    !== manifest.releaseProgram.sourceDigest) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_SOURCE_DIGEST_MISMATCH');
  }
  if (Date.parse(publication.publishedAt) > Date.parse(manifest.promotedAt)
    || Date.parse(mapping.updatedAt) > Date.parse(manifest.promotedAt)
    || Date.parse(releaseProgram.updatedAt) > Date.parse(manifest.promotedAt)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_SOURCE_TIME_INVALID');
  }
  return {
    publication,
    mapping,
    releaseProgram,
    compatibility: publicationAdapterRuntimeCompatibility(LK_NODE_RED_ANNUAL_BOOKING_V1)
  };
}

function buildReadyPlan(
  manifest: SubscriptionLegacyBindingPromotionManifest,
  snapshot: SubscriptionLegacyBindingPromotionSnapshot
): SubscriptionLegacyBindingPromotionPlan {
  if (snapshot.instanceCount !== 0) fail('SUBSCRIPTIONS_BINDING_PROMOTION_INSTANCES_EXIST');
  if (snapshot.projectorCheckpointCount !== 0) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PROJECTOR_CHECKPOINT_EXISTS');
  }
  if (snapshot.fence) fail('SUBSCRIPTIONS_BINDING_PROMOTION_FENCE_EXISTS');
  if (snapshot.promotion) fail('SUBSCRIPTIONS_BINDING_PROMOTION_CHECKPOINT_EXISTS');
  const source = validateStaticSource(manifest, snapshot);
  const identity = subscriptionLegacyBindingPromotionIdentity(manifest);
  const targetPublication: StoredSubscriptionPolicyPublication = {
    ...clone(source.publication),
    schemaVersion: 3,
    runtimeCompatibility: source.compatibility
  };
  validateStoredSubscriptionPolicyPublication(targetPublication);
  const targetMapping: StoredSubscriptionProviderMapping = {
    ...clone(source.mapping),
    evidenceRef: manifest.providerEvidenceRef,
    verifiedAt: manifest.promotedAt,
    verifiedBy: manifest.actorId,
    revision: source.mapping.revision + 1,
    updatedAt: manifest.promotedAt,
    updatedBy: manifest.actorId
  };
  validateStoredSubscriptionProviderMapping(targetMapping);
  const targetProgram: StoredReleaseProgram = {
    ...clone(source.releaseProgram),
    state: 'PAUSED',
    revision: source.releaseProgram.revision + 1,
    updatedAt: manifest.promotedAt,
    phases: source.releaseProgram.phases.map((phase) => phase.releasePhaseId
      === manifest.releaseProgram.releasePhaseId
      ? { ...phase, providerProductRef: PITER_PROVIDER_PRODUCT_ID }
      : clone(phase))
  };
  const targetFence = buildSubscriptionProjectionFence({
    mapping: targetMapping,
    publication: targetPublication,
    previous: null
  });
  validateStoredSubscriptionProjectionFence(targetFence);
  if (targetFence.bindingRevision !== 1 || targetFence.coordinationRevision !== 1
    || targetFence.lastProjectorReconciliationDigest !== null) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_FENCE_TARGET_INVALID');
  }
  const checkpointBase = buildPromotionCheckpointBase({
    manifest,
    identity,
    publication: targetPublication,
    mapping: targetMapping,
    releaseProgram: targetProgram,
    fence: targetFence,
    compatibility: source.compatibility
  });
  const planSha256 = buildPlanHash({
    identity,
    checkpointBase,
    publication: targetPublication,
    mapping: targetMapping,
    releaseProgram: targetProgram,
    fence: targetFence
  });
  const promotion: StoredSubscriptionRuntimeBindingPromotion = {
    ...checkpointBase,
    planSha256
  };
  return {
    status: 'READY_TO_PROMOTE',
    manifest,
    identity,
    planSha256,
    source: {
      publication: clone(source.publication),
      mapping: clone(source.mapping),
      releaseProgram: clone(source.releaseProgram)
    },
    target: {
      publication: targetPublication,
      mapping: targetMapping,
      releaseProgram: targetProgram,
      fence: targetFence,
      promotion
    }
  };
}

function buildReplayPlan(
  manifest: SubscriptionLegacyBindingPromotionManifest,
  snapshot: SubscriptionLegacyBindingPromotionSnapshot
): SubscriptionLegacyBindingPromotionPlan {
  const identity = subscriptionLegacyBindingPromotionIdentity(manifest);
  const promotion = snapshot.promotion;
  const publication = snapshot.publication;
  const mapping = snapshot.mapping;
  const releaseProgram = snapshot.releaseProgram;
  const fence = snapshot.fence;
  if (!promotion || !publication || !mapping || !releaseProgram || !fence) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PARTIAL_STATE');
  }
  const compatibility = publicationAdapterRuntimeCompatibility(LK_NODE_RED_ANNUAL_BOOKING_V1);
  if (!snapshot.type || snapshot.type.subscriptionTypeId !== manifest.subscriptionTypeId
    || snapshot.type.state !== 'ACTIVE'
    || snapshot.type.currentPolicyVersion !== manifest.policyVersion
    || !snapshot.policy || snapshot.policy.subscriptionTypeId !== manifest.subscriptionTypeId
    || snapshot.policy.version !== manifest.policyVersion
    || snapshot.policy.modelVersion !== 3 || snapshot.policy.status !== 'PUBLISHED') {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_REPLAY_POLICY_CONFLICT');
  }
  let compiledProjection;
  try {
    assertPolicySupportedByPublicationAdapter(LK_NODE_RED_ANNUAL_BOOKING_V1, snapshot.policy);
    compiledProjection = compileSubscriptionRuntimeProjection(snapshot.policy);
  } catch {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_REPLAY_POLICY_CONFLICT');
  }
  validateStoredSubscriptionPolicyPublication(publication);
  validateStoredSubscriptionProviderMapping(mapping);
  validateStoredSubscriptionProjectionFence(fence);
  const checkpointBase = buildPromotionCheckpointBase({
    manifest,
    identity,
    publication,
    mapping,
    releaseProgram,
    fence,
    compatibility
  });
  const planSha256 = buildPlanHash({
    identity,
    checkpointBase,
    publication,
    mapping,
    releaseProgram,
    fence
  });
  const expectedPromotion: StoredSubscriptionRuntimeBindingPromotion = {
    ...checkpointBase,
    planSha256
  };
  if (publication.schemaVersion !== 3 || publication.state !== 'PUBLISHED'
    || publication.publicationId !== manifest.publication.publicationId
    || publication.subscriptionTypeId !== manifest.subscriptionTypeId
    || publication.policyVersion !== manifest.policyVersion
    || publication.mappingId !== manifest.mapping.mappingId
    || !isDeepStrictEqual(publication.runtimeProjection, compiledProjection)
    || publication.policyDigest !== computeSubscriptionRuntimeProjectionDigest(compiledProjection)
    || !isDeepStrictEqual(publication.runtimeCompatibility, compatibility)
    || mapping.state !== 'VERIFIED'
    || mapping.mappingId !== manifest.mapping.mappingId
    || mapping.tenantId !== manifest.tenantId
    || mapping.provider !== 'VIVA'
    || mapping.providerProductId !== manifest.providerProductId
    || !isDeepStrictEqual(mapping.providerScope, manifest.providerScope)
    || mapping.subscriptionTypeId !== manifest.subscriptionTypeId
    || mapping.revision !== manifest.mapping.sourceRevision + 1
    || mapping.evidenceRef !== manifest.providerEvidenceRef
    || mapping.verifiedAt !== manifest.promotedAt
    || mapping.verifiedBy !== manifest.actorId
    || mapping.updatedAt !== manifest.promotedAt
    || mapping.updatedBy !== manifest.actorId
    || releaseProgram.state !== 'PAUSED'
    || releaseProgram.releaseProgramId !== manifest.releaseProgram.releaseProgramId
    || releaseProgram.subscriptionTypeId !== manifest.subscriptionTypeId
    || releaseProgram.stationId !== manifest.stationId
    || releaseProgram.revision !== manifest.releaseProgram.sourceRevision + 1
    || releaseProgram.updatedAt !== manifest.promotedAt
    || releaseProgram.phases.filter((phase) =>
      phase.releasePhaseId === manifest.releaseProgram.releasePhaseId
      && phase.providerProductRef === PITER_PROVIDER_PRODUCT_ID).length !== 1
    || fence.fenceId !== subscriptionProjectionFenceId(manifest.subscriptionTypeId)
    || fence.bindingRevision !== 1
    || fence.coordinationRevision !== 1
    || fence.lastProjectorReconciliationDigest !== null
    || fence.bindingDigest !== subscriptionProjectionFenceBindingDigest(fence.binding)
    || !isDeepStrictEqual(promotion, expectedPromotion)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_IMMUTABLE_CONFLICT');
  }
  return {
    status: 'EXACT_REPLAY', manifest, identity, planSha256, source: null,
    target: { publication, mapping, releaseProgram, fence, promotion }
  };
}

export function buildSubscriptionLegacyBindingPromotionPlan(
  input: unknown,
  snapshot: SubscriptionLegacyBindingPromotionSnapshot
): SubscriptionLegacyBindingPromotionPlan {
  const manifest = parseSubscriptionLegacyBindingPromotionManifest(input);
  return rebuildSubscriptionLegacyBindingPromotionPlan(manifest, snapshot);
}

export function rebuildSubscriptionLegacyBindingPromotionPlan(
  manifest: SubscriptionLegacyBindingPromotionManifest,
  snapshot: SubscriptionLegacyBindingPromotionSnapshot
): SubscriptionLegacyBindingPromotionPlan {
  if (snapshot.promotion) return buildReplayPlan(manifest, snapshot);
  if (snapshot.fence || snapshot.publication?.schemaVersion === 3
    || snapshot.releaseProgram?.state !== 'DRAFT'
    || snapshot.releaseProgram?.phases.some((phase) => phase.providerProductRef !== null)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PARTIAL_STATE');
  }
  return buildReadyPlan(manifest, snapshot);
}

export function validateSubscriptionLegacyBindingPromotionAttestations(input: {
  env: NodeJS.ProcessEnv;
  manifest: SubscriptionLegacyBindingPromotionManifest;
  planSha256: Digest;
  actualTargetSha256: Digest;
  database: string;
  now?: Date;
  requireApplyConfirm: boolean;
}): void {
  const { env, manifest } = input;
  const exact = (name: string, expected: string, code: string): void => {
    if (String(env[name] ?? '').trim() !== expected) fail(code);
  };
  exact('SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED', 'true', 'SUBSCRIPTIONS_BINDING_PROMOTION_RUNTIME_CONTRACTS_REQUIRED');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED', 'true', 'SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_DISABLED');
  exact('SUBSCRIPTIONS_AUTO_CREATE_INDEXES', 'false', 'SUBSCRIPTIONS_BINDING_PROMOTION_AUTO_INDEXES_FORBIDDEN');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_SHA256', manifest.inputSha256, 'SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_PLAN_SHA256', input.planSha256, 'SUBSCRIPTIONS_BINDING_PROMOTION_PLAN_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_TARGET_SHA256', input.actualTargetSha256, 'SUBSCRIPTIONS_BINDING_PROMOTION_TARGET_ATTESTATION_MISMATCH');
  if (manifest.targetSha256 !== input.actualTargetSha256) fail('SUBSCRIPTIONS_BINDING_PROMOTION_TARGET_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_APPROVAL_REF', manifest.approvalRef, 'SUBSCRIPTIONS_BINDING_PROMOTION_APPROVAL_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_EXPECTED_DB', input.database, 'SUBSCRIPTIONS_BINDING_PROMOTION_DATABASE_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_SUBSCRIPTION_TYPE_ID', manifest.subscriptionTypeId, 'SUBSCRIPTIONS_BINDING_PROMOTION_IDENTITY_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_PROVIDER_PRODUCT_ID', manifest.providerProductId, 'SUBSCRIPTIONS_BINDING_PROMOTION_IDENTITY_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_ID', manifest.publication.publicationId, 'SUBSCRIPTIONS_BINDING_PROMOTION_IDENTITY_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_ID', manifest.mapping.mappingId, 'SUBSCRIPTIONS_BINDING_PROMOTION_IDENTITY_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_RELEASE_PROGRAM_ID', manifest.releaseProgram.releaseProgramId, 'SUBSCRIPTIONS_BINDING_PROMOTION_IDENTITY_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_RELEASE_PHASE_ID', manifest.releaseProgram.releasePhaseId, 'SUBSCRIPTIONS_BINDING_PROMOTION_IDENTITY_ATTESTATION_MISMATCH');
  exact('SUBSCRIPTIONS_BINDING_PROMOTION_ACTOR_ID', manifest.actorId, 'SUBSCRIPTIONS_BINDING_PROMOTION_ACTOR_ATTESTATION_MISMATCH');
  const maxStalenessRaw = String(env.SUBSCRIPTIONS_BINDING_PROMOTION_MAX_STALENESS_SECONDS ?? '').trim();
  if (!/^\d+$/.test(maxStalenessRaw) || Number(maxStalenessRaw) < 1) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_MAX_STALENESS_INVALID');
  }
  const nowMs = (input.now ?? new Date()).getTime();
  const coverageMs = Date.parse(manifest.evidence.coverageThrough);
  const promotedMs = Date.parse(manifest.promotedAt);
  if (coverageMs > nowMs || nowMs - coverageMs > Number(maxStalenessRaw) * 1000) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_EVIDENCE_STALE');
  }
  if (promotedMs > nowMs || nowMs - promotedMs > Number(maxStalenessRaw) * 1000) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PROMOTED_AT_INVALID');
  }
  if (input.requireApplyConfirm) {
    exact('SUBSCRIPTIONS_BINDING_PROMOTION_APPLY_CONFIRM', SUBSCRIPTION_LEGACY_BINDING_PROMOTION_CONFIRM, 'SUBSCRIPTIONS_BINDING_PROMOTION_APPLY_CONFIRM_INVALID');
  }
}

export function subscriptionLegacyBindingPromotionResult(
  plan: SubscriptionLegacyBindingPromotionPlan,
  status: SubscriptionLegacyBindingPromotionResult['status'],
  write: boolean
): SubscriptionLegacyBindingPromotionResult {
  return {
    status,
    write,
    promotionId: plan.identity.promotionId,
    subscriptionTypeId: plan.identity.subscriptionTypeId,
    providerProductId: plan.identity.providerProductId,
    publicationId: plan.identity.publicationId,
    mappingId: plan.identity.mappingId,
    releaseProgramId: plan.identity.releaseProgramId,
    releasePhaseId: plan.identity.releasePhaseId,
    inputSha256: plan.manifest.inputSha256,
    planSha256: plan.planSha256,
    targetSha256: plan.manifest.targetSha256,
    sourceItemCount: 24,
    rejectedItemCount: 0,
    duplicateIdentityCount: 0
  };
}

export function assertSubscriptionLegacyBindingPromotionPlanExact(
  expected: SubscriptionLegacyBindingPromotionPlan,
  actual: SubscriptionLegacyBindingPromotionPlan
): void {
  if (expected.planSha256 !== actual.planSha256
    || !isDeepStrictEqual(expected.target, actual.target)
    || !isDeepStrictEqual(expected.identity, actual.identity)) {
    fail('SUBSCRIPTIONS_BINDING_PROMOTION_PLAN_CHANGED');
  }
}

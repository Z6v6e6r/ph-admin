import { createHash, createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { subscriptionProviderScopeMatchesProjection } from './subscription-provider-scope';
import {
  buildSubscriptionInstancePolicyResolution,
  subscriptionPublicationHistoryMatchesResolution
} from './subscription-instance-policy-resolution';
import {
  resolveSubscriptionSalePeriod,
  validateSubscriptionSalePeriodHistory
} from './subscription-sale-period-resolver';
import {
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionInstance,
  validateStoredSubscriptionInstanceProjectorCheckpoint,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProjectionFence,
  validateStoredSubscriptionProviderMapping
} from './subscription-runtime-contracts';
import {
  subscriptionProjectionFenceBindingDigest,
  subscriptionProjectionFenceId
} from './subscription-projection-fence';
import { computeSubscriptionClientRefHash } from './subscription-trusted-shadow-adapter.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionInstance,
  StoredSubscriptionInstanceProjectorCheckpoint,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProjectionFence,
  SubscriptionInstanceState,
  SubscriptionRuntimeCompatibility
} from './subscriptions.types';

const TOP_LEVEL_KEYS = [
  'schemaVersion', 'sourceMode', 'evidenceStatus', 'approvalRef', 'tenantId', 'provider',
  'providerProductId', 'providerScope', 'binding', 'producer', 'authority', 'snapshot', 'records'
] as const;
const SCOPE_KEYS = ['kind', 'scopeId'] as const;
const BINDING_KEYS = [
  'fenceId', 'fenceRevision', 'fenceDigest', 'mappingId', 'mappingRevision',
  'subscriptionTypeId', 'publicationId', 'policyVersion',
  'policyDigest', 'releaseProgramId', 'releaseProgramRevision', 'releasePhaseId',
  'runtimeCompatibility'
] as const;
const COMPATIBILITY_KEYS = ['adapterId', 'contractVersion', 'capabilityDigest'] as const;
const PRODUCER_KEYS = [
  'producerId', 'contractVersion', 'producerCapabilityDigest', 'sourceContractDigest'
] as const;
const AUTHORITY_KEYS = [
  'sourceSystem', 'resourceKind', 'selectionMode', 'snapshotSemantics',
  'endpointContractDigest', 'queryContractDigest', 'paginationContractDigest',
  'normalizationContractDigest', 'stateMappingDigest', 'moneyMappingDigest',
  'completenessEvidenceRef', 'pageCount', 'sourceItemCount', 'rejectedItemCount',
  'duplicateIdentityCount'
] as const;
const SNAPSHOT_KEYS = [
  'snapshotId', 'snapshotDigest', 'startedAt', 'coverageThrough', 'sourceEvidenceRef',
  'resultEvidenceRef'
] as const;
const RECORD_KEYS = [
  'providerClientId', 'clientSubscriptionId', 'homeStationId', 'purchasePrice', 'state',
  'purchasedAt', 'activeFrom', 'activeTo', 'frozenUntil', 'renewalPredecessorId',
  'renewalSuccessorId', 'paymentEvidenceRef', 'providerInstanceEvidenceRef',
  'lastReadBackEvidenceRef'
] as const;
const MONEY_KEYS = ['amountMinor', 'currency'] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_PATTERN = /^[a-z][a-z0-9_]{2,63}:sha256:[a-f0-9]{64}$/;
const PAYMENT_EVIDENCE_PATTERN = /^provider_payment_evidence:sha256:[a-f0-9]{64}$/;
const INSTANCE_EVIDENCE_PATTERN = /^provider_instance_evidence:sha256:[a-f0-9]{64}$/;
const READBACK_EVIDENCE_PATTERN = /^provider_readback_evidence:sha256:[a-f0-9]{64}$/;
const APPROVAL_PATTERN = /^provider_approval:sha256:[a-f0-9]{64}$/;
const STATES = new Set<SubscriptionInstanceState>([
  'PENDING_ACTIVATION', 'CANCELLED_PRE_ACTIVATION', 'REFUNDED_PRE_ACTIVATION', 'ACTIVE',
  'FROZEN', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'REVOKED'
]);
const MAX_RECORDS = 500;

type JsonObject = Record<string, unknown>;

interface ParsedManifest {
  sourceContract: SubscriptionInstanceProjectionSourceContract;
  approvalRef: string;
  inputSha256: `sha256:${string}`;
  tenantId: string;
  providerProductId: string;
  providerScope: StoredSubscriptionInstanceProjectorCheckpoint['providerScope'];
  binding: StoredSubscriptionInstanceProjectorCheckpoint['binding'];
  producer: StoredSubscriptionInstanceProjectorCheckpoint['producer'];
  authorityDigest: `sha256:${string}`;
  snapshot: {
    snapshotId: string;
    snapshotDigest: `sha256:${string}`;
    startedAt: string;
    coverageThrough: string;
    sourceEvidenceRef: string;
    resultEvidenceRef: string;
  };
  records: JsonObject[];
}

export type SubscriptionInstanceProjectionSourceContract =
  | 'PRODUCTION_COMPLETE'
  | 'DEV_EXACT_ALLOWLIST';

export interface SubscriptionInstanceProjectionPlan {
  inputSha256: `sha256:${string}`;
  planSha256: `sha256:${string}`;
  approvalRef: string;
  instances: StoredSubscriptionInstance[];
  checkpoint: StoredSubscriptionInstanceProjectorCheckpoint;
}

export interface SubscriptionInstanceProjectionResult {
  status: 'READY_TO_INSERT' | 'INSERTED' | 'EXACT_REPLAY';
  write: boolean;
  sourceItemCount: number;
  inputSha256: string;
  planSha256: string;
  checkpointId: string;
}

export interface SubscriptionInstanceProjectionPlanFingerprintResult {
  status: 'PLAN_FINGERPRINT';
  write: false;
  sourceItemCount: number;
  inputSha256: string;
  planSha256: string;
  checkpointId: string;
}

function fail(code: string): never {
  throw new SubscriptionRuntimeContractError(code);
}

const exactObject = (value: unknown, keys: readonly string[], code: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const object = value as JsonObject;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
  return object;
};

const requiredPattern = (value: unknown, pattern: RegExp, code: string): string => {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code);
  return value;
};

const requiredInstant = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(code);
  return value;
};

const optionalInstant = (value: unknown, code: string): string | null =>
  value === null ? null : requiredInstant(value, code);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as JsonObject).sort()
    .map((key) => [key, stableValue((value as JsonObject)[key])]));
};

const sha256 = (value: unknown): `sha256:${string}` => `sha256:${createHash('sha256')
  .update(JSON.stringify(stableValue(value)))
  .digest('hex')}`;

const parseCompatibility = (value: unknown): SubscriptionRuntimeCompatibility => {
  const object = exactObject(
    value,
    COMPATIBILITY_KEYS,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_COMPATIBILITY_INVALID'
  );
  const compatibility = {
    adapterId: requiredPattern(
      object.adapterId,
      ID_PATTERN,
      'SUBSCRIPTIONS_INSTANCE_PROJECTOR_COMPATIBILITY_INVALID'
    ),
    contractVersion: object.contractVersion as number,
    capabilityDigest: requiredPattern(
      object.capabilityDigest,
      DIGEST_PATTERN,
      'SUBSCRIPTIONS_INSTANCE_PROJECTOR_COMPATIBILITY_INVALID'
    ) as `sha256:${string}`
  };
  if (!Number.isSafeInteger(compatibility.contractVersion) || compatibility.contractVersion < 1) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_COMPATIBILITY_INVALID');
  }
  return compatibility;
};

const parseManifest = (
  input: unknown,
  sourceContract: SubscriptionInstanceProjectionSourceContract = 'PRODUCTION_COMPLETE'
): ParsedManifest => {
  const value = exactObject(input, TOP_LEVEL_KEYS, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_SHAPE_INVALID');
  const expectedSchemaVersion = sourceContract === 'PRODUCTION_COMPLETE' ? 2 : 3;
  const expectedSourceMode = sourceContract === 'PRODUCTION_COMPLETE'
    ? 'VIVA_AUTHORITATIVE_COMPLETE_SUBSCRIPTION_INSTANCE_SNAPSHOT'
    : 'DEV_VIVA_EXACT_CLIENT_SUBSCRIPTION_ALLOWLIST';
  if (value.schemaVersion !== expectedSchemaVersion
    || value.sourceMode !== expectedSourceMode
    || value.provider !== 'VIVA') {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SOURCE_INVALID');
  }
  if (value.evidenceStatus !== 'APPROVED') {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_EVIDENCE_NOT_APPROVED');
  }
  const tenantId = requiredPattern(value.tenantId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TENANT_INVALID');
  const providerProductId = requiredPattern(
    value.providerProductId,
    ID_PATTERN,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRODUCT_INVALID'
  );
  const scopeObject = exactObject(value.providerScope, SCOPE_KEYS, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_INVALID');
  if (!['TENANT', 'STATION', 'STATION_SET'].includes(String(scopeObject.kind))) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_INVALID');
  }
  const providerScope = {
    kind: scopeObject.kind as StoredSubscriptionInstanceProjectorCheckpoint['providerScope']['kind'],
    scopeId: requiredPattern(scopeObject.scopeId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_INVALID')
  };
  const bindingObject = exactObject(value.binding, BINDING_KEYS, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID');
  const mappingRevision = bindingObject.mappingRevision as number;
  const policyVersion = bindingObject.policyVersion as number;
  const releaseProgramRevision = bindingObject.releaseProgramRevision as number;
  if (!Number.isSafeInteger(mappingRevision) || mappingRevision < 1
    || !Number.isSafeInteger(policyVersion) || policyVersion < 1
    || !Number.isSafeInteger(releaseProgramRevision) || releaseProgramRevision < 1) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID');
  }
  const binding = {
    fenceId: requiredPattern(bindingObject.fenceId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID'),
    fenceRevision: bindingObject.fenceRevision as number,
    fenceDigest: requiredPattern(bindingObject.fenceDigest, DIGEST_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID') as `sha256:${string}`,
    mappingId: requiredPattern(bindingObject.mappingId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID'),
    mappingRevision,
    subscriptionTypeId: requiredPattern(bindingObject.subscriptionTypeId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID'),
    publicationId: requiredPattern(bindingObject.publicationId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID'),
    policyVersion,
    policyDigest: requiredPattern(bindingObject.policyDigest, DIGEST_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID') as `sha256:${string}`,
    releaseProgramId: requiredPattern(bindingObject.releaseProgramId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID'),
    releaseProgramRevision,
    releasePhaseId: requiredPattern(bindingObject.releasePhaseId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID'),
    runtimeCompatibility: parseCompatibility(bindingObject.runtimeCompatibility)
  };
  if (!Number.isSafeInteger(binding.fenceRevision) || binding.fenceRevision < 1) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_INVALID');
  }
  const producerObject = exactObject(value.producer, PRODUCER_KEYS, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRODUCER_INVALID');
  if (producerObject.producerId !== 'VIVA_ANNUAL_SUBSCRIPTION_INSTANCE_PROJECTOR'
    || producerObject.contractVersion !== 2) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRODUCER_INVALID');
  }
  const producer = {
    producerId: 'VIVA_ANNUAL_SUBSCRIPTION_INSTANCE_PROJECTOR' as const,
    contractVersion: 2 as const,
    producerCapabilityDigest: requiredPattern(producerObject.producerCapabilityDigest, DIGEST_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRODUCER_INVALID') as `sha256:${string}`,
    sourceContractDigest: requiredPattern(producerObject.sourceContractDigest, DIGEST_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRODUCER_INVALID') as `sha256:${string}`,
    authorityDigest: '' as `sha256:${string}`
  };
  const authority = exactObject(
    value.authority,
    AUTHORITY_KEYS,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_INVALID'
  );
  const expectedSelectionMode = sourceContract === 'PRODUCTION_COMPLETE'
    ? 'EXACT_PRODUCT_AND_SCOPE'
    : 'EXACT_CLIENT_SUBSCRIPTION_ALLOWLIST';
  const expectedSnapshotSemantics = sourceContract === 'PRODUCTION_COMPLETE'
    ? 'COMPLETE_AS_OF'
    : 'EXACT_ALLOWLIST_AS_OF';
  if (authority.sourceSystem !== 'VIVA'
    || authority.resourceKind !== 'SUBSCRIPTION_INSTANCE'
    || authority.selectionMode !== expectedSelectionMode
    || authority.snapshotSemantics !== expectedSnapshotSemantics) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_INVALID');
  }
  for (const field of [
    'endpointContractDigest', 'queryContractDigest', 'paginationContractDigest',
    'normalizationContractDigest', 'stateMappingDigest', 'moneyMappingDigest'
  ] as const) {
    requiredPattern(authority[field], DIGEST_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_INVALID');
  }
  requiredPattern(
    authority.completenessEvidenceRef,
    EVIDENCE_PATTERN,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_INVALID'
  );
  for (const field of ['pageCount', 'sourceItemCount', 'rejectedItemCount', 'duplicateIdentityCount'] as const) {
    if (!Number.isSafeInteger(authority[field]) || Number(authority[field]) < 0) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_INVALID');
    }
  }
  if (Number(authority.pageCount) < 1
    || Number(authority.rejectedItemCount) !== 0
    || Number(authority.duplicateIdentityCount) !== 0) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_INCOMPLETE');
  }
  const authorityDigest = sha256(authority);
  producer.authorityDigest = authorityDigest;
  const snapshotObject = exactObject(value.snapshot, SNAPSHOT_KEYS, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_INVALID');
  const snapshot = {
    snapshotId: requiredPattern(snapshotObject.snapshotId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_INVALID'),
    snapshotDigest: requiredPattern(snapshotObject.snapshotDigest, DIGEST_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_INVALID') as `sha256:${string}`,
    startedAt: requiredInstant(snapshotObject.startedAt, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_INVALID'),
    coverageThrough: requiredInstant(snapshotObject.coverageThrough, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_INVALID'),
    sourceEvidenceRef: requiredPattern(snapshotObject.sourceEvidenceRef, EVIDENCE_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_EVIDENCE_REF_INVALID'),
    resultEvidenceRef: requiredPattern(snapshotObject.resultEvidenceRef, EVIDENCE_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_EVIDENCE_REF_INVALID')
  };
  if (Date.parse(snapshot.startedAt) > Date.parse(snapshot.coverageThrough)) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_TIME_INVALID');
  }
  if (!Array.isArray(value.records) || value.records.length < 1 || value.records.length > MAX_RECORDS) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_RECORD_COUNT_INVALID');
  }
  const recordValues = value.records as unknown[];
  if (Number(authority.sourceItemCount) !== recordValues.length) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_COUNT_MISMATCH');
  }
  const records = recordValues.map((record: unknown) => exactObject(
    record,
    RECORD_KEYS,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_RECORD_SHAPE_INVALID'
  ));
  return {
    sourceContract,
    approvalRef: requiredPattern(value.approvalRef, APPROVAL_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_REF_INVALID'),
    inputSha256: sha256(value),
    tenantId,
    providerProductId,
    providerScope,
    binding,
    producer,
    authorityDigest,
    snapshot,
    records
  };
};

export function subscriptionInstanceProjectionInputFingerprint(
  input: unknown,
  sourceContract: SubscriptionInstanceProjectionSourceContract = 'PRODUCTION_COMPLETE'
): string {
  return parseManifest(input, sourceContract).inputSha256;
}

export function subscriptionInstanceProjectionTargetFingerprint(
  uriValue: unknown,
  databaseValue: unknown
): string {
  const uri = String(uriValue ?? '').trim();
  const database = String(databaseValue ?? '').trim();
  const match = /^(mongodb(?:\+srv)?):\/\/([^/?#]+)(.*)$/i.exec(uri);
  if (!match || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(database)) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_INVALID');
  }
  const resolvedMatch = match as RegExpExecArray;
  const hosts = resolvedMatch[2]
    .slice(resolvedMatch[2].lastIndexOf('@') + 1)
    .trim()
    .toLowerCase();
  if (!hosts || /[\s/@]/.test(hosts)) fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_INVALID');
  return sha256({
    scheme: resolvedMatch[1].toLowerCase(),
    hosts,
    database,
    connectionSuffix: resolvedMatch[3] || ''
  });
}

export function buildSubscriptionInstanceProjectionPlan(
  input: unknown,
  pepperValue: unknown,
  publicationHistory: readonly StoredSubscriptionPolicyPublication[],
  sourceContract: SubscriptionInstanceProjectionSourceContract = 'PRODUCTION_COMPLETE'
): SubscriptionInstanceProjectionPlan {
  const parsed = parseManifest(input, sourceContract);
  const pepper = String(pepperValue ?? '');
  if (Buffer.byteLength(pepper, 'utf8') < 32) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_HASH_PEPPER_REQUIRED');
  }
  const compareCodeUnits = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  const sortedRecords = [...parsed.records].sort((left, right) => compareCodeUnits(
    `${String(left.providerClientId)}\0${String(left.clientSubscriptionId)}`,
    `${String(right.providerClientId)}\0${String(right.clientSubscriptionId)}`
  ));
  if (sha256(sortedRecords) !== parsed.snapshot.snapshotDigest) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_DIGEST_MISMATCH');
  }
  if (!Array.isArray(publicationHistory) || publicationHistory.length < 1) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_REQUIRED');
  }
  const validatedHistory = validateSubscriptionSalePeriodHistory(publicationHistory);
  if (validatedHistory.kind === 'AMBIGUOUS') {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_AMBIGUOUS');
  }
  if (validatedHistory.kind !== 'VALID') {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID');
  }
  const currentPublication = validatedHistory.publications.at(-1)!;
  if (currentPublication.publicationId !== parsed.binding.publicationId
    || currentPublication.policyVersion !== parsed.binding.policyVersion
    || currentPublication.policyDigest !== parsed.binding.policyDigest
    || currentPublication.mappingId !== parsed.binding.mappingId) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PUBLICATION_NOT_CURRENT');
  }
  const identities = new Set<string>();
  const resolvedInstances = sortedRecords.map((record): {
    instance: StoredSubscriptionInstance;
    selection: NonNullable<StoredSubscriptionInstanceProjectorCheckpoint['policyResolution']>['selections'][number];
  } => {
    const providerClientId = requiredPattern(record.providerClientId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_RECORD_ID_INVALID');
    const clientSubscriptionId = requiredPattern(record.clientSubscriptionId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_RECORD_ID_INVALID');
    const identity = `${providerClientId}\0${clientSubscriptionId}`;
    if (identities.has(identity)) fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_DUPLICATE_RECORD');
    identities.add(identity);
    const homeStationId = requiredPattern(record.homeStationId, ID_PATTERN, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_STATION_INVALID');
    const money = exactObject(record.purchasePrice, MONEY_KEYS, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRICE_INVALID');
    if (!Number.isSafeInteger(money.amountMinor) || Number(money.amountMinor) < 0 || money.currency !== 'RUB') {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRICE_INVALID');
    }
    if (!STATES.has(record.state as SubscriptionInstanceState)) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_STATE_INVALID');
    }
    const state = record.state as SubscriptionInstanceState;
    const purchasedAt = requiredInstant(record.purchasedAt, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TIME_INVALID');
    if (Date.parse(purchasedAt) > Date.parse(parsed.snapshot.coverageThrough)) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_TIME_INVALID');
    }
    const activeFrom = optionalInstant(record.activeFrom, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TIME_INVALID');
    const activeTo = optionalInstant(record.activeTo, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TIME_INVALID');
    const frozenUntil = optionalInstant(record.frozenUntil, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TIME_INVALID');
    const paymentEvidenceRef = requiredPattern(
      record.paymentEvidenceRef,
      PAYMENT_EVIDENCE_PATTERN,
      'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PAYMENT_EVIDENCE_REQUIRED'
    );
    const providerInstanceEvidenceRef = requiredPattern(
      record.providerInstanceEvidenceRef,
      INSTANCE_EVIDENCE_PATTERN,
      'SUBSCRIPTIONS_INSTANCE_PROJECTOR_INSTANCE_EVIDENCE_REQUIRED'
    );
    const lastReadBackEvidenceRef = requiredPattern(
      record.lastReadBackEvidenceRef,
      READBACK_EVIDENCE_PATTERN,
      'SUBSCRIPTIONS_INSTANCE_PROJECTOR_READBACK_EVIDENCE_REQUIRED'
    );
    if (record.renewalPredecessorId !== null || record.renewalSuccessorId !== null) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_RENEWAL_LINK_UNSUPPORTED');
    }
    if ((state === 'PENDING_ACTIVATION'
      && (activeFrom !== null || activeTo !== null || frozenUntil !== null))
      || (state !== 'FROZEN' && frozenUntil !== null)
      || (activeFrom !== null
        && Date.parse(activeFrom) > Date.parse(parsed.snapshot.coverageThrough))) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_STATE_TIME_MISMATCH');
    }
    const resolution = resolveSubscriptionSalePeriod({
      purchasedAt,
      publications: publicationHistory
    });
    if (resolution.kind === 'MALFORMED') {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID');
    }
    if (resolution.kind === 'AMBIGUOUS') {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_AMBIGUOUS');
    }
    if (resolution.kind === 'NO_MATCH') {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_NOT_FOUND');
    }
    const selectedPublication = resolution.publication;
    if (selectedPublication.state === 'DISABLED_FOR_NEW_OPERATIONS') {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SELECTED_PUBLICATION_DISABLED');
    }
    const document: StoredSubscriptionInstance = {
      schemaVersion: 1,
      subscriptionInstanceId: `subscription_instance:${createHmac('sha256', pepper)
        .update(['subscription-instance-id:v1', parsed.tenantId, providerClientId, clientSubscriptionId].join('\0'))
        .digest('hex')}`,
      tenantId: parsed.tenantId,
      subscriptionTypeId: parsed.binding.subscriptionTypeId,
      policyVersion: selectedPublication.policyVersion,
      policyDigest: selectedPublication.policyDigest,
      mappingId: selectedPublication.mappingId,
      provider: 'VIVA',
      providerProductId: parsed.providerProductId,
      providerClientId,
      clientSubscriptionId,
      clientRefHash: computeSubscriptionClientRefHash({ pepper, tenantId: parsed.tenantId, providerClientId }),
      homeStationId,
      releaseProgramId: parsed.binding.releaseProgramId,
      releasePhaseId: parsed.binding.releasePhaseId,
      purchasePrice: { amountMinor: Number(money.amountMinor), currency: 'RUB' },
      state,
      purchasedAt,
      activeFrom,
      activeTo,
      frozenUntil,
      renewalPredecessorId: null,
      renewalSuccessorId: null,
      evidence: {
        paymentEvidenceRef,
        providerInstanceEvidenceRef,
        lastReadBackEvidenceRef
      },
      reconciliation: {
        state: 'CURRENT',
        asOf: parsed.snapshot.coverageThrough,
        evidenceRef: parsed.snapshot.sourceEvidenceRef
      },
      revision: 1,
      createdAt: parsed.snapshot.coverageThrough,
      updatedAt: parsed.snapshot.coverageThrough
    };
    validateStoredSubscriptionInstance(document);
    return {
      instance: document,
      selection: {
        subscriptionInstanceId: document.subscriptionInstanceId,
        providerClientId,
        clientSubscriptionId,
        purchasedAt,
        publicationId: selectedPublication.publicationId,
        policyVersion: selectedPublication.policyVersion,
        policyDigest: selectedPublication.policyDigest as `sha256:${string}`,
        mappingId: selectedPublication.mappingId
      }
    };
  }).sort((left, right) => compareCodeUnits(
    left.instance.subscriptionInstanceId,
    right.instance.subscriptionInstanceId
  ));
  const instances = resolvedInstances.map(({ instance }) => instance);
  const selections = resolvedInstances.map(({ selection }) => selection);
  const checkpointId = `subscription_instance_projector_checkpoint:${createHash('sha256')
    .update(JSON.stringify(stableValue({
      tenantId: parsed.tenantId,
      provider: 'VIVA',
      providerProductId: parsed.providerProductId,
      providerScope: parsed.providerScope
    })))
    .digest('hex')}`;
  const reconciliationDigest = sha256({
    inputSha256: parsed.inputSha256,
    snapshotDigest: parsed.snapshot.snapshotDigest,
    instanceDigests: instances.map((instance) => sha256(instance))
  });
  const checkpoint: StoredSubscriptionInstanceProjectorCheckpoint = {
    schemaVersion: 3,
    checkpointId,
    tenantId: parsed.tenantId,
    provider: 'VIVA',
    providerProductId: parsed.providerProductId,
    providerScope: parsed.providerScope,
    approvalRef: parsed.approvalRef,
    binding: parsed.binding,
    producer: parsed.producer,
    policyResolution: buildSubscriptionInstancePolicyResolution(publicationHistory, selections),
    state: 'CURRENT',
    coverage: parsed.sourceContract === 'PRODUCTION_COMPLETE'
      ? {
        kind: 'CONSISTENT_FULL_SNAPSHOT',
        snapshotId: parsed.snapshot.snapshotId,
        snapshotDigest: parsed.snapshot.snapshotDigest,
        coverageThrough: parsed.snapshot.coverageThrough,
        sourceItemCount: instances.length
      }
      : {
        kind: 'EXACT_ALLOWLIST_CANARY',
        clientSubscriptionIds: selections
          .map((selection) => selection.clientSubscriptionId)
          .sort() as [string, string],
        coverageThrough: parsed.snapshot.coverageThrough,
        sourceItemCount: 2
      },
    reconciliation: {
      runId: `subscription_instance_projector_run:${parsed.inputSha256.slice(7)}`,
      mode: 'INITIAL_FULL',
      startedAt: parsed.snapshot.startedAt,
      completedAt: parsed.snapshot.coverageThrough,
      sourceItemCount: instances.length,
      insertedCount: instances.length,
      updatedCount: 0,
      replayedCount: 0,
      terminalCount: 0,
      failureCount: 0,
      sourceEvidenceRef: parsed.snapshot.sourceEvidenceRef,
      resultEvidenceRef: parsed.snapshot.resultEvidenceRef,
      reconciliationDigest
    },
    failure: null,
    lease: null,
    revision: 1,
    createdAt: parsed.snapshot.coverageThrough,
    updatedAt: parsed.snapshot.coverageThrough
  };
  validateStoredSubscriptionInstanceProjectorCheckpoint(checkpoint);
  return {
    inputSha256: parsed.inputSha256,
    planSha256: sha256({ instances, checkpoint }),
    approvalRef: parsed.approvalRef,
    instances,
    checkpoint
  };
}

export function assertSubscriptionInstanceProjectionCheckBoundary(
  plan: SubscriptionInstanceProjectionPlan,
  env: NodeJS.ProcessEnv = process.env
): void {
  const enabled = (name: string): boolean => ['1', 'true', 'yes'].includes(
    String(env[name] ?? '').trim().toLowerCase()
  );
  if (!enabled('SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED')) fail('SUBSCRIPTIONS_RUNTIME_CONTRACTS_DISABLED');
  if (!enabled('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED')) fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_DISABLED');
  const expected: Array<[string, string, string]> = [
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_SHA256', plan.inputSha256, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_SHA256', plan.planSha256, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_REF', plan.approvalRef, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_RUNTIME_TENANT_ID', plan.checkpoint.tenantId, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TENANT_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_PROVIDER_PRODUCT_ID', plan.checkpoint.providerProductId, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRODUCT_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_KIND', plan.checkpoint.providerScope.kind, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_ID', plan.checkpoint.providerScope.scopeId, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_ATTESTATION_MISMATCH']
  ];
  for (const [name, value, code] of expected) {
    if (String(env[name] ?? '').trim() !== value) fail(code);
  }
  const database = String(env.SUBSCRIPTIONS_MONGODB_DB ?? '').trim();
  if (String(env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_EXPECTED_DB ?? '').trim() !== database) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_DATABASE_ATTESTATION_MISMATCH');
  }
  const target = subscriptionInstanceProjectionTargetFingerprint(
    env.SUBSCRIPTIONS_MONGODB_URI ?? env.MONGODB_URI,
    database
  );
  if (String(env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_SHA256 ?? '').trim() !== target) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_ATTESTATION_MISMATCH');
  }
  const autoIndexes = String(env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES ?? '').trim().toLowerCase();
  if (!['0', 'false', 'no'].includes(autoIndexes)) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTO_INDEX_FALSE_REQUIRED');
  }
}

function assertSubscriptionInstanceProjectionInputBoundary(
  parsed: ParsedManifest,
  apply: boolean,
  env: NodeJS.ProcessEnv = process.env
): void {
  const enabled = (name: string): boolean => ['1', 'true', 'yes'].includes(
    String(env[name] ?? '').trim().toLowerCase()
  );
  if (!enabled('SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED')) fail('SUBSCRIPTIONS_RUNTIME_CONTRACTS_DISABLED');
  if (!enabled('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED')) fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_DISABLED');
  const expected: Array<[string, string, string]> = [
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_SHA256', parsed.inputSha256, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_REF', parsed.approvalRef, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_RUNTIME_TENANT_ID', parsed.tenantId, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TENANT_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_PROVIDER_PRODUCT_ID', parsed.providerProductId, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRODUCT_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_KIND', parsed.providerScope.kind, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_ATTESTATION_MISMATCH'],
    ['SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_ID', parsed.providerScope.scopeId, 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_ATTESTATION_MISMATCH']
  ];
  for (const [name, value, code] of expected) {
    if (String(env[name] ?? '').trim() !== value) fail(code);
  }
  const database = String(env.SUBSCRIPTIONS_MONGODB_DB ?? '').trim();
  if (String(env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_EXPECTED_DB ?? '').trim() !== database) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_DATABASE_ATTESTATION_MISMATCH');
  }
  const target = subscriptionInstanceProjectionTargetFingerprint(
    env.SUBSCRIPTIONS_MONGODB_URI ?? env.MONGODB_URI,
    database
  );
  if (String(env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_SHA256 ?? '').trim() !== target) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_ATTESTATION_MISMATCH');
  }
  const autoIndexes = String(env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES ?? '').trim().toLowerCase();
  if (!['0', 'false', 'no'].includes(autoIndexes)) {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTO_INDEX_FALSE_REQUIRED');
  }
  if (apply && String(env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM ?? '').trim()
    !== 'APPLY_INITIAL_RUNTIME_INSTANCE_PROJECTION') {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM_REQUIRED');
  }
}

export function assertSubscriptionInstanceProjectionApplyBoundary(
  plan: SubscriptionInstanceProjectionPlan,
  env: NodeJS.ProcessEnv = process.env
): void {
  assertSubscriptionInstanceProjectionCheckBoundary(plan, env);
  if (String(env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM ?? '').trim()
    !== 'APPLY_INITIAL_RUNTIME_INSTANCE_PROJECTION') {
    fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM_REQUIRED');
  }
}

@Injectable()
export class SubscriptionProviderInstanceProjectorService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async planFingerprint(input: unknown): Promise<SubscriptionInstanceProjectionPlanFingerprintResult> {
    const parsed = this.prepareInput(input, false);
    await this.repository.connectReadOnly();
    const publicationHistory = await this.repository.runtimePolicyPublicationHistoryByType(
      parsed.binding.subscriptionTypeId
    );
    const plan = this.plan(input, publicationHistory);
    const fence = await this.assertPersistedBinding(plan, publicationHistory);
    await this.assertFenceUnchanged(fence, plan.checkpoint.binding.subscriptionTypeId);
    await this.assertPublicationHistoryUnchanged(plan);
    return {
      status: 'PLAN_FINGERPRINT',
      write: false,
      sourceItemCount: plan.instances.length,
      inputSha256: plan.inputSha256,
      planSha256: plan.planSha256,
      checkpointId: plan.checkpoint.checkpointId
    };
  }

  async check(input: unknown): Promise<SubscriptionInstanceProjectionResult> {
    const parsed = this.prepareInput(input, false);
    await this.repository.connectReadOnly();
    const publicationHistory = await this.repository.runtimePolicyPublicationHistoryByType(
      parsed.binding.subscriptionTypeId
    );
    const plan = this.plan(input, publicationHistory);
    assertSubscriptionInstanceProjectionCheckBoundary(plan);
    const fence = await this.assertPersistedBinding(plan, publicationHistory);
    const status = await this.repository.preflightInitialRuntimeInstanceProjection(plan);
    await this.assertFenceUnchanged(fence, plan.checkpoint.binding.subscriptionTypeId);
    await this.assertPublicationHistoryUnchanged(plan);
    return this.result(plan, status, false);
  }

  async apply(input: unknown): Promise<SubscriptionInstanceProjectionResult> {
    const parsed = this.prepareInput(input, true);
    await this.repository.connect();
    const publicationHistory = await this.repository.runtimePolicyPublicationHistoryByType(
      parsed.binding.subscriptionTypeId
    );
    const plan = this.plan(input, publicationHistory);
    assertSubscriptionInstanceProjectionApplyBoundary(plan);
    await this.assertPersistedBinding(plan, publicationHistory);
    const status = await this.repository.applyInitialRuntimeInstanceProjection(plan);
    return this.result(plan, status, status === 'INSERTED');
  }

  protected now(): Date {
    return new Date();
  }

  private prepareInput(input: unknown, apply: boolean): ParsedManifest {
    const parsed = parseManifest(input);
    assertSubscriptionInstanceProjectionInputBoundary(parsed, apply);
    const maxSeconds = Number(process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_MAX_STALENESS_SECONDS);
    const age = this.now().getTime() - Date.parse(parsed.snapshot.coverageThrough);
    if (!Number.isSafeInteger(maxSeconds) || maxSeconds < 1 || age < 0 || age > maxSeconds * 1000) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_NOT_CURRENT');
    }
    return parsed;
  }

  private plan(
    input: unknown,
    publicationHistory: readonly StoredSubscriptionPolicyPublication[]
  ): SubscriptionInstanceProjectionPlan {
    return buildSubscriptionInstanceProjectionPlan(
      input,
      process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER,
      publicationHistory
    );
  }

  private async assertPersistedBinding(
    plan: SubscriptionInstanceProjectionPlan,
    publicationHistory: readonly StoredSubscriptionPolicyPublication[]
  ): Promise<StoredSubscriptionProjectionFence | null> {
    const checkpoint = plan.checkpoint;
    const [mapping, releaseProgram, subscriptionType, fence] = await Promise.all([
      this.repository.runtimeProviderMappingByProviderIdentity({
        tenantId: checkpoint.tenantId,
        provider: 'VIVA',
        providerProductId: checkpoint.providerProductId,
        providerScopeKind: checkpoint.providerScope.kind,
        providerScopeId: checkpoint.providerScope.scopeId
      }),
      this.repository.releaseProgramById(checkpoint.binding.releaseProgramId),
      this.repository.subscriptionTypeById(checkpoint.binding.subscriptionTypeId),
      this.repository.runtimeProjectionFenceByType(checkpoint.binding.subscriptionTypeId)
    ]);
    const publication = publicationHistory.find((item) =>
      item.policyVersion === checkpoint.binding.policyVersion);
    if (!mapping || !publication || !releaseProgram || !subscriptionType
      || checkpoint.schemaVersion !== 3
      || !checkpoint.policyResolution
      || !subscriptionPublicationHistoryMatchesResolution(
        publicationHistory,
        checkpoint.policyResolution
      )) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_BINDING_NOT_FOUND');
    }
    validateStoredSubscriptionProviderMapping(mapping);
    validateStoredSubscriptionPolicyPublication(publication);
    const expectedFenceBinding = {
      mappingId: checkpoint.binding.mappingId,
      mappingRevision: checkpoint.binding.mappingRevision,
      subscriptionTypeId: checkpoint.binding.subscriptionTypeId,
      publicationId: checkpoint.binding.publicationId,
      policyVersion: checkpoint.binding.policyVersion,
      policyDigest: checkpoint.binding.policyDigest,
      runtimeCompatibility: checkpoint.binding.runtimeCompatibility
    };
    if (checkpoint.binding.fenceId !== subscriptionProjectionFenceId(
      checkpoint.binding.subscriptionTypeId
    )
      || checkpoint.binding.fenceDigest !== subscriptionProjectionFenceBindingDigest(
        expectedFenceBinding
      )
      || (!fence && checkpoint.binding.fenceRevision !== 1)) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_NOT_CURRENT');
    }
    if (fence) {
      validateStoredSubscriptionProjectionFence(fence);
      if (fence.fenceId !== checkpoint.binding.fenceId
        || fence.bindingRevision !== checkpoint.binding.fenceRevision
        || fence.bindingDigest !== checkpoint.binding.fenceDigest
        || fence.bindingDigest !== subscriptionProjectionFenceBindingDigest(fence.binding)
        || fence.binding.mappingId !== checkpoint.binding.mappingId
        || fence.binding.mappingRevision !== checkpoint.binding.mappingRevision
        || fence.binding.subscriptionTypeId !== checkpoint.binding.subscriptionTypeId
        || fence.binding.publicationId !== checkpoint.binding.publicationId
        || fence.binding.policyVersion !== checkpoint.binding.policyVersion
        || fence.binding.policyDigest !== checkpoint.binding.policyDigest) {
        fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_NOT_CURRENT');
      }
    }
    if (mapping.state !== 'VERIFIED'
      || mapping.mappingId !== checkpoint.binding.mappingId
      || mapping.revision !== checkpoint.binding.mappingRevision
      || mapping.subscriptionTypeId !== checkpoint.binding.subscriptionTypeId
      || Date.parse(mapping.verifiedAt ?? '') > Date.parse(checkpoint.coverage.coverageThrough)
      || !subscriptionProviderScopeMatchesProjection(
        mapping.providerScope,
        publication.runtimeProjection,
        checkpoint.tenantId
      )) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_MAPPING_NOT_CURRENT');
    }
    const compatibility = publication.runtimeCompatibility;
    if (publication.schemaVersion !== 3
      || publication.state !== 'PUBLISHED'
      || publication.publicationId !== checkpoint.binding.publicationId
      || publication.mappingId !== mapping.mappingId
      || publication.policyDigest !== checkpoint.binding.policyDigest
      || !compatibility
      || compatibility.adapterId !== checkpoint.binding.runtimeCompatibility.adapterId
      || compatibility.contractVersion !== checkpoint.binding.runtimeCompatibility.contractVersion
      || compatibility.capabilityDigest !== checkpoint.binding.runtimeCompatibility.capabilityDigest
      || Date.parse(publication.publishedAt) > Date.parse(checkpoint.coverage.coverageThrough)
      || (fence && Date.parse(fence.updatedAt) > Date.parse(checkpoint.coverage.coverageThrough))
      ) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PUBLICATION_NOT_CURRENT');
    }
    const phase = releaseProgram.phases.find((item) =>
      item.releasePhaseId === checkpoint.binding.releasePhaseId);
    if (subscriptionType.state !== 'ACTIVE'
      || subscriptionType.currentPolicyVersion !== checkpoint.binding.policyVersion
      || releaseProgram.state === 'DRAFT'
      || releaseProgram.subscriptionTypeId !== checkpoint.binding.subscriptionTypeId
      || releaseProgram.revision !== checkpoint.binding.releaseProgramRevision
      || !phase
      || phase.providerProductRef !== checkpoint.providerProductId
      || !this.releaseStationMatchesScope(
        checkpoint,
        publication,
        releaseProgram.stationId
      )
      || plan.instances.some((instance) =>
        instance.homeStationId !== releaseProgram.stationId
        || instance.mappingId !== mapping.mappingId
        || instance.purchasePrice.amountMinor !== phase.price.amountMinor
        || instance.purchasePrice.currency !== phase.price.currency)) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_RELEASE_BINDING_MISMATCH');
    }
    return fence;
  }

  private async assertPublicationHistoryUnchanged(
    plan: SubscriptionInstanceProjectionPlan
  ): Promise<void> {
    if (plan.checkpoint.schemaVersion !== 3 || !plan.checkpoint.policyResolution) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID');
    }
    const after = await this.repository.runtimePolicyPublicationHistoryByType(
      plan.checkpoint.binding.subscriptionTypeId
    );
    if (!subscriptionPublicationHistoryMatchesResolution(
      after,
      plan.checkpoint.policyResolution
    )) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_CHANGED_DURING_CHECK');
    }
  }

  private async assertFenceUnchanged(
    before: StoredSubscriptionProjectionFence | null,
    subscriptionTypeId = before?.subscriptionTypeId
  ): Promise<void> {
    const typeId = subscriptionTypeId;
    if (!typeId) fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_NOT_CURRENT');
    const after = await this.repository.runtimeProjectionFenceByType(typeId);
    if ((!before && after)
      || (before && (!after
        || after.bindingRevision !== before.bindingRevision
        || after.coordinationRevision !== before.coordinationRevision
        || after.bindingDigest !== before.bindingDigest))) {
      fail('SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_CHANGED_DURING_CHECK');
    }
  }

  private releaseStationMatchesScope(
    checkpoint: StoredSubscriptionInstanceProjectorCheckpoint,
    publication: StoredSubscriptionPolicyPublication,
    stationId: string
  ): boolean {
    const scope = checkpoint.providerScope;
    if (scope.kind === 'STATION') return scope.scopeId === stationId;
    if (scope.kind === 'TENANT') return scope.scopeId === checkpoint.tenantId;
    const stationIds = new Set(publication.runtimeProjection.stationAccessRules
      .filter((rule) => rule.enabled && rule.selector.kind === 'STATION_LIST')
      .flatMap((rule) => rule.selector.stationIds));
    return stationIds.has(stationId);
  }

  private result(
    plan: SubscriptionInstanceProjectionPlan,
    status: SubscriptionInstanceProjectionResult['status'],
    write: boolean
  ): SubscriptionInstanceProjectionResult {
    return {
      status,
      write,
      sourceItemCount: plan.instances.length,
      inputSha256: plan.inputSha256,
      planSha256: plan.planSha256,
      checkpointId: plan.checkpoint.checkpointId
    };
  }
}

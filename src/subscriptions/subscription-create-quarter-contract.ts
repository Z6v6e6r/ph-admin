import { createHash } from 'node:crypto';
import type { StoredSubscriptionPolicyPublication, SubscriptionRuntimeProjectionSnapshot } from './subscriptions.types';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
export const QUARTER_EVENT = 'viva:direction:4588:type:1613';
export interface CreateQuarterDescriptor {
  schemaVersion: 1; kind: 'ORGANIZER_QUARTER_CREATE'; directionId: '4588'; typeId: '1613';
  selectorRevision: string; durationMinutes: 60; participantCount: 4; spot: 1;
  currency: 'RUB'; priceBasis: 'ORGANIZER_QUARTER'; benefitKind: 'FREE_ENTITLEMENT';
  usageUnits: 1; dailyUsageLimit: 1;
  stations: Array<{ stationId: string; providerStudioId: string; masterServiceId: string; subServiceId: string }>;
}
export interface CreateQuarterBinding {
  schemaVersion: 1; createOperationId: string; draftId: string; clientRefHash: string;
  publicationId: string; descriptorDigest: string;
}
export interface CreateQuarterIntake {
  contractVersion: 2; kind: 'ORGANIZER_QUARTER_CREATE'; targetId: string; revision: number;
  state: 'ACTIVE' | 'REVOKED'; subscriptionTypeId: string; policyVersion: number; publicationId: string;
  createOperationId: string; draftId: string; clientRefHash: string;
  stationId: string; roomId: string; startsAt: string; observedAt: string; expiresAt: string;
  catalogue: { directionId: '4588'; typeId: '1613'; providerStudioId: string; masterServiceId: string; subServiceId: string;
    selectorRevision: string; roomIds: string[] | null };
  price: { basis: 'WHOLE_COURT_WINDOW'; amountMinor: number; currency: 'RUB'; durationMinutes: 60;
    participantCount: 4; spot: 1 };
}
export interface CreateQuarterProvenance {
  schemaVersion: 1; binding: CreateQuarterBinding; subscriptionTypeId: string; policyVersion: number;
  policyDigest: string; approvalAuditRef: string; roomId: string;
  catalogue: CreateQuarterIntake['catalogue']; price: CreateQuarterIntake['price'];
}
export function quarterFail(): never { throw new Error('SUBSCRIPTION_CREATE_QUARTER_INVALID'); }
export function quarterRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!quarterRecord(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some(k => !keys.includes(k))) quarterFail();
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || /[\r\n]/.test(value) || !ID.test(value)) quarterFail();
}
function positive(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) quarterFail();
}
function instant(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) quarterFail();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (quarterRecord(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const quarterHash = (domain: string, value: unknown): string => createHash('sha256')
  .update(`${domain}\0${canonical(value)}`).digest('hex');
export const quarterDescriptorDigest = (value: CreateQuarterDescriptor): string =>
  `sha256:${quarterHash('subscription-create-quarter-descriptor:v1', parseQuarterDescriptor(value))}`;
export const quarterDictionaryRevision = (value: CreateQuarterDescriptor): string =>
  `dictionary:create-quarter:${quarterDescriptorDigest(value).slice(7)}`;
export const quarterDictionaryEvidence = (value: CreateQuarterDescriptor): string =>
  `evidence:canonical-dictionary:${quarterDescriptorDigest(value).slice(7)}`;

export function parseQuarterDescriptor(raw: unknown): CreateQuarterDescriptor {
  exact(raw, ['schemaVersion','kind','directionId','typeId','selectorRevision','durationMinutes','participantCount',
    'spot','currency','priceBasis','benefitKind','usageUnits','dailyUsageLimit','stations']);
  if (raw.schemaVersion !== 1 || raw.kind !== 'ORGANIZER_QUARTER_CREATE' || raw.directionId !== '4588'
    || raw.typeId !== '1613' || raw.durationMinutes !== 60 || raw.participantCount !== 4 || raw.spot !== 1
    || raw.currency !== 'RUB' || raw.priceBasis !== 'ORGANIZER_QUARTER' || raw.benefitKind !== 'FREE_ENTITLEMENT'
    || raw.usageUnits !== 1 || raw.dailyUsageLimit !== 1 || !Array.isArray(raw.stations)
    || raw.stations.length < 1 || raw.stations.length > 8) quarterFail();
  id(raw.selectorRevision);
  const stations = raw.stations.map(row => {
    exact(row, ['stationId','providerStudioId','masterServiceId','subServiceId']);
    id(row.stationId); id(row.providerStudioId); id(row.masterServiceId); id(row.subServiceId);
    return { stationId: row.stationId, providerStudioId: row.providerStudioId, masterServiceId: row.masterServiceId, subServiceId: row.subServiceId };
  }).sort((a,b) => a.stationId.localeCompare(b.stationId));
  if (new Set(stations.map(x => x.stationId)).size !== stations.length) quarterFail();
  return { schemaVersion: 1, kind: 'ORGANIZER_QUARTER_CREATE', directionId: '4588', typeId: '1613',
    selectorRevision: raw.selectorRevision, durationMinutes: 60, participantCount: 4, spot: 1, currency: 'RUB',
    priceBasis: 'ORGANIZER_QUARTER', benefitKind: 'FREE_ENTITLEMENT', usageUnits: 1, dailyUsageLimit: 1, stations };
}
export function assertQuarterPolicy(descriptor: CreateQuarterDescriptor, policy: SubscriptionRuntimeProjectionSnapshot): void {
  if (policy.dailyUsageLimit !== 1 || policy.usageUnitsByDuration['60'] !== 1
    || !policy.createGame.enabled || policy.createGame.durationsMinutes.length !== 1
    || policy.createGame.durationsMinutes[0] !== 60) quarterFail();
  if (policy.dailyUsagePolicy && (!policy.dailyUsagePolicy.actions.includes('CREATE_GAME')
    || policy.dailyUsagePolicy.limitExceeded !== 'BLOCK')) quarterFail();
  const rules = policy.benefitRules.filter(r => r.enabled && r.actions.includes('CREATE_GAME'));
  if (rules.length !== 1) quarterFail();
  const rule = rules[0];
  if (rule.kind !== 'FREE_ENTITLEMENT' || rule.category !== 'GAME' || rule.actions.length !== 1
    || rule.durationMinutes.length !== 1 || rule.durationMinutes[0] !== 60
    || rule.externalEventTypeIds.length !== 1 || rule.externalEventTypeIds[0] !== QUARTER_EVENT
    || rule.productTypeIds.length !== 0) quarterFail();
  for (const row of descriptor.stations) {
    if (!rule.stationIds.includes(row.stationId)) quarterFail();
    const access = policy.stationAccessRules.filter(r => r.enabled && r.selector.kind === 'STATION_LIST'
      && r.selector.stationIds.includes(row.stationId));
    if (access.length !== 1 || access[0].surcharge.kind !== 'NONE' || access[0].surcharge.amountMinor !== 0) quarterFail();
  }
}
export function assertQuarterPublication(publication: StoredSubscriptionPolicyPublication): CreateQuarterDescriptor {
  if (publication.schemaVersion !== 4 || !publication.createQuarterDescriptor
    || publication.state === 'DISABLED_FOR_NEW_OPERATIONS') quarterFail();
  const descriptor = parseQuarterDescriptor(publication.createQuarterDescriptor);
  if (publication.createQuarterDescriptorDigest !== quarterDescriptorDigest(descriptor)
    || publication.dictionaryRevision !== quarterDictionaryRevision(descriptor)) quarterFail();
  id(publication.approvalAuditRef);
  assertQuarterPolicy(descriptor, publication.runtimeProjection);
  return descriptor;
}
export function parseQuarterBinding(raw: unknown): CreateQuarterBinding {
  exact(raw, ['schemaVersion','createOperationId','draftId','clientRefHash','publicationId','descriptorDigest']);
  if (raw.schemaVersion !== 1 || typeof raw.createOperationId !== 'string' || raw.createOperationId.length !== 36 || !UUID.test(raw.createOperationId)
    || typeof raw.draftId !== 'string' || raw.draftId.length !== 36 || !UUID.test(raw.draftId)
    || typeof raw.clientRefHash !== 'string' || raw.clientRefHash.length !== 64 || !HASH.test(raw.clientRefHash)
    || typeof raw.descriptorDigest !== 'string' || raw.descriptorDigest.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(raw.descriptorDigest)) quarterFail();
  id(raw.publicationId);
  return { schemaVersion: 1, createOperationId: raw.createOperationId, draftId: raw.draftId,
    clientRefHash: raw.clientRefHash, publicationId: raw.publicationId, descriptorDigest: raw.descriptorDigest };
}
export function parseQuarterIntake(raw: unknown): CreateQuarterIntake {
  exact(raw, ['contractVersion','kind','targetId','revision','state','subscriptionTypeId','policyVersion','publicationId',
    'createOperationId','draftId','clientRefHash','stationId','roomId','startsAt','observedAt','expiresAt','catalogue','price']);
  if (raw.contractVersion !== 2 || raw.kind !== 'ORGANIZER_QUARTER_CREATE'
    || (raw.state !== 'ACTIVE' && raw.state !== 'REVOKED')) quarterFail();
  for (const k of ['targetId','subscriptionTypeId','publicationId','stationId','roomId']) id(raw[k]);
  positive(raw.revision); positive(raw.policyVersion);
  parseQuarterBinding({ schemaVersion: 1, createOperationId: raw.createOperationId, draftId: raw.draftId,
    clientRefHash: raw.clientRefHash, publicationId: raw.publicationId, descriptorDigest: `sha256:${'0'.repeat(64)}` });
  if (raw.targetId !== `create-draft:${raw.draftId}`) quarterFail();
  for (const k of ['startsAt','observedAt','expiresAt']) instant(raw[k]);
  if (Date.parse(raw.expiresAt as string) <= Date.parse(raw.observedAt as string)
    || Date.parse(raw.expiresAt as string) - Date.parse(raw.observedAt as string) > 60000) quarterFail();
  exact(raw.catalogue, ['directionId','typeId','providerStudioId','masterServiceId','subServiceId','selectorRevision','roomIds']);
  if (raw.catalogue.directionId !== '4588' || raw.catalogue.typeId !== '1613') quarterFail();
  for (const k of ['providerStudioId','masterServiceId','subServiceId','selectorRevision']) id(raw.catalogue[k]);
  if (raw.catalogue.roomIds !== null) {
    if (!Array.isArray(raw.catalogue.roomIds) || raw.catalogue.roomIds.length < 1 || raw.catalogue.roomIds.length > 1000) quarterFail();
    raw.catalogue.roomIds.forEach(id);
    if (!raw.catalogue.roomIds.includes(raw.roomId) || new Set(raw.catalogue.roomIds).size !== raw.catalogue.roomIds.length) quarterFail();
  }
  exact(raw.price, ['basis','amountMinor','currency','durationMinutes','participantCount','spot']);
  positive(raw.price.amountMinor);
  if (raw.price.basis !== 'WHOLE_COURT_WINDOW' || raw.price.amountMinor > 10000000 || raw.price.amountMinor % 4 !== 0
    || raw.price.currency !== 'RUB' || raw.price.durationMinutes !== 60 || raw.price.participantCount !== 4 || raw.price.spot !== 1) quarterFail();
  return { ...raw, catalogue: { ...raw.catalogue,
    roomIds: raw.catalogue.roomIds === null ? null : [...raw.catalogue.roomIds as string[]].sort() }, price: { ...raw.price } } as unknown as CreateQuarterIntake;
}
export function quarterBinding(input: CreateQuarterIntake, descriptor: CreateQuarterDescriptor): CreateQuarterBinding {
  return parseQuarterBinding({ schemaVersion: 1, createOperationId: input.createOperationId, draftId: input.draftId,
    clientRefHash: input.clientRefHash, publicationId: input.publicationId, descriptorDigest: quarterDescriptorDigest(descriptor) });
}
export function assertQuarterCorrespondence(input: CreateQuarterIntake, publication: StoredSubscriptionPolicyPublication): CreateQuarterDescriptor {
  const descriptor = assertQuarterPublication(publication);
  if (input.publicationId !== publication.publicationId || input.subscriptionTypeId !== publication.subscriptionTypeId
    || input.policyVersion !== publication.policyVersion || input.catalogue.selectorRevision !== descriptor.selectorRevision) quarterFail();
  const row = descriptor.stations.find(r => r.stationId === input.stationId);
  if (!row || row.providerStudioId !== input.catalogue.providerStudioId || row.masterServiceId !== input.catalogue.masterServiceId || row.subServiceId !== input.catalogue.subServiceId) quarterFail();
  return descriptor;
}

export function quarterSnapshotInput(snapshot: import('./subscriptions.types').StoredSubscriptionCanonicalTargetSnapshot): CreateQuarterIntake {
  const proof = snapshot.createQuarter;
  exact(proof, ['schemaVersion','binding','subscriptionTypeId','policyVersion','policyDigest','approvalAuditRef','roomId','catalogue','price']);
  if (proof.schemaVersion !== 1 || typeof proof.policyDigest !== 'string' || proof.policyDigest.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(proof.policyDigest)) quarterFail();
  id(proof.approvalAuditRef);
  const binding = parseQuarterBinding(proof.binding);
  const input = parseQuarterIntake({ contractVersion: 2, kind: 'ORGANIZER_QUARTER_CREATE', targetId: snapshot.targetId,
    revision: snapshot.revision, state: snapshot.state, subscriptionTypeId: proof.subscriptionTypeId, policyVersion: proof.policyVersion,
    publicationId: binding.publicationId, createOperationId: binding.createOperationId, draftId: binding.draftId,
    clientRefHash: binding.clientRefHash, stationId: snapshot.stationId, roomId: proof.roomId,
    startsAt: snapshot.startsAt, observedAt: snapshot.observedAt, expiresAt: snapshot.expiresAt,
    catalogue: proof.catalogue, price: proof.price });
  if (snapshot.schemaVersion !== 2 || snapshot.action !== 'CREATE_GAME' || snapshot.category !== 'GAME'
    || snapshot.durationMinutes !== 60 || snapshot.externalEventTypeId !== QUARTER_EVENT || snapshot.productTypeId !== null
    || snapshot.basePriceMinor !== input.price.amountMinor / 4 || snapshot.currency !== 'RUB'
    || snapshot.dictionaryRevision !== `dictionary:create-quarter:${binding.descriptorDigest.slice(7)}`
    || snapshot.evidenceRef !== quarterTargetEvidence(snapshot.tenantId, input, proof as unknown as CreateQuarterProvenance)
    || snapshot.priceEvidenceRef !== quarterPriceEvidence(input)) quarterFail();
  return input;
}
export const quarterTargetEvidence = (tenantId: string, input: CreateQuarterIntake, proof: CreateQuarterProvenance): string =>
  `evidence:create-quarter:${quarterHash('subscription-create-quarter-target:v1', { tenantId, input, proof })}`;
export const quarterPriceEvidence = (input: CreateQuarterIntake): string =>
  `evidence:create-quarter-price:${quarterHash('subscription-create-quarter-price:v1', { stationId: input.stationId,
    roomId: input.roomId, startsAt: input.startsAt, observedAt: input.observedAt, catalogue: input.catalogue, price: input.price })}`;
export function assertQuarterResolvedTarget(target: import('./subscriptions.types').SubscriptionShadowQuoteResolvedTarget,
  publication: StoredSubscriptionPolicyPublication, clientRefHash: string, action: string): void {
  const proof = target.createQuarter;
  if (!proof) quarterFail();
  const binding = parseQuarterBinding(proof.binding);
  const descriptor = assertQuarterPublication(publication);
  const row = descriptor.stations.find(r => r.stationId === target.stationId);
  if (action !== 'CREATE_GAME' || binding.clientRefHash !== clientRefHash || target.targetId !== `create-draft:${binding.draftId}`
    || binding.publicationId !== publication.publicationId || binding.descriptorDigest !== quarterDescriptorDigest(descriptor)
    || proof.subscriptionTypeId !== publication.subscriptionTypeId || proof.policyVersion !== publication.policyVersion
    || proof.policyDigest !== publication.policyDigest || proof.approvalAuditRef !== publication.approvalAuditRef
    || target.dictionaryRevision !== publication.dictionaryRevision || target.durationMinutes !== 60
    || target.externalEventTypeId !== QUARTER_EVENT || target.category !== 'GAME' || target.productTypeId !== null
    || !row || row.providerStudioId !== proof.catalogue.providerStudioId || row.masterServiceId !== proof.catalogue.masterServiceId || row.subServiceId !== proof.catalogue.subServiceId
    || descriptor.selectorRevision !== proof.catalogue.selectorRevision || target.basePriceMinor !== proof.price.amountMinor / 4
    || proof.price.basis !== 'WHOLE_COURT_WINDOW' || proof.price.participantCount !== 4 || proof.price.spot !== 1
    || proof.price.durationMinutes !== 60 || proof.price.currency !== 'RUB' || target.currency !== 'RUB'
    || !Number.isSafeInteger(proof.price.amountMinor) || proof.price.amountMinor <= 0 || proof.price.amountMinor % 4 !== 0) quarterFail();
}

import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionType,
  StoredSubscriptionUsageLedgerEvent,
  SubscriptionAction,
  SubscriptionPolicyApplyTo,
  SubscriptionPolicyStatus,
  SubscriptionPublicationState,
  SubscriptionRuntimeProjectionSnapshot,
  SubscriptionTypeState
} from './subscriptions.types';

/** Canonical action order used by the operator registry and the CUP UI. */
const ACTIONS_ORDER: readonly SubscriptionAction[] = [
  'CREATE_GAME',
  'JOIN_GAME',
  'BOOK_GROUP_TRAINING',
  'BOOK_TOURNAMENT',
  'PURCHASE_ADD_ON_PRODUCT'
];

const PAGE_SIZE = 100;

export interface SubscriptionPolicyRegistryVersion {
  policyVersion: number;
  status: SubscriptionPolicyStatus;
  modelVersion: 2 | 3;
  effectiveAt: string;
  applyTo: SubscriptionPolicyApplyTo;
  publicationState: SubscriptionPublicationState | null;
}

export interface SubscriptionPolicyRegistryPublication {
  publicationId: string;
  policyVersion: number;
  policyDigest: string;
  state: SubscriptionPublicationState;
  effectiveAt: string;
  applyTo: SubscriptionPolicyApplyTo;
  publishedAt: string;
  supersededAt: string | null;
  runtimeCompatibility: {
    adapterId: string;
    contractVersion: number;
    capabilityDigest: string;
  } | null;
}

export interface SubscriptionPolicyRegistryLastDecision {
  at: string;
  source: 'LEDGER' | 'OPERATION';
  eventType: string | null;
  operationState: string | null;
  action: SubscriptionAction | null;
  policyVersion: number;
  policyDigest: string;
  usageDelta: number | null;
  moneyDeltaMinor: number | null;
}

export interface SubscriptionPolicyRegistryItem {
  subscriptionTypeId: string;
  code: string;
  title: string;
  description: string | null;
  state: SubscriptionTypeState;
  currentPolicyVersion: number | null;
  publication: SubscriptionPolicyRegistryPublication | null;
  rules: SubscriptionRuntimeProjectionSnapshot | null;
  surfaces: SubscriptionAction[];
  versions: SubscriptionPolicyRegistryVersion[];
  instances: {
    total: number;
    byPolicyVersion: Array<{ policyVersion: number; count: number }>;
  };
  lastDecision: SubscriptionPolicyRegistryLastDecision | null;
  /** Newest persisted quote decision (evaluation journal), if any instance of this type was quoted. */
  lastQuoteDecision: {
    at: string;
    outcome: string;
    serviceAllowed: boolean;
    subscriptionBenefitAllowed: boolean;
    blockers: string[];
    policyVersion: number | null;
    policyDigest: string | null;
  } | null;
}

export interface SubscriptionPolicyRegistryResult {
  schemaVersion: 1;
  generatedAt: string;
  items: SubscriptionPolicyRegistryItem[];
  totals: {
    subscriptionTypes: number;
    publishedPolicies: number;
    draftPolicies: number;
    instances: number;
  };
}

function deriveSurfaces(
  projection: SubscriptionRuntimeProjectionSnapshot | null
): SubscriptionAction[] {
  if (!projection) return [];
  const enabled = new Set<SubscriptionAction>();
  if (projection.createGame.enabled) enabled.add('CREATE_GAME');
  if (projection.joinGame.enabled) enabled.add('JOIN_GAME');
  for (const rule of projection.benefitRules) {
    if (!rule.enabled) continue;
    for (const action of rule.actions) enabled.add(action);
  }
  for (const action of projection.dailyUsagePolicy?.actions ?? []) enabled.add(action);
  return ACTIONS_ORDER.filter((action) => enabled.has(action));
}

function latestPublication(
  publications: StoredSubscriptionPolicyPublication[]
): StoredSubscriptionPolicyPublication | null {
  const published = publications.filter((entry) => entry.state === 'PUBLISHED');
  if (published.length > 0) {
    return [...published].sort(
      (left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt)
    )[published.length - 1]!;
  }
  const ordered = [...publications].sort(
    (left, right) => Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt)
  );
  return ordered[ordered.length - 1] ?? null;
}

function publicationDto(
  publication: StoredSubscriptionPolicyPublication,
  applyToByVersion: Map<number, SubscriptionPolicyApplyTo>
): SubscriptionPolicyRegistryPublication {
  return {
    publicationId: publication.publicationId,
    policyVersion: publication.policyVersion,
    policyDigest: publication.policyDigest,
    state: publication.state,
    effectiveAt: publication.effectiveAt,
    applyTo: applyToByVersion.get(publication.policyVersion) ?? 'NEW_ONLY',
    publishedAt: publication.publishedAt,
    supersededAt: publication.supersededAt,
    runtimeCompatibility: publication.runtimeCompatibility
      ? {
          adapterId: publication.runtimeCompatibility.adapterId,
          contractVersion: publication.runtimeCompatibility.contractVersion,
          capabilityDigest: publication.runtimeCompatibility.capabilityDigest
        }
      : null
  };
}

function ledgerDecision(
  event: StoredSubscriptionUsageLedgerEvent
): SubscriptionPolicyRegistryLastDecision {
  return {
    at: event.recordedAt,
    source: 'LEDGER',
    eventType: event.eventType,
    operationState: null,
    action: null,
    policyVersion: event.policyVersion,
    policyDigest: event.policyDigest,
    usageDelta: event.usageDelta,
    moneyDeltaMinor: event.moneyDeltaMinor
  };
}

function operationDecision(
  operation: StoredSubscriptionRuntimeOperation
): SubscriptionPolicyRegistryLastDecision | null {
  const decision = operation.decision;
  if (!decision) return null;
  return {
    at: operation.updatedAt,
    source: 'OPERATION',
    eventType: null,
    operationState: operation.state,
    action: decision.decisionKind === 'ENTITLEMENT' ? decision.action : null,
    policyVersion: decision.policyVersion,
    policyDigest: decision.policyDigest,
    usageDelta: decision.decisionKind === 'ENTITLEMENT' ? decision.usageUnits : null,
    moneyDeltaMinor: null
  };
}

function newestDecision(
  ledger: SubscriptionPolicyRegistryLastDecision | null,
  operation: SubscriptionPolicyRegistryLastDecision | null
): SubscriptionPolicyRegistryLastDecision | null {
  if (!ledger) return operation;
  if (!operation) return ledger;
  return Date.parse(operation.at) >= Date.parse(ledger.at) ? operation : ledger;
}

/**
 * Read-only operator registry over published subscription policy versions.
 *
 * The service deliberately exposes only persisted facts: the latest immutable
 * publication snapshot (compiled runtime projection), version history, pinned
 * instance usage per policy version and the newest persisted decision. It never
 * evaluates policy, mutates state or accepts rule values from the caller.
 */
@Injectable()
export class SubscriptionPolicyRegistryService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async read(integrationToken: string | undefined): Promise<SubscriptionPolicyRegistryResult> {
    this.assertEnabled();
    this.assertIntegrationToken(integrationToken);
    await this.repository.connectReadOnly();

    const types = await this.listAllTypes();
    const items: SubscriptionPolicyRegistryItem[] = [];
    let publishedPolicies = 0;
    let draftPolicies = 0;
    let instances = 0;
    for (const type of types) {
      const [versions, publications, context] = await Promise.all([
        this.repository.listPolicyVersions(type.subscriptionTypeId),
        this.repository.runtimePolicyPublicationHistoryByType(type.subscriptionTypeId),
        this.repository.runtimePolicyRegistryContext(type.subscriptionTypeId)
      ]);
      const applyToByVersion = new Map<number, SubscriptionPolicyApplyTo>(
        versions.map((version) => [version.version, version.applyTo])
      );
      const publication = latestPublication(publications);
      const registryVersions: SubscriptionPolicyRegistryVersion[] = versions.map(
        (version: StoredSubscriptionPolicyVersion) => ({
          policyVersion: version.version,
          status: version.status,
          modelVersion: version.modelVersion,
          effectiveAt: version.effectiveAt,
          applyTo: version.applyTo,
          publicationState:
            publications.find((entry) => entry.policyVersion === version.version)?.state ?? null
        })
      );
      publishedPolicies += versions.filter((version) => version.status === 'PUBLISHED').length;
      draftPolicies += versions.filter((version) => version.status === 'DRAFT').length;
      instances += context.instances.total;
      const ledger = context.lastLedgerEvent ? ledgerDecision(context.lastLedgerEvent) : null;
      const operation = context.lastDecisionOperation
        ? operationDecision(context.lastDecisionOperation)
        : null;
      items.push({
        subscriptionTypeId: type.subscriptionTypeId,
        code: type.code,
        title: type.title,
        description: type.description,
        state: type.state,
        currentPolicyVersion: type.currentPolicyVersion,
        publication: publication ? publicationDto(publication, applyToByVersion) : null,
        rules: publication?.runtimeProjection ?? null,
        surfaces: deriveSurfaces(publication?.runtimeProjection ?? null),
        versions: registryVersions,
        instances: context.instances,
        lastDecision: newestDecision(ledger, operation),
        lastQuoteDecision: context.lastQuoteDecision
          ? {
              at: context.lastQuoteDecision.evaluatedAt,
              outcome: context.lastQuoteDecision.outcome,
              serviceAllowed: context.lastQuoteDecision.serviceAllowed,
              subscriptionBenefitAllowed: context.lastQuoteDecision.subscriptionBenefitAllowed,
              blockers: [...context.lastQuoteDecision.blockers],
              policyVersion: context.lastQuoteDecision.policyVersion,
              policyDigest: context.lastQuoteDecision.policyDigest
            }
          : null
      });
    }
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      items,
      totals: {
        subscriptionTypes: items.length,
        publishedPolicies,
        draftPolicies,
        instances
      }
    };
  }

  private async listAllTypes(): Promise<StoredSubscriptionType[]> {
    const types: StoredSubscriptionType[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await this.repository.listSubscriptionTypes(cursor, PAGE_SIZE);
      types.push(...page);
      if (page.length < PAGE_SIZE) break;
      const last = page[page.length - 1];
      if (!last || last.subscriptionTypeId === cursor) break;
      cursor = last.subscriptionTypeId;
    }
    return types;
  }

  private assertEnabled(): void {
    if (!['1', 'true', 'yes'].includes(
      String(process.env.SUBSCRIPTIONS_POLICY_REGISTRY_ENABLED ?? '').trim().toLowerCase()
    )) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_POLICY_REGISTRY_DISABLED',
        message: 'Subscription policy registry is disabled'
      });
    }
  }

  private assertIntegrationToken(suppliedToken?: string): void {
    const expected = String(
      process.env.SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_TOKEN ?? ''
    ).trim();
    if (Buffer.byteLength(expected, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_NOT_CONFIGURED',
        message: 'Subscription policy registry is not configured'
      });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(String(suppliedToken ?? '').trim());
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_FORBIDDEN',
        message: 'Subscription policy registry access is forbidden'
      });
    }
  }
}

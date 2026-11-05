import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import type { ClientSession } from 'mongodb';
import { LkIdentityService } from '../lk-identity/lk-identity.service';
import {
  validateStoredSubscriptionInstance,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProviderMapping
} from '../subscriptions/subscription-runtime-contracts';
import { computeSubscriptionClientRefHash } from '../subscriptions/subscription-trusted-shadow-adapter.service';
import { subscriptionProviderScopeMatchesProjection } from '../subscriptions/subscription-provider-scope';
import { resolveSubscriptionSalePeriod } from '../subscriptions/subscription-sale-period-resolver';
import {
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionType,
  SubscriptionStationAccessRule
} from '../subscriptions/subscriptions.types';
import {
  assertResidentServicesEnabled,
  requireResidentServicesClientHashPepper,
  requireResidentServicesIntegrationToken,
  requireResidentServicesTenantId,
  residentServicesMaxEvidenceAgeSeconds,
  RESIDENT_SERVICES_ID_PATTERN
} from './resident-services.config';
import { ResidentServicesRepository } from './resident-services.repository';
import { RESIDENT_SERVICES_ERROR_CODES } from './resident-services.types';

export const RESIDENT_SERVICES_CLOCK = Symbol('RESIDENT_SERVICES_CLOCK');

export interface ResidentContext {
  tenantId: string;
  clientRefHash: string;
  instance: StoredSubscriptionInstance;
  publication: StoredSubscriptionPolicyPublication;
  mapping: StoredSubscriptionProviderMapping;
  subscriptionType: StoredSubscriptionType;
  evidenceAsOf: string;
}

@Injectable()
export class ResidentResidencyService {
  constructor(
    private readonly repository: ResidentServicesRepository,
    private readonly identity: LkIdentityService,
    @Optional() @Inject(RESIDENT_SERVICES_CLOCK) private readonly clock?: () => Date
  ) {}

  /**
   * Single identity boundary for the internal resident-services routes: the
   * integration token gates the route, the LK bearer identifies the client and
   * the derived client reference hash decides pass ownership.
   */
  async verifyClientIdentity(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined
  ): Promise<{ tenantId: string; providerClientId: string; clientRefHash: string }> {
    assertResidentServicesEnabled();
    requireResidentServicesIntegrationToken(integrationToken);
    const tenantId = requireResidentServicesTenantId();
    const pepper = requireResidentServicesClientHashPepper();
    const verified = await this.identity.verifyTrustedBearer(authorizationHeader);
    if (verified.actor.tenantKey !== tenantId) {
      throw new ForbiddenException({
        code: RESIDENT_SERVICES_ERROR_CODES.NOT_ACTIVE,
        message: 'LK identity tenant does not match resident services tenant'
      });
    }
    const providerClientId = String(verified.actor.clientId ?? '').trim();
    if (!RESIDENT_SERVICES_ID_PATTERN.test(providerClientId)) {
      throw new UnauthorizedException({
        code: RESIDENT_SERVICES_ERROR_CODES.NOT_CONFIGURED,
        message: 'Verified LK identity does not contain a canonical provider client id'
      });
    }
    return {
      tenantId,
      providerClientId,
      clientRefHash: computeSubscriptionClientRefHash({
        pepper,
        tenantId,
        providerClientId
      })
    };
  }

  async resolveByClientIdentity(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined,
    clientSubscriptionId: string
  ): Promise<ResidentContext> {
    const { tenantId, providerClientId, clientRefHash } =
      await this.verifyClientIdentity(authorizationHeader, integrationToken);
    this.repository.requireAvailable();
    const instance = await this.repository.runtimeInstanceByProviderIdentity({
      tenantId,
      providerClientId,
      clientSubscriptionId
    });
    if (!instance || instance.clientRefHash !== clientRefHash) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.PASS_NOT_FOUND,
        message: 'Current resident subscription was not found'
      });
    }
    return this.buildContext(instance, clientRefHash);
  }

  async resolveByInstance(
    tenantId: string,
    subscriptionInstanceId: string,
    session?: ClientSession
  ): Promise<ResidentContext> {
    assertResidentServicesEnabled();
    this.repository.requireAvailable();
    const instance = await this.repository.runtimeInstanceByTenantAndId(
      tenantId,
      subscriptionInstanceId,
      session
    );
    if (!instance) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.INSTANCE_NOT_FOUND,
        message: 'Resident subscription instance was not found'
      });
    }
    return this.buildContext(instance, instance.clientRefHash, session);
  }

  stationAllowed(context: ResidentContext, stationId: string): boolean {
    const selection = residentSelectStationRule(
      context.publication.runtimeProjection.stationAccessRules,
      context.instance.homeStationId,
      stationId
    );
    return selection.allowed;
  }

  private async buildContext(
    instance: StoredSubscriptionInstance,
    clientRefHash: string,
    session?: ClientSession
  ): Promise<ResidentContext> {
    const now = this.now();
    try {
      validateStoredSubscriptionInstance(instance);
    } catch {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.EVIDENCE_INVALID,
        message: 'Resident subscription evidence is invalid'
      });
    }
    const tenantId = instance.tenantId;
    if (instance.clientRefHash !== clientRefHash) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.PASS_NOT_FOUND,
        message: 'Current resident subscription was not found'
      });
    }
    const subscriptionType = await this.repository.subscriptionTypeById(
      instance.subscriptionTypeId,
      session
    );
    if (!subscriptionType || typeof subscriptionType.title !== 'string') {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.TYPE_NOT_FOUND,
        message: 'Resident subscription type was not found'
      });
    }
    let publications: StoredSubscriptionPolicyPublication[];
    try {
      publications = await this.repository.policyPublicationHistoryByType(
        instance.subscriptionTypeId,
        session
      );
    } catch {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.POLICY_NOT_CURRENT,
        message: 'Resident subscription policy history is invalid'
      });
    }
    if (publications.length === 0) {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.POLICY_NOT_CURRENT,
        message: 'Resident subscription policy is not current'
      });
    }
    let publication: StoredSubscriptionPolicyPublication;
    try {
      publications.forEach((row) => validateStoredSubscriptionPolicyPublication(row));
      const resolution = resolveSubscriptionSalePeriod({
        purchasedAt: instance.purchasedAt,
        publications
      });
      if (resolution.kind !== 'MATCH') {
        throw new Error('RESIDENT_SALE_PERIOD_UNRESOLVED');
      }
      publication = resolution.publication;
    } catch {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.POLICY_NOT_CURRENT,
        message: 'Resident subscription policy is not current'
      });
    }
    if (publication.subscriptionTypeId !== instance.subscriptionTypeId
      || publication.policyVersion !== instance.policyVersion
      || publication.policyDigest !== instance.policyDigest
      || publication.mappingId !== instance.mappingId
      || publication.state === 'DISABLED_FOR_NEW_OPERATIONS') {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.POLICY_NOT_CURRENT,
        message: 'Resident subscription policy is not current'
      });
    }
    const mapping = await this.repository.providerMappingById(instance.mappingId, session);
    if (!mapping) {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.MAPPING_NOT_CURRENT,
        message: 'Resident subscription provider mapping was not found'
      });
    }
    try {
      validateStoredSubscriptionProviderMapping(mapping);
    } catch {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.MAPPING_NOT_CURRENT,
        message: 'Resident subscription provider mapping is invalid'
      });
    }
    if (mapping.state !== 'VERIFIED'
      || mapping.mappingId !== instance.mappingId
      || mapping.tenantId !== instance.tenantId
      || mapping.subscriptionTypeId !== instance.subscriptionTypeId
      || mapping.provider !== instance.provider
      || mapping.providerProductId !== instance.providerProductId
      || (mapping.providerScope.kind === 'TENANT'
        && mapping.providerScope.scopeId !== instance.tenantId)
      || (mapping.providerScope.kind === 'STATION'
        && mapping.providerScope.scopeId !== instance.homeStationId)
      || mapping.providerScope.kind === 'STUDIO'
      || (mapping.providerScope.kind === 'STATION_SET'
        && !subscriptionProviderScopeMatchesProjection(
          mapping.providerScope,
          publication.runtimeProjection,
          instance.tenantId
        ))) {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.MAPPING_NOT_CURRENT,
        message: 'Resident subscription provider mapping is not current'
      });
    }
    if (!mapping.verifiedAt || !this.isFresh(mapping.verifiedAt, now)) {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.MAPPING_STALE,
        message: 'Resident subscription provider mapping is stale'
      });
    }
    if (instance.reconciliation.state !== 'CURRENT'
      || !instance.reconciliation.asOf
      || !this.isFresh(instance.reconciliation.asOf, now)) {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.EVIDENCE_STALE,
        message: 'Resident subscription evidence is not fresh'
      });
    }
    if (instance.state !== 'ACTIVE') {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.NOT_ACTIVE,
        message: 'Resident subscription is not active'
      });
    }
    if (!instance.activeFrom || !instance.activeTo) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.TERM_EXPIRED,
        message: 'Resident subscription term is not confirmed'
      });
    }
    const activeFrom = Date.parse(instance.activeFrom);
    const activeTo = Date.parse(instance.activeTo);
    if (!Number.isFinite(activeFrom) || !Number.isFinite(activeTo) || activeTo <= activeFrom) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.TERM_EXPIRED,
        message: 'Resident subscription term is invalid'
      });
    }
    if (now.getTime() < activeFrom) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.NOT_ACTIVE,
        message: 'Resident subscription has not started yet'
      });
    }
    if (now.getTime() >= activeTo) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.TERM_EXPIRED,
        message: 'Resident subscription term has ended'
      });
    }
    return {
      tenantId,
      clientRefHash,
      instance,
      publication,
      mapping,
      subscriptionType,
      evidenceAsOf: instance.reconciliation.asOf
    };
  }

  private isFresh(value: string, now: Date): boolean {
    const observedAt = Date.parse(value);
    const maxSeconds = residentServicesMaxEvidenceAgeSeconds();
    return Number.isFinite(observedAt)
      && observedAt <= now.getTime()
      && now.getTime() - observedAt <= maxSeconds * 1000;
  }

  protected now(): Date {
    return this.clock ? this.clock() : new Date();
  }
}

export function residentSelectStationRule(
  rules: readonly SubscriptionStationAccessRule[],
  homeStationId: string,
  stationId: string
): { allowed: boolean; ambiguous: boolean } {
  const matches = rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.selector.kind === 'HOME_STATION') return homeStationId === stationId;
    if (rule.selector.kind === 'ALL_STATIONS') return true;
    return rule.selector.stationIds.includes(stationId);
  }).sort((left, right) => right.priority - left.priority);
  if (matches.length === 0) return { allowed: false, ambiguous: false };
  const priority = matches[0].priority;
  const highest = matches.filter((rule) => rule.priority === priority);
  return { allowed: highest.length === 1, ambiguous: highest.length > 1 };
}

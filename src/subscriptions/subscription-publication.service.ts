import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AuthPersistenceService } from '../auth/auth-persistence.service';
import { getStationScopeForPermission } from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import {
  PublishSubscriptionPolicyDto,
  SubscriptionPolicyPublicationPreviewDto
} from './dto/subscription-policy-publication.dto';
import {
  computeSubscriptionRuntimeProjectionDigest,
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionPolicyPublication
} from './subscription-runtime-contracts';
import { compileSubscriptionRuntimeProjection } from './subscription-runtime-projection';
import {
  deriveSubscriptionProviderScope,
  SubscriptionProviderScopeDerivationError
} from './subscription-provider-scope';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping,
  SubscriptionCreateResult,
  SubscriptionPolicyPublicationPreview,
  SubscriptionPolicyPublicationResult,
  SubscriptionProviderMappingView,
  SubscriptionProviderProductEvidence,
  SubscriptionProviderScope,
  SubscriptionRuntimeProjectionSnapshot
} from './subscriptions.types';

interface CommandHeaders {
  idempotencyKey: string | undefined;
  correlationId: string | undefined;
}

interface PublicationPlan {
  preview: SubscriptionPolicyPublicationPreview;
  typeRevision: number;
  policyRevision: number;
  previousPolicyRevision: number | null;
  previousPublication: StoredSubscriptionPolicyPublication | null;
  mapping: StoredSubscriptionProviderMapping | null;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DICTIONARY_EVIDENCE_PATTERN = /^evidence:canonical-dictionary:[a-f0-9]{64}$/;

@Injectable()
export class SubscriptionPublicationService {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly vivaAdmin: VivaAdminService,
    private readonly authPersistence: AuthPersistenceService
  ) {}

  async preview(
    subscriptionTypeId: string,
    rawVersion: string,
    dto: SubscriptionPolicyPublicationPreviewDto,
    user?: RequestUser
  ): Promise<SubscriptionPolicyPublicationPreview> {
    this.requireFlags('PREVIEW');
    this.requireGlobalPublicationActor(user);
    const input = this.normalizePreviewInput(subscriptionTypeId, rawVersion, dto);
    const plan = await this.buildPlan(input);
    return plan.preview;
  }

  async publish(
    subscriptionTypeId: string,
    rawVersion: string,
    dto: PublishSubscriptionPolicyDto,
    headers: CommandHeaders,
    user?: RequestUser
  ): Promise<SubscriptionCreateResult<SubscriptionPolicyPublicationResult>> {
    this.requireFlags('COMMAND');
    const actorId = this.requireGlobalPublicationActor(user);
    const command = this.validateCommandHeaders(headers);
    const input = this.normalizePublishInput(subscriptionTypeId, rawVersion, dto);
    const tenantId = this.tenantId();
    const requestHash = this.hash({
      operation: 'publishSubscriptionPolicy',
      tenantId,
      ...input
    });

    const existingPublication = await this.repositoryCall('WRITE', () =>
      this.repository.runtimePolicyPublicationByIdempotency({
        actorId,
        key: command.idempotencyKey
      })
    );
    if (existingPublication) {
      return this.replayPublication(
        existingPublication,
        input.subscriptionTypeId,
        input.policyVersion,
        requestHash
      );
    }
    const existingMapping = await this.repositoryCall('WRITE', () =>
      this.repository.runtimeProviderMappingByIdempotency({
        tenantId,
        actorId,
        key: command.idempotencyKey
      })
    );
    if (existingMapping) {
      return this.replay(existingMapping, input.subscriptionTypeId, input.policyVersion, requestHash);
    }

    const plan = await this.buildPlan(input);
    if (plan.preview.policyDigest !== input.expectedPolicyDigest
      || plan.preview.impactPreviewRef !== input.expectedImpactPreviewRef) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_PUBLICATION_PRECONDITION_CHANGED',
        message: 'Publication preview no longer matches the current policy or evidence inputs'
      });
    }

    const now = new Date().toISOString();
    const mappingId = plan.mapping?.mappingId ?? `mapping:${randomUUID()}`;
    const publicationId = `publication:${randomUUID()}`;
    const approvalAuditRef = `audit:subscription-publication:${randomUUID()}`;
    const mappingEvidenceRef = this.reference('evidence:provider-mapping', {
      providerEvidenceRef: plan.preview.providerEvidence.evidenceRef,
      providerObservedAt: plan.preview.providerEvidence.observedAt,
      dictionaryEvidenceRef: plan.preview.dictionaryEvidenceRef,
      tenantId: plan.preview.tenantId,
      providerStudioId: plan.preview.providerStudioId,
      providerScope: plan.preview.providerScope,
      providerProductId: plan.preview.providerProductId
    });
    const mapping: StoredSubscriptionProviderMapping = plan.mapping ? {
      ...plan.mapping,
      state: 'VERIFIED',
      evidenceRef: mappingEvidenceRef,
      verifiedAt: now,
      verifiedBy: actorId,
      revision: plan.mapping.revision + 1,
      updatedAt: now,
      updatedBy: actorId
    } : {
      schemaVersion: 1,
      mappingId,
      tenantId: plan.preview.tenantId,
      provider: 'VIVA',
      providerProductId: plan.preview.providerProductId,
      providerScope: plan.preview.providerScope,
      subscriptionTypeId: input.subscriptionTypeId,
      state: 'VERIFIED',
      evidenceRef: mappingEvidenceRef,
      verifiedAt: now,
      verifiedBy: actorId,
      revision: 1,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      idempotency: {
        actorId,
        key: command.idempotencyKey,
        requestHash,
        correlationId: command.correlationId
      }
    };
    const publication: StoredSubscriptionPolicyPublication = {
      schemaVersion: 2,
      publicationId,
      subscriptionTypeId: input.subscriptionTypeId,
      policyVersion: input.policyVersion,
      policyDigest: plan.preview.policyDigest,
      mappingId,
      dictionaryRevision: plan.preview.dictionaryRevision,
      runtimeProjection: plan.preview.runtimeProjection,
      state: 'PUBLISHED',
      effectiveAt: plan.preview.runtimeProjection.effectiveAt,
      publishedAt: now,
      publishedBy: actorId,
      supersededAt: null,
      supersededBy: null,
      impactPreviewRef: plan.preview.impactPreviewRef,
      approvalAuditRef,
      idempotency: {
        actorId,
        key: command.idempotencyKey,
        requestHash,
        correlationId: command.correlationId
      }
    };

    await this.appendApprovalAudit({
      approvalAuditRef,
      publicationId,
      actorId,
      user,
      command,
      plan,
      mappingId,
      mappingEvidenceRef,
      approvalReason: input.approvalReason
    });

    try {
      await this.repositoryCall('WRITE', () => this.repository.publishRuntimePolicy({
        mapping,
        insertMapping: plan.mapping === null,
        expectedMappingRevision: plan.mapping?.revision ?? null,
        publication,
        expectedTypeRevision: plan.typeRevision,
        expectedPolicyRevision: plan.policyRevision,
        previousPublicationId: plan.previousPublication?.publicationId ?? null,
        previousPolicyVersion: plan.preview.supersedes?.policyVersion ?? null,
        expectedPreviousPolicyRevision: plan.previousPolicyRevision
      }));
    } catch (error) {
      const duplicate = this.repository.isDuplicateKey(error);
      const response = error instanceof HttpException ? error.getResponse() : null;
      const responseCode = response && typeof response === 'object'
        ? String((response as { code?: unknown }).code ?? '')
        : '';
      const replayableRace = duplicate
        || responseCode === 'SUBSCRIPTIONS_PUBLICATION_PRECONDITION_CHANGED';
      if (replayableRace) {
        const racedPublication = await this.repositoryCall('WRITE', () =>
          this.repository.runtimePolicyPublicationByIdempotency({
            actorId,
            key: command.idempotencyKey
          })
        );
        if (racedPublication) {
          return this.replayPublication(
            racedPublication,
            input.subscriptionTypeId,
            input.policyVersion,
            requestHash
          );
        }
      }
      if (!duplicate) throw error;
      const racedMapping = await this.repositoryCall('WRITE', () =>
        this.repository.runtimeProviderMappingByIdempotency({
          tenantId,
          actorId,
          key: command.idempotencyKey
        })
      );
      if (racedMapping) {
        return this.replay(racedMapping, input.subscriptionTypeId, input.policyVersion, requestHash);
      }
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_POLICY_ALREADY_PUBLISHED',
        message: 'Policy version or provider mapping was published by another command'
      });
    }

    return {
      item: { mapping: this.publicMapping(mapping), publication },
      replayed: false,
      correlationId: command.correlationId
    };
  }

  private async buildPlan(
    input: {
      subscriptionTypeId: string;
      policyVersion: number;
      providerStudioId: string;
      dictionaryRevision: string;
      dictionaryEvidenceRef: string;
    }
  ): Promise<PublicationPlan> {
    const tenantId = this.tenantId();
    const [type, policy] = await this.repositoryCall('READ_ONLY', async () => Promise.all([
      this.repository.subscriptionTypeById(input.subscriptionTypeId),
      this.repository.policyVersionByNumber(input.subscriptionTypeId, input.policyVersion)
    ]));
    if (!type) throw new NotFoundException('Subscription type not found');
    if (!policy) throw new NotFoundException('Subscription policy version not found');
    const publicationMode = type.state === 'DRAFT' && type.currentPolicyVersion === null
      ? 'INITIAL'
      : type.state === 'ACTIVE'
        && Number.isSafeInteger(type.currentPolicyVersion)
        && Number(type.currentPolicyVersion) > 0
        && input.policyVersion === Number(type.currentPolicyVersion) + 1
        ? 'SUPERSESSION'
        : null;
    if (!publicationMode) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_PUBLICATION_PRECONDITION_CHANGED',
        message: 'Publication target is not the current draft or the next version of an active subscription'
      });
    }
    if (policy.status !== 'DRAFT' || policy.modelVersion !== 3) {
      throw new UnprocessableEntityException({
        code: 'SUBSCRIPTIONS_PUBLICATION_DRAFT_V3_REQUIRED',
        message: 'Publication requires one draft modelVersion 3 policy'
      });
    }
    if (publicationMode === 'SUPERSESSION' && policy.applyTo !== 'NEW_ONLY') {
      throw new UnprocessableEntityException({
        code: 'SUBSCRIPTIONS_ACTIVE_INSTANCE_MIGRATION_UNSUPPORTED',
        message: 'Supersession supports NEW_ONLY only; active instance migration is not available'
      });
    }
    const binding = policy.providerBinding;
    if (!binding
      || binding.provider !== 'VIVA'
      || binding.referenceKind !== 'PRODUCT_CANDIDATE'
      || binding.evidenceState !== 'UNVERIFIED'
      || !ID_PATTERN.test(binding.externalId)) {
      throw new UnprocessableEntityException({
        code: 'SUBSCRIPTIONS_PROVIDER_BINDING_CANDIDATE_REQUIRED',
        message: 'Publication requires one exact unverified Viva product candidate'
      });
    }
    const providerScope = this.providerScope(policy.stationAccessRules ?? [], tenantId);
    const runtimeProjection = compileSubscriptionRuntimeProjection({
      ...policy,
      status: 'PUBLISHED'
    });
    const policyDigest = computeSubscriptionRuntimeProjectionDigest(runtimeProjection);
    this.assertRuntimeProjectionPublishable({
      subscriptionTypeId: input.subscriptionTypeId,
      policyVersion: input.policyVersion,
      policyDigest,
      dictionaryRevision: input.dictionaryRevision,
      runtimeProjection
    });
    const currentPolicyVersion = publicationMode === 'SUPERSESSION'
      ? Number(type.currentPolicyVersion)
      : null;
    const [existingPublication, existingMapping, previousPolicy, previousPublication, existingInstanceCount] = await this.repositoryCall(
      'READ_ONLY',
      async () => Promise.all([
        this.repository.runtimePolicyPublicationByVersion(input.subscriptionTypeId, input.policyVersion),
        this.repository.runtimeProviderMappingByProviderIdentity({
          tenantId,
          provider: 'VIVA',
          providerProductId: binding.externalId,
          providerScopeKind: providerScope.kind,
          providerScopeId: providerScope.scopeId
        }),
        currentPolicyVersion === null
          ? Promise.resolve(null)
          : this.repository.policyVersionByNumber(input.subscriptionTypeId, currentPolicyVersion),
        currentPolicyVersion === null
          ? Promise.resolve(null)
          : this.repository.runtimePolicyPublicationByVersion(
            input.subscriptionTypeId,
            currentPolicyVersion
          ),
        currentPolicyVersion === null
          ? Promise.resolve(0)
          : this.repository.countRuntimeInstancesByPolicy(
            input.subscriptionTypeId,
            currentPolicyVersion
          )
      ])
    );
    if (existingPublication) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_POLICY_ALREADY_PUBLISHED',
        message: 'Policy version already exists'
      });
    }
    if (publicationMode === 'INITIAL' && existingMapping) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_POLICY_ALREADY_PUBLISHED',
        message: 'Provider mapping already exists'
      });
    }
    if (publicationMode === 'SUPERSESSION') {
      if (!previousPolicy
        || previousPolicy.status !== 'PUBLISHED'
        || !previousPublication
        || previousPublication.state !== 'PUBLISHED'
        || previousPublication.policyVersion !== currentPolicyVersion
        || previousPublication.policyDigest !== computeSubscriptionRuntimeProjectionDigest(
          compileSubscriptionRuntimeProjection({ ...previousPolicy, status: 'PUBLISHED' })
        )) {
        throw new ConflictException({
          code: 'SUBSCRIPTIONS_PUBLICATION_PRECONDITION_CHANGED',
          message: 'Current published policy or publication is not eligible for supersession'
        });
      }
      if (existingMapping && (existingMapping.state !== 'VERIFIED'
        || existingMapping.subscriptionTypeId !== input.subscriptionTypeId)) {
        throw new ConflictException({
          code: 'SUBSCRIPTIONS_PROVIDER_MAPPING_CONFLICT',
          message: 'Provider identity is already bound to another subscription type or mapping state'
        });
      }
    }

    const providerEvidence = await this.vivaAdmin.inspectSubscriptionProduct({
      productId: binding.externalId,
      clientId: this.previewClientId(),
      studioId: input.providerStudioId
    });
    if (providerEvidence.providerProductId !== binding.externalId) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PROVIDER_EVIDENCE_MISMATCH',
        message: 'Viva product evidence does not match the policy candidate'
      });
    }
    const impactPreviewRef = this.reference('impact:subscription-publication', {
      schemaVersion: 1,
      tenantId,
      subscriptionTypeId: input.subscriptionTypeId,
      policyVersion: input.policyVersion,
      policyDigest,
      providerProductId: binding.externalId,
      providerStudioId: input.providerStudioId,
      providerScope,
      dictionaryRevision: input.dictionaryRevision,
      dictionaryEvidenceRef: input.dictionaryEvidenceRef,
      publicationMode,
      previousPublicationId: previousPublication?.publicationId ?? null,
      previousPolicyVersion: currentPolicyVersion,
      providerMappingMode: existingMapping ? 'REUSE' : 'CREATE',
      applyTo: policy.applyTo,
      existingInstanceCount
    });
    return {
      typeRevision: type.revision,
      policyRevision: policy.revision,
      previousPolicyRevision: previousPolicy?.revision ?? null,
      previousPublication,
      mapping: existingMapping,
      preview: {
        subscriptionTypeId: input.subscriptionTypeId,
        policyVersion: input.policyVersion,
        policyStatus: 'DRAFT',
        readOnly: true,
        blocked: false,
        blockers: [],
        tenantId,
        providerStudioId: input.providerStudioId,
        providerScope,
        providerProductId: binding.externalId,
        providerEvidence: providerEvidence as SubscriptionProviderProductEvidence,
        dictionaryRevision: input.dictionaryRevision,
        dictionaryEvidenceRef: input.dictionaryEvidenceRef,
        policyDigest,
        impactPreviewRef,
        runtimeProjection: runtimeProjection as SubscriptionRuntimeProjectionSnapshot,
        publicationMode,
        providerMappingMode: existingMapping ? 'REUSE' : 'CREATE',
        supersedes: previousPublication ? {
          publicationId: previousPublication.publicationId,
          policyVersion: previousPublication.policyVersion,
          policyDigest: previousPublication.policyDigest
        } : null,
        instanceImpact: {
          applyTo: policy.applyTo,
          existingInstanceCount,
          migrationRequired: false
        }
      }
    };
  }

  private async replay(
    mapping: StoredSubscriptionProviderMapping,
    subscriptionTypeId: string,
    policyVersion: number,
    requestHash: string
  ): Promise<SubscriptionCreateResult<SubscriptionPolicyPublicationResult>> {
    if (mapping.idempotency.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Idempotency-Key was already used for another publication request'
      });
    }
    const publication = await this.repositoryCall('WRITE', () =>
      this.repository.runtimePolicyPublicationByVersion(subscriptionTypeId, policyVersion)
    );
    if (!publication || publication.mappingId !== mapping.mappingId) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PUBLICATION_REPLAY_INCOMPLETE',
        message: 'Publication idempotency record is incomplete'
      });
    }
    return {
      item: { mapping: this.publicMapping(mapping), publication },
      replayed: true,
      correlationId: mapping.idempotency.correlationId
    };
  }

  private async replayPublication(
    publication: StoredSubscriptionPolicyPublication,
    subscriptionTypeId: string,
    policyVersion: number,
    requestHash: string
  ): Promise<SubscriptionCreateResult<SubscriptionPolicyPublicationResult>> {
    if (!publication.idempotency
      || publication.idempotency.requestHash !== requestHash
      || publication.subscriptionTypeId !== subscriptionTypeId
      || publication.policyVersion !== policyVersion) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Idempotency-Key was already used for another publication request'
      });
    }
    const mapping = await this.repositoryCall('WRITE', () =>
      this.repository.runtimeProviderMappingById(publication.mappingId)
    );
    if (!mapping || mapping.subscriptionTypeId !== subscriptionTypeId) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PUBLICATION_REPLAY_INCOMPLETE',
        message: 'Publication idempotency record is incomplete'
      });
    }
    return {
      item: { mapping: this.publicMapping(mapping), publication },
      replayed: true,
      correlationId: publication.idempotency.correlationId
    };
  }

  private providerScope(
    rules: SubscriptionRuntimeProjectionSnapshot['stationAccessRules'],
    tenantId: string
  ): SubscriptionProviderScope {
    try {
      return deriveSubscriptionProviderScope(rules, tenantId);
    } catch (error) {
      if (!(error instanceof SubscriptionProviderScopeDerivationError)) throw error;
      throw new UnprocessableEntityException({
        code: 'SUBSCRIPTIONS_PUBLICATION_STATION_SCOPE_UNSUPPORTED',
        message: 'First publication requires ALL_STATIONS or a non-empty exact station set'
      });
    }
  }

  private assertRuntimeProjectionPublishable(input: {
    subscriptionTypeId: string;
    policyVersion: number;
    policyDigest: string;
    dictionaryRevision: string;
    runtimeProjection: SubscriptionRuntimeProjectionSnapshot;
  }): void {
    try {
      validateStoredSubscriptionPolicyPublication({
        schemaVersion: 1,
        publicationId: 'publication:preview-validation',
        subscriptionTypeId: input.subscriptionTypeId,
        policyVersion: input.policyVersion,
        policyDigest: input.policyDigest,
        mappingId: 'mapping:preview-validation',
        dictionaryRevision: input.dictionaryRevision,
        runtimeProjection: input.runtimeProjection,
        state: 'PUBLISHED',
        effectiveAt: input.runtimeProjection.effectiveAt,
        publishedAt: new Date().toISOString(),
        publishedBy: 'system:publication-preview',
        supersededAt: null,
        supersededBy: null,
        impactPreviewRef: 'impact:preview-validation',
        approvalAuditRef: 'audit:preview-validation'
      });
    } catch (error) {
      if (error instanceof SubscriptionRuntimeContractError) {
        throw new UnprocessableEntityException({
          code: error.code,
          message: 'Draft policy cannot satisfy the immutable runtime publication contract'
        });
      }
      throw error;
    }
  }

  private normalizePreviewInput(
    subscriptionTypeId: string,
    rawVersion: string,
    dto: SubscriptionPolicyPublicationPreviewDto
  ): {
    subscriptionTypeId: string;
    policyVersion: number;
    providerStudioId: string;
    dictionaryRevision: string;
    dictionaryEvidenceRef: string;
  } {
    const normalizedTypeId = String(subscriptionTypeId ?? '').trim();
    const normalizedVersion = String(rawVersion ?? '').trim();
    const policyVersion = Number(normalizedVersion);
    const providerStudioId = String(dto.providerStudioId ?? '').trim();
    const dictionaryRevision = String(dto.dictionaryRevision ?? '').trim();
    const dictionaryEvidenceRef = String(dto.dictionaryEvidenceRef ?? '').trim();
    if (!ID_PATTERN.test(normalizedTypeId)
      || !/^[1-9]\d{0,9}$/.test(normalizedVersion)
      || !Number.isSafeInteger(policyVersion)) {
      throw new NotFoundException('Subscription policy version not found');
    }
    if (!ID_PATTERN.test(providerStudioId) || !ID_PATTERN.test(dictionaryRevision)) {
      throw new BadRequestException({
        code: 'SUBSCRIPTIONS_PUBLICATION_INPUT_INVALID',
        message: 'Provider studio and dictionary revision must be canonical identifiers'
      });
    }
    if (!DICTIONARY_EVIDENCE_PATTERN.test(dictionaryEvidenceRef)) {
      throw new BadRequestException({
        code: 'SUBSCRIPTIONS_PUBLICATION_DICTIONARY_EVIDENCE_REQUIRED',
        message: 'Canonical dictionary evidence must be a content-addressed reference'
      });
    }
    return {
      subscriptionTypeId: normalizedTypeId,
      policyVersion,
      providerStudioId,
      dictionaryRevision,
      dictionaryEvidenceRef
    };
  }

  private normalizePublishInput(
    subscriptionTypeId: string,
    rawVersion: string,
    dto: PublishSubscriptionPolicyDto
  ): ReturnType<SubscriptionPublicationService['normalizePreviewInput']> & {
    expectedPolicyDigest: string;
    expectedImpactPreviewRef: string;
    approvalReason: string;
  } {
    const preview = this.normalizePreviewInput(subscriptionTypeId, rawVersion, dto);
    const expectedPolicyDigest = String(dto.expectedPolicyDigest ?? '').trim();
    const expectedImpactPreviewRef = String(dto.expectedImpactPreviewRef ?? '').trim();
    const approvalReason = String(dto.approvalReason ?? '').trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(expectedPolicyDigest)
      || !/^impact:subscription-publication:[a-f0-9]{64}$/.test(expectedImpactPreviewRef)
      || approvalReason.length < 10
      || approvalReason.length > 500) {
      throw new BadRequestException({
        code: 'SUBSCRIPTIONS_PUBLICATION_APPROVAL_INVALID',
        message: 'Exact preview digest/reference and a 10..500 character approval reason are required'
      });
    }
    return { ...preview, expectedPolicyDigest, expectedImpactPreviewRef, approvalReason };
  }

  private async appendApprovalAudit(input: {
    approvalAuditRef: string;
    publicationId: string;
    actorId: string;
    user?: RequestUser;
    command: { idempotencyKey: string; correlationId: string };
    plan: PublicationPlan;
    mappingId: string;
    mappingEvidenceRef: string;
    approvalReason: string;
  }): Promise<void> {
    if (!this.authPersistence.isEnabled()) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PUBLICATION_AUDIT_UNAVAILABLE',
        message: 'Durable admin audit is required before publication'
      });
    }
    try {
      await this.authPersistence.appendAudit({
        id: input.approvalAuditRef,
        at: new Date().toISOString(),
        action: 'SUBSCRIPTION_POLICY_PUBLICATION_APPROVED',
        actor: {
          id: input.actorId,
          login: input.user?.login,
          title: input.user?.title
        },
        targetType: 'RESOURCE',
        targetId: input.publicationId,
        targetLabel: `${input.plan.preview.subscriptionTypeId}:v${input.plan.preview.policyVersion}`,
        metadata: {
          correlationId: input.command.correlationId,
          idempotencyKeyHash: this.hash(input.command.idempotencyKey),
          subscriptionTypeId: input.plan.preview.subscriptionTypeId,
          policyVersion: input.plan.preview.policyVersion,
          policyDigest: input.plan.preview.policyDigest,
          impactPreviewRef: input.plan.preview.impactPreviewRef,
          dictionaryRevision: input.plan.preview.dictionaryRevision,
          dictionaryEvidenceRef: input.plan.preview.dictionaryEvidenceRef,
          providerEvidenceRef: input.plan.preview.providerEvidence.evidenceRef,
          publicationMode: input.plan.preview.publicationMode,
          providerMappingMode: input.plan.preview.providerMappingMode,
          supersededPublicationId: input.plan.preview.supersedes?.publicationId ?? null,
          supersededPolicyVersion: input.plan.preview.supersedes?.policyVersion ?? null,
          applyTo: input.plan.preview.instanceImpact.applyTo,
          existingInstanceCount: input.plan.preview.instanceImpact.existingInstanceCount,
          migrationRequired: input.plan.preview.instanceImpact.migrationRequired,
          mappingId: input.mappingId,
          mappingEvidenceRef: input.mappingEvidenceRef,
          approvalReason: input.approvalReason
        }
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PUBLICATION_AUDIT_UNAVAILABLE',
        message: 'Durable admin audit could not be written'
      });
    }
  }

  private requireFlags(mode: 'PREVIEW' | 'COMMAND'): void {
    if (!this.flag('SUBSCRIPTIONS_ADMIN_ENABLED')
      || !this.flag('SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED')
      || !this.flag('SUBSCRIPTIONS_PUBLICATION_PREVIEW_ENABLED')
      || (mode === 'COMMAND' && !this.flag('SUBSCRIPTIONS_PUBLICATION_COMMAND_ENABLED'))) {
      throw new ServiceUnavailableException({
        code: mode === 'PREVIEW'
          ? 'SUBSCRIPTIONS_PUBLICATION_PREVIEW_DISABLED'
          : 'SUBSCRIPTIONS_PUBLICATION_COMMAND_DISABLED',
        message: mode === 'PREVIEW'
          ? 'Subscription publication preview is disabled'
          : 'Subscription publication command is disabled'
      });
    }
  }

  private requireGlobalPublicationActor(user?: RequestUser): string {
    const actorId = String(user?.id ?? '').trim();
    if (!actorId) throw new UnauthorizedException('User context is missing');
    if (getStationScopeForPermission(user, 'subscriptions:publication:write') !== null) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_PUBLICATION_GLOBAL_SCOPE_REQUIRED',
        message: 'Subscription publication requires global scope'
      });
    }
    return actorId;
  }

  private validateCommandHeaders(headers: CommandHeaders): {
    idempotencyKey: string;
    correlationId: string;
  } {
    const idempotencyKey = String(headers.idempotencyKey ?? '');
    const correlationId = String(headers.correlationId ?? '');
    if (idempotencyKey !== idempotencyKey.trim()
      || idempotencyKey.length < 16
      || idempotencyKey.length > 128) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must contain 16..128 characters without surrounding spaces'
      });
    }
    if (correlationId !== correlationId.trim()
      || correlationId.length < 8
      || correlationId.length > 128) {
      throw new BadRequestException({
        code: 'INVALID_CORRELATION_ID',
        message: 'X-Correlation-Id must contain 8..128 characters without surrounding spaces'
      });
    }
    return { idempotencyKey, correlationId };
  }

  private tenantId(): string {
    const value = String(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID ?? '').trim();
    if (!ID_PATTERN.test(value)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PUBLICATION_TENANT_NOT_CONFIGURED',
        message: 'Subscription runtime tenant is not configured'
      });
    }
    return value;
  }

  private previewClientId(): string {
    const value = String(
      process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_ID ?? ''
    ).trim();
    if (!ID_PATTERN.test(value)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_NOT_CONFIGURED',
        message: 'Synthetic Viva client context is not configured'
      });
    }
    return value;
  }

  private async repositoryCall<T>(
    mode: 'READ_ONLY' | 'WRITE',
    action: () => Promise<T>
  ): Promise<T> {
    try {
      if (mode === 'READ_ONLY') await this.repository.connectReadOnly();
      else await this.repository.connect();
      return await action();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (this.repository.isDuplicateKey(error)) throw error;
      if (error instanceof SubscriptionRuntimeContractError) {
        if ([
          'SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT',
          'SUBSCRIPTION_PUBLICATION_CAS_CONFLICT'
        ].includes(error.code)) {
          throw new ConflictException({
            code: 'SUBSCRIPTIONS_PUBLICATION_PRECONDITION_CHANGED',
            message: 'Subscription policy changed during publication'
          });
        }
        if (error.code === 'SUBSCRIPTION_PUBLICATION_SOURCE_NOT_FOUND') {
          throw new NotFoundException('Subscription policy version not found');
        }
      }
      const message = String((error as Error)?.message ?? error);
      if (message.includes('SUBSCRIPTIONS_')
        || message.includes('Mongo')
        || message.includes('ECONN')
        || message.includes('server selection')) {
        throw new ServiceUnavailableException({
          code: 'SUBSCRIPTIONS_PUBLICATION_STORAGE_UNAVAILABLE',
          message: 'Subscription publication storage is not ready'
        });
      }
      throw error;
    }
  }

  private publicMapping(mapping: StoredSubscriptionProviderMapping): SubscriptionProviderMappingView {
    const { idempotency: _idempotency, ...view } = mapping;
    return view;
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }

  private reference(prefix: string, value: unknown): string {
    return `${prefix}:${this.hash(value)}`;
  }

  private hash(value: unknown): string {
    const payload = typeof value === 'string' ? value : stableStringify(value);
    return createHash('sha256').update(payload).digest('hex');
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => (
      `${JSON.stringify(key)}:${stableStringify(item)}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

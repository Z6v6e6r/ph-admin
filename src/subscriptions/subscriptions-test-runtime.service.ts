import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { getStationScopeForPermission } from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { ActivateSubscriptionTestOfferDto } from './dto/activate-subscription-test-offer.dto';
import { CreateSubscriptionTestReservationDto } from './dto/create-subscription-test-reservation.dto';
import { FakeConfirmSubscriptionTestPurchaseDto } from './dto/fake-confirm-subscription-test-purchase.dto';
import { SubscriptionUsageTestQuoteDto } from './dto/subscription-usage-test-quote.dto';
import { SubscriptionUsageResolvedQuoteDto } from './dto/subscription-usage-resolved-quote.dto';
import {
  buildSubscriptionUsageTestScenario,
  evaluateSubscriptionUsageResolvedTarget,
  evaluateSubscriptionUsageTestScenario
} from './subscription-usage-test-runtime';
import { resolveSubscriptionUsageExactTarget } from './subscription-usage-test-exact-target';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  ReleaseProgram,
  StoredReleaseProgram,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionTestEvent,
  StoredSubscriptionTestInventory,
  StoredSubscriptionTestOffer,
  StoredSubscriptionTestPurchase,
  StoredSubscriptionTestReservation,
  SubscriptionImpactIssue,
  SubscriptionPolicyImpactPreview,
  SubscriptionPolicyVersion,
  SubscriptionTestActivationResult,
  SubscriptionTestInventorySnapshot,
  SubscriptionTestOfferView,
  SubscriptionTestPurchaseStatus,
  SubscriptionTestPurchaseView,
  SubscriptionTestReservationResult,
  SubscriptionUsageTestQuoteResult,
  SubscriptionUsageResolvedQuoteResult,
  SubscriptionUsageTestScenarioView
} from './subscriptions.types';

interface CommandHeaders {
  idempotencyKey: string | undefined;
  correlationId: string | undefined;
}

const EXPIRY_SWEEP_BATCH = 100;
const EXPIRY_SWEEP_ROUNDS = 10;
const RESERVATION_ATTEMPTS = 8;

@Injectable()
export class SubscriptionsTestRuntimeService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async impactPreview(
    subscriptionTypeId: string,
    version: number,
    releaseProgramId: string,
    user?: RequestUser
  ): Promise<SubscriptionPolicyImpactPreview> {
    this.requireAdminFeatureEnabled();
    this.requireActor(user);
    const normalizedTypeId = this.requiredId(subscriptionTypeId, 'Subscription type not found');
    if (!Number.isInteger(version) || version < 1) throw new NotFoundException('Policy version not found');
    const normalizedProgramId = this.requiredId(releaseProgramId, 'Release program not found');
    const [type, policy, program] = await Promise.all([
      this.call(() => this.repository.subscriptionTypeById(normalizedTypeId)),
      this.call(() => this.repository.policyVersionByNumber(normalizedTypeId, version)),
      this.call(() => this.repository.releaseProgramById(normalizedProgramId))
    ]);
    if (!type) throw new NotFoundException('Subscription type not found');
    if (!policy) throw new NotFoundException('Policy version not found');
    if (!program || program.subscriptionTypeId !== normalizedTypeId) {
      throw new NotFoundException('Release program not found');
    }
    this.requireStationScope(user, 'subscriptions:read', program.stationId);

    const realBlockers: SubscriptionImpactIssue[] = [];
    const testBlockers: SubscriptionImpactIssue[] = [];
    const warnings: SubscriptionImpactIssue[] = [];
    testBlockers.push(...this.testActivationBlockers(policy, program));
    if (!policy.providerBinding || policy.providerBinding.evidenceState !== 'UNVERIFIED') {
      realBlockers.push(this.issue(
        'PROVIDER_MAPPING_NOT_APPROVED',
        'Для реальной публикации требуется отдельный reviewed provider mapping contract',
        'REAL'
      ));
    } else {
      realBlockers.push(this.issue(
        'PROVIDER_MAPPING_UNVERIFIED',
        'Viva productId остаётся кандидатом UNVERIFIED и блокирует реальную публикацию',
        'REAL'
      ));
      warnings.push(this.issue(
        'FAKE_PROVIDER_IGNORES_VIVA_MAPPING',
        'Тестовый runtime использует только FAKE provider и не вызывает Viva',
        'TEST'
      ));
    }
    if (policy.benefitRules.filter((rule) => rule.enabled && rule.kind !== 'DISABLED').length === 0) {
      realBlockers.push(this.issue(
        'NO_ENABLED_BENEFITS',
        'Для пользовательского сценария скидки нет включённых льгот на запись',
        'REAL'
      ));
    }
    realBlockers.push(
      this.issue(
        'INITIAL_ENTITLEMENT_UNDEFINED',
        'Начальный баланс посещений экземпляра подписки не зафиксирован в runtime-контракте',
        'REAL'
      ),
      this.issue(
        'CANONICAL_STATION_MAPPING_UNVERIFIED',
        'Станции программы выпуска не разрешены через подтверждённый canonical mapping',
        'REAL'
      ),
      this.issue(
        'CANONICAL_EVENT_MAPPING_UNVERIFIED',
        'Типы событий льгот не разрешены через подтверждённый canonical mapping',
        'REAL'
      )
    );
    return {
      subscriptionTypeId: normalizedTypeId,
      policyVersion: policy.version,
      policyStatus: policy.status,
      readOnly: true,
      realPublication: { blocked: realBlockers.length > 0, blockers: realBlockers },
      testActivation: { allowed: testBlockers.length === 0, blockers: testBlockers },
      warnings
    };
  }

  async activateTestOffer(
    releaseProgramId: string,
    dto: ActivateSubscriptionTestOfferDto,
    headers: CommandHeaders,
    user?: RequestUser
  ): Promise<SubscriptionTestActivationResult> {
    this.requireAdminFeatureEnabled();
    this.requireTestRuntimeEnabled();
    const actorId = this.requireActor(user);
    const command = this.validateCommandHeaders(headers);
    const normalizedProgramId = this.requiredId(releaseProgramId, 'Release program not found');
    const requestHash = this.requestHash('activateSubscriptionTestOffer', {
      releaseProgramId: normalizedProgramId,
      policyVersion: dto.policyVersion,
      providerMode: 'FAKE',
      testOnly: true
    });
    const existing = await this.call(() =>
      this.repository.testOfferByIdempotency(actorId, command.idempotencyKey)
    );
    if (existing) {
      this.assertIdempotency(existing.idempotency.requestHash, requestHash);
      this.requireStationScope(user, 'subscriptions:release:write', existing.stationId);
      const inventory = await this.ensureTestInventory(existing);
      await this.recordOfferActivationEvent(existing);
      return this.activationResponse(existing, inventory, null, true, command.correlationId);
    }

    const program = await this.call(() => this.repository.releaseProgramById(normalizedProgramId));
    if (!program) throw new NotFoundException('Release program not found');
    this.requireStationScope(user, 'subscriptions:release:write', program.stationId);
    if (program.state !== 'DRAFT') {
      throw this.domainError('RELEASE_PROGRAM_NOT_DRAFT', 'Тестовая активация доступна только для DRAFT-программы');
    }
    const [type, policy] = await Promise.all([
      this.call(() => this.repository.subscriptionTypeById(program.subscriptionTypeId)),
      this.call(() => this.repository.policyVersionByNumber(program.subscriptionTypeId, dto.policyVersion))
    ]);
    if (!type) throw new NotFoundException('Subscription type not found');
    if (!policy) throw new NotFoundException('Policy version not found');
    const activationBlockers = this.testActivationBlockers(policy, program);
    if (activationBlockers.length) {
      throw this.domainError('TEST_ACTIVATION_BLOCKED', 'Тестовая активация заблокирована', {
        blockers: activationBlockers
      });
    }
    const sameProgramOffer = await this.call(() =>
      this.repository.testOfferByProgramPolicy(program.releaseProgramId, policy.version)
    );
    if (sameProgramOffer) {
      const inventory = await this.ensureTestInventory(sameProgramOffer);
      return this.activationResponse(sameProgramOffer, inventory, null, true, command.correlationId);
    }

    const accessToken = randomBytes(32).toString('base64url');
    const now = this.now().toISOString();
    const offer: StoredSubscriptionTestOffer = {
      schemaVersion: 1,
      offerId: `test_offer:${randomUUID()}`,
      subscriptionTypeId: program.subscriptionTypeId,
      releaseProgramId: program.releaseProgramId,
      title: type.title,
      stationId: program.stationId,
      timezone: program.timezone,
      state: 'TEST_ACTIVE',
      testOnly: true,
      providerMode: 'FAKE',
      accessTokenHash: this.hashSecret('access-token', accessToken),
      policyVersion: policy.version,
      policySnapshot: this.publicPolicy(policy),
      releaseProgramSnapshot: this.publicProgram(program),
      reservationTtlMinutes: policy.capabilities?.commerce?.reservationTtlMinutes ?? 15,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      idempotency: {
        actorId,
        key: command.idempotencyKey,
        requestHash,
        correlationId: command.correlationId
      }
    };
    try {
      await this.call(() => this.repository.insertTestOffer(offer));
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
      const raced = await this.call(() =>
        this.repository.testOfferByIdempotency(actorId, command.idempotencyKey)
      );
      const existingProgramOffer = raced ?? await this.call(() =>
        this.repository.testOfferByProgramPolicy(program.releaseProgramId, policy.version)
      );
      if (!existingProgramOffer) throw error;
      if (raced) this.assertIdempotency(raced.idempotency.requestHash, requestHash);
      const inventory = await this.ensureTestInventory(existingProgramOffer);
      return this.activationResponse(existingProgramOffer, inventory, null, true, command.correlationId);
    }
    const inventory = await this.ensureTestInventory(offer);
    await this.recordOfferActivationEvent(offer);
    return this.activationResponse(offer, inventory, accessToken, false, command.correlationId);
  }

  async adminInventory(
    offerId: string,
    user?: RequestUser
  ): Promise<SubscriptionTestInventorySnapshot> {
    this.requireAdminFeatureEnabled();
    this.requireTestRuntimeEnabled();
    this.requireActor(user);
    const offer = await this.offerById(offerId);
    this.requireStationScope(user, 'subscriptions:read', offer.stationId);
    await this.expirePendingPurchases(offer);
    return this.inventorySnapshot(await this.requiredInventory(offer.offerId));
  }

  async adminInventoryByReleaseProgram(
    releaseProgramId: string,
    user?: RequestUser
  ): Promise<SubscriptionTestInventorySnapshot> {
    this.requireAdminFeatureEnabled();
    this.requireTestRuntimeEnabled();
    this.requireActor(user);
    const normalized = this.requiredId(releaseProgramId, 'Release program not found');
    const offer = await this.call(() => this.repository.testOfferByReleaseProgramId(normalized));
    if (!offer) throw new NotFoundException('Active test offer not found');
    this.requireStationScope(user, 'subscriptions:read', offer.stationId);
    await this.expirePendingPurchases(offer);
    return this.inventorySnapshot(await this.requiredInventory(offer.offerId));
  }

  async offerByCredentials(
    offerId: string,
    accessToken: string
  ): Promise<SubscriptionTestOfferView> {
    this.requireTestRuntimeEnabled();
    const offer = await this.offerByCredentialsInternal(offerId, accessToken);
    await this.expirePendingPurchases(offer);
    return this.offerView(offer, await this.requiredInventory(offer.offerId));
  }

  async usageScenarios(
    offerId: string,
    accessToken: string
  ): Promise<SubscriptionUsageTestScenarioView> {
    this.requireTestRuntimeEnabled();
    const offer = await this.offerByCredentialsInternal(offerId, accessToken);
    return buildSubscriptionUsageTestScenario(offer, this.now());
  }

  async quoteUsageScenario(
    offerId: string,
    accessToken: string,
    dto: SubscriptionUsageTestQuoteDto
  ): Promise<SubscriptionUsageTestQuoteResult> {
    this.requireTestRuntimeEnabled();
    const offer = await this.offerByCredentialsInternal(offerId, accessToken);
    return evaluateSubscriptionUsageTestScenario(offer, dto, this.now());
  }

  async quoteResolvedUsageScenario(
    offerId: string,
    accessToken: string,
    dto: SubscriptionUsageResolvedQuoteDto
  ): Promise<SubscriptionUsageResolvedQuoteResult> {
    this.requireTestRuntimeEnabled();
    const offer = await this.offerByCredentialsInternal(offerId, accessToken);
    const resolved = resolveSubscriptionUsageExactTarget(offer, dto);
    return evaluateSubscriptionUsageResolvedTarget(offer, resolved, dto, this.now());
  }

  async reserve(
    offerId: string,
    accessToken: string,
    dto: CreateSubscriptionTestReservationDto,
    headers: CommandHeaders
  ): Promise<SubscriptionTestReservationResult> {
    this.requireTestRuntimeEnabled();
    const command = this.validateCommandHeaders(headers);
    const offer = await this.offerByCredentialsInternal(offerId, accessToken);
    await this.expirePendingPurchases(offer);
    const clientRef = String(dto.clientRef ?? '').trim();
    if (clientRef.length < 3) throw new BadRequestException('clientRef must contain at least 3 non-space characters');
    if (!clientRef.startsWith('synthetic:')) {
      throw new BadRequestException({
        code: 'SYNTHETIC_CLIENT_REF_REQUIRED',
        message: 'Test runtime accepts only synthetic: client references'
      });
    }
    const clientRefHash = this.hashClientRef(clientRef);
    const keyHash = this.hashSecret(`reservation-key:${offer.offerId}`, command.idempotencyKey);
    const requestHash = this.requestHash('createSubscriptionTestReservation', {
      offerId: offer.offerId,
      clientRefHash
    });
    let purchase = await this.call(() => this.repository.testPurchaseByIdempotency(offer.offerId, keyHash));
    if (purchase) {
      this.assertIdempotency(purchase.idempotency.requestHash, requestHash);
      return this.resumeReservation(offer, purchase);
    }

    const initialInventory = await this.requiredInventory(offer.offerId);
    const current = initialInventory.phases
      .find((phase) => phase.order === initialInventory.currentPhaseOrder);
    if (!current || current.available <= 0) {
      throw this.conflict('TEST_OFFER_SOLD_OUT', 'В текущей тестовой фазе нет доступных подписок');
    }
    const now = this.now();
    purchase = {
      schemaVersion: 1,
      purchaseId: `test_purchase:${randomUUID()}`,
      offerId: offer.offerId,
      phaseId: current.phaseId,
      phaseOrder: current.order,
      accessTokenHash: offer.accessTokenHash,
      clientRefHash,
      status: 'CREATING',
      priceSnapshot: { ...current.price },
      expiresAt: new Date(now.getTime() + offer.reservationTtlMinutes * 60_000).toISOString(),
      testOnly: true,
      providerMode: 'FAKE',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      inventoryFinalizedAt: null,
      idempotency: { keyHash, requestHash, correlationId: command.correlationId },
      confirmationCommands: {}
    };
    try {
      await this.call(() => this.repository.insertTestPurchase(purchase as StoredSubscriptionTestPurchase));
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
      const raced = await this.call(() => this.repository.testPurchaseByIdempotency(offer.offerId, keyHash));
      if (!raced) throw error;
      this.assertIdempotency(raced.idempotency.requestHash, requestHash);
      purchase = raced;
    }
    return this.resumeReservation(offer, purchase);
  }

  async fakeConfirm(
    purchaseId: string,
    accessToken: string,
    dto: FakeConfirmSubscriptionTestPurchaseDto,
    headers: CommandHeaders
  ): Promise<SubscriptionTestPurchaseView> {
    this.requireTestRuntimeEnabled();
    const command = this.validateCommandHeaders(headers);
    const purchase = await this.purchaseWithToken(purchaseId, accessToken);
    const offer = await this.offerById(purchase.offerId);
    await this.expirePendingPurchases(offer);
    let current = await this.requiredPurchase(purchase.purchaseId);
    if (current.status === 'CREATING') {
      await this.resumeReservation(offer, current);
      current = await this.requiredPurchase(current.purchaseId);
    }
    const confirmationKeyHash = this.hashSecret(
      `fake-confirm-key:${current.purchaseId}`,
      command.idempotencyKey
    );
    const confirmationRequestHash = this.requestHash('fakeConfirmSubscriptionTestPurchase', {
      purchaseId: current.purchaseId,
      accessTokenHash: current.accessTokenHash,
      outcome: dto.outcome
    });
    if (!current.confirmationCommands?.[confirmationKeyHash]) {
      current = await this.call(() => this.repository.claimTestPurchaseConfirmation({
        purchaseId: current.purchaseId,
        keyHash: confirmationKeyHash,
        requestHash: confirmationRequestHash,
        correlationId: command.correlationId,
        outcome: dto.outcome,
        updatedAt: this.now().toISOString()
      })) ?? await this.requiredPurchase(current.purchaseId);
    }
    const claimedConfirmation = current.confirmationCommands?.[confirmationKeyHash];
    if (!claimedConfirmation || claimedConfirmation.requestHash !== confirmationRequestHash) {
      throw this.conflict('IDEMPOTENCY_CONFLICT', 'Idempotency-Key уже использован с другим fake-confirm intent');
    }
    if (dto.outcome === 'PENDING') return this.publicPurchase(current, await this.requiredInventory(offer.offerId));
    const target = dto.outcome;
    if (current.status !== 'PAYMENT_PENDING' && current.status !== target) {
      throw this.conflict(
        'TEST_PURCHASE_STATE_CONFLICT',
        `Покупка уже завершена в состоянии ${current.status}`
      );
    }
    if (current.status === 'PAYMENT_PENDING') {
      current = await this.call(() => this.repository.transitionTestPurchase({
        purchaseId: current.purchaseId,
        from: 'PAYMENT_PENDING',
        to: target,
        updatedAt: this.now().toISOString()
      })) ?? await this.requiredPurchase(current.purchaseId);
    }
    if (current.status !== target) {
      throw this.conflict(
        'TEST_PURCHASE_STATE_CONFLICT',
        `Concurrent confirmation completed purchase as ${current.status}`
      );
    }
    const inventory = await this.finalizePurchase(offer, current);
    return this.publicPurchase(current, inventory);
  }

  async getPurchase(purchaseId: string, accessToken: string): Promise<SubscriptionTestPurchaseView> {
    this.requireTestRuntimeEnabled();
    const purchase = await this.purchaseWithToken(purchaseId, accessToken);
    const offer = await this.offerById(purchase.offerId);
    await this.expirePendingPurchases(offer);
    const current = await this.requiredPurchase(purchase.purchaseId);
    const inventory = current.status === 'PAID' || current.status === 'FAILED' || current.status === 'EXPIRED'
      ? await this.finalizePurchase(offer, current)
      : await this.requiredInventory(offer.offerId);
    return this.publicPurchase(current, inventory);
  }

  private async resumeReservation(
    offer: StoredSubscriptionTestOffer,
    initial: StoredSubscriptionTestPurchase
  ): Promise<SubscriptionTestReservationResult> {
    let purchase = initial;
    if (purchase.status !== 'CREATING') {
      if (purchase.status !== 'PAYMENT_PENDING') {
        throw this.conflict('TEST_RESERVATION_NOT_PENDING', `Резерв находится в состоянии ${purchase.status}`);
      }
      await this.recordPurchaseEvent(offer, purchase, 'PURCHASE_RESERVED');
      return this.reservationResponse(purchase);
    }
    const markerKey = this.markerKey(purchase.purchaseId);
    const clientClaimKey = this.markerKey(purchase.clientRefHash);
    const purchaseLimit = Math.max(
      1,
      Number(offer.policySnapshot.capabilities?.commerce?.purchaseLimitPerClient ?? 1)
    );
    for (let attempt = 0; attempt < RESERVATION_ATTEMPTS; attempt += 1) {
      const inventory = await this.requiredInventory(offer.offerId);
      const existingMarker = inventory.purchaseMarkers[markerKey];
      if (!existingMarker) {
        if ((inventory.clientClaimCounts[clientClaimKey] ?? 0) >= purchaseLimit) {
          await this.failCreatingPurchase(purchase.purchaseId);
          throw this.conflict('TEST_PURCHASE_LIMIT_REACHED', 'Достигнут лимит покупок для тестового клиента');
        }
        const phase = inventory.phases.find((item) => item.order === inventory.currentPhaseOrder);
        if (!phase || phase.available <= 0) {
          await this.failCreatingPurchase(purchase.purchaseId);
          throw this.conflict('TEST_OFFER_SOLD_OUT', 'В текущей тестовой фазе нет доступных подписок');
        }
        const expiresAt = new Date(this.now().getTime() + offer.reservationTtlMinutes * 60_000).toISOString();
        purchase = await this.call(() => this.repository.updateCreatingTestPurchaseSnapshot({
          purchaseId: purchase.purchaseId,
          phaseId: phase.phaseId,
          phaseOrder: phase.order,
          priceSnapshot: { ...phase.price },
          expiresAt,
          updatedAt: this.now().toISOString()
        })) ?? await this.requiredPurchase(purchase.purchaseId);
        const reserved = await this.call(() => this.repository.reserveTestInventory({
          offerId: offer.offerId,
          phaseId: purchase.phaseId,
          phaseOrder: purchase.phaseOrder,
          purchaseMarkerKey: markerKey,
          clientClaimKey,
          purchaseLimitPerClient: purchaseLimit,
          now: this.now().toISOString()
        }));
        if (!reserved) {
          const count = await this.call(() =>
            this.repository.countTestPurchasesForClient(offer.offerId, purchase.clientRefHash)
          );
          if (count >= purchaseLimit) {
            await this.failCreatingPurchase(purchase.purchaseId);
            throw this.conflict('TEST_PURCHASE_LIMIT_REACHED', 'Достигнут лимит покупок для тестового клиента');
          }
          continue;
        }
      } else if (existingMarker.state !== 'RESERVED') {
        throw this.conflict('TEST_RESERVATION_NOT_PENDING', `Резерв находится в состоянии ${existingMarker.state}`);
      }
      await this.ensureReservationDocument(purchase);
      purchase = await this.call(() => this.repository.transitionTestPurchase({
        purchaseId: purchase.purchaseId,
        from: 'CREATING',
        to: 'PAYMENT_PENDING',
        updatedAt: this.now().toISOString()
      })) ?? await this.requiredPurchase(purchase.purchaseId);
      await this.recordPurchaseEvent(offer, purchase, 'PURCHASE_RESERVED');
      return this.reservationResponse(purchase);
    }
    await this.failCreatingPurchase(purchase.purchaseId);
    throw this.conflict('TEST_INVENTORY_CONTENTION', 'Не удалось атомарно зарезервировать подписку, повторите запрос');
  }

  private async failCreatingPurchase(purchaseId: string): Promise<void> {
    await this.call(() => this.repository.transitionTestPurchase({
      purchaseId,
      from: 'CREATING',
      to: 'FAILED',
      updatedAt: this.now().toISOString()
    }));
  }

  private async ensureReservationDocument(purchase: StoredSubscriptionTestPurchase): Promise<void> {
    const existing = await this.call(() => this.repository.testReservationByPurchaseId(purchase.purchaseId));
    if (existing) return;
    const row: StoredSubscriptionTestReservation = {
      schemaVersion: 1,
      reservationId: `test_reservation:${randomUUID()}`,
      purchaseId: purchase.purchaseId,
      offerId: purchase.offerId,
      phaseId: purchase.phaseId,
      clientRefHash: purchase.clientRefHash,
      status: 'PAYMENT_PENDING',
      priceSnapshot: { ...purchase.priceSnapshot },
      expiresAt: purchase.expiresAt,
      createdAt: purchase.createdAt,
      updatedAt: this.now().toISOString()
    };
    try {
      await this.call(() => this.repository.insertTestReservation(row));
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
    }
  }

  private async expirePendingPurchases(offer: StoredSubscriptionTestOffer): Promise<void> {
    for (let round = 0; round < EXPIRY_SWEEP_ROUNDS; round += 1) {
      const expired = await this.call(() =>
        this.repository.listExpiredTestPurchases(offer.offerId, this.now().toISOString(), EXPIRY_SWEEP_BATCH)
      );
      if (!expired.length) {
        await this.reconcileTerminalPurchases(offer);
        return;
      }
      for (const purchase of expired) {
        const changed = await this.call(() => this.repository.transitionTestPurchase({
          purchaseId: purchase.purchaseId,
          from: purchase.status,
          to: 'EXPIRED',
          updatedAt: this.now().toISOString()
        }));
        const current = changed ?? await this.requiredPurchase(purchase.purchaseId);
        if (current.status === 'EXPIRED') await this.finalizePurchase(offer, current);
      }
      if (expired.length < EXPIRY_SWEEP_BATCH) {
        await this.reconcileTerminalPurchases(offer);
        return;
      }
    }
    const remainingExpired = await this.call(() =>
      this.repository.listExpiredTestPurchases(offer.offerId, this.now().toISOString(), 1)
    );
    if (!remainingExpired.length) {
      await this.reconcileTerminalPurchases(offer);
      return;
    }
    throw new ServiceUnavailableException({
      code: 'TEST_EXPIRY_SWEEP_LIMIT',
      message: 'Too many expired test reservations; retry the request'
    });
  }

  private async reconcileTerminalPurchases(offer: StoredSubscriptionTestOffer): Promise<void> {
    for (let round = 0; round < EXPIRY_SWEEP_ROUNDS; round += 1) {
      const pending = await this.call(() =>
        this.repository.listUnfinalizedTerminalTestPurchases(
          offer.offerId,
          EXPIRY_SWEEP_BATCH
        )
      );
      if (!pending.length) return;
      for (const purchase of pending) await this.finalizePurchase(offer, purchase);
      if (pending.length < EXPIRY_SWEEP_BATCH) return;
    }
    const remaining = await this.call(() =>
      this.repository.listUnfinalizedTerminalTestPurchases(offer.offerId, 1)
    );
    if (!remaining.length) return;
    throw new ServiceUnavailableException({
      code: 'TEST_RECONCILIATION_SWEEP_LIMIT',
      message: 'Too many unreconciled terminal test purchases; retry the request'
    });
  }

  private async finalizePurchase(
    offer: StoredSubscriptionTestOffer,
    purchase: StoredSubscriptionTestPurchase
  ): Promise<StoredSubscriptionTestInventory> {
    if (!['PAID', 'FAILED', 'EXPIRED'].includes(purchase.status)) {
      return this.requiredInventory(offer.offerId);
    }
    const finalStatus = purchase.status as 'PAID' | 'FAILED' | 'EXPIRED';
    const markerKey = this.markerKey(purchase.purchaseId);
    const clientClaimKey = this.markerKey(purchase.clientRefHash);
    let inventory = await this.requiredInventory(offer.offerId);
    const marker = inventory.purchaseMarkers[markerKey];
    if (marker?.state === 'RESERVED') {
      inventory = await this.call(() => this.repository.finalizeTestInventory({
        offerId: offer.offerId,
        phaseId: purchase.phaseId,
        purchaseMarkerKey: markerKey,
        clientClaimKey,
        outcome: finalStatus,
        now: this.now().toISOString()
      })) ?? await this.requiredInventory(offer.offerId);
    }
    await this.call(() => this.repository.transitionTestReservation({
      purchaseId: purchase.purchaseId,
      from: 'PAYMENT_PENDING',
      to: finalStatus,
      updatedAt: this.now().toISOString()
    }));
    await this.recordPurchaseEvent(
      offer,
      purchase,
      finalStatus === 'PAID' ? 'PURCHASE_CONFIRMED' : 'PURCHASE_RELEASED'
    );
    const reconciledInventory = finalStatus === 'PAID'
      ? await this.advancePhaseIfEligible(inventory)
      : inventory;
    await this.call(() => this.repository.markTestPurchaseInventoryFinalized({
      purchaseId: purchase.purchaseId,
      status: finalStatus,
      finalizedAt: this.now().toISOString()
    }));
    return reconciledInventory;
  }

  private async advancePhaseIfEligible(
    initial: StoredSubscriptionTestInventory
  ): Promise<StoredSubscriptionTestInventory> {
    let inventory = initial;
    const current = inventory.phases.find((phase) => phase.order === inventory.currentPhaseOrder);
    if (!current || current.available !== 0 || current.reserved !== 0 || current.sold !== current.totalQuantity) {
      return inventory;
    }
    const next = inventory.phases.find((phase) => phase.order === current.order + 1);
    if (!next || next.activation !== 'PREVIOUS_SOLD_OUT') return inventory;
    inventory = await this.call(() => this.repository.activateNextTestPhase({
      offerId: inventory.offerId,
      expectedRevision: inventory.revision,
      currentPhaseOrder: current.order,
      nextPhaseOrder: next.order,
      nextPhaseId: next.phaseId,
      nextTotalQuantity: next.totalQuantity,
      now: this.now().toISOString()
    })) ?? await this.requiredInventory(inventory.offerId);
    return inventory;
  }

  private async ensureTestInventory(
    offer: StoredSubscriptionTestOffer
  ): Promise<StoredSubscriptionTestInventory> {
    const existing = await this.call(() => this.repository.testInventoryByOfferId(offer.offerId));
    if (existing) return existing;
    const now = this.now().toISOString();
    const phases = offer.releaseProgramSnapshot.phases.map((phase, index) => ({
      phaseId: phase.releasePhaseId,
      order: phase.order,
      activation: phase.activation,
      totalQuantity: phase.totalQuantity,
      price: { ...phase.price },
      available: index === 0 ? phase.totalQuantity : 0,
      reserved: 0,
      sold: 0,
      refunded: 0
    }));
    const row: StoredSubscriptionTestInventory = {
      schemaVersion: 1,
      offerId: offer.offerId,
      currentPhaseOrder: phases[0]?.order ?? 1,
      phases,
      purchaseMarkers: {},
      clientClaimCounts: {},
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    try {
      await this.call(() => this.repository.insertTestInventory(row));
      return row;
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
      return this.requiredInventory(offer.offerId);
    }
  }

  private testActivationBlockers(
    policy: StoredSubscriptionPolicyVersion,
    program: StoredReleaseProgram
  ): SubscriptionImpactIssue[] {
    const blockers: SubscriptionImpactIssue[] = [];
    if (policy.status !== 'DRAFT') blockers.push(this.issue('POLICY_NOT_DRAFT', 'Policy must be DRAFT', 'TEST'));
    if (!policy.capabilities) blockers.push(this.issue('POLICY_CAPABILITIES_REQUIRED', 'Policy schema v2 is required', 'TEST'));
    if (program.phases.some((phase) => phase.mode !== 'BULK')) {
      blockers.push(this.issue('TEST_RUNTIME_BULK_ONLY', 'Тестовый runtime поддерживает только BULK-фазы', 'TEST'));
    }
    if (program.phases[0]?.activation !== 'MANUAL') {
      blockers.push(this.issue('TEST_FIRST_PHASE_MANUAL_REQUIRED', 'Первая тестовая фаза должна быть MANUAL', 'TEST'));
    }
    if (program.phases.slice(1).some((phase) => phase.activation !== 'PREVIOUS_SOLD_OUT')) {
      blockers.push(this.issue('TEST_LADDER_ACTIVATION_REQUIRED', 'Следующие фазы должны быть PREVIOUS_SOLD_OUT', 'TEST'));
    }
    if (program.phases.some((phase) => phase.price.amountMinor <= 0)) {
      blockers.push(this.issue('TEST_PRICE_REQUIRED', 'Цена каждой тестовой фазы должна быть больше нуля', 'TEST'));
    }
    return blockers;
  }

  private activationResponse(
    offer: StoredSubscriptionTestOffer,
    inventory: StoredSubscriptionTestInventory,
    accessToken: string | null,
    replayed: boolean,
    correlationId: string
  ): SubscriptionTestActivationResult {
    return {
      ...this.offerView(offer, inventory),
      accessToken,
      storefrontPath: accessToken
        ? `/api/ui/subscription-test#offerId=${encodeURIComponent(offer.offerId)}&token=${encodeURIComponent(accessToken)}`
        : null,
      usageScenarioUrl: accessToken
        ? `https://padlhub.ru/lk_dev?subscriptionTest=1#offerId=${encodeURIComponent(offer.offerId)}&token=${encodeURIComponent(accessToken)}`
        : null,
      tokenIssued: Boolean(accessToken),
      replayed,
      correlationId
    };
  }

  private offerView(
    offer: StoredSubscriptionTestOffer,
    inventory: StoredSubscriptionTestInventory
  ): SubscriptionTestOfferView {
    const snapshot = this.inventorySnapshot(inventory);
    return {
      offerId: offer.offerId,
      title: offer.title,
      stationId: offer.stationId,
      testOnly: true,
      providerMode: 'FAKE',
      policyVersion: offer.policyVersion,
      currentPhase: snapshot.currentPhase,
      phases: snapshot.phases,
      reservationTtlMinutes: offer.reservationTtlMinutes
    };
  }

  private inventorySnapshot(inventory: StoredSubscriptionTestInventory): SubscriptionTestInventorySnapshot {
    const phases = inventory.phases.map((phase) => ({
      phaseId: phase.phaseId,
      order: phase.order,
      activation: phase.activation,
      totalQuantity: phase.totalQuantity,
      price: { ...phase.price },
      available: phase.available,
      reserved: phase.reserved,
      sold: phase.sold,
      refunded: phase.refunded
    }));
    return {
      offerId: inventory.offerId,
      currentPhaseOrder: inventory.currentPhaseOrder,
      currentPhase: phases.find((phase) => phase.order === inventory.currentPhaseOrder) ?? null,
      phases,
      revision: inventory.revision,
      updatedAt: inventory.updatedAt
    };
  }

  private reservationResponse(purchase: StoredSubscriptionTestPurchase): SubscriptionTestReservationResult {
    if (purchase.status !== 'PAYMENT_PENDING') {
      throw this.conflict('TEST_RESERVATION_NOT_PENDING', `Резерв находится в состоянии ${purchase.status}`);
    }
    return {
      purchaseId: purchase.purchaseId,
      status: 'PAYMENT_PENDING',
      priceSnapshot: { ...purchase.priceSnapshot },
      expiresAt: purchase.expiresAt
    };
  }

  private publicPurchase(
    purchase: StoredSubscriptionTestPurchase,
    inventory: StoredSubscriptionTestInventory
  ): SubscriptionTestPurchaseView {
    if (purchase.status === 'CREATING') throw new ServiceUnavailableException('Test purchase is still being created');
    return {
      purchaseId: purchase.purchaseId,
      offerId: purchase.offerId,
      status: purchase.status,
      priceSnapshot: { ...purchase.priceSnapshot },
      expiresAt: purchase.expiresAt,
      testOnly: true,
      providerMode: 'FAKE',
      inventory: this.inventorySnapshot(inventory)
    };
  }

  private publicPolicy(row: StoredSubscriptionPolicyVersion): SubscriptionPolicyVersion {
    const { schemaVersion: _schemaVersion, idempotency: _idempotency, ...policy } = row;
    return policy as SubscriptionPolicyVersion;
  }

  private publicProgram(row: StoredReleaseProgram): ReleaseProgram {
    return {
      releaseProgramId: row.releaseProgramId,
      subscriptionTypeId: row.subscriptionTypeId,
      stationId: row.stationId,
      timezone: row.timezone,
      state: row.state,
      revision: row.revision,
      phases: row.phases.map((phase) => ({
        ...phase,
        counters: { available: 0, reserved: 0, sold: 0, refunded: 0 },
        nextReleaseAt: null
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy
    };
  }

  private async offerByCredentialsInternal(
    offerId: string,
    accessToken: string
  ): Promise<StoredSubscriptionTestOffer> {
    const offer = await this.offerById(offerId);
    const tokenHash = this.hashSecret('access-token', this.validateAccessToken(accessToken));
    if (
      offer.accessTokenHash !== tokenHash
      || offer.state !== 'TEST_ACTIVE'
      || !offer.testOnly
      || offer.providerMode !== 'FAKE'
    ) {
      throw new NotFoundException({ code: 'TEST_OFFER_NOT_FOUND', message: 'Test offer not found' });
    }
    return offer;
  }

  private async offerById(offerId: string): Promise<StoredSubscriptionTestOffer> {
    const normalized = this.requiredId(offerId, 'Test offer not found');
    const offer = await this.call(() => this.repository.testOfferById(normalized));
    if (!offer) throw new NotFoundException('Test offer not found');
    return offer;
  }

  private async purchaseWithToken(
    purchaseId: string,
    accessToken: string
  ): Promise<StoredSubscriptionTestPurchase> {
    const purchase = await this.requiredPurchase(this.requiredId(purchaseId, 'Test purchase not found'));
    const tokenHash = this.hashSecret('access-token', this.validateAccessToken(accessToken));
    if (purchase.accessTokenHash !== tokenHash) {
      throw new NotFoundException({ code: 'TEST_PURCHASE_NOT_FOUND', message: 'Test purchase not found' });
    }
    return purchase;
  }

  private async requiredPurchase(purchaseId: string): Promise<StoredSubscriptionTestPurchase> {
    const purchase = await this.call(() => this.repository.testPurchaseById(purchaseId));
    if (!purchase) throw new NotFoundException('Test purchase not found');
    return purchase;
  }

  private async requiredInventory(offerId: string): Promise<StoredSubscriptionTestInventory> {
    const inventory = await this.call(() => this.repository.testInventoryByOfferId(offerId));
    if (!inventory) throw new ServiceUnavailableException('Test offer inventory is not initialized');
    return inventory;
  }

  private async recordPurchaseEvent(
    offer: StoredSubscriptionTestOffer,
    purchase: StoredSubscriptionTestPurchase,
    eventType: 'PURCHASE_RESERVED' | 'PURCHASE_CONFIRMED' | 'PURCHASE_RELEASED'
  ): Promise<void> {
    await this.recordEvent({
      schemaVersion: 1,
      eventId: `test_event:${eventType}:${this.markerKey(purchase.purchaseId)}`,
      eventType,
      offerId: offer.offerId,
      purchaseId: purchase.purchaseId,
      stationId: offer.stationId,
      correlationId: purchase.idempotency.correlationId,
      actorId: null,
      occurredAt: this.now().toISOString(),
      metadata: {
        status: purchase.status,
        phaseOrder: purchase.phaseOrder,
        amountMinor: purchase.priceSnapshot.amountMinor,
        currency: purchase.priceSnapshot.currency,
        providerMode: 'FAKE',
        testOnly: true
      }
    });
  }

  private async recordOfferActivationEvent(offer: StoredSubscriptionTestOffer): Promise<void> {
    await this.recordEvent({
      schemaVersion: 1,
      eventId: `test_event:offer:${this.hashSecret('event', offer.offerId)}`,
      eventType: 'TEST_OFFER_ACTIVATED',
      offerId: offer.offerId,
      purchaseId: null,
      stationId: offer.stationId,
      correlationId: offer.idempotency.correlationId,
      actorId: offer.createdBy,
      occurredAt: offer.createdAt,
      metadata: { providerMode: 'FAKE', testOnly: true, policyVersion: offer.policyVersion }
    });
  }

  private async recordEvent(event: StoredSubscriptionTestEvent): Promise<void> {
    await this.call(() => this.repository.insertTestEvent(event));
  }

  private issue(code: string, message: string, target: 'REAL' | 'TEST'): SubscriptionImpactIssue {
    return { code, message, target };
  }

  private validateCommandHeaders(headers: CommandHeaders): { idempotencyKey: string; correlationId: string } {
    const idempotencyKey = String(headers.idempotencyKey ?? '');
    const correlationId = String(headers.correlationId ?? '');
    if (idempotencyKey !== idempotencyKey.trim() || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must contain 16..128 characters without surrounding spaces'
      });
    }
    if (correlationId !== correlationId.trim() || correlationId.length < 8 || correlationId.length > 128) {
      throw new BadRequestException({
        code: 'INVALID_CORRELATION_ID',
        message: 'X-Correlation-Id must contain 8..128 characters without surrounding spaces'
      });
    }
    return { idempotencyKey, correlationId };
  }

  private assertIdempotency(actualHash: string, expectedHash: string): void {
    if (actualHash !== expectedHash) {
      throw this.conflict('IDEMPOTENCY_CONFLICT', 'Idempotency-Key уже использован с другим запросом');
    }
  }

  private requireAdminFeatureEnabled(): void {
    if (!this.envFlag('SUBSCRIPTIONS_ADMIN_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ADMIN_DISABLED',
        message: 'Subscription administration is disabled'
      });
    }
  }

  private requireTestRuntimeEnabled(): void {
    if (!this.envFlag('SUBSCRIPTIONS_TEST_RUNTIME_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_TEST_RUNTIME_DISABLED',
        message: 'Subscription test runtime is disabled'
      });
    }
    this.requireHashPepper();
  }

  private envFlag(name: string): boolean {
    const value = String(process.env[name] ?? '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private requireActor(user?: RequestUser): string {
    const actorId = String(user?.id ?? '').trim();
    if (!actorId) throw new UnauthorizedException('User context is missing');
    return actorId;
  }

  private requireStationScope(user: RequestUser | undefined, permission: string, stationId: string): void {
    const scope = getStationScopeForPermission(user, permission);
    if (scope !== null && !scope.includes(stationId)) {
      throw new ForbiddenException('Station is outside the subscription scope');
    }
  }

  private validateAccessToken(value: string): string {
    const token = String(value ?? '');
    if (token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new NotFoundException({ code: 'TEST_OFFER_NOT_FOUND', message: 'Test offer not found' });
    }
    return token;
  }

  private requiredId(value: string, message: string): string {
    const id = String(value ?? '').trim();
    if (!id || id.length > 200) throw new NotFoundException(message);
    return id;
  }

  private markerKey(value: string): string {
    return this.hashSecret('marker', value);
  }

  private hashClientRef(value: string): string {
    return createHmac('sha256', this.requireHashPepper())
      .update(`client-ref\u0000${value}`, 'utf8')
      .digest('hex');
  }

  private requireHashPepper(): string {
    const pepper = String(process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER ?? '');
    if (pepper.length < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_TEST_HASH_PEPPER_REQUIRED',
        message: 'Subscription test hash pepper is not configured'
      });
    }
    return pepper;
  }

  private hashSecret(namespace: string, value: string): string {
    return createHash('sha256').update(`${namespace}\u0000${value}`, 'utf8').digest('hex');
  }

  private requestHash(operation: string, payload: unknown): string {
    return createHash('sha256')
      .update(`${operation}\n${this.stableStringify(payload)}`, 'utf8')
      .digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private domainError(code: string, message: string, details?: Record<string, unknown>): UnprocessableEntityException {
    return new UnprocessableEntityException({ code, message, ...(details ? { details } : {}) });
  }

  private now(): Date {
    return new Date();
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await this.repository.connect();
      return await operation();
    } catch (error) {
      if (
        error instanceof BadRequestException
        || error instanceof ConflictException
        || error instanceof ForbiddenException
        || error instanceof NotFoundException
        || error instanceof ServiceUnavailableException
        || error instanceof UnauthorizedException
        || error instanceof UnprocessableEntityException
      ) throw error;
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_STORAGE_UNAVAILABLE',
        message: 'Subscription test runtime storage is unavailable'
      });
    }
  }
}

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional
} from '@nestjs/common';
import { RequestUser } from '../common/rbac/request-user.interface';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityFeedItem } from '../communities/communities.types';
import { GamesService } from '../games/games.service';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import { VivaTournamentsService } from '../integrations/viva/viva-tournaments.service';
import {
  AmericanoRatingSimulationResult,
  AmericanoSimulateRatingInput
} from './americano-rating.types';
import { AmericanoRatingSimulationService } from './americano-rating-simulation.service';
import {
  AmericanoGeneratorConfig,
  AmericanoGenerateScheduleInput,
  AmericanoPenaltyWeights,
  AmericanoScheduleResult
} from './americano-schedule.types';
import { AmericanoScheduleService } from './americano-schedule.service';
import {
  CreateCustomTournamentMutation,
  TournamentsPersistenceService,
  UpdateCustomTournamentMutation
} from './tournaments-persistence.service';
import {
  CustomTournament,
  Tournament,
  TournamentAcceptedSubscriptionRule,
  TournamentActor,
  TournamentAccessCheckResponse,
  TournamentBookingConfig,
  TournamentClientSubscription,
  TournamentGender,
  TournamentJoinFlowResponse,
  TournamentJoinPaymentState,
  TournamentMechanics,
  TournamentMechanicsAccessResponse,
  TournamentParticipant,
  TournamentPurchaseOption,
  TournamentPublicClientProfile,
  TournamentPublicDirectoryResponse,
  TournamentResultsView,
  TournamentPublicView,
  TournamentRegistrationResponse,
  TournamentStatus
} from './tournaments.types';

interface RegistrationInput {
  name: string;
  phone: string;
  levelLabel?: string;
  gender?: TournamentGender;
  notes?: string;
  selectedSubscriptionId?: string;
  selectedPurchaseOptionId?: string;
  purchaseConfirmed?: boolean;
  subscriptions?: TournamentClientSubscription[];
  vivaAuthorizationHeader?: string;
}

interface JoinPurchaseTransactionInput extends RegistrationInput {
  successUrl: string;
  failUrl: string;
}

interface VivaJoinTransactionResponse {
  transactionId?: string;
  checkoutUrl?: string;
}

interface PendingJoinPayment {
  transactionId: string;
  phone: string;
  name?: string;
  avatarUrl?: string | null;
  levelLabel?: string;
  notes?: string;
  selectedPurchaseOptionId?: string;
  createdAt: string;
}

interface TournamentLevelDescriptor {
  token: string;
  base: string;
  step: number | null;
  label: string;
  rank: number;
  minScore: number;
  maxScore: number;
}

const PUBLIC_TOURNAMENTS_LIMIT_DEFAULT = 48;
const PUBLIC_TOURNAMENTS_LIMIT_MAX = 96;
const PUBLIC_TOURNAMENTS_FORWARD_DAYS = 30;
const TOURNAMENT_BASE_LEVELS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'] as const;
const TOURNAMENT_LEVEL_DIVISION_COUNT = 4;
const TOURNAMENT_LEVEL_BANDS = [
  { base: 'D', min: 1, max: 2, display: '1.0-2.0' },
  { base: 'D+', min: 2, max: 3, display: '2.0-3.0' },
  { base: 'C', min: 3, max: 3.5, display: '3.0-3.5' },
  { base: 'C+', min: 3.5, max: 4, display: '3.5-4.0' },
  { base: 'B', min: 4, max: 4.7, display: '4.0-4.7' },
  { base: 'B+', min: 4.7, max: 5.5, display: '4.7-5.5' },
  { base: 'A', min: 5.5, max: 6.3, display: '5.5+' }
] as const;
const TOURNAMENT_LEVEL_LEGACY_ALIASES = [
  { offset: 0.25, aliases: ['BEGINNER', 'НОВИЧ', 'НАЧИН'] },
  { offset: 0.5, aliases: ['MIDDLE', 'INTERMEDIATE', 'MEDIUM', 'СРЕДН'] },
  { offset: 0.75, aliases: ['ADVANCED', 'PRO', 'ПРОДВ'] }
] as const;
const DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS: AmericanoPenaltyWeights = {
  partnerRepeat: 1000,
  partnerImmediateRepeat: 1200,
  opponentRepeat: 150,
  opponentRecentRepeat: 250,
  balance: 100,
  unevenBye: 300,
  consecutiveBye: 700,
  pairInternalImbalance: 30
};

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);
  private readonly vivaEndUserApiBaseUrl =
    this.normalizeBaseUrl(process.env.VIVA_END_USER_API_BASE_URL)
    || this.normalizeBaseUrl(process.env.VIVA_ADMIN_API_BASE_URL)
    || 'https://api.vivacrm.ru';
  private readonly vivaEndUserWidgetId =
    this.pickString(process.env.VIVA_END_USER_WIDGET_ID) ?? 'iSkq6G';
  private readonly vivaEndUserRequestTimeoutMs =
    this.readPositiveNumberEnv('VIVA_END_USER_TIMEOUT_MS', 5000);

  constructor(
    private readonly lkPadelHubClient: LkPadelHubClientService,
    private readonly vivaTournamentsService: VivaTournamentsService,
    private readonly gamesService: GamesService,
    private readonly tournamentsPersistence: TournamentsPersistenceService,
    private readonly americanoScheduleService: AmericanoScheduleService,
    private readonly americanoRatingSimulationService: AmericanoRatingSimulationService,
    @Optional() private readonly vivaAdminService?: VivaAdminService,
    @Optional() private readonly communitiesService?: CommunitiesService
  ) {}

  async generateSchedule(
    input: AmericanoGenerateScheduleInput
  ): Promise<AmericanoScheduleResult> {
    return this.americanoScheduleService.generateSchedule(input);
  }

  async simulateRating(
    input: AmericanoSimulateRatingInput
  ): Promise<AmericanoRatingSimulationResult> {
    return this.americanoRatingSimulationService.simulateRating(input);
  }

  async findAll(): Promise<Tournament[]> {
    const sourceTournaments = await this.listSourceTournaments();
    const customTournaments = await this.listCustomTournamentsSafe();
    const customBySourceId = new Map<string, CustomTournament>();
    customTournaments.forEach((tournament) => {
      if (tournament.sourceTournamentId) {
        customBySourceId.set(tournament.sourceTournamentId, tournament);
      }
    });

    const sourceIds = new Set(sourceTournaments.map((item) => item.id));
    const mergedSource = sourceTournaments.map((tournament) =>
      this.enrichSourceTournament(tournament, customBySourceId.get(tournament.id))
    );
    const standaloneCustom = customTournaments
      .filter(
        (tournament) =>
          !tournament.sourceTournamentId || !sourceIds.has(tournament.sourceTournamentId)
      )
      .map((tournament) => this.toTournamentListItem(tournament));

    return [...mergedSource, ...standaloneCustom].sort((left, right) => {
      const leftStartsAt = Date.parse(left.startsAt ?? '');
      const rightStartsAt = Date.parse(right.startsAt ?? '');
      const leftRank = Number.isFinite(leftStartsAt) ? leftStartsAt : Number.MAX_SAFE_INTEGER;
      const rightRank = Number.isFinite(rightStartsAt)
        ? rightStartsAt
        : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(left.name ?? '').localeCompare(String(right.name ?? ''), 'ru');
    });
  }

  async findById(id: string): Promise<Tournament> {
    const customTournament = await this.findCustomTournamentByIdSafe(id);
    if (customTournament) {
      return this.toTournamentListItem(customTournament);
    }

    const tournament = await this.findSourceTournamentById(id);
    if (!tournament) {
      throw new NotFoundException(`Tournament with id ${id} not found`);
    }

    const linkedCustom = await this.findCustomTournamentBySourceIdSafe(tournament.id);
    return this.enrichSourceTournament(tournament, linkedCustom ?? undefined);
  }

  async findCustomById(id: string): Promise<CustomTournament> {
    this.ensurePersistenceEnabled();
    const tournament = await this.tournamentsPersistence.findCustomTournamentById(id);
    if (!tournament) {
      throw new NotFoundException(`Custom tournament with id ${id} not found`);
    }
    return this.enrichTournamentVivaProfiles(await this.hydrateCustomTournament(tournament));
  }

  async getResults(id: string, user?: RequestUser): Promise<TournamentResultsView> {
    const requestedId = this.pickString(id);
    if (!requestedId) {
      throw new BadRequestException('Tournament id is required');
    }

    const customTournament = await this.findCustomTournamentByIdSafe(requestedId);
    const sourceTournamentSnapshot = customTournament
      ? this.getSourceTournamentSnapshot(customTournament)
      : {};
    const sourceTournamentId =
      customTournament?.sourceTournamentId ||
      this.pickString(sourceTournamentSnapshot.id) ||
      requestedId;
    const results = await this.gamesService.getTournamentResults(sourceTournamentId, user);

    return {
      ...results,
      tournamentId: requestedId,
      resolvedTournamentId: sourceTournamentId
    };
  }

  async createCustomFromSource(
    sourceTournamentId: string,
    mutation: Partial<CreateCustomTournamentMutation>
  ): Promise<CustomTournament> {
    this.ensurePersistenceEnabled();
    const sourceTournament = await this.findSourceTournamentById(sourceTournamentId);
    if (!sourceTournament) {
      throw new NotFoundException(`Source tournament with id ${sourceTournamentId} not found`);
    }

    const existing = await this.tournamentsPersistence.findCustomTournamentBySourceTournamentId(
      sourceTournamentId
    );
    const normalizedMutation = this.buildCreateMutation(sourceTournament, mutation);

    if (existing) {
      return this.updateExistingFromCreate(existing.id, normalizedMutation);
    }

    const created = await this.tournamentsPersistence.createCustomTournament(normalizedMutation);
    const hydrated = await this.hydrateCustomTournament(created);
    await this.publishTournamentToSelectedCommunities(hydrated, normalizedMutation.actor);
    return hydrated;
  }

  async updateCustom(
    id: string,
    mutation: UpdateCustomTournamentMutation
  ): Promise<CustomTournament> {
    this.ensurePersistenceEnabled();
    const updated = await this.tournamentsPersistence.updateCustomTournament(id, mutation);
    if (!updated) {
      throw new NotFoundException(`Custom tournament with id ${id} not found`);
    }
    const hydrated = await this.hydrateCustomTournament(updated);
    await this.publishTournamentToSelectedCommunities(hydrated, mutation.actor);
    return hydrated;
  }

  async getPublicBySlug(slug: string): Promise<TournamentPublicView> {
    this.ensurePersistenceEnabled();
    const tournament = await this.enrichTournamentVivaProfiles(await this.requireCustomBySlug(slug));
    return this.toPublicView(tournament);
  }

  async listPublicDirectory(options?: {
    limit?: number;
    stationIds?: string[];
    includePast?: boolean;
    forwardDays?: number;
    date?: string;
  }): Promise<TournamentPublicDirectoryResponse> {
    this.ensurePersistenceEnabled();
    const limit = this.normalizePublicLimit(options?.limit);
    const stationIds = this.normalizeFilterValues(options?.stationIds);
    const includePast = options?.includePast === true;
    const forwardDays = this.normalizePublicForwardDays(options?.forwardDays);
    const date = this.normalizePublicDate(options?.date);
    const tournaments = await this.listCustomTournamentsSafe();

    const candidates = tournaments
      .filter((tournament) =>
        this.matchesPublicTournamentFilters(tournament, {
          stationIds,
          includePast,
          forwardDays,
          date
        })
      )
      .sort((left, right) => this.comparePublicTournaments(left, right))
      .slice(0, limit);
    const sourceTournamentsById = await this.buildSourceTournamentMapForCustomTournaments(candidates);
    const hydrated = await Promise.all(
      candidates.map((tournament) => this.hydrateCustomTournamentFromSourceMap(
        tournament,
        sourceTournamentsById
      ))
    );
    const enriched = await Promise.all(
      hydrated.map((tournament) => this.enrichTournamentVivaProfiles(tournament))
    );
    const items = enriched
      .map((tournament) => this.toPublicView(tournament));

    return {
      generatedAt: new Date().toISOString(),
      count: items.length,
      items
    };
  }

  async getPublicJoinFlow(
    slug: string,
    client: TournamentPublicClientProfile,
    options?: {
      requireAuth?: boolean;
    }
  ): Promise<TournamentJoinFlowResponse> {
    this.ensurePersistenceEnabled();
    const tournament = await this.enrichTournamentVivaProfiles(await this.requireCustomBySlug(slug));
    const publicTournament = this.toPublicView(tournament);
    const normalizedPhone = this.normalizePhone(client.phone) ?? undefined;
    const normalizedLevel = this.normalizeLevel(client.levelLabel) ?? undefined;
    const access = this.evaluateAccess(tournament, normalizedLevel);
    const vivaSubscriptions =
      normalizedPhone && (client.authorized || client.phoneVerified)
        ? await this.fetchVivaBookingSubscriptions(tournament, normalizedPhone)
        : [];
    const normalizedClient: TournamentPublicClientProfile = {
      ...client,
      phone: normalizedPhone,
      phoneVerified: client.phoneVerified === true,
      levelLabel: normalizedLevel,
      onboardingCompleted: Boolean(normalizedLevel),
      subscriptions: this.mergeClientSubscriptions(
        this.normalizeClientSubscriptions(client.subscriptions),
        vivaSubscriptions
      )
    };
    const vivaPurchaseOptions = await this.fetchVivaJoinPurchaseOptions(tournament);
    const payment = this.resolveJoinPayment(
      tournament,
      normalizedClient,
      normalizedLevel,
      vivaPurchaseOptions
    );
    const requireAuth = options?.requireAuth === true;
    const missingFields: Array<'phone' | 'levelLabel'> = [];

    if (requireAuth && !normalizedClient.authorized && !normalizedClient.phoneVerified) {
      return {
        ok: false,
        code: normalizedPhone ? 'PHONE_VERIFICATION_REQUIRED' : 'PROFILE_REQUIRED',
        message:
          normalizedPhone
            ? 'Подтвердите номер телефона кодом, чтобы продолжить запись.'
            : 'Чтобы присоединиться к турниру, укажите номер телефона.',
        tournament: publicTournament,
        client: normalizedClient,
        access,
        missingFields: normalizedPhone ? [] : ['phone'],
        waitlistAllowed: false,
        payment,
        authRequired: false
      };
    }

    if (!normalizedPhone) {
      missingFields.push('phone');
    }
    if (tournament.accessLevels.length > 0 && !normalizedLevel) {
      missingFields.push('levelLabel');
    }

    if (normalizedPhone) {
      const existingParticipant = this.findParticipantByPhone(
        tournament.participants,
        normalizedPhone
      );
      if (existingParticipant) {
        return {
          ok: true,
          code: 'ALREADY_REGISTERED',
          message: 'Вы уже записаны в этот турнир.',
          tournament: publicTournament,
          client: normalizedClient,
          access,
          missingFields: [],
          waitlistAllowed: false,
          payment
        };
      }

      const existingWaitlistParticipant = this.findParticipantByPhone(
        tournament.waitlist,
        normalizedPhone
      );
      if (existingWaitlistParticipant) {
        return {
          ok: true,
          code: 'ALREADY_WAITLISTED',
          message: 'Вы уже находитесь в листе ожидания этого турнира.',
          tournament: publicTournament,
          client: normalizedClient,
          access,
          missingFields: [],
          waitlistAllowed: false,
          payment
        };
      }
    }

    if (missingFields.includes('phone')) {
      return {
        ok: false,
        code: 'PROFILE_REQUIRED',
        message: 'Чтобы присоединиться к турниру, укажите номер телефона.',
        tournament: publicTournament,
        client: normalizedClient,
        access,
        missingFields,
        waitlistAllowed: false,
        payment
      };
    }

    if (missingFields.includes('levelLabel')) {
      return {
        ok: false,
        code: 'ONBOARDING_REQUIRED',
        message:
          'Для участия в этом турнире нужно определить игровой уровень. Выберите его перед записью.',
        tournament: publicTournament,
        client: normalizedClient,
        access,
        missingFields,
        waitlistAllowed: false,
        payment
      };
    }

    if (!access.ok && access.code === 'LEVEL_NOT_ALLOWED') {
      const levelRangeLabel = this.describeTournamentLevelRange(tournament.accessLevels);
      return {
        ok: false,
        code: 'LEVEL_NOT_ALLOWED',
        message: `Турнир для уровня ${levelRangeLabel}. Вы не можете записаться в турнир, но можете записаться в лист ожидания и отправить организатору заявку на рассмотрение вашего участия.`,
        tournament: publicTournament,
        client: normalizedClient,
        access,
        missingFields: [],
        waitlistAllowed: true,
        payment
      };
    }

    if (payment.required && payment.code === 'PURCHASE_REQUIRED') {
      return {
        ok: false,
        code: 'PURCHASE_REQUIRED',
        message:
          'Подходящий абонемент не найден. Перейдите к покупке, чтобы завершить запись в турнир.',
        tournament: publicTournament,
        client: normalizedClient,
        access,
        missingFields: [],
        waitlistAllowed: false,
        payment
      };
    }

    if (payment.required && payment.code === 'SUBSCRIPTION_AVAILABLE') {
      return {
        ok: true,
        code: 'SUBSCRIPTION_AVAILABLE',
        message:
          'Найден подходящий абонемент. Его можно списать и сразу подтвердить участие в турнире.',
        tournament: publicTournament,
        client: normalizedClient,
        access,
        missingFields: [],
        waitlistAllowed: false,
        payment
      };
    }

    return {
      ok: true,
      code: 'READY_TO_JOIN',
      message: 'Все данные заполнены. Можно подтвердить участие в турнире.',
      tournament: publicTournament,
      client: normalizedClient,
      access,
      missingFields: [],
      waitlistAllowed: false,
      payment
    };
  }

  async checkPublicAccess(
    slug: string,
    levelLabel?: string
  ): Promise<TournamentAccessCheckResponse> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    return this.evaluateAccess(tournament, levelLabel);
  }

  async registerPublicParticipant(
    slug: string,
    input: RegistrationInput
  ): Promise<TournamentRegistrationResponse> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    const normalizedPhone = this.normalizePhone(input.phone);
    const normalizedLevel = this.normalizeLevel(input.levelLabel) ?? undefined;
    if (!normalizedPhone) {
      return {
        ok: false,
        code: 'PHONE_REQUIRED',
        message: 'Для записи в турнир нужен номер телефона.',
        tournamentSlug: tournament.slug
      };
    }

    const access = this.evaluateAccess(tournament, input.levelLabel);
    if (!access.ok) {
      return {
        ok: false,
        code: access.code,
        message: access.message,
        tournamentSlug: tournament.slug
      };
    }

    const payment = this.resolveJoinPayment(
      tournament,
      {
        id: normalizedPhone,
        authorized: true,
        authSource: 'headers',
        name: input.name,
        phone: normalizedPhone,
        levelLabel: normalizedLevel,
        onboardingCompleted: Boolean(normalizedLevel),
        subscriptions: this.readClientSubscriptionsFromInput(input)
      },
      normalizedLevel,
      await this.fetchVivaJoinPurchaseOptions(tournament)
    );

    if (payment.required && payment.code === 'PURCHASE_REQUIRED' && input.purchaseConfirmed !== true) {
      return {
        ok: false,
        code: 'PURCHASE_REQUIRED',
        message:
          'Подходящий абонемент не найден. Сначала завершите покупку, затем повторите запись.',
        tournamentSlug: tournament.slug,
        payment
      };
    }

    if (payment.required && payment.code === 'SUBSCRIPTION_AVAILABLE') {
      const booking = this.resolveBookingConfig(tournament);
      const subscription =
        this.resolveSelectedClientSubscription(
          payment.availableSubscriptions,
          input.selectedSubscriptionId
        ) ?? payment.selectedSubscription;
      if (subscription && this.canCreateVivaTransaction(booking)) {
        const transaction = await this.createVivaJoinTransaction({
          booking,
          purchaseOption: {
            id: subscription.id,
            label: subscription.label,
            priceLabel: '0',
            productType: subscription.productType ?? 'SUBSCRIPTION'
          },
          tournament,
          phone: normalizedPhone,
          successUrl: this.buildPublicJoinUrl(tournament.publicUrl),
          failUrl: this.buildPublicJoinUrl(tournament.publicUrl)
        });
        if (transaction.checkoutUrl) {
          return {
            ok: true,
            code: 'PURCHASE_STARTED',
            message: 'Списание создано. Перейдите к подтверждению, чтобы завершить запись.',
            tournamentId: tournament.id,
            tournamentSlug: tournament.slug,
            payment: {
              ...payment,
              selectedSubscription: subscription,
              checkoutUrl: transaction.checkoutUrl,
              transactionId: transaction.transactionId
            }
          };
        }
      }
    }

    const participant = await this.enrichTournamentParticipantWithViva({
      name: String(input.name || '').trim() || normalizedPhone,
      phone: normalizedPhone,
      levelLabel: normalizedLevel,
      gender: input.gender ?? 'MIXED',
      paymentStatus: payment.required ? 'PAID' : 'UNPAID',
      status: 'REGISTERED' as const,
      registeredAt: new Date().toISOString(),
      paidAt: payment.required ? new Date().toISOString() : undefined,
      notes: this.composeRegistrationNotes(
        this.pickString(input.notes) ?? undefined,
        payment,
        input.selectedPurchaseOptionId
      )
    });

    const existingParticipant = tournament.participants.find(
      (item) => this.normalizePhone(item.phone) === normalizedPhone
    );
    if (existingParticipant) {
      return {
        ok: true,
        code: 'ALREADY_REGISTERED',
        message: 'Игрок уже записан в турнир.',
        tournamentId: tournament.id,
        tournamentSlug: tournament.slug,
        participant: existingParticipant,
        payment
      };
    }

    const existingWaitlistParticipant = tournament.waitlist.find(
      (item) => this.normalizePhone(item.phone) === normalizedPhone
    );
    if (existingWaitlistParticipant) {
      return {
        ok: true,
        code: 'ALREADY_WAITLISTED',
        message: 'Игрок уже находится в листе ожидания.',
        tournamentId: tournament.id,
        tournamentSlug: tournament.slug,
        participant: existingWaitlistParticipant,
        payment
      };
    }

    const maxPlayers = Math.max(2, Number(tournament.maxPlayers || 0) || 8);
    if (tournament.participants.length >= maxPlayers) {
      const nextWaitlist: TournamentParticipant[] = [
        ...tournament.waitlist,
        {
          ...participant,
          status: 'WAITLIST' as const,
          waitlistReason: 'FULL'
        }
      ];
      await this.updateCustom(tournament.id, {
        waitlist: nextWaitlist
      });
      return {
        ok: true,
        code: 'WAITLISTED',
        message: 'Свободных мест нет. Игрок добавлен в лист ожидания.',
        tournamentId: tournament.id,
        tournamentSlug: tournament.slug,
        participant: nextWaitlist[nextWaitlist.length - 1],
        payment
      };
    }

    const vivaBookingCreated = await this.createSourceTournamentBooking(tournament, {
      name: participant.name,
      phone: normalizedPhone,
      notes: participant.notes,
      vivaAuthorizationHeader: input.vivaAuthorizationHeader
    });
    if (!vivaBookingCreated.ok) {
      return {
        ok: false,
        code: 'BOOKING_FAILED',
        message: vivaBookingCreated.message,
        tournamentId: tournament.id,
        tournamentSlug: tournament.slug,
        payment
      };
    }

    const nextParticipants = [...tournament.participants, participant];
    await this.updateCustom(tournament.id, {
      participants: nextParticipants
    });
    return {
      ok: true,
      code: 'REGISTERED',
      message: 'Игрок успешно записан в турнир.',
      tournamentId: tournament.id,
      tournamentSlug: tournament.slug,
      participant,
      payment
    };
  }

  async createPublicJoinPurchaseTransaction(
    slug: string,
    input: JoinPurchaseTransactionInput
  ): Promise<TournamentRegistrationResponse> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    const normalizedPhone = this.normalizePhone(input.phone);
    const normalizedLevel = this.normalizeLevel(input.levelLabel) ?? undefined;
    if (!normalizedPhone) {
      return {
        ok: false,
        code: 'PHONE_REQUIRED',
        message: 'Для покупки участия нужен номер телефона.',
        tournamentSlug: tournament.slug
      };
    }

    const access = this.evaluateAccess(tournament, input.levelLabel);
    if (!access.ok) {
      return {
        ok: false,
        code: access.code,
        message: access.message,
        tournamentSlug: tournament.slug
      };
    }

    const payment = this.resolveJoinPayment(
      tournament,
      {
        id: normalizedPhone,
        authorized: true,
        authSource: 'headers',
        name: input.name,
        phone: normalizedPhone,
        levelLabel: normalizedLevel,
        onboardingCompleted: Boolean(normalizedLevel),
        subscriptions: this.readClientSubscriptionsFromInput(input)
      },
      normalizedLevel,
      await this.fetchVivaJoinPurchaseOptions(tournament)
    );

    if (!payment.required || payment.code !== 'PURCHASE_REQUIRED') {
      return this.registerPublicParticipant(slug, input);
    }

    const booking = this.resolveBookingConfig(tournament);
    const purchaseOption = this.resolveSelectedPurchaseOption(
      payment.purchaseOptions,
      input.selectedPurchaseOptionId
    );
    if (!purchaseOption) {
      return {
        ok: false,
        code: 'PURCHASE_REQUIRED',
        message: 'Для покупки участия нужен тариф.',
        tournamentSlug: tournament.slug,
        payment
      };
    }

    const transaction = await this.createVivaJoinTransaction({
      booking,
      purchaseOption,
      tournament,
      phone: normalizedPhone,
      successUrl: input.successUrl,
      failUrl: input.failUrl,
      authorizationHeader: input.vivaAuthorizationHeader
    });

    if (transaction.transactionId) {
      await this.savePendingJoinPayment(tournament, {
        transactionId: transaction.transactionId,
        phone: normalizedPhone,
        name: this.pickString(input.name) ?? undefined,
        levelLabel: normalizedLevel,
        notes: this.pickString(input.notes) ?? undefined,
        selectedPurchaseOptionId: purchaseOption.id,
        createdAt: new Date().toISOString()
      });
    }

    if (!transaction.checkoutUrl) {
      return {
        ok: false,
        code: 'PURCHASE_REQUIRED',
        message: 'Viva создала транзакцию без ссылки на оплату. Попробуйте повторить позже.',
        tournamentSlug: tournament.slug,
        payment: {
          ...payment,
          transactionId: transaction.transactionId
        }
      };
    }

    return {
      ok: true,
      code: 'PURCHASE_STARTED',
      message: 'Покупка участия создана. Перейдите к оплате, чтобы завершить запись.',
      tournamentId: tournament.id,
      tournamentSlug: tournament.slug,
      payment: {
        ...payment,
        checkoutUrl: transaction.checkoutUrl,
        transactionId: transaction.transactionId
      }
    };
  }

  async rememberPublicJoinPurchaseTransaction(
    slug: string,
    input: RegistrationInput & {
      transactionId?: string;
      checkoutUrl?: string;
    }
  ): Promise<TournamentRegistrationResponse> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    const normalizedPhone = this.normalizePhone(input.phone);
    const transactionId = this.pickString(input.transactionId);
    if (!normalizedPhone) {
      return {
        ok: false,
        code: 'PHONE_REQUIRED',
        message: 'Для покупки участия нужен номер телефона.',
        tournamentSlug: tournament.slug
      };
    }
    if (!transactionId) {
      return {
        ok: false,
        code: 'PURCHASE_REQUIRED',
        message: 'Viva создала транзакцию без номера. Попробуйте повторить позже.',
        tournamentSlug: tournament.slug
      };
    }

    const access = this.evaluateAccess(tournament, input.levelLabel);
    if (!access.ok) {
      return {
        ok: false,
        code: access.code,
        message: access.message,
        tournamentSlug: tournament.slug
      };
    }

    const payment = this.resolveJoinPayment(
      tournament,
      {
        id: normalizedPhone,
        authorized: true,
        authSource: 'headers',
        name: input.name,
        phone: normalizedPhone,
        levelLabel: this.normalizeLevel(input.levelLabel) ?? undefined,
        onboardingCompleted: Boolean(this.normalizeLevel(input.levelLabel)),
        subscriptions: this.readClientSubscriptionsFromInput(input)
      },
      input.levelLabel,
      await this.fetchVivaJoinPurchaseOptions(tournament)
    );

    if (!payment.required || payment.code !== 'PURCHASE_REQUIRED') {
      return this.registerPublicParticipant(slug, input);
    }

    const purchaseOption = this.resolveSelectedPurchaseOption(
      payment.purchaseOptions,
      input.selectedPurchaseOptionId
    );
    await this.savePendingJoinPayment(tournament, {
      transactionId,
      phone: normalizedPhone,
      name: this.pickString(input.name) ?? undefined,
      levelLabel: this.normalizeLevel(input.levelLabel) ?? undefined,
      notes: this.pickString(input.notes) ?? undefined,
      selectedPurchaseOptionId: purchaseOption?.id ?? this.pickString(input.selectedPurchaseOptionId) ?? undefined,
      createdAt: new Date().toISOString()
    });

    return {
      ok: true,
      code: 'PURCHASE_STARTED',
      message: 'Покупка участия создана. Перейдите к оплате, чтобы завершить запись.',
      tournamentId: tournament.id,
      tournamentSlug: tournament.slug,
      payment: {
        ...payment,
        checkoutUrl: this.pickString(input.checkoutUrl) ?? undefined,
        transactionId
      }
    };
  }

  async confirmPublicJoinAfterPayment(
    slug: string,
    input: {
      phone?: string;
      fallbackName?: string;
      fallbackLevelLabel?: string;
    }
  ): Promise<TournamentRegistrationResponse> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    const normalizedPhone = this.normalizePhone(input.phone);
    if (!normalizedPhone) {
      return {
        ok: false,
        code: 'PHONE_REQUIRED',
        message: 'Для подтверждения оплаты нужен номер телефона.',
        tournamentSlug: tournament.slug
      };
    }

    const pending = this.findPendingJoinPayment(tournament, normalizedPhone);
    if (!pending) {
      return {
        ok: false,
        code: 'PURCHASE_REQUIRED',
        message: 'Не найдена ожидающая транзакция оплаты для этого номера.',
        tournamentSlug: tournament.slug
      };
    }

    const verification = await this.verifyVivaTransaction({
      booking: this.resolveBookingConfig(tournament),
      transactionId: pending.transactionId
    });
    if (!verification.paid) {
      return {
        ok: false,
        code: 'PURCHASE_REQUIRED',
        message: 'Оплата пока не подтверждена Viva. Попробуйте обновить страницу через несколько секунд.',
        tournamentSlug: tournament.slug
      };
    }

    await this.removePendingJoinPayment(tournament, pending.transactionId);
    return this.registerPublicParticipant(slug, {
      name: pending.name ?? input.fallbackName ?? normalizedPhone,
      phone: normalizedPhone,
      levelLabel: pending.levelLabel ?? input.fallbackLevelLabel,
      notes: pending.notes,
      selectedPurchaseOptionId: pending.selectedPurchaseOptionId,
      purchaseConfirmed: true
    });
  }

  async addPublicParticipantToWaitlist(
    slug: string,
    input: RegistrationInput
  ): Promise<TournamentRegistrationResponse> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    const normalizedPhone = this.normalizePhone(input.phone);
    if (!normalizedPhone) {
      return {
        ok: false,
        code: 'PHONE_REQUIRED',
        message: 'Для добавления в лист ожидания нужен номер телефона.',
        tournamentSlug: tournament.slug
      };
    }

    const existingParticipant = tournament.participants.find(
      (item) => this.normalizePhone(item.phone) === normalizedPhone
    );
    if (existingParticipant) {
      return {
        ok: true,
        code: 'ALREADY_REGISTERED',
        message: 'Игрок уже записан в турнир.',
        tournamentId: tournament.id,
        tournamentSlug: tournament.slug,
        participant: existingParticipant
      };
    }

    const existingWaitlistParticipant = tournament.waitlist.find(
      (item) => this.normalizePhone(item.phone) === normalizedPhone
    );
    if (existingWaitlistParticipant) {
      return {
        ok: true,
        code: 'ALREADY_WAITLISTED',
        message: 'Игрок уже находится в листе ожидания.',
        tournamentId: tournament.id,
        tournamentSlug: tournament.slug,
        participant: existingWaitlistParticipant
      };
    }

    const participant = await this.enrichTournamentParticipantWithViva({
      name: String(input.name || '').trim() || normalizedPhone,
      phone: normalizedPhone,
      levelLabel: this.normalizeLevel(input.levelLabel) ?? undefined,
      gender: input.gender ?? 'MIXED',
      paymentStatus: 'UNPAID',
      status: 'WAITLIST' as const,
      waitlistReason: 'LEVEL_MISMATCH',
      registeredAt: new Date().toISOString(),
      notes: this.pickString(input.notes) ?? undefined
    });

    const nextWaitlist: TournamentParticipant[] = [...tournament.waitlist, participant];
    await this.updateCustom(tournament.id, {
      waitlist: nextWaitlist
    });

    return {
      ok: true,
      code: 'WAITLISTED',
      message:
        'Заявка добавлена в лист ожидания. Организатор сможет подтвердить участие после проверки уровня.',
      tournamentId: tournament.id,
      tournamentSlug: tournament.slug,
      participant
    };
  }

  async checkMechanicsAccess(
    slug: string,
    phone?: string
  ): Promise<TournamentMechanicsAccessResponse> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    const normalizedPhone = this.normalizePhone(phone);
    if (!normalizedPhone) {
      return {
        ok: false,
        code: 'PHONE_REQUIRED',
        message: 'Для доступа к турнирной механике нужен номер телефона.',
        tournamentSlug: tournament.slug
      };
    }

    if (
      tournament.allowedManagerPhones.length === 0 ||
      tournament.allowedManagerPhones.includes(normalizedPhone)
    ) {
      return {
        ok: true,
        code: 'OK',
        message: 'Доступ к турнирной механике разрешён.',
        tournamentSlug: tournament.slug
      };
    }

    return {
      ok: false,
      code: 'ACCESS_DENIED',
      message: 'Этот номер телефона не допущен к управлению турниром.',
      tournamentSlug: tournament.slug
    };
  }

  private async listSourceTournaments(): Promise<Tournament[]> {
    const vivaTournaments = await this.vivaTournamentsService.listTournaments();
    if (vivaTournaments) {
      return vivaTournaments;
    }

    return this.lkPadelHubClient.listTournaments();
  }

  private async listCustomTournamentsSafe(): Promise<CustomTournament[]> {
    if (!this.tournamentsPersistence.isEnabled()) {
      return [];
    }

    try {
      return await this.tournamentsPersistence.listCustomTournaments();
    } catch (error) {
      this.logger.warn(
        `Failed to load custom tournaments, fallback to source only: ${String(error)}`
      );
      return [];
    }
  }

  private async listHydratedCustomTournamentsSafe(): Promise<CustomTournament[]> {
    const tournaments = await this.listCustomTournamentsSafe();
    const sourceTournamentsById = await this.buildSourceTournamentMapForCustomTournaments(tournaments);
    return Promise.all(
      tournaments.map(async (tournament) => {
        try {
          return await this.hydrateCustomTournamentFromSourceMap(tournament, sourceTournamentsById);
        } catch (error) {
          this.logger.warn(
            `Failed to hydrate public tournament ${tournament.id}: ${String(error)}`
          );
          return tournament;
        }
      })
    );
  }

  private async buildSourceTournamentMapForCustomTournaments(
    tournaments: CustomTournament[]
  ): Promise<Map<string, Tournament>> {
    const sourceIds = new Set(
      tournaments
        .map((tournament) => this.pickString(tournament.sourceTournamentId))
        .filter((sourceId): sourceId is string => Boolean(sourceId))
    );
    if (sourceIds.size === 0) {
      return new Map();
    }

    try {
      const sourceTournaments = await this.listSourceTournaments();
      const sourceTournamentsById = new Map(
        sourceTournaments
          .filter((tournament) => sourceIds.has(tournament.id))
          .map((tournament) => [tournament.id, tournament])
      );
      await Promise.all(
        Array.from(sourceIds).map(async (sourceId) => {
          const detailedTournament = await this.findSourceTournamentById(sourceId);
          if (detailedTournament) {
            sourceTournamentsById.set(sourceId, detailedTournament);
          }
        })
      );
      return sourceTournamentsById;
    } catch (error) {
      this.logger.warn(`Failed to load source tournaments for public list: ${String(error)}`);
      return new Map();
    }
  }

  private async findCustomTournamentByIdSafe(id: string): Promise<CustomTournament | null> {
    if (!this.tournamentsPersistence.isEnabled()) {
      return null;
    }

    try {
      const tournament = await this.tournamentsPersistence.findCustomTournamentById(id);
      return tournament ? await this.hydrateCustomTournament(tournament) : null;
    } catch (error) {
      this.logger.warn(
        `Failed to lookup custom tournament by id ${id}, fallback to source only: ${String(error)}`
      );
      return null;
    }
  }

  private async findCustomTournamentBySourceIdSafe(
    sourceTournamentId: string
  ): Promise<CustomTournament | null> {
    if (!this.tournamentsPersistence.isEnabled()) {
      return null;
    }

    try {
      const tournament = await this.tournamentsPersistence.findCustomTournamentBySourceTournamentId(
        sourceTournamentId
      );
      return tournament ? await this.hydrateCustomTournament(tournament) : null;
    } catch (error) {
      this.logger.warn(
        `Failed to lookup custom tournament by source id ${sourceTournamentId}: ${String(error)}`
      );
      return null;
    }
  }

  private async findSourceTournamentById(id: string): Promise<Tournament | null> {
    if (typeof this.vivaTournamentsService.findTournamentById === 'function') {
      const vivaTournament = await this.vivaTournamentsService.findTournamentById(id);
      if (vivaTournament) {
        return vivaTournament;
      }
    }

    const sourceTournaments = await this.listSourceTournaments();
    return sourceTournaments.find((item) => item.id === id) ?? null;
  }

  private matchesPublicTournamentFilters(
    tournament: CustomTournament,
    options: {
      stationIds: string[];
      includePast: boolean;
      forwardDays: number;
      date?: string;
    }
  ): boolean {
    if (
      !options.includePast &&
      (tournament.status === TournamentStatus.FINISHED
        || tournament.status === TournamentStatus.CANCELED)
    ) {
      return false;
    }

    if (options.date && !this.isTournamentOnPublicDate(tournament, options.date)) {
      return false;
    }

    if (
      !options.date
      && !options.includePast
      && !this.isTournamentWithinPublicForwardWindow(tournament, options.forwardDays)
    ) {
      return false;
    }

    if (options.stationIds.length === 0) {
      return true;
    }

    const candidates = [
      this.normalizeFilterValue(tournament.studioId),
      this.normalizeFilterValue(tournament.studioName)
    ].filter((value): value is string => Boolean(value));
    if (candidates.length === 0) {
      return false;
    }

    return options.stationIds.some((stationId) => candidates.includes(stationId));
  }

  private isTournamentWithinPublicForwardWindow(
    tournament: CustomTournament,
    forwardDays = PUBLIC_TOURNAMENTS_FORWARD_DAYS
  ): boolean {
    const startsAt = Date.parse(tournament.startsAt ?? '');
    if (!Number.isFinite(startsAt)) {
      return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const end = new Date(today);
    end.setDate(end.getDate() + forwardDays - 1);
    end.setHours(23, 59, 59, 999);

    return startsAt >= today.getTime() && startsAt <= end.getTime();
  }

  private isTournamentOnPublicDate(tournament: CustomTournament, date: string): boolean {
    const startsAt = Date.parse(tournament.startsAt ?? '');
    if (!Number.isFinite(startsAt)) {
      return false;
    }
    return this.formatPublicDateKey(new Date(startsAt)) === date;
  }

  private comparePublicTournaments(left: CustomTournament, right: CustomTournament): number {
    const leftStartsAt = Date.parse(left.startsAt ?? '');
    const rightStartsAt = Date.parse(right.startsAt ?? '');
    const leftRank = Number.isFinite(leftStartsAt) ? leftStartsAt : Number.MAX_SAFE_INTEGER;
    const rightRank = Number.isFinite(rightStartsAt)
      ? rightStartsAt
      : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return String(left.name ?? '').localeCompare(String(right.name ?? ''), 'ru');
  }

  private enrichSourceTournament(
    tournament: Tournament,
    customTournament?: CustomTournament
  ): Tournament {
    const sourceTournamentSnapshot = this.buildSourceTournamentSnapshot(tournament);

    if (!customTournament) {
      return {
        ...tournament,
        details: {
          sourceTournamentSnapshot
        },
        linkedCustomTournamentId: undefined,
        publicUrl: undefined,
        slug: undefined,
        tournamentType: tournament.tournamentType,
        accessLevels: undefined,
        gender: undefined,
        maxPlayers: tournament.maxPlayers,
        participants: tournament.participants,
        participantsCount: tournament.participantsCount,
        paidParticipantsCount: tournament.paidParticipantsCount,
        waitlist: tournament.waitlist,
        waitlistCount: undefined,
        allowedManagerPhones: undefined,
        skin: undefined,
        mechanics: this.buildDefaultTournamentMechanics({
          tournamentType: tournament.tournamentType,
          maxPlayers: tournament.maxPlayers
        }),
        changeLog: []
      };
    }

    const mergedCustomTournament = this.mergeCustomWithSourceTournament(customTournament, tournament);

    return {
      ...tournament,
      name: mergedCustomTournament.name,
      details: {
        sourceTournamentSnapshot
      },
      linkedCustomTournamentId: mergedCustomTournament.id,
      sourceTournamentId: mergedCustomTournament.sourceTournamentId,
      slug: mergedCustomTournament.slug,
      publicUrl: mergedCustomTournament.publicUrl,
      tournamentType: mergedCustomTournament.tournamentType,
      accessLevels: mergedCustomTournament.accessLevels,
      gender: mergedCustomTournament.gender,
      maxPlayers: mergedCustomTournament.maxPlayers,
      participants: mergedCustomTournament.participants,
      participantsCount: mergedCustomTournament.participantsCount,
      paidParticipantsCount: mergedCustomTournament.paidParticipantsCount,
      waitlist: mergedCustomTournament.waitlist,
      waitlistCount: mergedCustomTournament.waitlistCount,
      allowedManagerPhones: mergedCustomTournament.allowedManagerPhones,
      publicationCommunityIds: mergedCustomTournament.publicationCommunityIds,
      skin: mergedCustomTournament.skin
    };
  }

  private toTournamentListItem(tournament: CustomTournament): Tournament {
    return {
      ...this.ensureTournamentDefaults(tournament),
      linkedCustomTournamentId: tournament.id,
      sourceTournamentId: tournament.sourceTournamentId
    };
  }

  private buildCreateMutation(
    sourceTournament: Tournament,
    mutation: Partial<CreateCustomTournamentMutation>
  ): CreateCustomTournamentMutation {
    return {
      sourceTournamentId: sourceTournament.id,
      sourceTournamentSnapshot: this.buildSourceTournamentSnapshot(sourceTournament),
      name: this.pickString(mutation.name) ?? sourceTournament.name,
      status: mutation.status ?? TournamentStatus.REGISTRATION,
      startsAt: this.pickString(mutation.startsAt) ?? sourceTournament.startsAt,
      endsAt: this.pickString(mutation.endsAt) ?? sourceTournament.endsAt,
      tournamentType:
        this.pickString(mutation.tournamentType) ?? sourceTournament.tournamentType ?? 'AMERICANO',
      accessLevels: Array.isArray(mutation.accessLevels) ? mutation.accessLevels : [],
      gender: mutation.gender ?? 'MIXED',
      maxPlayers: Number(mutation.maxPlayers || 0) || Number(sourceTournament.maxPlayers || 0) || 8,
      participants: Array.isArray(mutation.participants)
        ? mutation.participants
        : Array.isArray(sourceTournament.participants)
          ? sourceTournament.participants
          : [],
      waitlist: Array.isArray(mutation.waitlist) ? mutation.waitlist : [],
      allowedManagerPhones: Array.isArray(mutation.allowedManagerPhones)
        ? mutation.allowedManagerPhones
        : [],
      publicationCommunityIds: Array.isArray(mutation.publicationCommunityIds)
        ? mutation.publicationCommunityIds
        : [],
      slug: this.pickString(mutation.slug) ?? undefined,
      studioId: this.pickString(mutation.studioId) ?? sourceTournament.studioId,
      studioName: this.pickString(mutation.studioName) ?? sourceTournament.studioName,
      courtName: this.pickString(mutation.courtName) ?? sourceTournament.courtName,
      locationName: this.pickString(mutation.locationName) ?? sourceTournament.locationName,
      trainerId: this.pickString(mutation.trainerId) ?? sourceTournament.trainerId,
      trainerName: this.pickString(mutation.trainerName) ?? sourceTournament.trainerName,
      trainerAvatarUrl:
        mutation.trainerAvatarUrl !== undefined
          ? mutation.trainerAvatarUrl
          : sourceTournament.trainerAvatarUrl ?? null,
      exerciseTypeId: sourceTournament.exerciseTypeId,
      mechanics:
        mutation.mechanics
        ?? this.buildDefaultTournamentMechanics({
          tournamentType:
            this.pickString(mutation.tournamentType) ?? sourceTournament.tournamentType,
          maxPlayers: Number(mutation.maxPlayers || 0) || Number(sourceTournament.maxPlayers || 0) || 8
        }),
      actor: mutation.actor,
      skin: mutation.skin ?? {
        title: sourceTournament.name,
        subtitle: sourceTournament.studioName,
        description: sourceTournament.tournamentType,
        ctaLabel: 'Записаться'
      }
    };
  }

  private async updateExistingFromCreate(
    id: string,
    mutation: CreateCustomTournamentMutation
  ): Promise<CustomTournament> {
    return this.updateCustom(id, {
      name: mutation.name,
      status: mutation.status,
      startsAt: mutation.startsAt,
      endsAt: mutation.endsAt,
      tournamentType: mutation.tournamentType,
      accessLevels: mutation.accessLevels,
      gender: mutation.gender,
      maxPlayers: mutation.maxPlayers,
      participants: mutation.participants,
      waitlist: mutation.waitlist,
      allowedManagerPhones: mutation.allowedManagerPhones,
      publicationCommunityIds: mutation.publicationCommunityIds,
      slug: mutation.slug,
      studioId: mutation.studioId,
      studioName: mutation.studioName,
      courtName: mutation.courtName,
      locationName: mutation.locationName,
      trainerId: mutation.trainerId,
      trainerName: mutation.trainerName,
      trainerAvatarUrl: mutation.trainerAvatarUrl,
      exerciseTypeId: mutation.exerciseTypeId,
      skin: mutation.skin,
      mechanics: mutation.mechanics,
      actor: mutation.actor
    });
  }

  private buildSourceTournamentSnapshot(
    sourceTournament: Tournament
  ): Record<string, unknown> {
    return {
      id: sourceTournament.id,
      source: sourceTournament.source,
      name: sourceTournament.name,
      status: sourceTournament.status,
      startsAt: sourceTournament.startsAt,
      endsAt: sourceTournament.endsAt,
      studioId: sourceTournament.studioId,
      studioName: sourceTournament.studioName,
      courtName: sourceTournament.courtName,
      locationName: sourceTournament.locationName,
      trainerId: sourceTournament.trainerId,
      trainerName: sourceTournament.trainerName,
      trainerAvatarUrl: sourceTournament.trainerAvatarUrl,
      exerciseTypeId: sourceTournament.exerciseTypeId,
      tournamentType: sourceTournament.tournamentType,
      maxPlayers: sourceTournament.maxPlayers,
      participants: sourceTournament.participants,
      participantsCount: sourceTournament.participantsCount
    };
  }

  private ensurePersistenceEnabled(): void {
    if (!this.tournamentsPersistence.isEnabled()) {
      throw new InternalServerErrorException(
        'Custom tournaments require TOURNAMENTS_MONGODB_URI or MONGODB_URI'
      );
    }
  }

  private async requireCustomBySlug(slug: string): Promise<CustomTournament> {
    const tournament = await this.tournamentsPersistence.findCustomTournamentBySlug(slug);
    if (!tournament) {
      throw new NotFoundException(`Public tournament with slug ${slug} not found`);
    }
    return this.hydrateCustomTournament(tournament);
  }

  private async hydrateCustomTournament(tournament: CustomTournament): Promise<CustomTournament> {
    if (!tournament.sourceTournamentId) {
      return this.ensureTournamentDefaults(tournament);
    }

    try {
      const sourceTournament = await this.findSourceTournamentById(tournament.sourceTournamentId);
      return this.mergeCustomWithSourceTournament(tournament, sourceTournament ?? undefined);
    } catch (error) {
      this.logger.warn(
        `Failed to hydrate source data for custom tournament ${tournament.id}: ${String(error)}`
      );
      return this.mergeCustomWithSourceTournament(tournament);
    }
  }

  private async hydrateCustomTournamentFromSourceMap(
    tournament: CustomTournament,
    sourceTournamentsById: Map<string, Tournament>
  ): Promise<CustomTournament> {
    if (!tournament.sourceTournamentId) {
      return this.ensureTournamentDefaults(tournament);
    }
    return this.mergeCustomWithSourceTournament(
      tournament,
      sourceTournamentsById.get(tournament.sourceTournamentId)
    );
  }

  private mergeCustomWithSourceTournament(
    tournament: CustomTournament,
    sourceTournament?: Tournament
  ): CustomTournament {
    const sourceTournamentSnapshot = sourceTournament
      ? this.buildSourceTournamentSnapshot(sourceTournament)
      : this.getSourceTournamentSnapshot(tournament);
    const sourceParticipants = Array.isArray(sourceTournament?.participants)
      ? sourceTournament.participants
      : this.readSnapshotParticipants(sourceTournamentSnapshot);
    const customParticipants = Array.isArray(tournament.participants)
      ? tournament.participants
      : [];
    const sourceParticipantsCount =
      this.pickNumber(sourceTournament?.participantsCount)
      ?? this.pickNumber(sourceTournamentSnapshot.participantsCount);
    const sourceProvidesParticipantState =
      this.isLiveVivaParticipantState(sourceTournament, sourceTournamentSnapshot);
    const participants = this.mergeTournamentParticipants(
      sourceParticipants,
      customParticipants,
      {
        includeCustomOnly: !sourceProvidesParticipantState
      }
    );
    const paidParticipantsCount = participants.filter((item) => item.paymentStatus === 'PAID').length;
    const participantsCount = Math.max(
      participants.length,
      sourceParticipantsCount ?? 0,
      sourceProvidesParticipantState ? 0 : Number(tournament.participantsCount || 0) || 0
    );
    const waitlist = Array.isArray(tournament.waitlist) ? tournament.waitlist : [];

    return {
      ...tournament,
      maxPlayers:
        Number(tournament.maxPlayers || 0) ||
        this.pickNumber(sourceTournamentSnapshot.maxPlayers) ||
        8,
      trainerAvatarUrl:
        tournament.trainerAvatarUrl
        ?? this.pickString(sourceTournamentSnapshot.trainerAvatarUrl)
        ?? undefined,
      mechanics: this.buildDefaultTournamentMechanics({
        existing: tournament.mechanics,
        tournamentType:
          tournament.tournamentType ?? this.pickString(sourceTournamentSnapshot.tournamentType),
        maxPlayers:
          Number(tournament.maxPlayers || 0) ||
          this.pickNumber(sourceTournamentSnapshot.maxPlayers) ||
          8
      }),
      participants,
      participantsCount,
      paidParticipantsCount:
        paidParticipantsCount > 0 ? paidParticipantsCount : tournament.paidParticipantsCount,
      waitlist,
      waitlistCount: waitlist.length,
      details: {
        ...(tournament.details && typeof tournament.details === 'object' ? tournament.details : {}),
        sourceTournamentSnapshot
      }
    };
  }

  private ensureTournamentDefaults(tournament: CustomTournament): CustomTournament {
    return {
      ...tournament,
      mechanics: this.buildDefaultTournamentMechanics({
        existing: tournament.mechanics,
        tournamentType: tournament.tournamentType,
        maxPlayers: tournament.maxPlayers
      }),
      changeLog: Array.isArray(tournament.changeLog) ? tournament.changeLog : []
    };
  }

  private buildDefaultTournamentMechanics(input: {
    existing?: TournamentMechanics;
    tournamentType?: string;
    maxPlayers?: number;
  }): TournamentMechanics {
    const existing = input.existing;
    const existingConfig = existing?.config;
    const resolvedConfig: AmericanoGeneratorConfig = {
      mode: this.resolveMechanicsMode(input.tournamentType, existingConfig?.mode),
      rounds: typeof existingConfig?.rounds === 'number' ? existingConfig.rounds : null,
      courts: typeof existingConfig?.courts === 'number' ? existingConfig.courts : null,
      useRatings: existingConfig?.useRatings !== false,
      firstRoundSeeding: existingConfig?.firstRoundSeeding ?? 'auto',
      roundExactThreshold:
        typeof existingConfig?.roundExactThreshold === 'number'
          ? existingConfig.roundExactThreshold
          : 12,
      balanceOutlierThreshold:
        typeof existingConfig?.balanceOutlierThreshold === 'number'
          ? existingConfig.balanceOutlierThreshold
          : 1.1,
      balanceOutlierWeight:
        typeof existingConfig?.balanceOutlierWeight === 'number'
          ? existingConfig.balanceOutlierWeight
          : 120,
      strictPartnerUniqueness: existingConfig?.strictPartnerUniqueness ?? 'high',
      strictBalance: existingConfig?.strictBalance ?? 'medium',
      avoidRepeatOpponents: existingConfig?.avoidRepeatOpponents !== false,
      avoidRepeatPartners: existingConfig?.avoidRepeatPartners !== false,
      distributeByesEvenly: existingConfig?.distributeByesEvenly !== false,
      historyDepth:
        typeof existingConfig?.historyDepth === 'number' ? existingConfig.historyDepth : 0,
      localSearchIterations:
        typeof existingConfig?.localSearchIterations === 'number'
          ? existingConfig.localSearchIterations
          : 6,
      pairingExactThreshold:
        typeof existingConfig?.pairingExactThreshold === 'number'
          ? existingConfig.pairingExactThreshold
          : 16,
      matchExactThreshold:
        typeof existingConfig?.matchExactThreshold === 'number'
          ? existingConfig.matchExactThreshold
          : 12,
      weights: {
        ...DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS,
        ...(existingConfig?.weights || {})
      }
    };

    return {
      enabled: existing?.enabled !== false,
      config: resolvedConfig,
      history: Array.isArray(existing?.history) ? existing?.history : undefined,
      notes: this.pickString(existing?.notes) ?? undefined,
      raw:
        existing?.raw && typeof existing.raw === 'object'
          ? (existing.raw as Record<string, unknown>)
          : undefined
    };
  }

  private resolveMechanicsMode(
    tournamentType?: string,
    existingMode?: AmericanoGeneratorConfig['mode']
  ): AmericanoGeneratorConfig['mode'] {
    if (
      existingMode === 'full_americano' ||
      existingMode === 'short_americano' ||
      existingMode === 'competitive_americano' ||
      existingMode === 'dynamic_americano' ||
      existingMode === 'team_americano' ||
      existingMode === 'team_mexicano' ||
      existingMode === 'flex_americano' ||
      existingMode === 'round_robin'
    ) {
      return existingMode;
    }

    const normalizedType = String(tournamentType ?? '').trim().toLowerCase();
    if (normalizedType.includes('compet')) {
      return 'competitive_americano';
    }
    return 'short_americano';
  }

  private getSourceTournamentSnapshot(tournament: CustomTournament): Record<string, unknown> {
    if (!tournament.details || typeof tournament.details !== 'object') {
      return {};
    }

    const snapshot = tournament.details.sourceTournamentSnapshot;
    return snapshot && typeof snapshot === 'object'
      ? (snapshot as Record<string, unknown>)
      : {};
  }

  private readSnapshotParticipants(snapshot: Record<string, unknown>): TournamentParticipant[] {
    if (!Array.isArray(snapshot.participants)) {
      return [];
    }

    const seen = new Set<string>();
    return snapshot.participants
      .map((entry) => this.toTournamentParticipant(entry))
      .filter((item): item is TournamentParticipant => Boolean(item))
      .filter((participant) => {
        const key = this.buildParticipantKey(participant);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  private mergeTournamentParticipants(
    sourceParticipants: TournamentParticipant[],
    customParticipants: TournamentParticipant[],
    options?: {
      includeCustomOnly?: boolean;
    }
  ): TournamentParticipant[] {
    const merged: TournamentParticipant[] = [];
    const indexes = new Map<string, number>();
    const includeCustomOnly = options?.includeCustomOnly !== false;

    sourceParticipants.forEach((participant) => {
      const key = this.buildParticipantKey(participant);
      indexes.set(key, merged.length);
      merged.push({ ...participant });
    });

    customParticipants.forEach((participant) => {
      const key = this.buildParticipantKey(participant);
      const existingIndex = indexes.get(key);
      if (existingIndex === undefined) {
        if (!includeCustomOnly) {
          return;
        }
        indexes.set(key, merged.length);
        merged.push({ ...participant });
        return;
      }

      merged[existingIndex] = this.mergeSourceAndCustomParticipant(
        merged[existingIndex],
        participant
      );
    });

    return merged;
  }

  private mergeSourceAndCustomParticipant(
    sourceParticipant: TournamentParticipant,
    customParticipant: TournamentParticipant
  ): TournamentParticipant {
    return {
      ...customParticipant,
      ...sourceParticipant,
      id: sourceParticipant.id ?? customParticipant.id,
      name: sourceParticipant.name || customParticipant.name,
      phone: sourceParticipant.phone ?? customParticipant.phone,
      avatarUrl: sourceParticipant.avatarUrl ?? customParticipant.avatarUrl,
      levelLabel: sourceParticipant.levelLabel ?? customParticipant.levelLabel,
      gender: sourceParticipant.gender ?? customParticipant.gender,
      paymentStatus: sourceParticipant.paymentStatus ?? customParticipant.paymentStatus,
      status: sourceParticipant.status ?? customParticipant.status,
      registeredAt: sourceParticipant.registeredAt ?? customParticipant.registeredAt,
      paidAt: sourceParticipant.paidAt ?? customParticipant.paidAt,
      notes: sourceParticipant.notes ?? customParticipant.notes
    };
  }

  private isLiveVivaParticipantState(
    sourceTournament: Tournament | undefined,
    sourceTournamentSnapshot: Record<string, unknown>
  ): boolean {
    const source = this.pickString(sourceTournament?.source ?? sourceTournamentSnapshot.source)
      ?.toUpperCase();
    if (source !== 'VIVA' || !sourceTournament) {
      return false;
    }

    return (
      Array.isArray(sourceTournament.participants)
      || this.pickNumber(sourceTournament.participantsCount) !== undefined
    );
  }

  private buildParticipantKey(participant: TournamentParticipant): string {
    const phone = this.normalizePhone(participant.phone);
    if (phone) {
      return `phone:${phone}`;
    }
    return `name:${String(participant.name || '').trim().toLowerCase()}`;
  }

  private toTournamentParticipant(value: unknown): TournamentParticipant | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    const name = this.pickString(record.name);
    if (!name) {
      return null;
    }

    const paymentStatus = this.pickString(record.paymentStatus);
    const status = this.pickString(record.status);
    return {
      id: this.pickString(record.id) ?? undefined,
      name,
      phone: this.normalizePhone(record.phone) ?? undefined,
      levelLabel: this.pickString(record.levelLabel) ?? undefined,
      avatarUrl: this.pickNullableString(record.avatarUrl ?? record.photo) ?? undefined,
      gender: this.normalizeGender(record.gender),
      paymentStatus:
        paymentStatus === 'PAID' ? 'PAID' : paymentStatus === 'UNPAID' ? 'UNPAID' : undefined,
      status: status === 'WAITLIST' ? 'WAITLIST' : 'REGISTERED',
      waitlistReason: this.normalizeWaitlistReason(record.waitlistReason) ?? undefined,
      registeredAt: this.pickString(record.registeredAt) ?? undefined,
      paidAt: this.pickString(record.paidAt) ?? undefined,
      notes: this.pickString(record.notes) ?? undefined
    };
  }

  private evaluateAccess(
    tournament: CustomTournament,
    levelLabel?: string
  ): TournamentAccessCheckResponse {
    const normalizedLevel = this.normalizeLevel(levelLabel);
    if (tournament.accessLevels.length === 0) {
      return {
        ok: true,
        code: 'OK',
        message: 'Турнир доступен без ограничений по уровню.',
        tournamentSlug: tournament.slug,
        accessLevels: tournament.accessLevels,
        levelLabel: normalizedLevel ?? undefined
      };
    }

    if (!normalizedLevel) {
      return {
        ok: false,
        code: 'ONBOARDING_REQUIRED',
        message: 'Для записи нужен уровень игрока. Предложите пользователю пройти онбординг.',
        tournamentSlug: tournament.slug,
        accessLevels: tournament.accessLevels
      };
    }

    if (!this.isLevelAllowedByList(normalizedLevel, tournament.accessLevels)) {
      return {
        ok: false,
        code: 'LEVEL_NOT_ALLOWED',
        message: 'Уровень игрока не подходит под условия этого турнира.',
        tournamentSlug: tournament.slug,
        accessLevels: tournament.accessLevels,
        levelLabel: normalizedLevel
      };
    }

    return {
      ok: true,
      code: 'OK',
      message: 'Уровень игрока подходит для участия в турнире.',
      tournamentSlug: tournament.slug,
      accessLevels: tournament.accessLevels,
      levelLabel: normalizedLevel
    };
  }

  private resolveJoinPayment(
    tournament: CustomTournament,
    client: TournamentPublicClientProfile,
    levelLabel?: string,
    vivaPurchaseOptions?: TournamentPurchaseOption[]
  ): TournamentJoinPaymentState {
    const booking = this.resolveBookingConfig(tournament);
    const purchaseOptions =
      Array.isArray(vivaPurchaseOptions) && vivaPurchaseOptions.length > 0
        ? vivaPurchaseOptions
        : booking.purchaseOptions;
    const requiresPurchase = booking.required || purchaseOptions.length > 0;
    if (!requiresPurchase) {
      return {
        required: false,
        code: 'NOT_REQUIRED',
        message: 'Дополнительная оплата для участия в турнире не требуется.',
        availableSubscriptions: [],
        purchaseOptions,
        purchaseFlowUrl: booking.purchaseFlowUrl
      };
    }

    const normalizedLevel = this.normalizeLevel(levelLabel) ?? undefined;
    const availableSubscriptions = this.normalizeClientSubscriptions(client.subscriptions).filter(
      (subscription) => this.isSubscriptionCompatible(subscription, booking, tournament, normalizedLevel)
    );

    if (availableSubscriptions.length > 0) {
      return {
        required: true,
        code: 'SUBSCRIPTION_AVAILABLE',
        message: `Можно списать абонемент «${availableSubscriptions[0].label}» для подтверждения участия.`,
        availableSubscriptions,
        selectedSubscription: availableSubscriptions[0],
        purchaseOptions,
        purchaseFlowUrl: booking.purchaseFlowUrl
      };
    }

    return {
      required: true,
      code: 'PURCHASE_REQUIRED',
      message: 'Подходящий абонемент не найден. Сначала нужно купить участие.',
      availableSubscriptions: [],
      purchaseOptions,
      purchaseFlowUrl: booking.purchaseFlowUrl
    };
  }

  private resolveBookingConfig(tournament: CustomTournament): TournamentBookingConfig {
    const details =
      tournament.details && typeof tournament.details === 'object'
        ? (tournament.details as Record<string, unknown>)
        : {};
    const rawBooking = this.toRecord(details.booking) ?? this.toRecord(details.joinFlow) ?? {};
    const rawViva = this.toRecord(rawBooking.viva) ?? {};
    const acceptedSubscriptions = this.normalizeAcceptedSubscriptions(
      rawBooking.acceptedSubscriptions ?? rawBooking.subscriptions
    );
    const purchaseOptions = this.normalizePurchaseOptions(
      rawBooking.purchaseOptions ?? rawBooking.tariffs
    );
    const enabled =
      rawBooking.enabled === true
      || rawBooking.paymentRequired === true
      || acceptedSubscriptions.length > 0
      || purchaseOptions.length > 0;
    const required =
      rawBooking.paymentRequired === true || (enabled && (acceptedSubscriptions.length > 0 || purchaseOptions.length > 0));

    return {
      enabled,
      required,
      acceptedSubscriptions,
      purchaseOptions,
      purchaseFlowUrl: this.pickString(rawBooking.purchaseFlowUrl ?? rawBooking.purchaseUrl) ?? undefined,
      vivaWidgetId:
        this.pickString(rawBooking.vivaWidgetId ?? rawBooking.widgetId ?? rawViva.widgetId)
        ?? undefined,
      vivaExerciseId:
        this.pickString(rawBooking.vivaExerciseId ?? rawBooking.exerciseId ?? rawViva.exerciseId)
        ?? this.pickString(tournament.sourceTournamentId)
        ?? this.pickString(this.getSourceTournamentSnapshot(tournament).id)
        ?? undefined,
      vivaStudioId:
        this.pickString(rawBooking.vivaStudioId ?? rawBooking.studioId ?? rawViva.studioId)
        ?? this.pickString(tournament.studioId)
        ?? this.pickString(this.getSourceTournamentSnapshot(tournament).studioId)
        ?? undefined
    };
  }

  private async createSourceTournamentBooking(
    tournament: CustomTournament,
    input: {
      name: string;
      phone: string;
      notes?: string;
      vivaAuthorizationHeader?: string;
    }
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.isVivaSourceTournament(tournament)) {
      return { ok: true };
    }

    const booking = this.resolveBookingConfig(tournament);
    const exerciseId =
      this.pickString(booking.vivaExerciseId)
      ?? this.pickString(tournament.sourceTournamentId);
    if (!exerciseId) {
      return {
        ok: false,
        message: 'Не найден идентификатор групповой записи Viva для записи участника.'
      };
    }

    const created = await this.vivaTournamentsService.createTournamentBooking({
      exerciseId,
      phone: input.phone,
      name: input.name,
      comment: input.notes,
      authorizationHeader: input.vivaAuthorizationHeader
    });
    if (created) {
      return { ok: true };
    }

    return {
      ok: false,
      message:
        'Не удалось добавить участника в групповую запись Viva. Запись в локальную карточку не сохранена, чтобы счетчик не расходился с Viva.'
    };
  }

  private isVivaSourceTournament(tournament: CustomTournament): boolean {
    const snapshot = this.getSourceTournamentSnapshot(tournament);
    const source = this.pickString(snapshot.source)?.toUpperCase();
    return source === 'VIVA';
  }

  private normalizeAcceptedSubscriptions(value: unknown): TournamentAcceptedSubscriptionRule[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const items: TournamentAcceptedSubscriptionRule[] = [];
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      const record = item as Record<string, unknown>;
      const label = this.pickString(record.label) ?? this.pickString(record.name);
      if (!label) {
        return;
      }
      items.push({
        id:
          this.pickString(record.id)
          ?? this.pickString(record.subscriptionId)
          ?? `accepted-${index + 1}`,
        label,
        description: this.pickString(record.description) ?? undefined,
        writeOffLabel: this.pickString(record.writeOffLabel) ?? undefined,
        compatibleTournamentTypes: this.pickStringArray(
          record.compatibleTournamentTypes ?? record.tournamentTypes
        ),
        compatibleAccessLevels: this.pickStringArray(
          record.compatibleAccessLevels ?? record.accessLevels
        )
      });
    });
    return items;
  }

  private normalizePurchaseOptions(value: unknown): TournamentPurchaseOption[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const items: TournamentPurchaseOption[] = [];
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      const record = item as Record<string, unknown>;
      const label = this.pickString(record.label) ?? this.pickString(record.title);
      const priceLabel =
        this.pickString(record.priceLabel)
        ?? this.pickString(record.price)
        ?? this.pickString(record.amount);
      if (!label || !priceLabel) {
        return;
      }
      items.push({
        id: this.pickString(record.id) ?? `purchase-${index + 1}`,
        label,
        priceLabel,
        description: this.pickString(record.description) ?? undefined,
        productType: this.normalizeVivaProductType(record.productType ?? record.type)
      });
    });
    return items;
  }

  private normalizeVivaProductCatalog(
    value: unknown,
    productType: 'SUBSCRIPTION' | 'ONE_TIME'
  ): TournamentPurchaseOption[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const items: TournamentPurchaseOption[] = [];
    value.forEach((item, index) => {
      const record = this.toRecord(item);
      if (!record) {
        return;
      }
      const id =
        this.pickString(record.id)
        ?? this.pickString(record.productId)
        ?? this.pickString(record.subscriptionId)
        ?? this.pickString(record.oneTimeId)
        ?? `${productType.toLowerCase()}-${index + 1}`;
      const label =
        this.pickString(record.label)
        ?? this.pickString(record.name)
        ?? this.pickString(record.title)
        ?? id;
      const priceLabel =
        this.pickString(record.priceLabel)
        ?? this.pickString(record.price)
        ?? this.pickString(record.amountLabel)
        ?? this.pickString(record.amount)
        ?? this.pickString(record.costLabel)
        ?? this.pickString(record.cost)
        ?? '—';
      items.push({
        id,
        label,
        priceLabel,
        description: this.pickString(record.description) ?? undefined,
        productType
      });
    });
    return items;
  }

  private resolveSelectedPurchaseOption(
    purchaseOptions: TournamentPurchaseOption[],
    selectedPurchaseOptionId?: string
  ): TournamentPurchaseOption | null {
    if (purchaseOptions.length === 0) {
      return null;
    }
    const selectedId = this.pickString(selectedPurchaseOptionId);
    if (selectedId) {
      return purchaseOptions.find((item) => item.id === selectedId) ?? null;
    }
    return purchaseOptions[0];
  }

  private normalizeVivaProductType(value: unknown): 'SUBSCRIPTION' | 'ONE_TIME' | 'SERVICE' | undefined {
    const normalized = this.pickString(value)?.toUpperCase().replace(/[-\s]+/g, '_');
    if (normalized === 'SUBSCRIPTION' || normalized === 'ONE_TIME' || normalized === 'SERVICE') {
      return normalized;
    }
    return undefined;
  }

  private resolveVivaTransactionProductType(
    value: 'SUBSCRIPTION' | 'ONE_TIME' | 'SERVICE' | undefined
  ): 'SUBSCRIPTION' | 'SERVICE' {
    if (value === 'SUBSCRIPTION') {
      return 'SUBSCRIPTION';
    }
    return 'SERVICE';
  }

  private async createVivaJoinTransaction(input: {
    booking: TournamentBookingConfig;
    purchaseOption: TournamentPurchaseOption;
    tournament: CustomTournament;
    phone: string;
    successUrl: string;
    failUrl: string;
    authorizationHeader?: string;
  }): Promise<VivaJoinTransactionResponse> {
    const widgetId = this.pickString(input.booking.vivaWidgetId) ?? this.vivaEndUserWidgetId;
    const exerciseId = this.pickString(input.booking.vivaExerciseId);
    const studioId = this.pickString(input.booking.vivaStudioId);
    if (!widgetId || !exerciseId || !studioId) {
      throw new BadRequestException(
        'Для покупки через Viva нужны widgetId, exerciseId и studioId в details.booking'
      );
    }

    const productType = this.resolveVivaTransactionProductType(
      input.purchaseOption.productType
    );
    const productName = productType === 'SERVICE'
      ? this.pickString(input.purchaseOption.label)
      : undefined;
    const url = new URL(
      `/end-user/api/v1/${encodeURIComponent(widgetId)}/transactions`,
      `${this.vivaEndUserApiBaseUrl}/`
    );
    const payload = {
      products: [
        {
          id: input.purchaseOption.id,
          ...(productName ? { name: productName } : {}),
          type: productType,
          count: 1,
          bookingRequests: [
            {
              exerciseId,
              client: null,
              comment: null,
              marketingAttribution: {}
            }
          ]
        }
      ],
      clientPhone: input.phone,
      paymentMethod: 'WIDGET',
      successUrl: this.buildVivaWidgetPaymentReturnUrl(exerciseId, 'TorneosPADL_paymentsuccess'),
      failUrl: this.buildVivaWidgetPaymentReturnUrl(exerciseId, 'TorneosPADL_paymentfailed'),
      exerciseId,
      studioId,
      promoCode: null
    };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(input.authorizationHeader ? { Authorization: input.authorizationHeader } : {}),
        Origin: 'https://padlhub.ru',
        Referer: 'https://padlhub.ru/'
      },
      body: JSON.stringify(payload),
      signal: this.buildAbortSignal(this.vivaEndUserRequestTimeoutMs)
    });

    const responsePayload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const responseRecord = this.toRecord(responsePayload);
      const responseDetails = this.pickString(
        responseRecord
          ? (
            responseRecord.message
            ?? responseRecord.error
            ?? responseRecord.description
            ?? responseRecord.detail
          )
          : undefined
      );
      throw new BadRequestException(
        responseDetails
          ? `Viva transaction failed with status ${response.status}: ${responseDetails}`
          : `Viva transaction failed with status ${response.status}`
      );
    }

    const checkoutUrl =
      this.findVivaCheckoutUrl(responsePayload)
      ?? this.findVivaCheckoutUrlInHeaders(response.headers);
    const transactionId = this.findVivaTransactionId(responsePayload);

    return {
      transactionId,
      checkoutUrl
    };
  }

  private buildVivaWidgetPaymentReturnUrl(exerciseId: string, flag: string): string {
    const url = new URL('https://padlhub.ru/padel_torneos');
    url.searchParams.set('TorneosPADL_exercise', exerciseId);
    url.searchParams.set(flag, 'true');
    return url.toString();
  }

  private findVivaCheckoutUrl(payload: unknown): string | undefined {
    const exactKeys = new Set([
      'paymenturl',
      'payment_url',
      'paymentlink',
      'payment_link',
      'checkouturl',
      'checkout_url',
      'redirecturl',
      'redirect_url',
      'confirmationurl',
      'confirmation_url',
      'formurl',
      'form_url',
      'href',
      'link',
      'payurl',
      'pay_url',
      'url'
    ]);
    return this.findFirstMatchingString(payload, (key, value) => {
      const normalizedKey = key.toLowerCase().replace(/[\s-]+/g, '_');
      if (!this.isHttpUrl(value)) {
        return false;
      }
      if (/(success|fail|return|callback|webhook|cancel)/i.test(normalizedKey)) {
        return false;
      }
      if (/[?&](?:paymentsuccess|paymentfailed|TorneosPADL_paymentsuccess|TorneosPADL_paymentfailed)=/i.test(value)) {
        return false;
      }
      return exactKeys.has(normalizedKey)
        || /(payment|checkout|redirect|confirmation|form|pay).*(url|link)/i.test(key)
        || /(url|link).*(payment|checkout|redirect|confirmation|form|pay)/i.test(key);
    });
  }

  private findVivaCheckoutUrlInHeaders(headers?: Headers): string | undefined {
    if (!headers) {
      return undefined;
    }
    for (const key of ['location', 'x-payment-url', 'x-checkout-url', 'x-redirect-url']) {
      const value = this.pickString(headers.get(key));
      if (value && this.isHttpUrl(value) && !/api\.vivacrm\.ru/i.test(value)) {
        return value;
      }
    }
    return undefined;
  }

  private findVivaTransactionId(payload: unknown): string | undefined {
    const exactKeys = new Set(['id', 'transactionid', 'transaction_id', 'orderid', 'order_id']);
    return this.findFirstMatchingString(payload, (key, value) => {
      const normalizedKey = key.toLowerCase().replace(/[\s-]+/g, '_');
      return Boolean(value) && exactKeys.has(normalizedKey);
    });
  }

  private findFirstMatchingString(
    value: unknown,
    matches: (key: string, value: string) => boolean,
    key = '',
    seen = new Set<unknown>()
  ): string | undefined {
    const direct = this.pickString(value);
    if (direct && matches(key, direct)) {
      return direct;
    }

    if (!value || typeof value !== 'object' || seen.has(value)) {
      return undefined;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findFirstMatchingString(item, matches, key, seen);
        if (found) {
          return found;
        }
      }
      return undefined;
    }

    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const found = this.findFirstMatchingString(childValue, matches, childKey, seen);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  private async verifyVivaTransaction(input: {
    booking: TournamentBookingConfig;
    transactionId: string;
  }): Promise<{ paid: boolean }> {
    const widgetId = this.pickString(input.booking.vivaWidgetId) ?? this.vivaEndUserWidgetId;
    if (!widgetId) {
      return { paid: false };
    }

    const candidates = [
      `/end-user/api/v1/${encodeURIComponent(widgetId)}/transactions/${encodeURIComponent(input.transactionId)}`,
      `/end-user/api/v1/${encodeURIComponent(widgetId)}/transactions/${encodeURIComponent(input.transactionId)}/status`
    ];

    for (const path of candidates) {
      try {
        const url = new URL(path, `${this.vivaEndUserApiBaseUrl}/`);
        const response = await fetch(url.toString(), {
          headers: { Accept: 'application/json' },
          signal: this.buildAbortSignal(this.vivaEndUserRequestTimeoutMs)
        });
        if (!response.ok) {
          continue;
        }
        const payload = (await response.json().catch(() => null)) as unknown;
        if (this.isVivaPaymentSuccessful(payload)) {
          return { paid: true };
        }
      } catch {
        continue;
      }
    }

    return { paid: false };
  }

  private isVivaPaymentSuccessful(payload: unknown): boolean {
    const normalized = JSON.stringify(payload ?? {}).toUpperCase();
    return normalized.includes('"PAID"')
      || normalized.includes('"SUCCEEDED"')
      || normalized.includes('"SUCCESS"')
      || normalized.includes('"COMPLETED"');
  }

  private findPendingJoinPayment(
    tournament: CustomTournament,
    phone: string
  ): PendingJoinPayment | null {
    const details = this.toRecord(tournament.details) ?? {};
    const booking = this.toRecord(details.booking) ?? {};
    const pending = Array.isArray(booking.pendingJoinPayments) ? booking.pendingJoinPayments : [];
    const normalizedPhone = this.normalizePhone(phone);
    if (!normalizedPhone) {
      return null;
    }
    for (const item of pending) {
      const record = this.toRecord(item);
      if (!record) {
        continue;
      }
      const itemPhone = this.normalizePhone(record.phone);
      const transactionId = this.pickString(record.transactionId);
      if (!itemPhone || !transactionId) {
        continue;
      }
      if (itemPhone !== normalizedPhone) {
        continue;
      }
      return {
        transactionId,
        phone: itemPhone,
        name: this.pickString(record.name) ?? undefined,
        avatarUrl: this.pickNullableString(record.avatarUrl ?? record.photo),
        levelLabel: this.normalizeLevel(this.pickString(record.levelLabel)) ?? undefined,
        notes: this.pickString(record.notes) ?? undefined,
        selectedPurchaseOptionId: this.pickString(record.selectedPurchaseOptionId) ?? undefined,
        createdAt: this.pickString(record.createdAt) ?? new Date().toISOString()
      };
    }
    return null;
  }

  private async savePendingJoinPayment(
    tournament: CustomTournament,
    pending: PendingJoinPayment
  ): Promise<void> {
    const enrichedPending = await this.enrichPendingJoinPaymentWithViva(pending);
    const details = this.toRecord(tournament.details) ?? {};
    const booking = this.toRecord(details.booking) ?? {};
    const current = Array.isArray(booking.pendingJoinPayments) ? booking.pendingJoinPayments : [];
    const next = [
      ...current.filter((item) => {
        const record = this.toRecord(item);
        return this.pickString(record?.transactionId) !== enrichedPending.transactionId;
      }),
      enrichedPending
    ];
    await this.updateCustom(tournament.id, {
      details: {
        ...details,
        booking: {
          ...booking,
          pendingJoinPayments: next
        }
      }
    });
  }

  private async removePendingJoinPayment(
    tournament: CustomTournament,
    transactionId: string
  ): Promise<void> {
    const details = this.toRecord(tournament.details) ?? {};
    const booking = this.toRecord(details.booking) ?? {};
    const current = Array.isArray(booking.pendingJoinPayments) ? booking.pendingJoinPayments : [];
    const next = current.filter((item) => {
      const record = this.toRecord(item);
      return this.pickString(record?.transactionId) !== transactionId;
    });
    await this.updateCustom(tournament.id, {
      details: {
        ...details,
        booking: {
          ...booking,
          pendingJoinPayments: next
        }
      }
    });
  }

  private normalizeClientSubscriptions(value: unknown): TournamentClientSubscription[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const subscriptions: TournamentClientSubscription[] = [];
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      const record = item as Record<string, unknown>;
      const label = this.pickString(record.label) ?? this.pickString(record.name);
      if (!label) {
        return;
      }
      subscriptions.push({
        id:
          this.pickString(record.id)
          ?? this.pickString(record.subscriptionId)
          ?? `client-sub-${index + 1}`,
        label,
        remainingUses: this.pickNumber(record.remainingUses ?? record.remaining ?? record.uses),
        description: this.pickString(record.description) ?? undefined,
        validUntil: this.pickString(record.validUntil ?? record.expiresAt) ?? undefined,
        compatibleTournamentTypes: this.pickStringArray(
          record.compatibleTournamentTypes ?? record.tournamentTypes
        ),
        compatibleAccessLevels: this.pickStringArray(
          record.compatibleAccessLevels ?? record.accessLevels
        ),
        productType: this.normalizeVivaProductType(record.productType ?? record.type)
      });
    });
    return subscriptions;
  }

  private mergeClientSubscriptions(
    left: TournamentClientSubscription[],
    right: TournamentClientSubscription[]
  ): TournamentClientSubscription[] {
    const merged = new Map<string, TournamentClientSubscription>();
    [...left, ...right].forEach((item) => {
      const key = item.id || item.label;
      if (!key) {
        return;
      }
      merged.set(key, {
        ...(merged.get(key) ?? {}),
        ...item
      });
    });
    return Array.from(merged.values());
  }

  private async fetchVivaBookingSubscriptions(
    tournament: CustomTournament,
    phone: string
  ): Promise<TournamentClientSubscription[]> {
    const booking = this.resolveBookingConfig(tournament);
    const exerciseId = this.pickString(booking.vivaExerciseId);
    if (!exerciseId) {
      return [];
    }

    try {
      const url = new URL(
        `/api/v1/exercises/${encodeURIComponent(exerciseId)}/bookings/payment-types`,
        `${this.vivaEndUserApiBaseUrl}/`
      );
      url.searchParams.set('phone', phone);
      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json'
        },
        signal: this.buildAbortSignal(this.vivaEndUserRequestTimeoutMs)
      });
      if (!response.ok) {
        return [];
      }
      const payload = (await response.json().catch(() => null)) as unknown;
      const record = this.toRecord(payload) ?? {};
      return this.normalizeVivaPaymentTypeSubscriptions(record.subscriptions);
    } catch (error) {
      this.logger.warn(
        `Failed to load Viva payment types for tournament ${tournament.id}: ${String(error)}`
      );
      return [];
    }
  }

  private async fetchVivaJoinPurchaseOptions(
    tournament: CustomTournament
  ): Promise<TournamentPurchaseOption[]> {
    const booking = this.resolveBookingConfig(tournament);
    const widgetId = this.pickString(booking.vivaWidgetId) ?? this.vivaEndUserWidgetId;
    const exerciseId = this.pickString(booking.vivaExerciseId);
    if (!widgetId || !exerciseId) {
      return [];
    }

    try {
      const loadCatalog = async (
        path: string,
        productType: 'SUBSCRIPTION' | 'ONE_TIME'
      ): Promise<TournamentPurchaseOption[]> => {
        const url = new URL(
          `/end-user/api/v2/${encodeURIComponent(widgetId)}/products/${path}`,
          `${this.vivaEndUserApiBaseUrl}/`
        );
        url.searchParams.set('exerciseId', exerciseId);
        const response = await fetch(url.toString(), {
          headers: { Accept: 'application/json' },
          signal: this.buildAbortSignal(this.vivaEndUserRequestTimeoutMs)
        });
        if (!response.ok) {
          return [];
        }
        const payload = (await response.json().catch(() => null)) as unknown;
        const record = this.toRecord(payload);
        const list =
          (record && (record.items ?? record.products ?? record.result ?? record.data))
          ?? payload;
        return this.normalizeVivaProductCatalog(list, productType);
      };

      const [subscriptions, oneTimes] = await Promise.all([
        loadCatalog('subscriptions', 'SUBSCRIPTION'),
        loadCatalog('one-times', 'ONE_TIME')
      ]);
      const merged = new Map<string, TournamentPurchaseOption>();
      [...subscriptions, ...oneTimes].forEach((item) => {
        merged.set(item.id, item);
      });
      return Array.from(merged.values());
    } catch (error) {
      this.logger.warn(
        `Failed to load Viva product catalog for tournament ${tournament.id}: ${String(error)}`
      );
      return [];
    }
  }

  private normalizeVivaPaymentTypeSubscriptions(value: unknown): TournamentClientSubscription[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item, index): TournamentClientSubscription | null => {
        const record = this.toRecord(item);
        if (!record) {
          return null;
        }
        const label = this.pickString(record.name) ?? this.pickString(record.label);
        if (!label) {
          return null;
        }
        const visitsLeft = this.pickNumber(record.visitsLeft ?? record.remainingUses);
        const minutesLeft = this.pickNumber(record.availableMinutes);
        const remainingUses =
          visitsLeft !== undefined
            ? visitsLeft
            : minutesLeft !== undefined && minutesLeft > 0
              ? 1
              : undefined;
        return {
          id:
            this.pickString(record.id)
            ?? this.pickString(record.subscriptionId)
            ?? `viva-sub-${index + 1}`,
          label,
          remainingUses,
          validUntil: this.pickString(record.expirationDate ?? record.validUntil) ?? undefined,
          productType: 'SUBSCRIPTION'
        };
      })
      .filter((item): item is TournamentClientSubscription => Boolean(item));
  }

  private resolveSelectedClientSubscription(
    subscriptions: TournamentClientSubscription[],
    selectedSubscriptionId?: string
  ): TournamentClientSubscription | null {
    if (subscriptions.length === 0) {
      return null;
    }
    const selectedId = this.pickString(selectedSubscriptionId);
    if (selectedId) {
      return subscriptions.find((item) => item.id === selectedId) ?? null;
    }
    return subscriptions[0];
  }

  private canCreateVivaTransaction(booking: TournamentBookingConfig): boolean {
    return Boolean(
      (this.pickString(booking.vivaWidgetId) ?? this.vivaEndUserWidgetId)
      && this.pickString(booking.vivaExerciseId)
      && this.pickString(booking.vivaStudioId)
    );
  }

  private isSubscriptionCompatible(
    subscription: TournamentClientSubscription,
    booking: TournamentBookingConfig,
    tournament: CustomTournament,
    levelLabel?: string
  ): boolean {
    const hasRemainingUses =
      subscription.remainingUses === undefined || subscription.remainingUses > 0;
    if (!hasRemainingUses) {
      return false;
    }

    const normalizedSubscriptionLabel = subscription.label.trim().toLowerCase();
    const normalizedLevel = this.normalizeLevel(levelLabel) ?? undefined;
    const matchingRule =
      booking.acceptedSubscriptions.find((rule) => {
        const sameId = rule.id === subscription.id;
        const sameLabel = rule.label.trim().toLowerCase() === normalizedSubscriptionLabel;
        return sameId || sameLabel;
      }) ?? null;

    const ruleOrSubscriptionTypes =
      matchingRule?.compatibleTournamentTypes ?? subscription.compatibleTournamentTypes;
    if (
      Array.isArray(ruleOrSubscriptionTypes)
      && ruleOrSubscriptionTypes.length > 0
      && !ruleOrSubscriptionTypes.includes(tournament.tournamentType)
    ) {
      return false;
    }

    const ruleOrSubscriptionLevels =
      matchingRule?.compatibleAccessLevels ?? subscription.compatibleAccessLevels;
    if (
      normalizedLevel
      && Array.isArray(ruleOrSubscriptionLevels)
      && ruleOrSubscriptionLevels.length > 0
      && !this.isLevelAllowedByList(normalizedLevel, ruleOrSubscriptionLevels)
    ) {
      return false;
    }

    if (booking.acceptedSubscriptions.length === 0) {
      return true;
    }

    return matchingRule !== null;
  }

  private readClientSubscriptionsFromInput(input: RegistrationInput): TournamentClientSubscription[] {
    return this.normalizeClientSubscriptions((input as RegistrationInput & {
      subscriptions?: TournamentClientSubscription[];
    }).subscriptions);
  }

  private composeRegistrationNotes(
    notes: string | undefined,
    payment: TournamentJoinPaymentState,
    selectedPurchaseOptionId?: string
  ): string | undefined {
    const chunks: string[] = [];
    if (notes) {
      chunks.push(notes);
    }
    if (payment.code === 'SUBSCRIPTION_AVAILABLE' && payment.selectedSubscription?.label) {
      chunks.push(`Абонемент списан: ${payment.selectedSubscription.label}`);
    }
    if (payment.code === 'PURCHASE_REQUIRED' && selectedPurchaseOptionId) {
      chunks.push(`Покупка подтверждена: ${selectedPurchaseOptionId}`);
    }
    return chunks.length > 0 ? chunks.join(' | ') : undefined;
  }

  private describeTournamentLevelRange(accessLevels: string[]): string {
    const descriptors = accessLevels
      .map((item) => this.parseLevelDescriptor(item))
      .filter((item): item is TournamentLevelDescriptor => Boolean(item))
      .sort((left, right) => left.rank - right.rank);
    if (descriptors.length === 0) {
      return 'без ограничений по уровню';
    }
    if (descriptors.length === 1) {
      return descriptors[0].label;
    }
    return `${descriptors[0].label} - ${descriptors[descriptors.length - 1].label}`;
  }

  private async publishTournamentToSelectedCommunities(
    tournament: CustomTournament,
    actor?: TournamentActor
  ): Promise<void> {
    if (!this.communitiesService) {
      return;
    }

    const communityIds = this.normalizePublicationCommunityIds(tournament.publicationCommunityIds);
    if (communityIds.length === 0) {
      return;
    }

    for (const communityId of communityIds) {
      try {
        const alreadyPublished = await this.isTournamentPublishedInCommunity(
          communityId,
          tournament
        );
        if (alreadyPublished) {
          continue;
        }

        await this.communitiesService.createFeedItem(communityId, {
          ...this.buildTournamentCommunityFeedPayload(tournament),
          actor: this.toCommunityActor(actor)
        });
      } catch (error) {
        this.logger.warn(
          `Failed to publish tournament ${tournament.id} to community ${communityId}: ${String(error)}`
        );
      }
    }
  }

  private async isTournamentPublishedInCommunity(
    communityId: string,
    tournament: CustomTournament
  ): Promise<boolean> {
    if (!this.communitiesService) {
      return false;
    }

    try {
      const items = await this.communitiesService.listFeedItems(communityId);
      return items.some((item) => this.isTournamentFeedItem(item, tournament));
    } catch (error) {
      this.logger.warn(
        `Failed to check tournament ${tournament.id} feed item in community ${communityId}: ${String(error)}`
      );
      return false;
    }
  }

  private isTournamentFeedItem(item: CommunityFeedItem, tournament: CustomTournament): boolean {
    if (item.kind !== 'TOURNAMENT') {
      return false;
    }

    const rawDetails = this.toRecord(item.details) ?? {};
    const nestedDetails = this.toRecord(rawDetails.details) ?? {};
    const details = {
      ...rawDetails,
      ...nestedDetails
    };

    return Boolean(
      (tournament.id && this.pickString(details.tournamentId) === tournament.id) ||
      (tournament.slug && this.pickString(details.tournamentSlug) === tournament.slug) ||
      (tournament.publicUrl && this.pickString(details.publicUrl) === tournament.publicUrl)
    );
  }

  private buildTournamentCommunityFeedPayload(tournament: CustomTournament) {
    const skin = tournament.skin ?? {};
    const publicTournament = this.toPublicView(tournament);
    const tags = Array.from(
      new Set(
        [
          ...(Array.isArray(skin.tags) ? skin.tags : []),
          'турнир'
        ]
          .map((item) => this.pickString(item))
          .filter((item): item is string => Boolean(item))
      )
    );

    return {
      kind: 'TOURNAMENT' as const,
      title: this.pickString(skin.title) ?? tournament.name,
      body: this.pickString(skin.description) ?? undefined,
      previewLabel: [
        this.pickString(skin.subtitle) ?? tournament.studioName,
        this.formatPublicFeedDate(tournament.startsAt)
      ]
        .filter((item): item is string => Boolean(item))
        .join(' · ') || undefined,
      ctaLabel: this.pickString(skin.ctaLabel) ?? 'Записаться',
      imageUrl: this.pickNullableString(skin.imageUrl) ?? null,
      startAt: this.pickIsoString(tournament.startsAt),
      endAt: this.pickIsoString(tournament.endsAt),
      stationName: this.pickString(tournament.studioName) ?? undefined,
      courtName: this.pickString(tournament.courtName) ?? undefined,
      locationName: this.pickString(tournament.locationName) ?? undefined,
      levelLabel: this.describeTournamentLevelRange(tournament.accessLevels),
      participants: tournament.participants.slice(0, 8).map((participant) => ({
        id: participant.id,
        name: participant.name,
        avatar: participant.avatarUrl ?? null,
        levelLabel: participant.levelLabel
      })),
      tags,
      details: {
        tournamentId: tournament.id,
        tournamentSlug: tournament.slug,
        publicUrl: tournament.publicUrl,
        joinUrl: publicTournament.joinUrl,
        cardVariant: 'TOURNAMENTS_SHOWCASE_COMPACT',
        tournamentType: tournament.tournamentType,
        gender: tournament.gender,
        accessLevels: tournament.accessLevels,
        startsAt: tournament.startsAt,
        endsAt: tournament.endsAt,
        studioName: tournament.studioName,
        courtName: tournament.courtName,
        locationName: tournament.locationName,
        trainerName: tournament.trainerName,
        trainerAvatarUrl: tournament.trainerAvatarUrl ?? null,
        maxPlayers: tournament.maxPlayers,
        participantsCount: Math.max(
          tournament.participants.length,
          Number(tournament.participantsCount || 0) || 0
        ),
        waitlistCount: tournament.waitlist.length,
        skin,
        publicTournament,
        source: 'TOURNAMENT_SERVICE'
      }
    };
  }

  private normalizePublicationCommunityIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .map((item) => this.pickString(item))
          .filter((item): item is string => Boolean(item))
      )
    );
  }

  private toCommunityActor(actor?: TournamentActor): { id?: string; name?: string } | undefined {
    const id = this.pickString(actor?.id);
    const name = this.pickString(actor?.name) ?? this.pickString(actor?.login);
    return id || name ? { ...(id ? { id } : {}), ...(name ? { name } : {}) } : undefined;
  }

  private pickIsoString(value: unknown): string | undefined {
    const text = this.pickString(value);
    if (!text || !Number.isFinite(Date.parse(text))) {
      return undefined;
    }
    return text;
  }

  private formatPublicFeedDate(value: unknown): string | undefined {
    const text = this.pickIsoString(value);
    if (!text) {
      return undefined;
    }

    const formatter = new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow'
    });
    return formatter.format(new Date(text));
  }

  private toPublicView(tournament: CustomTournament): TournamentPublicView {
    const sourceTournamentSnapshot =
      tournament.details && typeof tournament.details === 'object'
        ? (tournament.details.sourceTournamentSnapshot as Record<string, unknown> | undefined)
        : undefined;
    const publicName = this.pickString(tournament.skin?.title) ?? tournament.name;
    const participantsCount = Math.max(
      tournament.participants.length,
      Number(tournament.participantsCount || 0) || 0,
      this.pickNumber(sourceTournamentSnapshot?.participantsCount) ?? 0
    );
    const publicParticipants = this.buildDisplayTournamentParticipants(tournament);

    return {
      id: tournament.id,
      slug: tournament.slug,
      publicUrl: tournament.publicUrl,
      joinUrl: this.buildPublicJoinUrl(tournament.publicUrl),
      name: publicName,
      tournamentType: tournament.tournamentType,
      gender: tournament.gender,
      accessLevels: tournament.accessLevels,
      startsAt: tournament.startsAt,
      endsAt: tournament.endsAt,
      studioName: tournament.studioName,
      courtName: tournament.courtName,
      locationName: tournament.locationName,
      trainerName: tournament.trainerName,
      trainerAvatarUrl: tournament.trainerAvatarUrl ?? null,
      participantsCount,
      paidParticipantsCount: tournament.participants.filter(
        (item) => item.paymentStatus === 'PAID'
      ).length,
      waitlistCount: tournament.waitlist.length,
      maxPlayers: tournament.maxPlayers,
      participants: publicParticipants.map((participant) =>
        this.toPublicParticipantView(participant)
      ),
      waitlist: tournament.waitlist.map((participant) =>
        this.toPublicParticipantView(participant)
      ),
      registrationOpen: this.isTournamentRegistrationOpen(tournament),
      allowedManagerPhonesCount: tournament.allowedManagerPhones.length,
      skin: tournament.skin,
      booking: this.resolveBookingConfig(tournament),
      sourceTournamentId: tournament.sourceTournamentId,
      sourceTournament: sourceTournamentSnapshot
        ? {
            id: this.pickString(sourceTournamentSnapshot.id) ?? tournament.sourceTournamentId ?? '',
            source: (this.pickString(sourceTournamentSnapshot.source) ?? 'VIVA') as Tournament['source'],
            name: this.pickString(sourceTournamentSnapshot.name) ?? tournament.name,
            status:
              ((this.pickString(sourceTournamentSnapshot.status) ?? TournamentStatus.UNKNOWN) as TournamentStatus),
            startsAt: this.pickString(sourceTournamentSnapshot.startsAt) ?? undefined,
            endsAt: this.pickString(sourceTournamentSnapshot.endsAt) ?? undefined,
            studioName: this.pickString(sourceTournamentSnapshot.studioName) ?? undefined,
            courtName: this.pickString(sourceTournamentSnapshot.courtName) ?? undefined,
            locationName: this.pickString(sourceTournamentSnapshot.locationName) ?? undefined,
            trainerName: this.pickString(sourceTournamentSnapshot.trainerName) ?? undefined,
            exerciseTypeId: this.pickString(sourceTournamentSnapshot.exerciseTypeId) ?? undefined
          }
        : undefined
    };
  }

  private toPublicParticipantView(
    participant: TournamentParticipant
  ): Pick<TournamentParticipant, 'id' | 'name' | 'levelLabel' | 'avatarUrl' | 'gender' | 'paymentStatus' | 'status'> {
    return {
      id: participant.id,
      name: participant.name,
      levelLabel: participant.levelLabel,
      avatarUrl: participant.avatarUrl,
      gender: participant.gender,
      paymentStatus: participant.paymentStatus,
      status: participant.status
    };
  }

  private buildDisplayTournamentParticipants(tournament: CustomTournament): TournamentParticipant[] {
    const participants = [...tournament.participants];
    if (participants.length > 0) {
      return participants;
    }
    const seen = new Set<string>();
    participants.forEach((participant) => {
      const key = this.buildParticipantKey(participant);
      if (key) {
        seen.add(key);
      }
    });

    this.getPendingJoinPayments(tournament).forEach((payment, index) => {
      const participant = this.pendingJoinPaymentToParticipant(payment, index);
      const participantKey = this.buildParticipantKey(participant);
      if (participantKey && seen.has(participantKey)) {
        return;
      }
      if (participantKey) {
        seen.add(participantKey);
      }
      const key = participant.id ? `pending:${participant.id}` : '';
      if (key && seen.has(key)) {
        return;
      }
      if (key) {
        seen.add(key);
      }
      participants.push(participant);
    });

    return participants;
  }

  private getPendingJoinPayments(tournament: CustomTournament): PendingJoinPayment[] {
    const details = this.toRecord(tournament.details) ?? {};
    const booking = this.toRecord(details.booking) ?? {};
    const pending = Array.isArray(booking.pendingJoinPayments) ? booking.pendingJoinPayments : [];
    return pending
      .map((item): PendingJoinPayment | null => {
        const record = this.toRecord(item);
        if (!record) {
          return null;
        }
        const transactionId = this.pickString(record.transactionId);
        const phone = this.normalizePhone(record.phone);
        if (!transactionId || !phone) {
          return null;
        }
        return {
          transactionId,
          phone,
          name: this.pickString(record.name) ?? undefined,
          avatarUrl: this.pickNullableString(record.avatarUrl ?? record.photo),
          levelLabel: this.normalizeLevel(this.pickString(record.levelLabel)) ?? undefined,
          notes: this.pickString(record.notes) ?? undefined,
          selectedPurchaseOptionId: this.pickString(record.selectedPurchaseOptionId) ?? undefined,
          createdAt: this.pickString(record.createdAt) ?? new Date().toISOString()
        };
      })
      .filter((item): item is PendingJoinPayment => Boolean(item));
  }

  private pendingJoinPaymentToParticipant(
    payment: PendingJoinPayment,
    index: number
  ): TournamentParticipant {
    return {
      id: payment.transactionId,
      name: payment.name ?? payment.phone ?? `Заявка ${index + 1}`,
      phone: payment.phone,
      avatarUrl: payment.avatarUrl,
      levelLabel: payment.levelLabel,
      paymentStatus: 'UNPAID',
      status: 'REGISTERED',
      registeredAt: payment.createdAt,
      notes: 'Ожидает оплаты'
    };
  }

  private buildPublicJoinUrl(publicUrl: string): string {
    const normalized = String(publicUrl ?? '')
      .trim()
      .replace(/\/+$/, '');
    return normalized ? `${normalized}/join` : '';
  }

  private isTournamentRegistrationOpen(tournament: CustomTournament): boolean {
    return (
      tournament.status !== TournamentStatus.FINISHED
      && tournament.status !== TournamentStatus.CANCELED
    );
  }

  private findParticipantByPhone(
    participants: TournamentParticipant[],
    normalizedPhone: string
  ): TournamentParticipant | undefined {
    return participants.find((item) => this.normalizePhone(item.phone) === normalizedPhone);
  }

  private normalizePhone(value: unknown): string | null {
    const text = String(value ?? '').trim();
    if (!text) {
      return null;
    }

    const digits = text.replace(/\D+/g, '');
    if (!digits) {
      return null;
    }
    if (digits.length === 10) {
      return `7${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `7${digits.slice(1)}`;
    }
    return digits;
  }

  private async enrichTournamentVivaProfiles(
    tournament: CustomTournament
  ): Promise<CustomTournament> {
    const participants = await Promise.all(
      tournament.participants.map((participant) => this.enrichTournamentParticipantWithViva(participant))
    );
    const waitlist = await Promise.all(
      tournament.waitlist.map((participant) => this.enrichTournamentParticipantWithViva(participant))
    );
    const pendingJoinPayments = await Promise.all(
      this.getPendingJoinPayments(tournament).map((payment) =>
        this.enrichPendingJoinPaymentWithViva(payment)
      )
    );

    return {
      ...tournament,
      details: this.mergePendingJoinPaymentsIntoDetails(tournament, pendingJoinPayments),
      trainerAvatarUrl:
        tournament.trainerAvatarUrl
        ?? this.pickNullableString(this.getSourceTournamentSnapshot(tournament).trainerAvatarUrl)
        ?? undefined,
      participants,
      participantsCount: Math.max(
        participants.length,
        Number(tournament.participantsCount || 0) || 0,
        this.pickNumber(this.getSourceTournamentSnapshot(tournament).participantsCount) ?? 0
      ),
      paidParticipantsCount: participants.filter((item) => item.paymentStatus === 'PAID').length,
      waitlist,
      waitlistCount: waitlist.length
    };
  }

  private mergePendingJoinPaymentsIntoDetails(
    tournament: CustomTournament,
    pendingJoinPayments: PendingJoinPayment[]
  ): CustomTournament['details'] {
    const details = this.toRecord(tournament.details) ?? {};
    const booking = this.toRecord(details.booking) ?? {};
    if (pendingJoinPayments.length === 0 && !Array.isArray(booking.pendingJoinPayments)) {
      return tournament.details;
    }
    return {
      ...details,
      booking: {
        ...booking,
        pendingJoinPayments
      }
    };
  }

  private async enrichTournamentParticipantWithViva(
    participant: TournamentParticipant
  ): Promise<TournamentParticipant> {
    const normalizedPhone = this.normalizePhone(participant.phone);
    if (!normalizedPhone) {
      return participant;
    }

    const vivaAdminService = this.vivaAdminService;
    const fallbackName = this.resolveTournamentParticipantName(participant.name, normalizedPhone);
    const needsVivaLookup =
      this.isGenericTournamentParticipantName(participant.name)
      || this.isPhoneLikeValue(participant.name)
      || !participant.avatarUrl;

    if (!vivaAdminService || !needsVivaLookup) {
      return {
        ...participant,
        name: fallbackName,
        phone: normalizedPhone
      };
    }

    try {
      const lookup = await vivaAdminService.lookupClientCabinetByPhone(normalizedPhone);
      if (!lookup || lookup.status !== 'FOUND') {
        return {
          ...participant,
          name: fallbackName,
          phone: normalizedPhone
        };
      }

      return {
        ...participant,
        id: participant.id ?? lookup.vivaClientId ?? undefined,
        name: this.resolveTournamentParticipantName(
          lookup.displayName ?? participant.name,
          normalizedPhone
        ),
        phone: normalizedPhone,
        avatarUrl: participant.avatarUrl ?? lookup.avatarUrl ?? undefined
      };
    } catch (error) {
      this.logger.warn(
        `Failed to enrich tournament participant ${normalizedPhone} from Viva: ${String(error)}`
      );
      return {
        ...participant,
        name: fallbackName,
        phone: normalizedPhone
      };
    }
  }

  private async enrichPendingJoinPaymentWithViva(
    payment: PendingJoinPayment
  ): Promise<PendingJoinPayment> {
    const participant = await this.enrichTournamentParticipantWithViva({
      id: payment.transactionId,
      name: payment.name ?? payment.phone,
      phone: payment.phone,
      avatarUrl: payment.avatarUrl,
      levelLabel: payment.levelLabel,
      paymentStatus: 'UNPAID',
      status: 'REGISTERED',
      registeredAt: payment.createdAt,
      notes: payment.notes
    });

    return {
      ...payment,
      phone: this.normalizePhone(payment.phone) ?? payment.phone,
      name: participant.name,
      avatarUrl: participant.avatarUrl,
      levelLabel: participant.levelLabel
    };
  }

  private resolveTournamentParticipantName(value: unknown, phone?: string): string {
    const name = this.pickString(value);
    if (!name || this.isPhoneLikeValue(name) || this.isGenericTournamentParticipantName(name)) {
      return this.buildTournamentParticipantFallbackName(phone);
    }
    return name;
  }

  private buildTournamentParticipantFallbackName(phone?: string): string {
    const digits = String(phone ?? '').replace(/\D+/g, '');
    const suffix = digits.length >= 4 ? digits.slice(-4) : '';
    return suffix ? `Игрок ${suffix}` : 'Игрок';
  }

  private isGenericTournamentParticipantName(value: unknown): boolean {
    return /^игрок$/i.test(String(value ?? '').trim());
  }

  private isPhoneLikeValue(value: unknown): boolean {
    const digits = String(value ?? '').replace(/\D+/g, '');
    return digits.length >= 10;
  }

  private isLevelAllowedByList(levelLabel: string, allowedLevels: string[]): boolean {
    const candidate = this.parseLevelDescriptor(levelLabel);
    if (!candidate) {
      return false;
    }

    return allowedLevels
      .map((item) => this.parseLevelDescriptor(item))
      .filter((item): item is TournamentLevelDescriptor => Boolean(item))
      .some(
        (allowed) =>
          allowed.minScore <= candidate.maxScore && allowed.maxScore >= candidate.minScore
      );
  }

  private parseLevelDescriptor(value: unknown): TournamentLevelDescriptor | null {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/,/g, '.')
      .replace(/[·•]/g, ' ')
      .replace(/\s+/g, ' ');
    if (!normalized) {
      return null;
    }

    const directScoreToken = this.normalizeLevelScoreToken(normalized);
    if (directScoreToken) {
      return this.createExactLevelDescriptor(Number(directScoreToken));
    }

    const bases = [...TOURNAMENT_BASE_LEVELS].sort((left, right) => right.length - left.length);
    const base = bases.find((item) => {
      if (normalized === item) {
        return true;
      }
      if (!normalized.startsWith(item)) {
        return false;
      }
      const nextChar = normalized.charAt(item.length);
      return nextChar === ':' || nextChar === '-' || nextChar === ' ' || nextChar === '';
    });
    if (!base) {
      return null;
    }

    const baseIndex = TOURNAMENT_BASE_LEVELS.indexOf(base);
    if (baseIndex < 0) {
      return null;
    }
    const baseRange = this.getLevelBaseRange(base);
    if (!baseRange) {
      return null;
    }

    const remainder = normalized.slice(base.length).replace(/^[:\-\s]+/, '');
    if (!remainder) {
      return {
        token: base,
        base,
        step: null,
        label: base,
        rank: baseIndex * TOURNAMENT_LEVEL_DIVISION_COUNT,
        minScore: baseRange.start,
        maxScore: baseRange.end
      };
    }

    const remainderScoreToken = this.normalizeLevelScoreToken(remainder);
    if (remainderScoreToken) {
      const numericScore = Number(remainderScoreToken);
      if (numericScore >= baseRange.start - 0.0001 && numericScore <= baseRange.end + 0.0001) {
        return this.createExactLevelDescriptor(numericScore);
      }
      return null;
    }

    const legacyScore = this.resolveLegacyLevelScore(base, remainder);
    if (legacyScore === null) {
      return null;
    }
    return this.createExactLevelDescriptor(legacyScore);
  }

  private createExactLevelDescriptor(score: number): TournamentLevelDescriptor | null {
    const token = this.normalizeLevelScoreToken(score);
    if (!token) {
      return null;
    }

    const numericScore = Number(token);
    const base = this.resolveLevelBaseByScore(numericScore);
    if (!base) {
      return null;
    }

    const baseRange = this.getLevelBaseRange(base);
    const baseIndex = TOURNAMENT_BASE_LEVELS.indexOf(base);
    if (!baseRange || baseIndex < 0) {
      return null;
    }

    return {
      token,
      base,
      step: Math.round((numericScore - baseRange.start) * TOURNAMENT_LEVEL_DIVISION_COUNT),
      label: base,
      rank: this.findLevelRankByToken(token),
      minScore: numericScore,
      maxScore: numericScore
    };
  }

  private getLevelBaseRange(base: string): { start: number; end: number } | null {
    const band = TOURNAMENT_LEVEL_BANDS.find((item) => item.base === base);
    if (!band) {
      return null;
    }
    return {
      start: band.min,
      end: band.max
    };
  }

  private resolveLevelBaseByScore(score: number): (typeof TOURNAMENT_BASE_LEVELS)[number] | null {
    if (!Number.isFinite(score)) {
      return null;
    }

    const matched = TOURNAMENT_LEVEL_BANDS.find((band, index) => {
      if (index === TOURNAMENT_LEVEL_BANDS.length - 1) {
        return score >= band.min - 0.0001;
      }
      return score >= band.min - 0.0001 && score < band.max - 0.0001;
    });
    return matched?.base ?? null;
  }

  private formatLevelScoreToken(value: number): string {
    return Number(value ?? 0)
      .toFixed(3)
      .replace(/0+$/, '')
      .replace(/\.$/, '');
  }

  private normalizeLevelScoreToken(value: unknown): string | null {
    const normalized = String(value ?? '')
      .trim()
      .replace(/,/g, '.');
    if (!normalized) {
      return null;
    }

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    if (numeric < TOURNAMENT_LEVEL_BANDS[0].min || numeric > TOURNAMENT_LEVEL_BANDS[TOURNAMENT_LEVEL_BANDS.length - 1].max) {
      return null;
    }

    const token = this.formatLevelScoreToken(numeric);
    return this.findLevelRankByToken(token) >= 0 ? token : null;
  }

  private resolveLegacyLevelScore(base: string, value: string): number | null {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
    const baseRange = this.getLevelBaseRange(base);
    if (!normalized || !baseRange) {
      return null;
    }

    const matched = TOURNAMENT_LEVEL_LEGACY_ALIASES.find((item) =>
      item.aliases.some((alias) => normalized.includes(alias))
    );
    return matched ? baseRange.start + matched.offset : null;
  }

  private findLevelRankByToken(token: string): number {
    const normalized = this.formatLevelScoreToken(Number(token));
    let rank = 0;
    for (const [bandIndex, band] of TOURNAMENT_LEVEL_BANDS.entries()) {
      for (let step = 0; step <= TOURNAMENT_LEVEL_DIVISION_COUNT; step += 1) {
        if (bandIndex > 0 && step === 0) {
          continue;
        }
        const value = band.min + (band.max - band.min) * (step / TOURNAMENT_LEVEL_DIVISION_COUNT);
        if (this.formatLevelScoreToken(value) === normalized) {
          return rank;
        }
        rank += 1;
      }
    }
    return -1;
  }

  private normalizeLevel(value?: string): string | null {
    return this.parseLevelDescriptor(value)?.token ?? null;
  }

  private normalizeWaitlistReason(
    value: unknown
  ): 'FULL' | 'LEVEL_MISMATCH' | 'MANUAL' | null {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase();
    if (normalized === 'FULL' || normalized === 'LEVEL_MISMATCH' || normalized === 'MANUAL') {
      return normalized;
    }
    return null;
  }

  private pickNullableString(value: unknown): string | null | undefined {
    if (value === null) {
      return null;
    }
    return this.pickString(value);
  }

  private pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private normalizeBaseUrl(value?: string): string | undefined {
    const normalized = this.pickString(value);
    return normalized ? normalized.replace(/\/+$/, '') : undefined;
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] ?? '');
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.floor(raw);
  }

  private buildAbortSignal(timeoutMs: number): AbortSignal | undefined {
    const abortSignalTimeout = (AbortSignal as typeof AbortSignal & {
      timeout?: (delay: number) => AbortSignal;
    }).timeout;

    return typeof abortSignalTimeout === 'function'
      ? abortSignalTimeout(timeoutMs)
      : undefined;
  }

  private normalizeFilterValues(values?: string[]): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return Array.from(
      new Set(
        values
          .map((value) => this.normalizeFilterValue(value))
          .filter((value): value is string => Boolean(value))
      )
    );
  }

  private normalizeFilterValue(value: unknown): string | null {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    return normalized || null;
  }

  private normalizePublicLimit(limit?: number): number {
    const numericLimit = Number(limit);
    if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
      return PUBLIC_TOURNAMENTS_LIMIT_DEFAULT;
    }

    return Math.min(
      PUBLIC_TOURNAMENTS_LIMIT_MAX,
      Math.max(1, Math.floor(numericLimit))
    );
  }

  private normalizePublicForwardDays(forwardDays?: number): number {
    const numericForwardDays = Number(forwardDays);
    if (!Number.isFinite(numericForwardDays) || numericForwardDays <= 0) {
      return PUBLIC_TOURNAMENTS_FORWARD_DAYS;
    }

    return Math.min(120, Math.max(1, Math.floor(numericForwardDays)));
  }

  private normalizePublicDate(value?: string): string | undefined {
    const text = this.pickString(value);
    if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return undefined;
    }
    return text;
  }

  private formatPublicDateKey(date: Date): string {
    return [
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  private pickNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }

    const normalized = this.pickString(value);
    if (!normalized) {
      return undefined;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
  }

  private pickStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const items = value
      .map((item) => this.pickString(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items : undefined;
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private normalizeGender(value: unknown): TournamentGender | undefined {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase();
    if (normalized === 'MALE' || normalized === 'FEMALE' || normalized === 'MIXED') {
      return normalized as TournamentGender;
    }
    return undefined;
  }
}

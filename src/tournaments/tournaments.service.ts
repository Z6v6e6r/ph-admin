import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { RequestUser } from '../common/rbac/request-user.interface';
import { GamesService } from '../games/games.service';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
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
}

const PUBLIC_TOURNAMENTS_LIMIT_DEFAULT = 24;
const PUBLIC_TOURNAMENTS_LIMIT_MAX = 48;
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

  constructor(
    private readonly lkPadelHubClient: LkPadelHubClientService,
    private readonly vivaTournamentsService: VivaTournamentsService,
    private readonly gamesService: GamesService,
    private readonly tournamentsPersistence: TournamentsPersistenceService,
    private readonly americanoScheduleService: AmericanoScheduleService,
    private readonly americanoRatingSimulationService: AmericanoRatingSimulationService
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
    return this.hydrateCustomTournament(tournament);
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
    return this.hydrateCustomTournament(created);
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
    return this.hydrateCustomTournament(updated);
  }

  async getPublicBySlug(slug: string): Promise<TournamentPublicView> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    return this.toPublicView(tournament);
  }

  async listPublicDirectory(options?: {
    limit?: number;
    stationIds?: string[];
    includePast?: boolean;
  }): Promise<TournamentPublicDirectoryResponse> {
    this.ensurePersistenceEnabled();
    const limit = this.normalizePublicLimit(options?.limit);
    const stationIds = this.normalizeFilterValues(options?.stationIds);
    const includePast = options?.includePast === true;
    const tournaments = await this.listHydratedCustomTournamentsSafe();

    const items = tournaments
      .filter((tournament) =>
        this.matchesPublicTournamentFilters(tournament, {
          stationIds,
          includePast
        })
      )
      .sort((left, right) => this.comparePublicTournaments(left, right))
      .slice(0, limit)
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
    const tournament = await this.requireCustomBySlug(slug);
    const publicTournament = this.toPublicView(tournament);
    const normalizedPhone = this.normalizePhone(client.phone) ?? undefined;
    const normalizedLevel = this.normalizeLevel(client.levelLabel) ?? undefined;
    const access = this.evaluateAccess(tournament, normalizedLevel);
    const payment = this.resolveJoinPayment(tournament, client, normalizedLevel);
    const normalizedClient: TournamentPublicClientProfile = {
      ...client,
      phone: normalizedPhone,
      levelLabel: normalizedLevel,
      onboardingCompleted: Boolean(normalizedLevel),
      subscriptions: this.normalizeClientSubscriptions(client.subscriptions)
    };
    const requireAuth = options?.requireAuth === true;
    const missingFields: Array<'phone' | 'levelLabel'> = [];

    if (requireAuth && !normalizedClient.authorized) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message:
          'Чтобы присоединиться к турниру, сначала войдите в личный кабинет PadelHub.',
        tournament: publicTournament,
        client: normalizedClient,
        access,
        missingFields: [],
        waitlistAllowed: false,
        payment,
        authRequired: true
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
      normalizedLevel
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

    const participant: TournamentParticipant = {
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
    };

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
        { ...participant, status: 'WAITLIST' as const }
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

    const participant: TournamentParticipant = {
      name: String(input.name || '').trim() || normalizedPhone,
      phone: normalizedPhone,
      levelLabel: this.normalizeLevel(input.levelLabel) ?? undefined,
      gender: input.gender ?? 'MIXED',
      paymentStatus: 'UNPAID',
      status: 'WAITLIST' as const,
      registeredAt: new Date().toISOString(),
      notes: this.pickString(input.notes) ?? undefined
    };

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
    return Promise.all(
      tournaments.map(async (tournament) => {
        try {
          return await this.hydrateCustomTournament(tournament);
        } catch (error) {
          this.logger.warn(
            `Failed to hydrate public tournament ${tournament.id}: ${String(error)}`
          );
          return tournament;
        }
      })
    );
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
    const sourceTournaments = await this.listSourceTournaments();
    return sourceTournaments.find((item) => item.id === id) ?? null;
  }

  private matchesPublicTournamentFilters(
    tournament: CustomTournament,
    options: {
      stationIds: string[];
      includePast: boolean;
    }
  ): boolean {
    if (
      !options.includePast &&
      (tournament.status === TournamentStatus.FINISHED
        || tournament.status === TournamentStatus.CANCELED)
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
      slug: this.pickString(mutation.slug) ?? undefined,
      studioId: this.pickString(mutation.studioId) ?? sourceTournament.studioId,
      studioName: this.pickString(mutation.studioName) ?? sourceTournament.studioName,
      trainerId: this.pickString(mutation.trainerId) ?? sourceTournament.trainerId,
      trainerName: this.pickString(mutation.trainerName) ?? sourceTournament.trainerName,
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
      slug: mutation.slug,
      studioId: mutation.studioId,
      studioName: mutation.studioName,
      trainerId: mutation.trainerId,
      trainerName: mutation.trainerName,
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
      trainerId: sourceTournament.trainerId,
      trainerName: sourceTournament.trainerName,
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

  private mergeCustomWithSourceTournament(
    tournament: CustomTournament,
    sourceTournament?: Tournament
  ): CustomTournament {
    const sourceTournamentSnapshot = sourceTournament
      ? this.buildSourceTournamentSnapshot(sourceTournament)
      : this.getSourceTournamentSnapshot(tournament);
    const sourceParticipants = this.readSnapshotParticipants(sourceTournamentSnapshot);
    const mergedParticipants = this.mergeTournamentParticipants(
      sourceParticipants,
      tournament.participants
    );
    const paidParticipantsCount = mergedParticipants.filter(
      (item) => item.paymentStatus === 'PAID'
    ).length;
    const sourceParticipantsCount =
      this.pickNumber(sourceTournamentSnapshot.participantsCount) ?? sourceParticipants.length;
    const mergedParticipantsCount = Math.max(
      mergedParticipants.length,
      sourceParticipantsCount,
      Number(tournament.participantsCount || 0)
    );

    return {
      ...tournament,
      maxPlayers:
        Number(tournament.maxPlayers || 0) ||
        this.pickNumber(sourceTournamentSnapshot.maxPlayers) ||
        8,
      mechanics: this.buildDefaultTournamentMechanics({
        existing: tournament.mechanics,
        tournamentType:
          tournament.tournamentType ?? this.pickString(sourceTournamentSnapshot.tournamentType),
        maxPlayers:
          Number(tournament.maxPlayers || 0) ||
          this.pickNumber(sourceTournamentSnapshot.maxPlayers) ||
          8
      }),
      participants: mergedParticipants,
      participantsCount: mergedParticipantsCount,
      paidParticipantsCount:
        paidParticipantsCount > 0 ? paidParticipantsCount : tournament.paidParticipantsCount,
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
    customParticipants: TournamentParticipant[]
  ): TournamentParticipant[] {
    const merged: TournamentParticipant[] = [];
    const indexes = new Map<string, number>();

    sourceParticipants.forEach((participant) => {
      const key = this.buildParticipantKey(participant);
      indexes.set(key, merged.length);
      merged.push({ ...participant });
    });

    customParticipants.forEach((participant) => {
      const key = this.buildParticipantKey(participant);
      const existingIndex = indexes.get(key);
      if (existingIndex === undefined) {
        indexes.set(key, merged.length);
        merged.push({ ...participant });
        return;
      }

      merged[existingIndex] = {
        ...merged[existingIndex],
        ...participant
      };
    });

    return merged;
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
      gender: this.normalizeGender(record.gender),
      paymentStatus:
        paymentStatus === 'PAID' ? 'PAID' : paymentStatus === 'UNPAID' ? 'UNPAID' : undefined,
      status: status === 'WAITLIST' ? 'WAITLIST' : 'REGISTERED',
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

    if (!tournament.accessLevels.includes(normalizedLevel)) {
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
    levelLabel?: string
  ): TournamentJoinPaymentState {
    const booking = this.resolveBookingConfig(tournament);
    if (!booking.required) {
      return {
        required: false,
        code: 'NOT_REQUIRED',
        message: 'Дополнительная оплата для участия в турнире не требуется.',
        availableSubscriptions: [],
        purchaseOptions: booking.purchaseOptions,
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
        purchaseOptions: booking.purchaseOptions,
        purchaseFlowUrl: booking.purchaseFlowUrl
      };
    }

    return {
      required: true,
      code: 'PURCHASE_REQUIRED',
      message: 'Подходящий абонемент не найден. Сначала нужно купить участие.',
      availableSubscriptions: [],
      purchaseOptions: booking.purchaseOptions,
      purchaseFlowUrl: booking.purchaseFlowUrl
    };
  }

  private resolveBookingConfig(tournament: CustomTournament): TournamentBookingConfig {
    const details =
      tournament.details && typeof tournament.details === 'object'
        ? (tournament.details as Record<string, unknown>)
        : {};
    const rawBooking = this.toRecord(details.booking) ?? this.toRecord(details.joinFlow) ?? {};
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
      purchaseFlowUrl: this.pickString(rawBooking.purchaseFlowUrl ?? rawBooking.purchaseUrl) ?? undefined
    };
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
        description: this.pickString(record.description) ?? undefined
      });
    });
    return items;
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
        )
      });
    });
    return subscriptions;
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
      && !ruleOrSubscriptionLevels.includes(normalizedLevel)
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
    const normalized = accessLevels
      .map((item) => this.normalizeLevel(item))
      .filter((item): item is string => Boolean(item));
    if (normalized.length === 0) {
      return 'без ограничений по уровню';
    }
    if (normalized.length === 1) {
      return normalized[0];
    }
    return `${normalized[0]} - ${normalized[normalized.length - 1]}`;
  }

  private toPublicView(tournament: CustomTournament): TournamentPublicView {
    const sourceTournamentSnapshot =
      tournament.details && typeof tournament.details === 'object'
        ? (tournament.details.sourceTournamentSnapshot as Record<string, unknown> | undefined)
        : undefined;
    const publicName = this.pickString(tournament.skin?.title) ?? tournament.name;

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
      trainerName: tournament.trainerName,
      participantsCount: tournament.participants.length,
      paidParticipantsCount: tournament.participants.filter(
        (item) => item.paymentStatus === 'PAID'
      ).length,
      waitlistCount: tournament.waitlist.length,
      maxPlayers: tournament.maxPlayers,
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
            trainerName: this.pickString(sourceTournamentSnapshot.trainerName) ?? undefined,
            exerciseTypeId: this.pickString(sourceTournamentSnapshot.exerciseTypeId) ?? undefined
          }
        : undefined
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

  private normalizeLevel(value?: string): string | null {
    const cleaned = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
    return cleaned || null;
  }

  private pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
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

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import { VivaTournamentsService } from '../integrations/viva/viva-tournaments.service';
import {
  CreateCustomTournamentMutation,
  TournamentsPersistenceService,
  UpdateCustomTournamentMutation
} from './tournaments-persistence.service';
import {
  CustomTournament,
  Tournament,
  TournamentAccessCheckResponse,
  TournamentGender,
  TournamentMechanicsAccessResponse,
  TournamentParticipant,
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
}

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly lkPadelHubClient: LkPadelHubClientService,
    private readonly vivaTournamentsService: VivaTournamentsService,
    private readonly tournamentsPersistence: TournamentsPersistenceService
  ) {}

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
    return tournament;
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

    return this.tournamentsPersistence.createCustomTournament(normalizedMutation);
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
    return updated;
  }

  async getPublicBySlug(slug: string): Promise<TournamentPublicView> {
    this.ensurePersistenceEnabled();
    const tournament = await this.requireCustomBySlug(slug);
    return this.toPublicView(tournament);
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

    const participant: TournamentParticipant = {
      name: String(input.name || '').trim() || normalizedPhone,
      phone: normalizedPhone,
      levelLabel: this.normalizeLevel(input.levelLabel) ?? undefined,
      gender: input.gender ?? 'MIXED',
      paymentStatus: 'UNPAID',
      status: 'REGISTERED' as const,
      registeredAt: new Date().toISOString(),
      notes: this.pickString(input.notes) ?? undefined
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
        participant: nextWaitlist[nextWaitlist.length - 1]
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

  private async findCustomTournamentByIdSafe(id: string): Promise<CustomTournament | null> {
    if (!this.tournamentsPersistence.isEnabled()) {
      return null;
    }

    try {
      return await this.tournamentsPersistence.findCustomTournamentById(id);
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
      return await this.tournamentsPersistence.findCustomTournamentBySourceTournamentId(
        sourceTournamentId
      );
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

  private enrichSourceTournament(
    tournament: Tournament,
    customTournament?: CustomTournament
  ): Tournament {
    if (!customTournament) {
      return {
        ...tournament,
        linkedCustomTournamentId: undefined,
        publicUrl: undefined,
        slug: undefined,
        tournamentType: undefined,
        accessLevels: undefined,
        gender: undefined,
        maxPlayers: undefined,
        participantsCount: undefined,
        paidParticipantsCount: undefined,
        waitlistCount: undefined,
        allowedManagerPhones: undefined,
        skin: undefined
      };
    }

    return {
      ...tournament,
      linkedCustomTournamentId: customTournament.id,
      sourceTournamentId: customTournament.sourceTournamentId,
      slug: customTournament.slug,
      publicUrl: customTournament.publicUrl,
      tournamentType: customTournament.tournamentType,
      accessLevels: customTournament.accessLevels,
      gender: customTournament.gender,
      maxPlayers: customTournament.maxPlayers,
      participantsCount: customTournament.participantsCount,
      paidParticipantsCount: customTournament.paidParticipantsCount,
      waitlistCount: customTournament.waitlistCount,
      allowedManagerPhones: customTournament.allowedManagerPhones,
      skin: customTournament.skin
    };
  }

  private toTournamentListItem(tournament: CustomTournament): Tournament {
    return {
      ...tournament,
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
      tournamentType: this.pickString(mutation.tournamentType) ?? 'AMERICANO',
      accessLevels: Array.isArray(mutation.accessLevels) ? mutation.accessLevels : [],
      gender: mutation.gender ?? 'MIXED',
      maxPlayers: Number(mutation.maxPlayers || 0) || 8,
      participants: Array.isArray(mutation.participants) ? mutation.participants : [],
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
      skin: mutation.skin
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
      exerciseTypeId: sourceTournament.exerciseTypeId
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
    return tournament;
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

  private toPublicView(tournament: CustomTournament): TournamentPublicView {
    const sourceTournamentSnapshot =
      tournament.details && typeof tournament.details === 'object'
        ? (tournament.details.sourceTournamentSnapshot as Record<string, unknown> | undefined)
        : undefined;

    return {
      id: tournament.id,
      slug: tournament.slug,
      publicUrl: tournament.publicUrl,
      name: tournament.name,
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
      allowedManagerPhonesCount: tournament.allowedManagerPhones.length,
      skin: tournament.skin,
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
}

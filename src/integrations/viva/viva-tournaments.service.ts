import { Injectable, Logger } from '@nestjs/common';
import {
  Tournament,
  TournamentParticipant,
  TournamentPaymentStatus,
  TournamentStatus
} from '../../tournaments/tournaments.types';

interface VivaEntitySummary {
  id: string;
  name?: string;
  avatarUrl?: string | null;
}

interface VivaExerciseTypeResolution {
  id?: string;
  name?: string;
}

type VivaRawRecord = Record<string, unknown>;

@Injectable()
export class VivaTournamentsService {
  private readonly logger = new Logger(VivaTournamentsService.name);
  private readonly apiBaseUrl =
    this.normalizeBaseUrl(process.env.VIVA_END_USER_API_BASE_URL) ||
    this.normalizeBaseUrl(process.env.VIVA_ADMIN_API_BASE_URL) ||
    'https://api.vivacrm.ru';
  private readonly widgetId =
    this.normalizeString(process.env.VIVA_END_USER_WIDGET_ID) || 'iSkq6G';
  private readonly exerciseTypeIds = this.readStringListEnv(
    'VIVA_TOURNAMENT_EXERCISE_TYPE_IDS',
    ['839', '1013']
  );
  private readonly lookaheadDays = this.readPositiveNumberEnv(
    'VIVA_TOURNAMENT_LOOKAHEAD_DAYS',
    45
  );
  private readonly requestTimeoutMs = this.readPositiveNumberEnv(
    'VIVA_END_USER_TIMEOUT_MS',
    5000
  );

  async listTournaments(): Promise<Tournament[] | null> {
    if (!this.widgetId) {
      return null;
    }

    try {
      return await this.loadTournaments();
    } catch (error) {
      this.logger.warn(`Failed to load Viva tournaments: ${String(error)}`);
      return null;
    }
  }

  async findTournamentById(id: string): Promise<Tournament | null> {
    const normalizedId = this.normalizeString(id);
    if (!normalizedId || !this.widgetId) {
      return null;
    }

    const detailed = await this.loadTournamentDetails(normalizedId);
    if (detailed) {
      return detailed;
    }

    const tournaments = await this.listTournaments();
    const fallback = tournaments?.find((tournament) => tournament.id === normalizedId) ?? null;
    if (!fallback) {
      return null;
    }

    const related = await this.fetchRelatedParticipantRecords(normalizedId);
    const participants = this.resolveParticipants({
      clients: related,
      participants: related,
      registrations: related
    });
    if (participants.length === 0) {
      return fallback;
    }

    return {
      ...fallback,
      participants,
      participantsCount: participants.length
    };
  }

  async createTournamentBooking(input: {
    exerciseId?: string;
    phone?: string;
    name?: string;
    comment?: string;
    authorizationHeader?: string;
  }): Promise<boolean> {
    const exerciseId = this.normalizeString(input.exerciseId);
    const phone = this.readPhone(input.phone);
    if (!this.widgetId || !exerciseId || !phone) {
      return false;
    }

    const payload = {
      exerciseId,
      clientPhone: phone,
      phone,
      clientName: this.normalizeString(input.name) ?? phone,
      name: this.normalizeString(input.name) ?? phone,
      comment: this.normalizeString(input.comment) ?? null,
      marketingAttribution: {}
    };
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(input.authorizationHeader ? { Authorization: input.authorizationHeader } : {}),
      Origin: 'https://padlhub.ru',
      Referer: 'https://padlhub.ru/'
    };
    const paths = [
      `/end-user/api/v1/${encodeURIComponent(this.widgetId)}/exercises/${encodeURIComponent(exerciseId)}/bookings`,
      `/api/v1/exercises/${encodeURIComponent(exerciseId)}/bookings`
    ];

    for (const path of paths) {
      try {
        const response = await fetch(new URL(path, `${this.apiBaseUrl}/`).toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: this.buildAbortSignal()
        });
        if (response.ok) {
          return true;
        }
        this.logger.warn(
          `Viva booking request failed for ${exerciseId}: ${response.status} ${response.statusText}`
        );
      } catch (error) {
        this.logger.warn(`Viva booking request failed for ${exerciseId}: ${String(error)}`);
      }
    }

    return false;
  }

  private async loadTournaments(): Promise<Tournament[]> {
    const today = this.toDateKey(new Date());
    const dateTo = this.toDateKey(this.addDays(new Date(), this.lookaheadDays - 1));

    const studios = await this.fetchEntitySummaries('studios');
    const trainers = await this.fetchEntitySummaries('trainers');
    await this.fetchProfile();

    const todayExercises = await this.fetchExercisesByDate(today);
    const tournamentDates = await this.fetchTournamentDates(
      today,
      dateTo,
      studios.map((studio) => studio.id)
    );

    const dates = Array.from(
      new Set(
        [today, ...tournamentDates].filter(
          (dateKey) => dateKey >= today && dateKey <= dateTo
        )
      )
    ).sort();
    const otherDates = dates.filter((dateKey) => dateKey !== today);
    const otherExercises = await Promise.all(
      otherDates.map((dateKey) => this.fetchExercisesByDate(dateKey))
    );

    const studioNames = new Map(studios.map((studio) => [studio.id, studio.name]));
    const trainerNames = new Map(trainers.map((trainer) => [trainer.id, trainer.name]));
    const trainerAvatars = new Map(trainers.map((trainer) => [trainer.id, trainer.avatarUrl]));
    const deduplicated = new Map<string, Tournament>();

    for (const exercise of [todayExercises, ...otherExercises].flat()) {
      const tournament = this.toTournament(
        exercise,
        studioNames,
        trainerNames,
        trainerAvatars
      );
      if (tournament) {
        deduplicated.set(tournament.id, tournament);
      }
    }

    return Array.from(deduplicated.values()).sort((left, right) => {
      const leftStartsAt = Date.parse(left.startsAt || '');
      const rightStartsAt = Date.parse(right.startsAt || '');
      const leftRank = Number.isFinite(leftStartsAt) ? leftStartsAt : Number.MAX_SAFE_INTEGER;
      const rightRank = Number.isFinite(rightStartsAt)
        ? rightStartsAt
        : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(left.name || '').localeCompare(String(right.name || ''), 'ru');
    });
  }

  private async loadTournamentDetails(id: string): Promise<Tournament | null> {
    const detailRecord = await this.fetchFirstAvailableRecord([
      `exercises/${encodeURIComponent(id)}`,
      `exercises/${encodeURIComponent(id)}?include=clients,participants,bookings`
    ]);
    if (!detailRecord) {
      return null;
    }

    const related = await this.fetchRelatedParticipantRecords(id);
    const mergedRecord: VivaRawRecord = {
      ...detailRecord,
      clients: [
        ...this.unwrapRecords(detailRecord.clients),
        ...related
      ],
      participants: [
        ...this.unwrapRecords(detailRecord.participants),
        ...related
      ],
      registrations: [
        ...this.unwrapRecords(detailRecord.registrations),
        ...related
      ]
    };
    const tournament = this.toTournament(mergedRecord, new Map(), new Map(), new Map());
    if (!tournament) {
      return null;
    }

    const participants = this.resolveParticipants(mergedRecord);
    return {
      ...tournament,
      participants: participants.length > 0 ? participants : tournament.participants,
      participantsCount:
        participants.length > 0
          ? participants.length
          : tournament.participantsCount
    };
  }

  private async fetchFirstAvailableRecord(paths: string[]): Promise<VivaRawRecord | null> {
    for (const path of paths) {
      try {
        const payload = await this.fetchJson(path);
        const record = this.unwrapFirstRecord(payload);
        if (record) {
          return record;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async fetchRelatedParticipantRecords(id: string): Promise<VivaRawRecord[]> {
    const paths = [
      `exercises/${encodeURIComponent(id)}/bookings`,
      `exercises/${encodeURIComponent(id)}/clients`,
      `exercises/${encodeURIComponent(id)}/participants`,
      `bookings?exerciseId=${encodeURIComponent(id)}`
    ];
    const results = await Promise.allSettled(paths.map((path) => this.fetchJson(path)));
    return results.flatMap((result) =>
      result.status === 'fulfilled' ? this.unwrapRecords(result.value) : []
    );
  }

  private async fetchEntitySummaries(path: string): Promise<VivaEntitySummary[]> {
    const payload = await this.fetchJson(path);
    const summaries: VivaEntitySummary[] = [];

    for (const record of this.unwrapRecords(payload)) {
      const id = this.readString(record.id) ?? this.readString(record.uuid);
      if (!id) {
        continue;
      }

      summaries.push({
        id,
        name:
          this.readString(record.name) ??
          this.readString(record.title) ??
          this.readString(record.fullName) ??
          this.readString(record.full_name) ??
          this.readString(record.displayName) ??
          this.readString(record.display_name),
        avatarUrl: this.readAvatarUrl(record) ?? null
      });
    }

    return summaries;
  }

  private async fetchProfile(): Promise<void> {
    try {
      await this.fetchJson('profile');
    } catch (error) {
      this.logger.warn(`Failed to preload Viva schedule profile: ${String(error)}`);
    }
  }

  private async fetchExercisesByDate(dateKey: string): Promise<VivaRawRecord[]> {
    const payload = await this.fetchJson('exercises', { date: dateKey });
    return this.unwrapRecords(payload);
  }

  private async fetchTournamentDates(
    dateFrom: string,
    dateTo: string,
    studioIds: string[]
  ): Promise<string[]> {
    const query = new URLSearchParams();
    query.set('dateFrom', dateFrom);
    query.set('dateTo', dateTo);
    studioIds.forEach((studioId) => query.append('studioIds', studioId));
    this.exerciseTypeIds.forEach((typeId) => query.append('exerciseTypeIds', typeId));

    const payload = await this.fetchJson(`exercises/dates?${query.toString()}`);
    return this.collectDateKeys(payload);
  }

  private async fetchJson(path: string, query?: Record<string, string>): Promise<unknown> {
    const url = this.buildUrl(path, query);
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      },
      signal: this.buildAbortSignal()
    });

    if (!response.ok) {
      throw new Error(`Viva request ${path} failed with status ${response.status}`);
    }

    return response.json();
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const url = new URL(
      `/end-user/api/v1/${encodeURIComponent(this.widgetId)}/${cleanPath}`,
      `${this.apiBaseUrl}/`
    );
    Object.entries(query || {}).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return url.toString();
  }

  private toTournament(
    exercise: VivaRawRecord,
    studioNames: Map<string, string | undefined>,
    trainerNames: Map<string, string | undefined>,
    trainerAvatars: Map<string, string | null | undefined>
  ): Tournament | null {
    const direction = this.readRecord(exercise.direction);
    const type = this.readRecord(exercise.type);
    const studio = this.readRecord(exercise.studio);
    const name =
      this.readString(exercise.name) ??
      this.readString(exercise.title) ??
      this.readString(exercise.exerciseName) ??
      this.readString(exercise.exercise_name) ??
      this.readString(exercise.serviceName) ??
      this.readString(exercise.service_name) ??
      this.readDisplayName(direction) ??
      this.readDisplayName(type);
    const exerciseType = this.resolveExerciseType(exercise);
    if (!this.isTournamentExercise(name, exerciseType)) {
      return null;
    }

    const startsAt =
      this.readDateTimeString(exercise.startsAt) ??
      this.readDateTimeString(exercise.starts_at) ??
      this.readDateTimeString(exercise.startAt) ??
      this.readDateTimeString(exercise.start_at) ??
      this.readDateTimeString(exercise.startDateTime) ??
      this.readDateTimeString(exercise.start_date_time) ??
      this.readDateTimeString(exercise.timeFrom) ??
      this.readDateTimeString(exercise.time_from) ??
      this.readDateTimeString(exercise.timeStart) ??
      this.readDateTimeString(exercise.time_start) ??
      this.composeDateTime(
        this.readDateString(exercise.date) ??
          this.readDateString(exercise.startDate) ??
          this.readDateString(exercise.start_date),
        this.readTimeString(exercise.timeFrom) ??
          this.readTimeString(exercise.time_from) ??
          this.readTimeString(exercise.startTime) ??
          this.readTimeString(exercise.start_time)
      );
    const endsAt =
      this.readDateTimeString(exercise.endsAt) ??
      this.readDateTimeString(exercise.ends_at) ??
      this.readDateTimeString(exercise.endAt) ??
      this.readDateTimeString(exercise.end_at) ??
      this.readDateTimeString(exercise.endDateTime) ??
      this.readDateTimeString(exercise.end_date_time) ??
      this.readDateTimeString(exercise.timeTo) ??
      this.readDateTimeString(exercise.time_to) ??
      this.readDateTimeString(exercise.timeEnd) ??
      this.readDateTimeString(exercise.time_end) ??
      this.composeDateTime(
        this.readDateString(exercise.date) ??
          this.readDateString(exercise.endDate) ??
          this.readDateString(exercise.end_date),
        this.readTimeString(exercise.timeTo) ??
          this.readTimeString(exercise.time_to) ??
          this.readTimeString(exercise.endTime) ??
          this.readTimeString(exercise.end_time)
      );
    const studioId =
      this.readString(exercise.studioId) ??
      this.readString(exercise.studio_id) ??
      this.readNestedId(exercise.studio) ??
      this.readString(exercise.clubId) ??
      this.readString(exercise.club_id);
    const trainerId =
      this.readString(exercise.trainerId) ??
      this.readString(exercise.trainer_id) ??
      this.readString(exercise.coachId) ??
      this.readString(exercise.coach_id) ??
      this.readNestedId(exercise.trainer) ??
      this.readNestedId(exercise.coach) ??
      this.readNestedFirstId(exercise.trainers);
    const id =
      this.readString(exercise.id) ??
      this.readString(exercise.uuid) ??
      this.readString(exercise.exerciseId) ??
      this.readString(exercise.exercise_id) ??
      this.readString(exercise.eventId) ??
      this.readString(exercise.event_id) ??
      this.buildSyntheticTournamentId(name, startsAt, studioId, trainerId, exerciseType.id);
    const rawStatus =
      this.readString(exercise.status) ??
      this.readString(exercise.state) ??
      this.readString(exercise.bookingStatus) ??
      this.readString(exercise.booking_status);
    const tournamentType = this.resolveTournamentType(name, exerciseType);
    const maxPlayers = this.resolveMaxPlayers(exercise);
    const participants = this.resolveParticipants(exercise);
    const participantsCount = this.resolveParticipantsCount(exercise);
    const studioName =
      (studioId ? studioNames.get(studioId) : undefined) ??
      this.readDisplayName(studio);
    const courtName =
      this.readString(exercise.courtName) ??
      this.readString(exercise.court_name) ??
      this.readString(exercise.roomName) ??
      this.readString(exercise.room_name) ??
      this.readDisplayName(exercise.court) ??
      this.readDisplayName(exercise.room);
    const locationName = [studioName, courtName].filter(Boolean).join(' · ') || undefined;
    const trainerName =
      (trainerId ? trainerNames.get(trainerId) : undefined) ??
      this.readDisplayName(this.readFirstRecord(exercise.trainers)) ??
      this.readDisplayName(exercise.trainer) ??
      this.readDisplayName(exercise.coach);
    const trainerAvatarUrl =
      (trainerId ? trainerAvatars.get(trainerId) : undefined) ??
      this.readAvatarUrl(this.readFirstRecord(exercise.trainers)) ??
      this.readAvatarUrl(exercise.trainer) ??
      this.readAvatarUrl(exercise.coach) ??
      undefined;

    return {
      id,
      source: 'VIVA',
      name:
        name ||
        [exerciseType.name, studioId ? studioNames.get(studioId) : undefined]
          .filter(Boolean)
          .join(' · ') ||
        `Турнир ${startsAt || id}`,
      status: this.normalizeTournamentStatus(rawStatus, startsAt, endsAt),
      rawStatus: rawStatus ?? undefined,
      gameId:
        this.readString(exercise.gameId) ??
        this.readString(exercise.game_id) ??
        this.readString(direction?.id) ??
        exerciseType.id,
      studioId: studioId ?? undefined,
      studioName: studioName ?? undefined,
      courtName: courtName ?? undefined,
      locationName,
      trainerId: trainerId ?? undefined,
      trainerName: trainerName ?? undefined,
      trainerAvatarUrl,
      exerciseTypeId: exerciseType.id,
      tournamentType: tournamentType ?? undefined,
      maxPlayers: maxPlayers ?? undefined,
      participants: participants.length > 0 ? participants : undefined,
      participantsCount:
        participantsCount !== undefined
          ? participantsCount
          : participants.length > 0
            ? participants.length
            : undefined,
      startsAt: startsAt ?? undefined,
      endsAt: endsAt ?? undefined,
      createdAt:
        this.readDateTimeString(exercise.createdAt) ??
        this.readDateTimeString(exercise.created_at),
      updatedAt:
        this.readDateTimeString(exercise.updatedAt) ??
        this.readDateTimeString(exercise.updated_at)
    };
  }

  private resolveExerciseType(exercise: VivaRawRecord): VivaExerciseTypeResolution {
    const directTypeId =
      this.readString(exercise.exerciseTypeId) ??
      this.readString(exercise.exercise_type_id) ??
      this.readString(exercise.typeId) ??
      this.readString(exercise.type_id) ??
      this.readString(exercise.serviceId) ??
      this.readString(exercise.service_id);
    const directTypeName =
      this.readString(exercise.exerciseTypeName) ??
      this.readString(exercise.exercise_type_name) ??
      this.readString(exercise.typeName) ??
      this.readString(exercise.type_name);

    const nestedSource =
      this.readRecord(exercise.exerciseType) ??
      this.readRecord(exercise.exercise_type) ??
      this.readRecord(exercise.type) ??
      this.readRecord(exercise.service);

    return {
      id:
        directTypeId ??
        (nestedSource
          ? this.readString(nestedSource.id) ??
            this.readString(nestedSource.typeId) ??
            this.readString(nestedSource.type_id)
          : undefined),
      name:
        directTypeName ??
        (nestedSource
          ? this.readString(nestedSource.name) ??
            this.readString(nestedSource.title) ??
            this.readString(nestedSource.typeName) ??
            this.readString(nestedSource.type_name)
          : undefined)
    };
  }

  private isTournamentExercise(
    exerciseName: string | undefined,
    exerciseType: VivaExerciseTypeResolution
  ): boolean {
    if (exerciseType.id && this.exerciseTypeIds.includes(exerciseType.id)) {
      return true;
    }

    if (exerciseType.id && this.exerciseTypeIds.length > 0) {
      return false;
    }

    return /турнир|лига|tournament|cup/i.test(
      [exerciseName, exerciseType.name].filter(Boolean).join(' ')
    );
  }

  private resolveTournamentType(
    exerciseName: string | undefined,
    exerciseType: VivaExerciseTypeResolution
  ): string | undefined {
    const haystack = [exerciseName, exerciseType.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!haystack) {
      return undefined;
    }
    if (/американо|americano/.test(haystack)) {
      return 'Американо';
    }
    if (/мексикано|mexicano/.test(haystack)) {
      return 'Мексикано';
    }
    if (/лига|league/.test(haystack)) {
      return 'Лига';
    }
    if (/кубок|cup/.test(haystack)) {
      return 'Кубок';
    }
    if (/сетк|grid|playoff|knockout/.test(haystack)) {
      return 'Сетка';
    }
    return undefined;
  }

  private resolveMaxPlayers(exercise: VivaRawRecord): number | undefined {
    const keys = [
      'maxPlayers',
      'max_players',
      'maxClientsCount',
      'max_clients_count',
      'maxClients',
      'max_clients',
      'playersMax',
      'players_max',
      'maxParticipants',
      'max_participants',
      'participantsLimit',
      'participants_limit',
      'participantLimit',
      'participant_limit',
      'visitorsLimit',
      'visitors_limit',
      'maxVisitors',
      'max_visitors',
      'capacity',
      'placeCount',
      'place_count',
      'placesCount',
      'places_count',
      'countPlaces',
      'count_places',
      'slotsLimit',
      'slots_limit',
      'slotsCount',
      'slots_count',
      'clientsLimit',
      'clients_limit',
      'peopleLimit',
      'people_limit'
    ];
    const sources = [
      exercise,
      this.readRecord(exercise.booking),
      this.readRecord(exercise.settings),
      this.readRecord(exercise.metadata),
      this.readRecord(exercise.exerciseType),
      this.readRecord(exercise.exercise_type),
      this.readRecord(exercise.type),
      this.readRecord(exercise.service)
    ];

    for (const source of sources) {
      if (!source) {
        continue;
      }
      for (const key of keys) {
        const value = this.readPositiveInteger(source[key]);
        if (value) {
          return value;
        }
      }
    }

    return undefined;
  }

  private resolveParticipantsCount(exercise: VivaRawRecord): number | undefined {
    const keys = ['clientsCount', 'clients_count', 'participantsCount', 'participants_count'];
    const sources = [
      exercise,
      this.readRecord(exercise.booking),
      this.readRecord(exercise.settings),
      this.readRecord(exercise.metadata)
    ];

    for (const source of sources) {
      if (!source) {
        continue;
      }
      for (const key of keys) {
        const value = this.readNonNegativeInteger(source[key]);
        if (value !== undefined) {
          return value;
        }
      }
    }

    return undefined;
  }

  private resolveParticipants(exercise: VivaRawRecord): TournamentParticipant[] {
    const participants: TournamentParticipant[] = [];
    const seen = new Set<string>();
    const sources = [
      exercise,
      this.readRecord(exercise.booking),
      this.readRecord(exercise.settings),
      this.readRecord(exercise.metadata)
    ];
    const keys = [
      'clients',
      'clientList',
      'client_list',
      'participants',
      'participantList',
      'participant_list',
      'players',
      'playerList',
      'player_list',
      'members',
      'memberList',
      'member_list',
      'visitors',
      'visitorList',
      'visitor_list',
      'guests',
      'guestList',
      'guest_list',
      'bookings',
      'bookingList',
      'booking_list',
      'registrations',
      'registrationList',
      'registration_list'
    ];

    sources.forEach((source) => {
      if (!source) {
        return;
      }
      keys.forEach((key) => {
        this.collectParticipantsFromValue(source[key], participants, seen);
      });
    });

    return participants;
  }

  private collectParticipantsFromValue(
    value: unknown,
    participants: TournamentParticipant[],
    seen: Set<string>
  ): void {
    if (Array.isArray(value)) {
      value.forEach((entry) => this.pushParticipant(entry, participants, seen));
      return;
    }

    const record = this.readRecord(value);
    if (!record) {
      return;
    }

    const nestedArrays = [
      'data',
      'items',
      'results',
      'content',
      'records',
      'list',
      'bookings',
      'clients',
      'clientList',
      'participants',
      'players',
      'members',
      'visitors',
      'guests',
      'registrations'
    ];
    for (const key of nestedArrays) {
      if (Array.isArray(record[key])) {
        this.collectParticipantsFromValue(record[key], participants, seen);
      }
    }

    this.pushParticipant(record, participants, seen);
  }

  private pushParticipant(
    value: unknown,
    participants: TournamentParticipant[],
    seen: Set<string>
  ): void {
    const participant = this.toParticipant(value);
    if (!participant) {
      return;
    }

    const key = this.buildParticipantKey(participant);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    participants.push(participant);
  }

  private toParticipant(value: unknown): TournamentParticipant | null {
    const record = this.readRecord(value);
    if (!record) {
      return null;
    }

    const subject = this.resolveParticipantSubject(record);
    const name =
      this.readDisplayName(subject) ??
      this.readString(record.clientName) ??
      this.readString(record.client_name) ??
      this.readDisplayName(record);
    if (!name) {
      return null;
    }

    const paymentStatus = this.resolveParticipantPaymentStatus(record);
    return {
      id:
        this.readString(record.clientId) ??
        this.readString(record.client_id) ??
        this.readNestedId(subject) ??
        this.readString(record.id) ??
        undefined,
      name,
      phone:
        this.readPhone(subject?.phone) ??
        this.readPhone(subject?.phoneNumber) ??
        this.readPhone(subject?.phone_number) ??
        this.readPhone(subject?.mobilePhone) ??
        this.readPhone(subject?.mobile_phone) ??
        this.readPhone(record.phone) ??
        this.readPhone(record.phoneNumber) ??
        this.readPhone(record.phone_number) ??
        this.readPhone(record.mobilePhone) ??
        this.readPhone(record.mobile_phone) ??
        this.readPhone(record.clientPhone) ??
        this.readPhone(record.client_phone) ??
        undefined,
      levelLabel: this.readParticipantLevelLabel(subject, record) ?? undefined,
      avatarUrl:
        this.readAvatarUrl(subject) ??
        this.readAvatarUrl(record) ??
        undefined,
      paymentStatus: paymentStatus ?? undefined,
      status: 'REGISTERED'
    };
  }

  private readParticipantLevelLabel(
    subject: VivaRawRecord | null,
    record: VivaRawRecord
  ): string | undefined {
    const numericLevel =
      this.readFirstLevelScore(subject) ??
      this.readFirstLevelScore(record);
    if (numericLevel) {
      return numericLevel;
    }

    return (
      this.readString(subject?.levelLabel) ??
      this.readString(subject?.level_label) ??
      this.readString(subject?.level) ??
      this.readString(subject?.grade) ??
      this.readString(subject?.ratingLabel) ??
      this.readString(subject?.rating_label) ??
      this.readString(subject?.rating) ??
      this.readString(record.levelLabel) ??
      this.readString(record.level_label) ??
      this.readString(record.level) ??
      this.readString(record.grade) ??
      this.readString(record.ratingLabel) ??
      this.readString(record.rating_label) ??
      this.readString(record.rating)
    );
  }

  private readFirstLevelScore(record: VivaRawRecord | null): string | undefined {
    if (!record) {
      return undefined;
    }

    const keys = [
      'levelScore',
      'level_score',
      'levelNumeric',
      'level_numeric',
      'ratingNumeric',
      'rating_numeric',
      'ratingValue',
      'rating_value',
      'gameRating',
      'game_rating',
      'padelLevel',
      'padel_level',
      'rating',
      'level'
    ];

    for (const key of keys) {
      const score = this.readLevelScore(record[key]);
      if (score) {
        return score;
      }
    }

    return undefined;
  }

  private readLevelScore(value: unknown): string | undefined {
    if (typeof value === 'number') {
      return this.formatLevelScore(value);
    }

    const normalized = this.readString(value)?.replace(',', '.');
    if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) {
      return undefined;
    }

    return this.formatLevelScore(Number(normalized));
  }

  private formatLevelScore(value: number): string | undefined {
    if (!Number.isFinite(value) || value <= 0 || value > 10) {
      return undefined;
    }

    return value
      .toFixed(3)
      .replace(/0+$/, '')
      .replace(/\.$/, '');
  }

  private resolveParticipantSubject(record: VivaRawRecord): VivaRawRecord | null {
    return (
      this.readRecord(record.client) ??
      this.readRecord(record.user) ??
      this.readRecord(record.person) ??
      this.readRecord(record.member) ??
      this.readRecord(record.player) ??
      this.readRecord(record.guest)
    );
  }

  private resolveParticipantPaymentStatus(
    record: VivaRawRecord
  ): TournamentPaymentStatus | undefined {
    const paidFlags = [
      record.isPaid,
      record.paid,
      record.paymentReceived,
      record.payment_received
    ];
    if (paidFlags.some((flag) => flag === true)) {
      return 'PAID';
    }

    const rawStatus =
      this.readString(record.paymentStatus) ??
      this.readString(record.payment_status) ??
      this.readString(record.paymentState) ??
      this.readString(record.payment_state);
    const normalized = this.normalizeStatus(rawStatus);
    if (!normalized) {
      return undefined;
    }
    if (['PAID', 'PAYED', 'SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(normalized)) {
      return 'PAID';
    }
    if (['UNPAID', 'PENDING', 'NEW', 'CREATED', 'WAITING'].includes(normalized)) {
      return 'UNPAID';
    }
    return undefined;
  }

  private buildParticipantKey(participant: TournamentParticipant): string {
    const phone = this.readPhone(participant.phone);
    if (phone) {
      return `phone:${phone}`;
    }
    return `name:${String(participant.name || '').trim().toLowerCase()}`;
  }

  private normalizeTournamentStatus(
    rawStatus?: string,
    startsAt?: string,
    endsAt?: string
  ): TournamentStatus {
    const normalized = this.normalizeStatus(rawStatus);
    if (['CANCELED', 'CANCELLED', 'DELETED'].includes(normalized)) {
      return TournamentStatus.CANCELED;
    }
    if (
      [
        'REGISTRATION',
        'ENROLLMENT',
        'OPEN_REGISTRATION',
        'REG_OPEN',
        'AVAILABLE',
        'OPEN'
      ].includes(normalized)
    ) {
      return TournamentStatus.REGISTRATION;
    }
    if (['RUNNING', 'ACTIVE', 'IN_PROGRESS'].includes(normalized)) {
      return TournamentStatus.RUNNING;
    }
    if (['FINISHED', 'COMPLETED', 'DONE', 'CLOSED'].includes(normalized)) {
      return TournamentStatus.FINISHED;
    }
    if (['PLANNED', 'DRAFT', 'SCHEDULED', 'NEW'].includes(normalized)) {
      return TournamentStatus.PLANNED;
    }

    const now = Date.now();
    const startsAtMs = Date.parse(startsAt || '');
    const endsAtMs = Date.parse(endsAt || '');
    if (Number.isFinite(startsAtMs) && startsAtMs > now) {
      return TournamentStatus.REGISTRATION;
    }
    if (
      Number.isFinite(startsAtMs) &&
      startsAtMs <= now &&
      (!Number.isFinite(endsAtMs) || endsAtMs >= now)
    ) {
      return TournamentStatus.RUNNING;
    }
    if (Number.isFinite(endsAtMs) && endsAtMs < now) {
      return TournamentStatus.FINISHED;
    }

    return TournamentStatus.UNKNOWN;
  }

  private unwrapRecords(payload: unknown): VivaRawRecord[] {
    if (Array.isArray(payload)) {
      return payload.filter(this.isRecord);
    }

    const record = this.readRecord(payload);
    if (!record) {
      return [];
    }

    const keys = [
      'data',
      'result',
      'items',
      'results',
      'content',
      'records',
      'list',
      'bookings',
      'clients',
      'participants',
      'players',
      'members',
      'visitors',
      'guests',
      'registrations',
      'studios',
      'trainers',
      'exercises',
      'dates'
    ];

    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.filter(this.isRecord);
      }
      const nested = this.readRecord(value);
      if (nested) {
        const nestedRecords = this.unwrapRecords(nested);
        if (nestedRecords.length > 0) {
          return nestedRecords;
        }
      }
    }

    return [];
  }

  private unwrapFirstRecord(payload: unknown): VivaRawRecord | null {
    const direct = this.readRecord(payload);
    if (direct) {
      for (const key of ['data', 'item', 'result', 'exercise']) {
        const nested = this.readRecord(direct[key]);
        if (nested) {
          return nested;
        }
      }
      return direct;
    }

    const records = this.unwrapRecords(payload);
    return records[0] ?? null;
  }

  private collectDateKeys(payload: unknown): string[] {
    const collected = new Set<string>();
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        const dateKey = this.readDateString(value);
        if (dateKey) {
          collected.add(dateKey);
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => walk(item));
        return;
      }

      const record = this.readRecord(value);
      if (!record) {
        return;
      }

      Object.values(record).forEach((item) => walk(item));
    };

    walk(payload);
    return Array.from(collected).sort();
  }

  private buildSyntheticTournamentId(
    name?: string,
    startsAt?: string,
    studioId?: string,
    trainerId?: string,
    exerciseTypeId?: string
  ): string {
    return [
      'viva-tournament',
      name || 'unknown',
      startsAt || 'no-start',
      studioId || 'no-studio',
      trainerId || 'no-trainer',
      exerciseTypeId || 'no-type'
    ]
      .join('-')
      .replace(/[^a-zA-Z0-9а-яА-Я_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private readNestedId(value: unknown): string | undefined {
    const record = this.readRecord(value);
    if (!record) {
      return undefined;
    }

    return (
      this.readString(record.id) ??
      this.readString(record.uuid) ??
      this.readString(record.trainerId) ??
      this.readString(record.trainer_id) ??
      this.readString(record.studioId) ??
      this.readString(record.studio_id)
    );
  }

  private readNestedFirstId(value: unknown): string | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    for (const item of value) {
      const id = this.readNestedId(item);
      if (id) {
        return id;
      }
    }

    return undefined;
  }

  private readFirstRecord(value: unknown): VivaRawRecord | null {
    if (!Array.isArray(value)) {
      return null;
    }

    for (const item of value) {
      const record = this.readRecord(item);
      if (record) {
        return record;
      }
    }

    return null;
  }

  private readDisplayName(value: unknown): string | undefined {
    const record = this.readRecord(value);
    if (!record) {
      return undefined;
    }

    const directName =
      this.readString(record.name) ??
      this.readString(record.title) ??
      this.readString(record.fullName) ??
      this.readString(record.full_name) ??
      this.readString(record.displayName) ??
      this.readString(record.display_name);
    if (directName) {
      return directName;
    }

    const firstName = this.readString(record.firstName) ?? this.readString(record.first_name);
    const lastName = this.readString(record.lastName) ?? this.readString(record.last_name);
    return [firstName, lastName].filter(Boolean).join(' ') || undefined;
  }

  private readAvatarUrl(value: unknown): string | undefined {
    const record = this.readRecord(value);
    if (!record) {
      return undefined;
    }

    return (
      this.readString(record.photo) ??
      this.readString(record.avatar) ??
      this.readString(record.avatarUrl) ??
      this.readString(record.avatar_url) ??
      this.readString(record.imageUrl) ??
      this.readString(record.image_url) ??
      this.readString(record.photoUrl) ??
      this.readString(record.photo_url)
    );
  }

  private readDateTimeString(value: unknown): string | undefined {
    const normalized = this.readString(value);
    if (!normalized) {
      return undefined;
    }

    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) {
      return normalized;
    }

    return undefined;
  }

  private readDateString(value: unknown): string | undefined {
    const normalized = this.readString(value);
    if (!normalized) {
      return undefined;
    }

    const match = normalized.match(/(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : undefined;
  }

  private readTimeString(value: unknown): string | undefined {
    const normalized = this.readString(value);
    if (!normalized) {
      return undefined;
    }

    const match = normalized.match(/^(\d{1,2}:\d{2})(?::\d{2})?$/);
    if (!match) {
      return undefined;
    }

    const [hoursRaw, minutesRaw] = match[1].split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isFinite(hours) || hours < 0 || hours > 23) {
      return undefined;
    }
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
      return undefined;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private composeDateTime(dateKey?: string, timeValue?: string): string | undefined {
    if (!dateKey || !timeValue) {
      return undefined;
    }

    return `${dateKey}T${timeValue}:00`;
  }

  private normalizeStatus(value?: string): string {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
  }

  private readString(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private readPositiveInteger(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }

    const normalized = this.readString(value);
    if (!normalized) {
      return undefined;
    }

    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }

    const digits = normalized.replace(/\D+/g, '');
    if (!digits) {
      return undefined;
    }

    const numeric = Number(digits);
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : undefined;
  }

  private readNonNegativeInteger(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value);
    }

    const normalized = this.readString(value);
    if (!normalized) {
      return undefined;
    }

    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }

    const digits = normalized.replace(/\D+/g, '');
    if (!digits) {
      return undefined;
    }

    const numeric = Number(digits);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : undefined;
  }

  private readRecord(value: unknown): VivaRawRecord | null {
    return this.isRecord(value) ? value : null;
  }

  private readPhone(value: unknown): string | undefined {
    const normalized = this.readString(value);
    if (!normalized) {
      return undefined;
    }

    const digits = normalized.replace(/\D+/g, '');
    if (!digits) {
      return undefined;
    }

    if (digits.length === 10) {
      return `7${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `7${digits.slice(1)}`;
    }
    return digits;
  }

  private isRecord(value: unknown): value is VivaRawRecord {
    return typeof value === 'object' && value !== null;
  }

  private toDateKey(dateValue: Date): string {
    const year = dateValue.getFullYear();
    const month = String(dateValue.getMonth() + 1).padStart(2, '0');
    const day = String(dateValue.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addDays(dateValue: Date, days: number): Date {
    const nextDate = new Date(dateValue.getTime());
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
  }

  private buildAbortSignal(): AbortSignal | undefined {
    const abortSignalTimeout = (AbortSignal as typeof AbortSignal & {
      timeout?: (delay: number) => AbortSignal;
    }).timeout;

    return typeof abortSignalTimeout === 'function'
      ? abortSignalTimeout(this.requestTimeoutMs)
      : undefined;
  }

  private normalizeBaseUrl(value?: string): string | undefined {
    const normalized = this.normalizeString(value);
    return normalized ? normalized.replace(/\/+$/, '') : undefined;
  }

  private normalizeString(value?: string): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }

  private readStringListEnv(name: string, fallback: string[]): string[] {
    const raw = String(process.env[name] ?? '').trim();
    if (!raw) {
      return fallback;
    }

    const values = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    return values.length > 0 ? values : fallback;
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.trunc(parsed);
  }
}

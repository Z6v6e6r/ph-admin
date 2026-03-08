import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Game, GameStatus } from '../../games/games.types';
import { Tournament, TournamentStatus } from '../../tournaments/tournaments.types';
import { LkRawRecord } from './lk-padelhub.types';

type ClientMode = 'mock' | 'http';

@Injectable()
export class LkPadelHubClientService {
  private readonly logger = new Logger(LkPadelHubClientService.name);
  private readonly gamesUrl = process.env.LK_PADELHUB_GAMES_URL;
  private readonly tournamentsUrl = process.env.LK_PADELHUB_TOURNAMENTS_URL;
  private readonly token = process.env.LK_PADELHUB_API_TOKEN;
  private readonly mode: ClientMode = this.resolveMode();

  async listGames(): Promise<Game[]> {
    const payload =
      this.mode === 'http' ? await this.fetchGamesPayload() : this.mockGamesPayload();

    return this.unwrapArray(payload)
      .map((raw) => this.toGame(raw))
      .filter((game): game is Game => game !== null);
  }

  async getGameById(id: string): Promise<Game | null> {
    const games = await this.listGames();
    return games.find((game) => game.id === id) ?? null;
  }

  async listTournaments(): Promise<Tournament[]> {
    const payload =
      this.mode === 'http'
        ? await this.fetchTournamentsPayload()
        : this.mockTournamentsPayload();

    return this.unwrapArray(payload)
      .map((raw) => this.toTournament(raw))
      .filter((tournament): tournament is Tournament => tournament !== null);
  }

  async getTournamentById(id: string): Promise<Tournament | null> {
    const tournaments = await this.listTournaments();
    return tournaments.find((tournament) => tournament.id === id) ?? null;
  }

  private resolveMode(): ClientMode {
    const explicit = process.env.LK_PADELHUB_MODE?.trim().toLowerCase();
    if (explicit === 'http') {
      return 'http';
    }
    if (explicit === 'mock') {
      return 'mock';
    }
    if (this.gamesUrl && this.tournamentsUrl) {
      return 'http';
    }
    return 'mock';
  }

  private async fetchGamesPayload(): Promise<unknown> {
    if (!this.gamesUrl) {
      throw new InternalServerErrorException(
        'LK_PADELHUB_GAMES_URL is required for HTTP mode'
      );
    }
    return this.fetchJson(this.gamesUrl);
  }

  private async fetchTournamentsPayload(): Promise<unknown> {
    if (!this.tournamentsUrl) {
      throw new InternalServerErrorException(
        'LK_PADELHUB_TOURNAMENTS_URL is required for HTTP mode'
      );
    }
    return this.fetchJson(this.tournamentsUrl);
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      }
    });

    if (!response.ok) {
      this.logger.error(`LK request failed: ${response.status} ${response.statusText}`);
      throw new InternalServerErrorException(
        `LK request failed with status ${response.status}`
      );
    }

    return response.json();
  }

  private unwrapArray(payload: unknown): LkRawRecord[] {
    if (Array.isArray(payload)) {
      return payload.filter(this.isRecord);
    }

    if (!this.isRecord(payload)) {
      return [];
    }

    const keys = ['data', 'items', 'results'];
    for (const key of keys) {
      const value = payload[key];
      if (Array.isArray(value)) {
        return value.filter(this.isRecord);
      }
    }

    return [];
  }

  private toGame(raw: LkRawRecord): Game | null {
    const id = this.readString(raw.id) ?? this.readString(raw.gameId) ?? this.readString(raw.uuid);
    const name = this.readString(raw.name) ?? this.readString(raw.title);
    if (!id || !name) {
      return null;
    }

    const rawStatus = this.readString(raw.status) ?? this.readString(raw.state);
    return {
      id,
      source: 'LK_PADELHUB',
      name,
      status: this.normalizeGameStatus(rawStatus),
      rawStatus: rawStatus ?? undefined,
      tournamentId: this.readString(raw.tournamentId) ?? this.readString(raw.tournament_id),
      startsAt: this.readString(raw.startsAt) ?? this.readString(raw.starts_at),
      createdAt: this.readString(raw.createdAt) ?? this.readString(raw.created_at),
      updatedAt: this.readString(raw.updatedAt) ?? this.readString(raw.updated_at)
    };
  }

  private toTournament(raw: LkRawRecord): Tournament | null {
    const id =
      this.readString(raw.id) ??
      this.readString(raw.tournamentId) ??
      this.readString(raw.uuid);
    const name = this.readString(raw.name) ?? this.readString(raw.title);
    if (!id || !name) {
      return null;
    }

    const rawStatus = this.readString(raw.status) ?? this.readString(raw.state);
    return {
      id,
      source: 'LK_PADELHUB',
      name,
      status: this.normalizeTournamentStatus(rawStatus),
      rawStatus: rawStatus ?? undefined,
      gameId: this.readString(raw.gameId) ?? this.readString(raw.game_id),
      startsAt: this.readString(raw.startsAt) ?? this.readString(raw.starts_at),
      endsAt: this.readString(raw.endsAt) ?? this.readString(raw.ends_at),
      createdAt: this.readString(raw.createdAt) ?? this.readString(raw.created_at),
      updatedAt: this.readString(raw.updatedAt) ?? this.readString(raw.updated_at)
    };
  }

  private normalizeGameStatus(rawStatus?: string): GameStatus {
    if (!rawStatus) {
      return GameStatus.UNKNOWN;
    }

    const normalized = this.normalizeStatus(rawStatus);
    if (['DRAFT', 'NEW', 'PENDING'].includes(normalized)) {
      return GameStatus.DRAFT;
    }
    if (['ACTIVE', 'RUNNING', 'OPEN', 'PUBLISHED'].includes(normalized)) {
      return GameStatus.ACTIVE;
    }
    if (['ARCHIVED', 'CLOSED', 'DELETED'].includes(normalized)) {
      return GameStatus.ARCHIVED;
    }
    return GameStatus.UNKNOWN;
  }

  private normalizeTournamentStatus(rawStatus?: string): TournamentStatus {
    if (!rawStatus) {
      return TournamentStatus.UNKNOWN;
    }

    const normalized = this.normalizeStatus(rawStatus);
    if (['PLANNED', 'DRAFT', 'SCHEDULED'].includes(normalized)) {
      return TournamentStatus.PLANNED;
    }
    if (
      ['REGISTRATION', 'ENROLLMENT', 'OPEN_REGISTRATION', 'REG_OPEN'].includes(
        normalized
      )
    ) {
      return TournamentStatus.REGISTRATION;
    }
    if (['RUNNING', 'ACTIVE', 'IN_PROGRESS'].includes(normalized)) {
      return TournamentStatus.RUNNING;
    }
    if (['FINISHED', 'COMPLETED', 'DONE'].includes(normalized)) {
      return TournamentStatus.FINISHED;
    }
    if (['CANCELED', 'CANCELLED'].includes(normalized)) {
      return TournamentStatus.CANCELED;
    }
    return TournamentStatus.UNKNOWN;
  }

  private normalizeStatus(rawStatus: string): string {
    return rawStatus
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private isRecord(value: unknown): value is LkRawRecord {
    return typeof value === 'object' && value !== null;
  }

  private mockGamesPayload(): unknown {
    return [
      {
        id: 'lk-game-001',
        name: 'Padel Open Match',
        status: 'ACTIVE',
        startsAt: '2026-03-10T18:00:00.000Z',
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-06T09:00:00.000Z'
      }
    ];
  }

  private mockTournamentsPayload(): unknown {
    return [
      {
        id: 'lk-tournament-001',
        name: 'Spring Cup',
        status: 'REGISTRATION',
        startsAt: '2026-03-15T09:00:00.000Z',
        endsAt: '2026-03-16T20:00:00.000Z',
        createdAt: '2026-02-20T10:00:00.000Z',
        updatedAt: '2026-03-06T09:00:00.000Z'
      }
    ];
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { RequestUser } from '../common/rbac/request-user.interface';
import {
  Tournament,
  TournamentParticipant,
  TournamentResultMatchEntry,
  TournamentResultsView
} from './tournaments.types';
import {
  StoredTournamentStanding,
  TournamentResultsStoreService
} from './tournament-results-store.service';
import { TournamentsService } from './tournaments.service';

const EXPORT_TIME_ZONE = 'Europe/Moscow';
const EXPORT_MAX_DAYS = 366;
const EXPORT_MAX_TOURNAMENTS = 500;
const EXPORT_MAX_RESULT_ROWS = 50_000;
const EXPORT_CONCURRENCY = 4;

interface TournamentResultsExportInput {
  from?: unknown;
  to?: unknown;
  station?: unknown;
  direction?: unknown;
  user?: RequestUser;
}

interface TournamentResultsExportRow {
  start: Date | null;
  startIso?: string;
  station: string;
  direction: string;
  tournament: string;
  player: string;
  participantId?: string;
  rank: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  totalPoints: number;
  ratingBefore?: number;
  ratingAfter?: number;
  ratingDelta: number;
}

interface ConsolidatedParticipantRow {
  participantId?: string;
  player: string;
  tournaments: number;
  stations: Set<string>;
  directions: Set<string>;
  firstStart?: Date;
  firstStartIso?: string;
  lastStart?: Date;
  lastStartIso?: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  totalPoints: number;
  bestRank: number;
  rankSum: number;
  tournamentWins: number;
  podiums: number;
  ratingBefore?: number;
  ratingAfter?: number;
  ratingDeltaSum: number;
}

interface ParsedRatingLine {
  player: string;
  before?: number;
  after?: number;
  delta: number;
}

export interface TournamentResultsExportFile {
  buffer: Buffer;
  fileName: string;
  tournamentsCount: number;
  resultRowsCount: number;
  uniqueParticipantsCount: number;
}

@Injectable()
export class TournamentResultsExportService {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly tournamentResultsStore: TournamentResultsStoreService
  ) {}

  async buildExport(input: TournamentResultsExportInput): Promise<TournamentResultsExportFile> {
    const period = this.normalizePeriod(input.from, input.to);
    const stationFilter = this.normalizeFilter(input.station, 'station');
    const directionFilter = this.normalizeFilter(input.direction, 'direction');
    const tournaments = this.dedupeTournaments(
      (await this.tournamentsService.findAll({
        from: `${period.from}T00:00:00+03:00`,
        to: `${period.to}T23:59:59.999+03:00`,
        user: input.user
      }))
        .filter((tournament) => this.matchesStation(tournament, stationFilter))
        .filter((tournament) => this.matchesDirection(tournament, directionFilter))
    );

    if (tournaments.length > EXPORT_MAX_TOURNAMENTS) {
      throw new BadRequestException(
        `Export contains more than ${EXPORT_MAX_TOURNAMENTS} tournaments; narrow the filters`
      );
    }

    const storedResults = await this.tournamentResultsStore.findByTournamentIds(
      tournaments.flatMap((tournament) => this.resolveTournamentIdentifiers(tournament))
    );
    const resultSets = await this.mapWithConcurrency(
      tournaments,
      EXPORT_CONCURRENCY,
      async (tournament) => {
        const stored = storedResults
          ? this.resolveTournamentIdentifiers(tournament)
              .map((identifier) => storedResults.get(identifier))
              .find((value) => value !== undefined)
          : undefined;
        return {
          tournament,
          rows: stored
            ? this.buildStoredTournamentRows(tournament, stored.standings)
            : this.buildTournamentRows(
                tournament,
                await this.tournamentsService.getResults(tournament.id, input.user)
              )
        };
      }
    );
    const resultRows = resultSets.flatMap(({ rows }) => rows);
    if (resultRows.length > EXPORT_MAX_RESULT_ROWS) {
      throw new BadRequestException(
        `Export contains more than ${EXPORT_MAX_RESULT_ROWS} result rows; narrow the filters`
      );
    }

    const uniqueRows = this.consolidateParticipants(resultRows);
    const workbook = this.buildWorkbook(resultRows, uniqueRows);
    const workbookBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(workbookBuffer),
      fileName: `tournament-results-${period.from}_to_${period.to}.xlsx`,
      tournamentsCount: resultSets.filter(({ rows }) => rows.length > 0).length,
      resultRowsCount: resultRows.length,
      uniqueParticipantsCount: uniqueRows.length
    };
  }

  private buildStoredTournamentRows(
    tournament: Tournament,
    standings: StoredTournamentStanding[]
  ): TournamentResultsExportRow[] {
    const station = this.pickString(tournament.studioName)
      ?? this.pickString(tournament.studioId)
      ?? 'Без станции';
    const direction = resolveTournamentDirectionLabel(tournament);
    const startIso = this.pickString(tournament.startsAt);
    const start = startIso ? this.toExcelDate(startIso) : null;

    return standings
      .slice()
      .sort((left, right) => left.rank - right.rank)
      .map((standing) => ({
        start,
        startIso,
        station,
        direction,
        tournament: this.pickString(tournament.name) ?? 'Без названия',
        player: standing.name,
        participantId: standing.id,
        rank: standing.rank,
        matches: standing.matchesPlayed,
        wins: standing.wins,
        losses: standing.losses,
        draws: standing.draws,
        pointsFor: standing.pointsFor,
        pointsAgainst: standing.pointsAgainst,
        pointDiff: standing.pointDiff,
        totalPoints: standing.totalPoints,
        ratingBefore: standing.ratingBefore,
        ratingAfter: standing.ratingAfter,
        ratingDelta: this.roundRating(standing.ratingDelta)
      }));
  }

  private buildTournamentRows(
    tournament: Tournament,
    results: TournamentResultsView
  ): TournamentResultsExportRow[] {
    const ratingTimeline = this.buildRatingTimeline(results.matches);
    const drawCounts = this.buildDrawCounts(results.matches);
    const participantIds = this.buildParticipantIdsByName(tournament);
    const station = this.pickString(tournament.studioName)
      ?? this.pickString(tournament.studioId)
      ?? this.pickString(results.games[0]?.stationName)
      ?? 'Без станции';
    const direction = resolveTournamentDirectionLabel(tournament);
    const startIso = this.pickString(tournament.startsAt);
    const start = startIso ? this.toExcelDate(startIso) : null;

    return results.standings.map((standing, index) => {
      const playerKey = normalizeTournamentParticipantKey(standing.player);
      const rating = ratingTimeline.get(playerKey);
      const ratingDelta = rating?.before !== undefined && rating.after !== undefined
        ? rating.after - rating.before
        : rating?.delta ?? standing.totalDelta;
      return {
        start,
        startIso,
        station,
        direction,
        tournament: this.pickString(tournament.name) ?? 'Без названия',
        player: standing.player,
        participantId: participantIds.get(playerKey),
        rank: index + 1,
        matches: standing.playedGames,
        wins: standing.wins,
        losses: standing.losses,
        draws: drawCounts.get(playerKey) ?? 0,
        pointsFor: standing.scoredPoints,
        pointsAgainst: standing.concededPoints,
        pointDiff: standing.pointsDiff,
        totalPoints: standing.scoredPoints,
        ratingBefore: rating?.before,
        ratingAfter: rating?.after,
        ratingDelta: this.roundRating(ratingDelta)
      };
    });
  }

  private buildRatingTimeline(
    matches: TournamentResultMatchEntry[]
  ): Map<string, { before?: number; after?: number; delta: number }> {
    const timeline = new Map<string, { before?: number; after?: number; delta: number }>();
    matches
      .slice()
      .sort((left, right) => this.compareDateTimes(left.startsAt, right.startsAt))
      .forEach((match) => {
        match.ratingDeltaLines.forEach((line) => {
          const parsed = this.parseRatingLine(line);
          if (!parsed) {
            return;
          }
          const key = normalizeTournamentParticipantKey(parsed.player);
          const current = timeline.get(key) ?? { delta: 0 };
          if (current.before === undefined && parsed.before !== undefined) {
            current.before = parsed.before;
          }
          if (parsed.after !== undefined) {
            current.after = parsed.after;
          }
          current.delta += parsed.delta;
          timeline.set(key, current);
        });
      });
    return timeline;
  }

  private buildDrawCounts(matches: TournamentResultMatchEntry[]): Map<string, number> {
    const draws = new Map<string, number>();
    matches.forEach((match) => {
      const totals = this.resolveScoreTotals(match.resultLines);
      if (!totals || totals[0] !== totals[1]) {
        return;
      }
      match.teams.slice(0, 2).forEach((team) => {
        team.players.forEach((player) => {
          const key = normalizeTournamentParticipantKey(player);
          draws.set(key, (draws.get(key) ?? 0) + 1);
        });
      });
    });
    return draws;
  }

  private buildParticipantIdsByName(tournament: Tournament): Map<string, string> {
    const details = this.toRecord(tournament.details);
    const sourceSnapshot = this.toRecord(details.sourceTournamentSnapshot);
    const participants = [
      ...(Array.isArray(tournament.participants) ? tournament.participants : []),
      ...(Array.isArray(sourceSnapshot.participants)
        ? sourceSnapshot.participants.filter(this.isParticipant)
        : [])
    ];
    const idsByName = new Map<string, Set<string>>();
    participants.forEach((participant) => {
      const key = normalizeTournamentParticipantKey(participant.name);
      const id = this.pickString(participant.id);
      if (!key || !id) {
        return;
      }
      const ids = idsByName.get(key) ?? new Set<string>();
      ids.add(id);
      idsByName.set(key, ids);
    });

    const resolved = new Map<string, string>();
    idsByName.forEach((ids, key) => {
      if (ids.size === 1) {
        resolved.set(key, Array.from(ids)[0]);
      }
    });
    return resolved;
  }

  private resolveTournamentIdentifiers(tournament: Tournament): string[] {
    const details = this.toRecord(tournament.details);
    const sourceSnapshot = this.toRecord(details.sourceTournamentSnapshot);
    return Array.from(new Set([
      this.pickString(tournament.id),
      this.pickString(tournament.exerciseId),
      this.pickString(tournament.sourceTournamentId),
      this.pickString(sourceSnapshot.id)
    ].filter((value): value is string => Boolean(value))));
  }

  private consolidateParticipants(
    resultRows: TournamentResultsExportRow[]
  ): ConsolidatedParticipantRow[] {
    const consolidated = new Map<string, ConsolidatedParticipantRow>();
    resultRows.forEach((row) => {
      const key = row.participantId
        ? `id:${row.participantId}`
        : `name:${normalizeTournamentParticipantKey(row.player)}`;
      const current = consolidated.get(key) ?? {
        participantId: row.participantId,
        player: row.player,
        tournaments: 0,
        stations: new Set<string>(),
        directions: new Set<string>(),
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDiff: 0,
        totalPoints: 0,
        bestRank: row.rank,
        rankSum: 0,
        tournamentWins: 0,
        podiums: 0,
        ratingDeltaSum: 0
      };

      current.tournaments += 1;
      current.stations.add(row.station);
      current.directions.add(row.direction);
      current.matches += row.matches;
      current.wins += row.wins;
      current.losses += row.losses;
      current.draws += row.draws;
      current.pointsFor += row.pointsFor;
      current.pointsAgainst += row.pointsAgainst;
      current.pointDiff += row.pointDiff;
      current.totalPoints += row.totalPoints;
      current.bestRank = Math.min(current.bestRank, row.rank);
      current.rankSum += row.rank;
      current.tournamentWins += row.rank === 1 ? 1 : 0;
      current.podiums += row.rank <= 3 ? 1 : 0;
      current.ratingDeltaSum += row.ratingDelta;

      if (row.start) {
        if (!current.firstStart || row.start.getTime() < current.firstStart.getTime()) {
          current.firstStart = row.start;
          current.firstStartIso = row.startIso;
          if (row.ratingBefore !== undefined) {
            current.ratingBefore = row.ratingBefore;
          }
        } else if (current.ratingBefore === undefined && row.ratingBefore !== undefined) {
          current.ratingBefore = row.ratingBefore;
        }
        if (!current.lastStart || row.start.getTime() >= current.lastStart.getTime()) {
          current.lastStart = row.start;
          current.lastStartIso = row.startIso;
          if (row.ratingAfter !== undefined) {
            current.ratingAfter = row.ratingAfter;
          }
        }
      }
      consolidated.set(key, current);
    });

    return Array.from(consolidated.values()).sort((left, right) =>
      left.player.localeCompare(right.player, 'ru')
    );
  }

  private buildWorkbook(
    resultRows: TournamentResultsExportRow[],
    uniqueRows: ConsolidatedParticipantRow[]
  ): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PadlHub CUP';
    workbook.created = new Date();
    workbook.modified = new Date();

    const resultsSheet = workbook.addWorksheet('Результаты', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });
    resultsSheet.columns = [
      { header: 'start', key: 'start', width: 20 },
      { header: 'station', key: 'station', width: 18 },
      { header: 'tournament', key: 'tournament', width: 34 },
      { header: 'player', key: 'player', width: 24 },
      { header: 'rank', key: 'rank', width: 8 },
      { header: 'matches', key: 'matches', width: 10 },
      { header: 'wins', key: 'wins', width: 8 },
      { header: 'losses', key: 'losses', width: 9 },
      { header: 'draws', key: 'draws', width: 8 },
      { header: 'points_for', key: 'pointsFor', width: 12 },
      { header: 'points_against', key: 'pointsAgainst', width: 14 },
      { header: 'point_diff', key: 'pointDiff', width: 11 },
      { header: 'total_points', key: 'totalPoints', width: 12 },
      { header: 'rating_before', key: 'ratingBefore', width: 14 },
      { header: 'rating_after', key: 'ratingAfter', width: 14 },
      { header: 'rating_delta', key: 'ratingDelta', width: 13 }
    ];
    resultRows.forEach((row) => {
      resultsSheet.addRow({
        ...row,
        ratingBefore: row.ratingBefore ?? null,
        ratingAfter: row.ratingAfter ?? null
      });
    });
    this.styleWorksheet(resultsSheet, {
      dateColumns: ['A'],
      ratingColumns: ['N', 'O', 'P'],
      integerColumns: ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']
    });

    const uniqueSheet = workbook.addWorksheet('Уникальные участники', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });
    uniqueSheet.columns = [
      { header: 'participant_id', key: 'participantId', width: 38 },
      { header: 'player', key: 'player', width: 24 },
      { header: 'tournaments', key: 'tournaments', width: 12 },
      { header: 'stations', key: 'stations', width: 28 },
      { header: 'directions', key: 'directions', width: 30 },
      { header: 'first_start', key: 'firstStart', width: 20 },
      { header: 'last_start', key: 'lastStart', width: 20 },
      { header: 'matches', key: 'matches', width: 10 },
      { header: 'wins', key: 'wins', width: 8 },
      { header: 'losses', key: 'losses', width: 9 },
      { header: 'draws', key: 'draws', width: 8 },
      { header: 'points_for', key: 'pointsFor', width: 12 },
      { header: 'points_against', key: 'pointsAgainst', width: 14 },
      { header: 'point_diff', key: 'pointDiff', width: 11 },
      { header: 'total_points', key: 'totalPoints', width: 12 },
      { header: 'best_rank', key: 'bestRank', width: 11 },
      { header: 'avg_rank', key: 'averageRank', width: 11 },
      { header: 'tournament_wins', key: 'tournamentWins', width: 16 },
      { header: 'podiums', key: 'podiums', width: 10 },
      { header: 'rating_before', key: 'ratingBefore', width: 14 },
      { header: 'rating_after', key: 'ratingAfter', width: 14 },
      { header: 'rating_delta', key: 'ratingDelta', width: 13 }
    ];
    uniqueRows.forEach((row) => {
      const ratingDelta = row.ratingBefore !== undefined && row.ratingAfter !== undefined
        ? row.ratingAfter - row.ratingBefore
        : row.ratingDeltaSum;
      uniqueSheet.addRow({
        participantId: row.participantId ?? null,
        player: row.player,
        tournaments: row.tournaments,
        stations: Array.from(row.stations).sort((a, b) => a.localeCompare(b, 'ru')).join(', '),
        directions: Array.from(row.directions).sort((a, b) => a.localeCompare(b, 'ru')).join(', '),
        firstStart: row.firstStart ?? null,
        lastStart: row.lastStart ?? null,
        matches: row.matches,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        pointsFor: this.roundPoints(row.pointsFor),
        pointsAgainst: this.roundPoints(row.pointsAgainst),
        pointDiff: this.roundPoints(row.pointDiff),
        totalPoints: this.roundPoints(row.totalPoints),
        bestRank: row.bestRank,
        averageRank: this.roundPoints(row.rankSum / row.tournaments),
        tournamentWins: row.tournamentWins,
        podiums: row.podiums,
        ratingBefore: row.ratingBefore ?? null,
        ratingAfter: row.ratingAfter ?? null,
        ratingDelta: this.roundRating(ratingDelta)
      });
    });
    this.styleWorksheet(uniqueSheet, {
      dateColumns: ['F', 'G'],
      ratingColumns: ['T', 'U', 'V'],
      integerColumns: ['C', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S'],
      decimalColumns: ['Q']
    });

    return workbook;
  }

  private styleWorksheet(
    sheet: ExcelJS.Worksheet,
    columns: {
      dateColumns: string[];
      ratingColumns: string[];
      integerColumns: string[];
      decimalColumns?: string[];
    }
  ): void {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount }
    };
    sheet.properties.defaultRowHeight = 18;
    sheet.getRow(1).height = 23;
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FF1F2937' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = this.buildCellBorder();
    });
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        cell.border = this.buildCellBorder();
        cell.alignment = {
          vertical: 'middle',
          horizontal: typeof cell.value === 'string' || columnNumber === 1 ? 'left' : 'right'
        };
      });
    });
    columns.dateColumns.forEach((column) => {
      this.setColumnNumberFormat(sheet, column, 'dd.mm.yyyy, hh:mm');
    });
    columns.ratingColumns.forEach((column) => {
      this.setColumnNumberFormat(sheet, column, '0.#####');
    });
    columns.integerColumns.forEach((column) => {
      this.setColumnNumberFormat(sheet, column, '0');
    });
    (columns.decimalColumns ?? []).forEach((column) => {
      this.setColumnNumberFormat(sheet, column, '0.00');
    });
  }

  private setColumnNumberFormat(
    sheet: ExcelJS.Worksheet,
    column: string,
    numberFormat: string
  ): void {
    sheet.getColumn(column).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > 1) {
        cell.numFmt = numberFormat;
      }
    });
  }

  private buildCellBorder(): Partial<ExcelJS.Borders> {
    const edge = { style: 'thin' as const, color: { argb: 'FFB7B7B7' } };
    return { top: edge, left: edge, bottom: edge, right: edge };
  }

  private normalizePeriod(fromValue: unknown, toValue: unknown): { from: string; to: string } {
    const from = this.requireDateKey(fromValue, 'from');
    const to = this.requireDateKey(toValue, 'to');
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    if (toDate.getTime() < fromDate.getTime()) {
      throw new BadRequestException('to must not be earlier than from');
    }
    const rangeDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (rangeDays > EXPORT_MAX_DAYS) {
      throw new BadRequestException(`Export period must not exceed ${EXPORT_MAX_DAYS} days`);
    }
    return { from, to };
  }

  private requireDateKey(value: unknown, field: 'from' | 'to'): string {
    const normalized = this.pickString(value);
    if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new BadRequestException(`${field} must use YYYY-MM-DD format`);
    }
    const parsed = new Date(`${normalized}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
      throw new BadRequestException(`${field} must be a valid calendar date`);
    }
    return normalized;
  }

  private normalizeFilter(value: unknown, field: string): string | undefined {
    const normalized = this.pickString(value);
    if (!normalized || normalized.toUpperCase() === 'ALL') {
      return undefined;
    }
    if (normalized.length > 240) {
      throw new BadRequestException(`${field} filter is too long`);
    }
    return normalized;
  }

  private matchesStation(tournament: Tournament, filter?: string): boolean {
    if (!filter) {
      return true;
    }
    const normalized = filter.toLocaleLowerCase('ru');
    if (normalized.startsWith('id:')) {
      return normalizeTournamentParticipantKey(tournament.studioId) === normalized.slice(3);
    }
    if (normalized.startsWith('name:')) {
      return normalizeTournamentParticipantKey(tournament.studioName) === normalized.slice(5);
    }
    return [tournament.studioId, tournament.studioName]
      .some((value) => normalizeTournamentParticipantKey(value) === normalized);
  }

  private matchesDirection(tournament: Tournament, filter?: string): boolean {
    if (!filter) {
      return true;
    }
    return buildTournamentDirectionFilterValue(tournament) === filter.toLocaleLowerCase('ru');
  }

  private dedupeTournaments(tournaments: Tournament[]): Tournament[] {
    const deduped = new Map<string, Tournament>();
    tournaments.forEach((tournament) => {
      const key = this.pickString(tournament.sourceTournamentId)
        ?? this.pickString(tournament.exerciseId)
        ?? tournament.id;
      if (!deduped.has(key)) {
        deduped.set(key, tournament);
      }
    });
    return Array.from(deduped.values()).sort((left, right) =>
      this.compareDateTimes(left.startsAt, right.startsAt)
    );
  }

  private parseRatingLine(line: string): ParsedRatingLine | null {
    const normalized = this.pickString(line);
    if (!normalized) {
      return null;
    }
    const fullMatch = normalized.match(
      /^(.*?):\s*([+\-]?\d+(?:[.,]\d+)?)\s*(?:->|→)\s*([+\-]?\d+(?:[.,]\d+)?)\s*\(([+\-]?\d+(?:[.,]\d+)?)\)\s*$/
    );
    if (fullMatch) {
      const player = this.pickString(fullMatch[1]);
      const before = this.parseNumber(fullMatch[2]);
      const after = this.parseNumber(fullMatch[3]);
      const delta = this.parseNumber(fullMatch[4]);
      if (player && before !== undefined && after !== undefined && delta !== undefined) {
        return { player, before, after, delta };
      }
    }
    const deltaMatch = normalized.match(/^(.*?):.*\(([+\-]?\d+(?:[.,]\d+)?)\)\s*$/);
    if (!deltaMatch) {
      return null;
    }
    const player = this.pickString(deltaMatch[1]);
    const delta = this.parseNumber(deltaMatch[2]);
    return player && delta !== undefined ? { player, delta } : null;
  }

  private resolveScoreTotals(lines: string[]): [number, number] | null {
    const pairs = lines
      .map((line) => this.pickString(line)?.match(/^(\d+(?:[.,]\d+)?)\s*[:\-]\s*(\d+(?:[.,]\d+)?)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [this.parseNumber(match[1]), this.parseNumber(match[2])] as const)
      .filter((pair): pair is readonly [number, number] =>
        pair[0] !== undefined && pair[1] !== undefined
      );
    if (pairs.length === 0) {
      return null;
    }
    return pairs.reduce<[number, number]>((totals, pair) => [
      totals[0] + pair[0],
      totals[1] + pair[1]
    ], [0, 0]);
  }

  private toExcelDate(value: string): Date | null {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      return null;
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: EXPORT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(parsed);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return new Date(Date.UTC(
      Number(values.get('year')),
      Number(values.get('month')) - 1,
      Number(values.get('day')),
      Number(values.get('hour')),
      Number(values.get('minute')),
      Number(values.get('second'))
    ));
  }

  private compareDateTimes(left?: string, right?: string): number {
    const leftTime = Date.parse(left ?? '');
    const rightTime = Date.parse(right ?? '');
    const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
    const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
    return normalizedLeft - normalizedRight;
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>
  ): Promise<R[]> {
    const result = new Array<R>(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        result[index] = await mapper(items[index]);
      }
    });
    await Promise.all(workers);
    return result;
  }

  private isParticipant(value: unknown): value is TournamentParticipant {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).name === 'string'
    );
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private pickString(value: unknown): string | undefined {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || undefined;
  }

  private parseNumber(value: unknown): number | undefined {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private roundPoints(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private roundRating(value: number): number {
    return Math.round(value * 100_000) / 100_000;
  }
}

export function normalizeTournamentParticipantKey(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('ru');
}

export function resolveTournamentDirectionLabel(tournament: Tournament): string {
  const details = tournament.details && typeof tournament.details === 'object'
    ? tournament.details
    : {};
  const snapshot = details.sourceTournamentSnapshot
    && typeof details.sourceTournamentSnapshot === 'object'
    && !Array.isArray(details.sourceTournamentSnapshot)
      ? details.sourceTournamentSnapshot as Record<string, unknown>
      : {};
  const candidates = [
    snapshot.name,
    tournament.skin?.title,
    tournament.name,
    tournament.tournamentType
  ];
  const label = candidates.find((candidate) =>
    typeof candidate === 'string' && candidate.trim().length > 0
  );
  return typeof label === 'string' ? label.trim() : 'Без направления';
}

export function buildTournamentDirectionFilterValue(tournament: Tournament): string {
  return `name:${normalizeTournamentParticipantKey(resolveTournamentDirectionLabel(tournament))}`;
}

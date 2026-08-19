import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { AmericanoRatingSimulationResult } from './americano-rating.types';
import { AmericanoScheduleResult } from './americano-schedule.types';
import { CreateCustomTournamentFromVivaLinkDto } from './dto/create-custom-tournament-from-viva-link.dto';
import { CreateCustomTournamentFromSourceDto } from './dto/create-custom-tournament-from-source.dto';
import { GenerateTournamentScheduleDto } from './dto/generate-tournament-schedule.dto';
import { SimulateTournamentRatingDto } from './dto/simulate-tournament-rating.dto';
import { UpdateCustomTournamentDto } from './dto/update-custom-tournament.dto';
import {
  CustomTournament,
  Tournament,
  TournamentCustomEnergyCheckoutResponse,
  TournamentListSnapshotResponse,
  TournamentResultsView
} from './tournaments.types';
import { TournamentResultsExportService } from './tournament-results-export.service';
import { TournamentsVivaStatusSyncService } from './tournaments-viva-status-sync.service';
import { TournamentsService } from './tournaments.service';

@Controller('tournaments')
@Roles(
  Role.SUPER_ADMIN,
  Role.TOURNAMENT_MANAGER,
  Role.MANAGER,
  Role.STATION_ADMIN,
  Role.GAME_MANAGER
)
export class TournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly vivaStatusSyncService: TournamentsVivaStatusSyncService,
    private readonly tournamentResultsExportService: TournamentResultsExportService
  ) {}

  @Get()
  @Roles()
  findAll(
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('refresh') refresh?: string,
    @CurrentUser() user?: RequestUser
  ): Promise<Tournament[] | TournamentListSnapshotResponse> {
    const options = { date, from, to, user };
    return refresh === 'if-stale'
      ? this.tournamentsService.findAllWithSnapshotRevalidation(options)
      : this.tournamentsService.findAll(options);
  }

  @Get('export/results.xlsx')
  @Permissions('tournaments:read')
  @Roles()
  async exportResults(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('station') station: string | undefined,
    @Query('direction') direction: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Res() response: Response
  ): Promise<void> {
    const exported = await this.tournamentResultsExportService.buildExport({
      from,
      to,
      station,
      direction,
      user
    });
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${exported.fileName}"`
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, X-Export-Tournaments, X-Export-Rows, X-Export-Unique-Participants'
    );
    response.setHeader('X-Export-Tournaments', String(exported.tournamentsCount));
    response.setHeader('X-Export-Rows', String(exported.resultRowsCount));
    response.setHeader('X-Export-Unique-Participants', String(exported.uniqueParticipantsCount));
    response.send(exported.buffer);
  }

  @Post('snapshot/refresh-on-open')
  @Permissions('tournaments:read')
  @Roles()
  refreshSnapshotOnOpen(): ReturnType<TournamentsService['refreshVivaTournamentSnapshotOnAdminOpen']> {
    return this.tournamentsService.refreshVivaTournamentSnapshotOnAdminOpen();
  }

  @Post('snapshot/refresh-day')
  @Roles()
  refreshSnapshotDay(
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Request
  ): ReturnType<TournamentsService['refreshVivaTournamentSnapshotDay']> {
    return this.tournamentsService.refreshVivaTournamentSnapshotDay({
      date: body?.date,
      authorizationHeader: this.pickString(request.headers.authorization),
      tenantKeyHeader: this.pickString(request.headers['x-padlhub-tenant-key'])
    });
  }

  @Post('snapshot/admin-refresh-day')
  @Permissions('tournaments:write')
  @Roles()
  refreshSnapshotAdminDay(
    @Body() body: Record<string, unknown> | undefined,
    @CurrentUser() user?: RequestUser
  ): ReturnType<TournamentsService['refreshVivaTournamentSnapshotAdminDay']> {
    return this.tournamentsService.refreshVivaTournamentSnapshotAdminDay(body?.date, user);
  }

  @Post('backfill/pricing-snapshots')
  @Permissions('access:manage')
  backfillPricingSnapshots(): Promise<{
    windowStart: string;
    candidatesCount: number;
    readyCount: number;
    staleCount: number;
    missingCount: number;
  }> {
    return this.tournamentsService.backfillPricingSnapshots();
  }

  @Post('custom/from-source/:sourceTournamentId')
  @Permissions('tournaments:write')
  createCustomFromSource(
    @Param('sourceTournamentId') sourceTournamentId: string,
    @Body() dto: CreateCustomTournamentFromSourceDto,
    @CurrentUser() user?: RequestUser
  ): Promise<CustomTournament> {
    return this.tournamentsService.createCustomFromSource(sourceTournamentId, {
      ...dto,
      ...(user ? { actor: this.toActor(user) } : {})
    }, user);
  }

  @Post('custom/from-viva-link')
  @Permissions('tournaments:write')
  createCustomFromVivaLink(
    @Body() dto: CreateCustomTournamentFromVivaLinkDto,
    @CurrentUser() user?: RequestUser
  ): Promise<CustomTournament> {
    return this.tournamentsService.createCustomFromVivaLink(dto.vivaUrl, {
      ...dto,
      ...(user ? { actor: this.toActor(user) } : {})
    }, user);
  }

  @Get('custom/:id')
  @Permissions('tournaments:read')
  findCustomById(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<CustomTournament> {
    return this.tournamentsService.findCustomById(id, user);
  }

  @Patch('custom/:id')
  @Permissions('tournaments:write')
  updateCustom(
    @Param('id') id: string,
    @Body() dto: UpdateCustomTournamentDto,
    @CurrentUser() user?: RequestUser
  ): Promise<CustomTournament> {
    return this.tournamentsService.updateCustom(id, {
      ...dto,
      ...(user ? { actor: this.toActor(user) } : {})
    }, {
      rebuildPricingSnapshot: true
    }, user);
  }

  @Post('generate-schedule')
  @Permissions('tournaments:write')
  generateSchedule(
    @Body() dto: GenerateTournamentScheduleDto
  ): Promise<AmericanoScheduleResult> {
    return this.tournamentsService.generateSchedule(dto);
  }

  @Post('simulate-rating')
  @Permissions('tournaments:write')
  simulateRating(
    @Body() dto: SimulateTournamentRatingDto
  ): Promise<AmericanoRatingSimulationResult> {
    return this.tournamentsService.simulateRating(dto);
  }

  @Get(':id/results')
  @Permissions('tournaments:read')
  getResults(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<TournamentResultsView> {
    return this.tournamentsService.getResults(id, user);
  }

  @Get(':id/registration/me')
  @Roles()
  async getMyRegistration(
    @Param('id') id: string,
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<{
    status: 'NONE' | 'REGISTERED' | 'WAITLIST';
    placeNumber?: number;
    waitlistNumber?: number;
    canRegister: boolean;
    canCancel: boolean;
    message: string;
  }> {
    const client = await this.resolveLkClient(request, user);
    return this.tournamentsService.getPublicRegistrationByTournamentRef(id, client.phone);
  }

  @Post(':id/register')
  @Roles()
  async registerFromLkWidget(
    @Param('id') id: string,
    @Req() request: Request,
    @Body() body?: Record<string, unknown>,
    @CurrentUser() user?: RequestUser
  ): Promise<{
    status: 'NONE' | 'REGISTERED' | 'WAITLIST';
    placeNumber?: number;
    waitlistNumber?: number;
    canRegister: boolean;
    canCancel: boolean;
    message: string;
  }> {
    const client = await this.resolveLkClient(request, user, body);
    if (!client.phone) {
      return {
        status: 'NONE',
        canRegister: false,
        canCancel: false,
        message: 'Не удалось определить номер телефона для записи.'
      };
    }

    const outcome = await this.tournamentsService.registerPublicParticipantByTournamentRef(id, {
      name: client.name || client.phone,
      phone: client.phone,
      levelLabel: client.levelLabel,
      notes: this.pickString(body?.notes) ?? undefined,
      vivaAuthorizationHeader: this.pickString(request.headers.authorization) ?? undefined
    });
    return this.toLkRegistrationState(outcome);
  }

  @Delete(':id/register')
  @Roles()
  async cancelLkWidgetRegistration(
    @Param('id') id: string,
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<{
    status: 'NONE';
    canRegister: boolean;
    canCancel: false;
    message: string;
  }> {
    const client = await this.resolveLkClient(request, user);
    return this.tournamentsService.cancelPublicRegistrationByTournamentRef(id, client.phone);
  }

  @Post(':exerciseId/custom-energy-checkout')
  @Roles()
  createCustomEnergyCheckout(
    @Param('exerciseId') exerciseId: string,
    @Req() request: Request,
    @Body() body?: Record<string, unknown>
  ): Promise<TournamentCustomEnergyCheckoutResponse> {
    return this.tournamentsService.createCustomEnergyCheckout(exerciseId, {
      body: body && typeof body === 'object' && !Array.isArray(body) ? body : {},
      authorizationHeader: this.pickString(request.headers.authorization),
      authSourceHeader: this.pickString(request.headers['x-padlhub-auth-source']),
      tenantKeyHeader: this.pickString(request.headers['x-padlhub-tenant-key'])
    });
  }

  @Get('debug/viva-status-sync')
  @Permissions('tournaments:read')
  @Roles(Role.SUPER_ADMIN, Role.TOURNAMENT_MANAGER, Role.MANAGER)
  getVivaStatusSyncDiagnostics(): {
    enabled: boolean;
    intervalMs: number;
    forwardDays: number;
    runOnStartup: boolean;
    inProgress: boolean;
    lastStartedAt?: string;
    lastCompletedAt?: string;
    lastDurationMs?: number;
    lastError?: string;
    lastRunStatus?: 'SUCCESS' | 'ERROR' | 'SKIPPED';
    lastRunMessage?: string;
    lastResult?: {
      windowStart: string;
      windowEnd: string;
      candidatesCount: number;
      checkedCount: number;
      updatedCount: number;
      sourceNotFoundCount: number;
      sourceNotCanceledCount: number;
    };
    recentRuns: Array<{
      trigger: 'startup' | 'interval';
      status: 'SUCCESS' | 'ERROR' | 'SKIPPED';
      startedAt: string;
      completedAt?: string;
      durationMs?: number;
      message?: string;
      error?: string;
      result?: {
        windowStart: string;
        windowEnd: string;
        candidatesCount: number;
        checkedCount: number;
        updatedCount: number;
        sourceNotFoundCount: number;
        sourceNotCanceledCount: number;
      };
    }>;
  } {
    return this.vivaStatusSyncService.getRuntimeDiagnostics();
  }

  @Get('debug/viva-snapshot')
  @Roles(Role.SUPER_ADMIN, Role.TOURNAMENT_MANAGER, Role.MANAGER)
  getVivaTournamentSnapshotDiagnostics(): ReturnType<TournamentsService['getVivaTournamentSnapshotDiagnostics']> {
    return this.tournamentsService.getVivaTournamentSnapshotDiagnostics();
  }

  @Get('debug/viva-reference-cache')
  @Roles(Role.SUPER_ADMIN, Role.TOURNAMENT_MANAGER, Role.MANAGER)
  getVivaReferenceCacheDiagnostics(): ReturnType<TournamentsService['getVivaReferenceCacheDiagnostics']> {
    return this.tournamentsService.getVivaReferenceCacheDiagnostics();
  }

  @Get('debug/viva-governor')
  @Roles(Role.SUPER_ADMIN, Role.TOURNAMENT_MANAGER, Role.MANAGER)
  getVivaGovernorDiagnostics(): ReturnType<TournamentsService['getVivaGovernorDiagnostics']> {
    return this.tournamentsService.getVivaGovernorDiagnostics();
  }

  @Get(':id')
  @Roles()
  findById(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<Tournament> {
    return this.tournamentsService.findById(id, user);
  }

  private toActor(user: RequestUser): { id: string; login?: string; name: string } {
    return {
      id: user.id,
      ...(user.login ? { login: user.login } : {}),
      name: user.title || user.login || user.id
    };
  }

  private toLkRegistrationState(outcome: {
    ok: boolean;
    code: string;
    message: string;
    participant?: { status?: string };
  }): {
    status: 'NONE' | 'REGISTERED' | 'WAITLIST';
    canRegister: boolean;
    canCancel: boolean;
    message: string;
  } {
    const participantStatus = String(outcome.participant?.status ?? '').toUpperCase();
    const status =
      outcome.code === 'REGISTERED' ||
      outcome.code === 'ALREADY_REGISTERED' ||
      participantStatus === 'REGISTERED'
        ? 'REGISTERED'
        : outcome.code === 'WAITLISTED' ||
            outcome.code === 'ALREADY_WAITLISTED' ||
            participantStatus === 'WAITLIST'
          ? 'WAITLIST'
          : 'NONE';
    return {
      status,
      canRegister: status === 'NONE' && outcome.ok !== false,
      canCancel: status !== 'NONE',
      message: outcome.message
    };
  }

  private async resolveLkClient(
    request: Request,
    _user?: RequestUser,
    _body?: Record<string, unknown>
  ): Promise<{ name: string; phone: string; levelLabel?: string }> {
    return this.tournamentsService.resolveTrustedLkRegistrationClient(
      this.pickString(request.headers.authorization)
    );
  }

  private pickString(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      return this.pickString(value[0]);
    }
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }
}

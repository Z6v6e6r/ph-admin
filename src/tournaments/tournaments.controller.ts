import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { AmericanoRatingSimulationResult } from './americano-rating.types';
import { AmericanoScheduleResult } from './americano-schedule.types';
import { CreateCustomTournamentFromSourceDto } from './dto/create-custom-tournament-from-source.dto';
import { GenerateTournamentScheduleDto } from './dto/generate-tournament-schedule.dto';
import { SimulateTournamentRatingDto } from './dto/simulate-tournament-rating.dto';
import { UpdateCustomTournamentDto } from './dto/update-custom-tournament.dto';
import { CustomTournament, Tournament, TournamentResultsView } from './tournaments.types';
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
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get()
  @Roles()
  findAll(@Query('date') date?: string): Promise<Tournament[]> {
    return this.tournamentsService.findAll({ date });
  }

  @Post('custom/from-source/:sourceTournamentId')
  createCustomFromSource(
    @Param('sourceTournamentId') sourceTournamentId: string,
    @Body() dto: CreateCustomTournamentFromSourceDto,
    @CurrentUser() user?: RequestUser
  ): Promise<CustomTournament> {
    return this.tournamentsService.createCustomFromSource(sourceTournamentId, {
      ...dto,
      ...(user ? { actor: this.toActor(user) } : {})
    });
  }

  @Get('custom/:id')
  findCustomById(@Param('id') id: string): Promise<CustomTournament> {
    return this.tournamentsService.findCustomById(id);
  }

  @Patch('custom/:id')
  updateCustom(
    @Param('id') id: string,
    @Body() dto: UpdateCustomTournamentDto,
    @CurrentUser() user?: RequestUser
  ): Promise<CustomTournament> {
    return this.tournamentsService.updateCustom(id, {
      ...dto,
      ...(user ? { actor: this.toActor(user) } : {})
    });
  }

  @Post('generate-schedule')
  generateSchedule(
    @Body() dto: GenerateTournamentScheduleDto
  ): Promise<AmericanoScheduleResult> {
    return this.tournamentsService.generateSchedule(dto);
  }

  @Post('simulate-rating')
  simulateRating(
    @Body() dto: SimulateTournamentRatingDto
  ): Promise<AmericanoRatingSimulationResult> {
    return this.tournamentsService.simulateRating(dto);
  }

  @Get(':id/results')
  getResults(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<TournamentResultsView> {
    return this.tournamentsService.getResults(id, user);
  }

  @Get(':id/registration/me')
  @Roles()
  getMyRegistration(
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
    const client = this.resolveLkClient(request, user);
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
    const client = this.resolveLkClient(request, user, body);
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
  cancelLkWidgetRegistration(
    @Param('id') id: string,
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<{
    status: 'NONE';
    canRegister: boolean;
    canCancel: false;
    message: string;
  }> {
    const client = this.resolveLkClient(request, user);
    return this.tournamentsService.cancelPublicRegistrationByTournamentRef(id, client.phone);
  }

  @Get(':id')
  @Roles()
  findById(@Param('id') id: string): Promise<Tournament> {
    return this.tournamentsService.findById(id);
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

  private resolveLkClient(
    request: Request,
    user?: RequestUser,
    body?: Record<string, unknown>
  ): { name: string; phone?: string; levelLabel?: string } {
    const claims = this.decodeBearerClaims(request.headers.authorization);
    const phone =
      this.pickString(body?.phone) ??
      this.pickString(request.headers['x-user-phone']) ??
      this.pickString(request.headers['x-user-primary-phone']) ??
      this.pickString(claims?.phone_number) ??
      this.pickString(claims?.phone) ??
      this.pickString(claims?.mobile) ??
      this.pickPhoneLike(claims?.preferred_username);
    const name =
      this.pickString(body?.name) ??
      this.pickString(request.headers['x-user-name']) ??
      this.pickString(request.headers['x-user-title']) ??
      this.pickString(claims?.name) ??
      this.pickString(claims?.given_name) ??
      this.pickString(claims?.preferred_username) ??
      user?.title ??
      user?.login ??
      phone ??
      'Игрок PadelHub';
    const levelLabel =
      this.pickString(body?.levelLabel) ??
      this.pickString(request.headers['x-user-level-label']) ??
      this.pickString(request.headers['x-user-level']) ??
      this.pickString(claims?.levelLabel) ??
      this.pickString(claims?.level);

    return {
      name,
      phone,
      levelLabel
    };
  }

  private decodeBearerClaims(authorization: unknown): Record<string, unknown> | null {
    const value = this.pickString(authorization);
    const match = value?.match(/^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/i);
    if (!match?.[2]) {
      return null;
    }

    try {
      const payload = Buffer.from(match[2], 'base64url').toString('utf8');
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch (_error) {
      return null;
    }
  }

  private pickPhoneLike(value: unknown): string | undefined {
    const normalized = this.pickString(value);
    if (!normalized) {
      return undefined;
    }
    const digits = normalized.replace(/\D/g, '');
    return digits.length >= 10 ? normalized : undefined;
  }

  private pickString(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      return this.pickString(value[0]);
    }
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }
}

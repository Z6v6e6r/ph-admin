import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicTournamentAccessCheckDto } from './dto/public-tournament-access-check.dto';
import { RegisterTournamentParticipantDto } from './dto/register-tournament-participant.dto';
import { TournamentMechanicsAccessDto } from './dto/tournament-mechanics-access.dto';
import {
  TournamentAccessCheckResponse,
  TournamentMechanicsAccessResponse,
  TournamentPublicView,
  TournamentRegistrationResponse
} from './tournaments.types';
import { TournamentsService } from './tournaments.service';

@Controller('tournaments/public')
export class TournamentsPublicController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get(':slug')
  findPublicBySlug(@Param('slug') slug: string): Promise<TournamentPublicView> {
    return this.tournamentsService.getPublicBySlug(slug);
  }

  @Post(':slug/access-check')
  checkAccess(
    @Param('slug') slug: string,
    @Body() dto: PublicTournamentAccessCheckDto
  ): Promise<TournamentAccessCheckResponse> {
    return this.tournamentsService.checkPublicAccess(slug, dto.levelLabel);
  }

  @Post(':slug/registrations')
  registerParticipant(
    @Param('slug') slug: string,
    @Body() dto: RegisterTournamentParticipantDto
  ): Promise<TournamentRegistrationResponse> {
    return this.tournamentsService.registerPublicParticipant(slug, dto);
  }

  @Post(':slug/mechanics-access')
  checkMechanicsAccess(
    @Param('slug') slug: string,
    @Body() dto: TournamentMechanicsAccessDto
  ): Promise<TournamentMechanicsAccessResponse> {
    return this.tournamentsService.checkMechanicsAccess(slug, dto.phone);
  }
}

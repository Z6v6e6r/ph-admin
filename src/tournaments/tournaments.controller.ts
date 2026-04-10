import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { AmericanoRatingSimulationResult } from './americano-rating.types';
import { AmericanoScheduleResult } from './americano-schedule.types';
import { CreateCustomTournamentFromSourceDto } from './dto/create-custom-tournament-from-source.dto';
import { GenerateTournamentScheduleDto } from './dto/generate-tournament-schedule.dto';
import { SimulateTournamentRatingDto } from './dto/simulate-tournament-rating.dto';
import { UpdateCustomTournamentDto } from './dto/update-custom-tournament.dto';
import { CustomTournament, Tournament } from './tournaments.types';
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
  findAll(): Promise<Tournament[]> {
    return this.tournamentsService.findAll();
  }

  @Post('custom/from-source/:sourceTournamentId')
  createCustomFromSource(
    @Param('sourceTournamentId') sourceTournamentId: string,
    @Body() dto: CreateCustomTournamentFromSourceDto
  ): Promise<CustomTournament> {
    return this.tournamentsService.createCustomFromSource(sourceTournamentId, dto);
  }

  @Get('custom/:id')
  findCustomById(@Param('id') id: string): Promise<CustomTournament> {
    return this.tournamentsService.findCustomById(id);
  }

  @Patch('custom/:id')
  updateCustom(
    @Param('id') id: string,
    @Body() dto: UpdateCustomTournamentDto
  ): Promise<CustomTournament> {
    return this.tournamentsService.updateCustom(id, dto);
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

  @Get(':id')
  findById(@Param('id') id: string): Promise<Tournament> {
    return this.tournamentsService.findById(id);
  }
}

import { Body, Controller, Header, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Roles } from '../common/rbac/roles.decorator';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { PrepareTournamentOwnerDto } from './dto/prepare-tournament-owner.dto';
import { TournamentsService } from './tournaments.service';
import { TournamentOwnerPreparation } from './tournaments.types';

@Controller('internal/tournaments/owner-preparations')
@Roles()
export class TournamentsOwnerPreparationController {
  constructor(private readonly service: TournamentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @SkipAdminMutationAudit()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  prepare(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-cup-integration-token') integrationToken: string | undefined,
    @Body() dto: PrepareTournamentOwnerDto
  ): Promise<TournamentOwnerPreparation> {
    return this.service.prepareTournamentOwner(authorization, integrationToken, dto);
  }
}

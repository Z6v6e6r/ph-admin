import { Body, Controller, Header, Headers, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../common/rbac/roles.decorator';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { TournamentsService } from './tournaments.service';
import { TournamentLocalOperationDto, TournamentLocalOperationReadDto } from './dto/tournament-local-operation.dto';

@Controller('internal/tournaments/local-operations')
@Roles()
export class TournamentsLocalOwnerController {
  constructor(private readonly service: TournamentsService) {}
  @Post() @HttpCode(200) @SkipAdminMutationAudit()
  @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  command(@Headers('authorization') authorization: string | undefined,
    @Headers('x-cup-integration-token') token: string | undefined,
    @Headers('idempotency-key') key: string | undefined, @Body() body: TournamentLocalOperationDto) {
    // The operation contains its audit event in the same canonical Mongo update.
    return this.service.executeLocalTournamentOperation(authorization, token, key, body);
  }
  @Post('read') @HttpCode(200) @SkipAdminMutationAudit()
  @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  read(@Headers('authorization') authorization: string | undefined,
    @Headers('x-cup-integration-token') token: string | undefined, @Body() body: TournamentLocalOperationReadDto) {
    return this.service.readLocalTournamentOperation(authorization, token, body);
  }
}

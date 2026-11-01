import { positionInput, readCommandInput } from './tournament-chat-read.contract';
import { Body, Controller, Header, Headers, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../common/rbac/roles.decorator';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { TournamentChatActorProof } from './tournament-chat.actor-proof';
import { bodyBytes, CHAT_PATH, conflict, historyInput, readInput, sendInput } from './tournament-chat.contract';
import { TournamentChatService } from './tournament-chat.service';

@Controller('internal/tournaments/chat/v1')
@Roles()
export class TournamentChatController {
  constructor(private readonly proof: TournamentChatActorProof, private readonly service: TournamentChatService) {}
  @Post('message-requests') @HttpCode(200) @Header('Cache-Control', 'no-store') @SkipAdminMutationAudit()
  send(@Headers('authorization') authorization: unknown, @Headers('x-correlation-id') correlation: unknown,
    @Headers('idempotency-key') key: unknown, @Body() raw: unknown) {
    const x = sendInput(raw);
    const actor = this.proof.verify(authorization, CHAT_PATH + '/message-requests', bodyBytes(x), correlation);
    if (key !== x.requestId) throw conflict();
    return this.service.send(actor, x);
  }
  @Post('message-requests/read') @HttpCode(200) @Header('Cache-Control', 'no-store') @SkipAdminMutationAudit()
  read(@Headers('authorization') authorization: unknown, @Headers('x-correlation-id') correlation: unknown, @Body() raw: unknown) {
    const x = readInput(raw);
    const actor = this.proof.verify(authorization, CHAT_PATH + '/message-requests/read', bodyBytes(x), correlation);
    return this.service.status(actor, x);
  }
  @Post('history') @HttpCode(200) @Header('Cache-Control', 'no-store') @SkipAdminMutationAudit()
  history(@Headers('authorization') authorization: unknown, @Headers('x-correlation-id') correlation: unknown, @Body() raw: unknown) {
    const x = historyInput(raw);
    const actor = this.proof.verify(authorization, CHAT_PATH + '/history', bodyBytes(x), correlation);
    return this.service.history(actor, x);
  }
  @Post('read-position') @HttpCode(200) @Header('Cache-Control', 'no-store') @SkipAdminMutationAudit()
  position(@Headers('authorization') authorization: unknown, @Headers('x-correlation-id') correlation: unknown, @Body() raw: unknown) {
    const x = positionInput(raw);
    const actor = this.proof.verify(authorization, CHAT_PATH + '/read-position', JSON.stringify(x), correlation);
    return this.service.position(actor, x.tournamentId);
  }
  @Post('read-requests') @HttpCode(200) @Header('Cache-Control', 'no-store') @SkipAdminMutationAudit()
  advanceRead(@Headers('authorization') authorization: unknown, @Headers('x-correlation-id') correlation: unknown,
    @Headers('idempotency-key') key: unknown, @Body() raw: unknown) {
    const x = readCommandInput(raw);
    const actor = this.proof.verify(authorization, CHAT_PATH + '/read-requests', JSON.stringify(x), correlation);
    if (key !== x.requestId) throw conflict();
    return this.service.advanceRead(actor, x);
  }
  @Post('read-requests/read') @HttpCode(200) @Header('Cache-Control', 'no-store') @SkipAdminMutationAudit()
  readStatus(@Headers('authorization') authorization: unknown, @Headers('x-correlation-id') correlation: unknown, @Body() raw: unknown) {
    const x = readInput(raw);
    const actor = this.proof.verify(authorization, CHAT_PATH + '/read-requests/read', bodyBytes(x), correlation);
    return this.service.readStatus(actor, x);
  }

}

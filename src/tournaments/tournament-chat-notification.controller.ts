import { Body, Controller, Header, Headers, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../common/rbac/roles.decorator';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { TournamentChatNotificationProof } from './tournament-chat-notification.proof';
import { TournamentChatNotificationService } from './tournament-chat-notification.service';
import { eligibilityInput, publicationInput, recipientsInput } from './tournament-chat-notification.contract';
@Controller('internal/tournaments/chat-notifications/v1')
@Roles()
export class TournamentChatNotificationController {
 constructor(private readonly proof:TournamentChatNotificationProof,private readonly service:TournamentChatNotificationService){}
 @Post('publications') @HttpCode(200) @Header('Cache-Control','no-store') @SkipAdminMutationAudit()
 publications(@Headers('authorization') authorization:unknown,@Headers('x-correlation-id') correlation:unknown,@Body() raw:unknown){const x=publicationInput(raw);return this.service.publications(this.proof.verify(authorization,'publications',JSON.stringify(x),correlation),x);}
 @Post('recipients') @HttpCode(200) @Header('Cache-Control','no-store') @SkipAdminMutationAudit()
 recipients(@Headers('authorization') authorization:unknown,@Headers('x-correlation-id') correlation:unknown,@Body() raw:unknown){const x=recipientsInput(raw);return this.service.recipients(this.proof.verify(authorization,'recipients',JSON.stringify(x),correlation),x);}
 @Post('eligibility') @HttpCode(200) @Header('Cache-Control','no-store') @SkipAdminMutationAudit()
 eligibility(@Headers('authorization') authorization:unknown,@Headers('x-correlation-id') correlation:unknown,@Body() raw:unknown){const x=eligibilityInput(raw);return this.service.eligibility(this.proof.verify(authorization,'eligibility',JSON.stringify(x),correlation),x);}
}

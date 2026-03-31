import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  UnauthorizedException
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { RemoveWebPushSubscriptionDto } from './dto/remove-web-push-subscription.dto';
import { UpsertWebPushSubscriptionDto } from './dto/upsert-web-push-subscription.dto';
import { WebPushClientConfig } from './web-push.types';
import { WebPushService } from './web-push.service';

@Controller('messenger/web-push')
@Roles(Role.CLIENT)
export class WebPushController {
  constructor(private readonly webPushService: WebPushService) {}

  @Get('config')
  getConfig(@CurrentUser() user?: RequestUser): WebPushClientConfig {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.webPushService.getClientConfig();
  }

  @Post('subscriptions')
  upsertSubscription(
    @Body() dto: UpsertWebPushSubscriptionDto,
    @Headers('user-agent') userAgent: string | undefined,
    @CurrentUser() user?: RequestUser
  ): {
    ok: boolean;
    endpoint: string;
  } {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }

    const stored = this.webPushService.upsertSubscription(user.id, dto.subscription, {
      threadId: dto.threadId,
      userAgent
    });

    return {
      ok: true,
      endpoint: stored.endpoint
    };
  }

  @Delete('subscriptions')
  removeSubscription(
    @Body() dto: RemoveWebPushSubscriptionDto,
    @CurrentUser() user?: RequestUser
  ): { ok: boolean } {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }

    return {
      ok: this.webPushService.removeSubscription(user.id, dto.endpoint)
    };
  }
}

import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AdvertisingModule } from './advertising/advertising.module';
import { AuthModule } from './auth/auth.module';
import { ClientScriptModule } from './client-script/client-script.module';
import { CommunitiesModule } from './communities/communities.module';
import { RequestMetricsInterceptor } from './common/observability/request-metrics.interceptor';
import { RequestMetricsService } from './common/observability/request-metrics.service';
import { GamesModule } from './games/games.module';
import { TelegramConnectorModule } from './integrations/telegram/telegram-connector.module';
import { MessengerModule } from './messenger/messenger.module';
import { SupportModule } from './support/support.module';
import { RolesGuard } from './common/rbac/roles.guard';
import { SystemController } from './system/system.controller';
import { TournamentsModule } from './tournaments/tournaments.module';
import { UiController } from './ui/ui.controller';
import { WebPushModule } from './web-push/web-push.module';

@Module({
  imports: [
    AdvertisingModule,
    AuthModule,
    ClientScriptModule,
    CommunitiesModule,
    GamesModule,
    TournamentsModule,
    MessengerModule,
    SupportModule,
    TelegramConnectorModule,
    WebPushModule
  ],
  controllers: [SystemController, UiController],
  providers: [
    RequestMetricsService,
    {
      provide: APP_GUARD,
      useClass: RolesGuard
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestMetricsInterceptor
    }
  ]
})
export class AppModule {}

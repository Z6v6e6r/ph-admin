import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ClientScriptModule } from './client-script/client-script.module';
import { GamesModule } from './games/games.module';
import { TelegramConnectorModule } from './integrations/telegram/telegram-connector.module';
import { MessengerModule } from './messenger/messenger.module';
import { SupportModule } from './support/support.module';
import { RolesGuard } from './common/rbac/roles.guard';
import { SystemController } from './system/system.controller';
import { TournamentsModule } from './tournaments/tournaments.module';
import { UiController } from './ui/ui.controller';

@Module({
  imports: [
    AuthModule,
    ClientScriptModule,
    GamesModule,
    TournamentsModule,
    MessengerModule,
    SupportModule,
    TelegramConnectorModule
  ],
  controllers: [SystemController, UiController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RolesGuard
    }
  ]
})
export class AppModule {}

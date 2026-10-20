import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ClientScriptModule } from './client-script/client-script.module';
import { RolesGuard } from './common/rbac/roles.guard';
import { SystemController } from './system/system.controller';
import { UiController } from './ui/ui.controller';

@Module({
  imports: [AuthModule, ClientScriptModule],
  controllers: [SystemController, UiController],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }]
})
export class ReleaseMaintenanceModule {}

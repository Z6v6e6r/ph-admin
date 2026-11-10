import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PadlhubAdminProxyController } from './padlhub-admin-proxy.controller';
import { PadlhubAdminProxyService } from './padlhub-admin-proxy.service';

@Module({
  imports: [AuthModule],
  controllers: [PadlhubAdminProxyController],
  providers: [PadlhubAdminProxyService]
})
export class PadlhubAdminProxyModule {}

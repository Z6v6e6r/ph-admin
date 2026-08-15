import { Module } from '@nestjs/common';
import { LkIdentityController } from './lk-identity.controller';
import { LkIdentityService } from './lk-identity.service';

@Module({
  controllers: [LkIdentityController],
  providers: [LkIdentityService]
})
export class LkIdentityModule {}

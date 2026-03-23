import { Module } from '@nestjs/common';
import { AuthPersistenceService } from './auth-persistence.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthPersistenceService],
  exports: [AuthService]
})
export class AuthModule {}

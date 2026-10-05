import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  ReferralLinksAdminController,
  ReferralLinksPublicController
} from './referral-links.controller';
import { ReferralLinksRepository } from './referral-links.repository';
import { ReferralLinksService } from './referral-links.service';

@Module({
  imports: [AuthModule],
  controllers: [ReferralLinksAdminController, ReferralLinksPublicController],
  providers: [ReferralLinksRepository, ReferralLinksService]
})
export class ReferralLinksModule {}

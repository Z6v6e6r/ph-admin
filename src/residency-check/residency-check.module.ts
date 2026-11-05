import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VivaAdminModule } from '../integrations/viva/viva-admin.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ResidentProfileController } from './resident-profile.controller';
import { ResidentProfileService } from './resident-profile.service';
import { SubscriptionsVivaResidentProfileAdapter } from './resident-profile.adapter';
import { HttpResidentPreviewAdapter } from './resident-preview.http.adapter';
import {
  ResidencyCheckAssetController,
  ResidencyCheckPageController
} from './residency-check-page.controller';
import { RESIDENT_PREVIEW_PORT, RESIDENT_PROFILE_PORT } from './residency-check.types';

/**
 * Isolated composition boundary for the mobile resident check.
 *
 * It intentionally does not import the resident-services module: pass preview,
 * issuance, return and journal are already exposed by the staff admin API and
 * called by the browser. E only adds the staff page, its assets and the
 * read-only display profile lookup.
 */
@Module({
  imports: [AuthModule, VivaAdminModule, SubscriptionsModule],
  controllers: [
    ResidencyCheckPageController,
    ResidencyCheckAssetController,
    ResidentProfileController
  ],
  providers: [
    ResidentProfileService,
    SubscriptionsVivaResidentProfileAdapter,
    {
      provide: RESIDENT_PROFILE_PORT,
      useExisting: SubscriptionsVivaResidentProfileAdapter
    },
    {
      // Server-side D preview used to prove object authorization before any
      // resident PII is returned. Overridden in tests by a fake port.
      provide: RESIDENT_PREVIEW_PORT,
      useFactory: () => new HttpResidentPreviewAdapter()
    }
  ]
})
export class ResidencyCheckModule {}

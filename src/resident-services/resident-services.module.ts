import { Module } from '@nestjs/common';
import { LkIdentityModule } from '../lk-identity/lk-identity.module';
import { ResidentPassesInternalController } from './resident-passes.internal.controller';
import { ResidentBenefitsService } from './resident-benefits.service';
import { ResidentIssuancesService } from './resident-issuances.service';
import { ResidentPassesService } from './resident-passes.service';
import { ResidentResidencyService, RESIDENT_SERVICES_CLOCK } from './resident-residency.service';
import { ResidentServicesAdminController } from './resident-services.admin.controller';
import { ResidentServicesExceptionFilter } from './resident-services.exception.filter';
import { ResidentServicesRepository } from './resident-services.repository';

@Module({
  imports: [LkIdentityModule],
  controllers: [ResidentPassesInternalController, ResidentServicesAdminController],
  providers: [
    ResidentServicesRepository,
    ResidentResidencyService,
    ResidentBenefitsService,
    ResidentPassesService,
    ResidentIssuancesService,
    ResidentServicesExceptionFilter,
    {
      provide: RESIDENT_SERVICES_CLOCK,
      useFactory: () => () => new Date()
    }
  ]
})
export class ResidentServicesModule {}

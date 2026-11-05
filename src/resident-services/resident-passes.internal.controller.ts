import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters
} from '@nestjs/common';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { Roles } from '../common/rbac/roles.decorator';
import { CreateResidentPassDto } from './dto/create-resident-pass.dto';
import { ResidentPassesService } from './resident-passes.service';
import { ResidentServicesExceptionFilter } from './resident-services.exception.filter';
import { ResidentPassView } from './resident-services.types';

@Controller('internal/subscriptions/resident-passes')
@Roles()
@UseFilters(ResidentServicesExceptionFilter)
export class ResidentPassesInternalController {
  constructor(private readonly passes: ResidentPassesService) {}

  @Post()
  @SkipAdminMutationAudit()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  create(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-resident-services-integration-token') integrationToken: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() dto: CreateResidentPassDto
  ): Promise<ResidentPassView> {
    void correlationId;
    return this.passes.createPass({
      authorization,
      integrationToken,
      clientSubscriptionId: dto.clientSubscriptionId
    });
  }
}

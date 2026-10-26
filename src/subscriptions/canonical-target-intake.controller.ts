import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseFilters
} from '@nestjs/common';
import { Roles } from '../common/rbac/roles.decorator';
import {
  CanonicalTargetIntakeError,
  CanonicalTargetIntakeService,
  type CanonicalTargetIntakeResult
} from './canonical-target-intake.service';
import { SubscriptionsExceptionFilter } from './subscriptions-exception.filter';

/**
 * Server-to-server registration of authoritative canonical activity targets for LK2.
 *
 * The endpoint accepts only the internal integration token and already-resolved facts. It never
 * accepts actor identity, performs no evaluation and mutates no booking or entitlement state.
 */
@Controller('internal/subscriptions')
@Roles()
@UseFilters(SubscriptionsExceptionFilter)
export class CanonicalTargetIntakeController {
  public constructor(private readonly intake: CanonicalTargetIntakeService) {}

  @Post('canonical-targets')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  public async ingest(
    @Headers('x-subscriptions-integration-token') integrationToken: string | undefined,
    @Body() body: unknown
  ): Promise<CanonicalTargetIntakeResult> {
    try {
      return await this.intake.ingest(integrationToken, body);
    } catch (error) {
      if (error instanceof CanonicalTargetIntakeError) {
        throw new HttpException(
          { code: error.code, message: 'Каноническая цель не принята.' },
          error.status
        );
      }
      throw error;
    }
  }
}

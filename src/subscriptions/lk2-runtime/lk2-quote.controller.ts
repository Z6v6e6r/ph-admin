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
import { Roles } from '../../common/rbac/roles.decorator';
import { SubscriptionsExceptionFilter } from '../subscriptions-exception.filter';
import {
  Lk2QuoteReceiverError,
  Lk2QuoteReceiverService,
  type Lk2QuoteOutcomeBody
} from './lk2-quote-receiver.service';

/**
 * LK2-facing managed-subscription quote. The route accepts only the short-lived actor
 * delegation minted by LK2 plus the internal integration token; it never accepts actor identity,
 * provider identifiers, prices or policy values from the public client.
 */
@Controller('internal/subscription-runtime/lk2/v1')
@Roles()
@UseFilters(SubscriptionsExceptionFilter)
export class Lk2QuoteController {
  public constructor(private readonly receiver: Lk2QuoteReceiverService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  public async quote(
    @Headers('x-subscriptions-integration-token') integrationToken: string | undefined,
    @Headers('x-subscription-actor-delegation') actorDelegation: string | undefined,
    @Headers('x-subscription-runtime-contract-version') contractVersion: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() body: unknown
  ): Promise<Lk2QuoteOutcomeBody> {
    try {
      return await this.receiver.receive({
        integrationToken,
        actorDelegation,
        contractVersion,
        idempotencyKey,
        correlationId,
        body
      });
    } catch (error) {
      if (error instanceof Lk2QuoteReceiverError) {
        throw new HttpException(
          { code: error.code, message: 'Проверка подписки не выполнена.' },
          error.status
        );
      }
      throw new HttpException(
        {
          code: 'SUBSCRIPTION_RUNTIME_LK2_QUOTE_UNAVAILABLE',
          message: 'Проверка подписки временно недоступна.'
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}

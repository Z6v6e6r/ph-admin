import { Controller, Header, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { LkIdentityService } from './lk-identity.service';
import { LkIdentityVerificationResult } from './lk-identity.types';

@Controller('internal/lk/identity')
export class LkIdentityController {
  constructor(private readonly service: LkIdentityService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  verify(
    @Headers('authorization') authorization?: string,
    @Headers('x-cup-integration-token') integrationToken?: string
  ): Promise<LkIdentityVerificationResult> {
    return this.service.verify(authorization, integrationToken);
  }
}

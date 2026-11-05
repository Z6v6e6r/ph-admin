import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { CreateResidentBenefitRuleDto } from './dto/create-resident-benefit-rule.dto';
import { ConfirmResidentIssuanceDto } from './dto/confirm-resident-issuance.dto';
import { PreviewResidentPassDto } from './dto/preview-resident-pass.dto';
import { ReturnResidentItemsDto } from './dto/return-resident-items.dto';
import { UpdateResidentBenefitRuleDto } from './dto/update-resident-benefit-rule.dto';
import { ResidentBenefitsService } from './resident-benefits.service';
import { ResidentIssuancesService, ResidentJournalQueryInput } from './resident-issuances.service';
import { ResidentPassesService } from './resident-passes.service';
import { ResidentServicesExceptionFilter } from './resident-services.exception.filter';
import {
  RESIDENT_SERVICES_ERROR_CODES,
  ResidentBenefitRuleView,
  ResidentIssuanceView,
  ResidentJournalPage,
  ResidentPassPreviewView,
  ResidentReturnView
} from './resident-services.types';

const DEFAULT_ADMIN_ORIGIN = 'https://padlhub.su';

function trustedAdminOrigins(): Set<string> {
  const raw = String(
    process.env.RESIDENT_SERVICES_ADMIN_ORIGINS
      ?? process.env.QR_LINKS_ADMIN_ORIGINS
      ?? DEFAULT_ADMIN_ORIGIN
  );
  const origins = new Set<string>();
  for (const item of raw.split(',')) {
    try {
      origins.add(new URL(item.trim()).origin.toLowerCase());
    } catch {
      // Ignore malformed extra entries; the default origin stays trusted.
    }
  }
  if (origins.size === 0) origins.add(DEFAULT_ADMIN_ORIGIN);
  if (String(process.env.NODE_ENV ?? '').trim().toLowerCase() !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  return origins;
}

@Controller('v1/admin/resident-services')
@Roles(...STAFF_ROLES)
@UseFilters(ResidentServicesExceptionFilter)
export class ResidentServicesAdminController {
  private readonly allowedOrigins = trustedAdminOrigins();

  constructor(
    private readonly passes: ResidentPassesService,
    private readonly issuances: ResidentIssuancesService,
    private readonly benefits: ResidentBenefitsService
  ) {}

  @Post('passes/preview')
  @Permissions('resident-services:issue')
  @SkipAdminMutationAudit()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  previewPass(
    @Body() dto: PreviewResidentPassDto,
    @CurrentUser() user: RequestUser | undefined
  ): Promise<ResidentPassPreviewView> {
    return this.passes.preview(dto.token, dto.stationId, user);
  }

  @Post('issuances')
  @Permissions('resident-services:issue')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  async issue(
    @Body() dto: ConfirmResidentIssuanceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<ResidentIssuanceView> {
    this.assertTrustedOrigin(request);
    const result = await this.issuances.confirm({
      token: dto.token,
      stationId: dto.stationId,
      items: dto.items,
      user,
      idempotencyHeader: idempotencyKey,
      correlationHeader: correlationId
    });
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.view;
  }

  @Post('issuances/:issuanceId/returns')
  @Permissions('resident-services:return')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  async returnItems(
    @Param('issuanceId') issuanceId: string,
    @Body() dto: ReturnResidentItemsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<ResidentReturnView> {
    this.assertTrustedOrigin(request);
    const result = await this.issuances.returnItems({
      issuanceId,
      items: dto.items,
      user,
      idempotencyHeader: idempotencyKey,
      correlationHeader: correlationId
    });
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.view;
  }

  @Get('issuances/:issuanceId')
  @Permissions('resident-services:read')
  @Header('Cache-Control', 'private, no-store')
  issuance(
    @Param('issuanceId') issuanceId: string,
    @CurrentUser() user: RequestUser | undefined
  ): Promise<ResidentIssuanceView> {
    return this.issuances.getIssuance(issuanceId, user);
  }

  @Get('journal')
  @Permissions('resident-services:read')
  @Header('Cache-Control', 'private, no-store')
  journal(
    @Query('stationId') stationId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @CurrentUser() user: RequestUser | undefined
  ): Promise<ResidentJournalPage> {
    const query: ResidentJournalQueryInput = { stationId, from, to, limit, cursor };
    return this.issuances.journal(query, user);
  }

  @Get('benefit-rules')
  @Permissions('resident-services:read')
  @Header('Cache-Control', 'private, no-store')
  benefitRules(
    @CurrentUser() user: RequestUser | undefined
  ): Promise<{ items: ResidentBenefitRuleView[] }> {
    return this.benefits.listRules(user);
  }

  @Post('benefit-rules')
  @Permissions('resident-services:configure')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  async createBenefitRule(
    @Body() dto: CreateResidentBenefitRuleDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<ResidentBenefitRuleView> {
    this.assertTrustedOrigin(request);
    const result = await this.benefits.createRule(
      {
        subscriptionTypeId: dto.subscriptionTypeId,
        serviceKind: dto.serviceKind,
        stationIds: dto.stationIds,
        limitPeriod: dto.limitPeriod,
        limitQuantity: dto.limitQuantity,
        returnable: dto.returnable,
        enabled: dto.enabled
      },
      idempotencyKey,
      user,
      correlationId ?? ''
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.rule;
  }

  @Patch('benefit-rules/:ruleId')
  @Permissions('resident-services:configure')
  @Header('Cache-Control', 'private, no-store')
  updateBenefitRule(
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateResidentBenefitRuleDto,
    @CurrentUser() user: RequestUser | undefined,
    @Req() request: Request
  ): Promise<ResidentBenefitRuleView> {
    this.assertTrustedOrigin(request);
    return this.benefits.updateRule(
      ruleId,
      {
        stationIds: dto.stationIds,
        limitPeriod: dto.limitPeriod,
        limitQuantity: dto.limitQuantity,
        returnable: dto.returnable,
        enabled: dto.enabled,
        expectedRevision: dto.expectedRevision
      },
      user
    );
  }

  private assertTrustedOrigin(request: Request): void {
    if (request.headers.authorization) {
      return;
    }
    const origin = String(request.headers.origin ?? '').trim().toLowerCase();
    if (!origin) return;
    if (!this.allowedOrigins.has(origin)) {
      throw new ForbiddenException({
        code: RESIDENT_SERVICES_ERROR_CODES.UNTRUSTED_ORIGIN,
        message: 'Request origin is not trusted'
      });
    }
  }
}

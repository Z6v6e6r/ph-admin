import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { UpdateCabinetHomeAdvertisingDto } from './dto/update-cabinet-home-advertising.dto';
import { RecordAdvertisingEngagementDto } from './dto/record-advertising-engagement.dto';
import { UpdateSplitPaymentPromoDto } from './dto/update-split-payment-promo.dto';
import { AdvertisingService } from './advertising.service';
import {
  CabinetHomeAdvertisingAdminSnapshot,
  AdvertisingAdminInsightsSnapshot,
  CabinetHomeAdvertisingPublicSnapshot,
  SplitPaymentPromoMatchContext,
  SplitPaymentPromoAdminSnapshot,
  SplitPaymentPromoPublicSnapshot
} from './advertising.types';

@Controller('advertising')
export class AdvertisingController {
  constructor(private readonly advertisingService: AdvertisingService) {}

  @Get('cabinet-home')
  getCabinetHomePublic(
    @Req() request: Request
  ): Promise<CabinetHomeAdvertisingPublicSnapshot> {
    return this.advertisingService.getCabinetHomePublicSnapshot(
      this.getRequestBaseUrl(request)
    );
  }

  @Get('cabinet-home-top')
  getCabinetHomeTopPublic(
    @Req() request: Request
  ): Promise<CabinetHomeAdvertisingPublicSnapshot> {
    return this.advertisingService.getCabinetHomeTopPublicSnapshot(
      this.getRequestBaseUrl(request)
    );
  }

  @Get('cabinet-for-me-strip')
  getCabinetForMeStripPublic(
    @Req() request: Request
  ): Promise<CabinetHomeAdvertisingPublicSnapshot> {
    return this.advertisingService.getCabinetForMeStripPublicSnapshot(
      this.getRequestBaseUrl(request)
    );
  }

  @Get('cabinet-for-me-card')
  getCabinetForMeCardPublic(
    @Req() request: Request
  ): Promise<CabinetHomeAdvertisingPublicSnapshot> {
    return this.advertisingService.getCabinetForMeCardPublicSnapshot(
      this.getRequestBaseUrl(request)
    );
  }

  @Get('split-payment-promo')
  getSplitPaymentPromoPublic(
    @Query('forDate') forDate?: string,
    @Query('date') date?: string,
    @Query('gameDate') gameDate?: string,
    @Query('startAt') startAt?: string,
    @Query('startsAt') startsAt?: string,
    @Query('stationId') stationId?: string,
    @Query('station') station?: string,
    @Query('stationName') stationName?: string,
    @Query('studioId') studioId?: string,
    @Query('studioName') studioName?: string,
    @Query('roomId') roomId?: string,
    @Query('room') room?: string,
    @Query('roomName') roomName?: string,
    @Query('courtId') courtId?: string,
    @Query('courtName') courtName?: string
  ): Promise<SplitPaymentPromoPublicSnapshot> {
    const resolvedForDate = this.pickString(forDate)
      ?? this.pickString(date)
      ?? this.pickString(gameDate)
      ?? this.pickString(startAt)
      ?? this.pickString(startsAt);
    const context: SplitPaymentPromoMatchContext = {
      stationId: this.pickString(stationId) ?? this.pickString(studioId),
      stationName: this.pickString(stationName)
        ?? this.pickString(station)
        ?? this.pickString(studioName),
      roomId: this.pickString(roomId) ?? this.pickString(courtId),
      roomName: this.pickString(roomName)
        ?? this.pickString(room)
        ?? this.pickString(courtName)
    };
    return this.advertisingService.getSplitPaymentPromoPublicSnapshot(
      resolvedForDate,
      context
    );
  }

  @Get('cabinet-home/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  async getCabinetHomeAdmin(
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }

    return this.advertisingService.getCabinetHomeAdminSnapshot(
      this.getRequestBaseUrl(request)
    );
  }

  @Get('cabinet-home-top/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  async getCabinetHomeTopAdmin(
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.advertisingService.getCabinetHomeTopAdminSnapshot(
      this.getRequestBaseUrl(request)
    );
  }

  @Get('cabinet-for-me-strip/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  async getCabinetForMeStripAdmin(
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.advertisingService.getCabinetForMeStripAdminSnapshot(
      this.getRequestBaseUrl(request)
    );
  }

  @Get('cabinet-for-me-card/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  async getCabinetForMeCardAdmin(
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.advertisingService.getCabinetForMeCardAdminSnapshot(
      this.getRequestBaseUrl(request)
    );
  }

  @Get('cabinet-home/admin/insights')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  getCabinetHomeInsights(): Promise<AdvertisingAdminInsightsSnapshot> {
    return this.advertisingService.getAdminInsights('cabinet_home');
  }

  @Get('cabinet-home-top/admin/insights')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  getCabinetHomeTopInsights(): Promise<AdvertisingAdminInsightsSnapshot> {
    return this.advertisingService.getAdminInsights('cabinet_home_top');
  }

  @Get('cabinet-for-me-strip/admin/insights')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  getCabinetForMeStripInsights(): Promise<AdvertisingAdminInsightsSnapshot> {
    return this.advertisingService.getAdminInsights('cabinet_for_me_strip');
  }

  @Get('cabinet-for-me-card/admin/insights')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  getCabinetForMeCardInsights(): Promise<AdvertisingAdminInsightsSnapshot> {
    return this.advertisingService.getAdminInsights('cabinet_for_me_card');
  }

  @Get('split-payment-promo/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  async getSplitPaymentPromoAdmin(
    @CurrentUser() user?: RequestUser
  ): Promise<SplitPaymentPromoAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }

    return this.advertisingService.getSplitPaymentPromoAdminSnapshot();
  }

  @Patch('cabinet-home/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  async updateCabinetHomeAdmin(
    @Body() dto: UpdateCabinetHomeAdvertisingDto,
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }

    return this.advertisingService.updateCabinetHomeSettings(
      dto,
      user.title || user.login || user.id,
      this.getRequestBaseUrl(request)
    );
  }

  @Patch('cabinet-home-top/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  async updateCabinetHomeTopAdmin(
    @Body() dto: UpdateCabinetHomeAdvertisingDto,
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.advertisingService.updateCabinetHomeTopSettings(
      dto,
      user.title || user.login || user.id,
      this.getRequestBaseUrl(request)
    );
  }

  @Patch('cabinet-for-me-strip/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  async updateCabinetForMeStripAdmin(
    @Body() dto: UpdateCabinetHomeAdvertisingDto,
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.advertisingService.updateCabinetForMeStripSettings(
      dto,
      user.title || user.login || user.id,
      this.getRequestBaseUrl(request)
    );
  }

  @Patch('cabinet-for-me-card/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  async updateCabinetForMeCardAdmin(
    @Body() dto: UpdateCabinetHomeAdvertisingDto,
    @Req() request: Request,
    @CurrentUser() user?: RequestUser
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.advertisingService.updateCabinetForMeCardSettings(
      dto,
      user.title || user.login || user.id,
      this.getRequestBaseUrl(request)
    );
  }

  @Patch('split-payment-promo/admin')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  async updateSplitPaymentPromoAdmin(
    @Body() dto: UpdateSplitPaymentPromoDto,
    @CurrentUser() user?: RequestUser
  ): Promise<SplitPaymentPromoAdminSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }

    return this.advertisingService.updateSplitPaymentPromoSettings(
      dto,
      user.title || user.login || user.id
    );
  }

  @Post('engagements')
  async recordEngagement(
    @Body() dto: RecordAdvertisingEngagementDto,
    @Headers('x-advertising-event-key') eventKey?: string
  ): Promise<{ accepted: true; replayed: boolean }> {
    if (!this.advertisingService.isEngagementSecretValid(eventKey)) {
      throw new ForbiddenException('Advertising event key is invalid');
    }
    return this.advertisingService.recordEngagement(dto);
  }

  @Get('assets/:assetId')
  async getAsset(
    @Param('assetId') assetId: string,
    @Res() response: Response
  ): Promise<void> {
    const asset = await this.advertisingService.getAsset(assetId);
    if (!asset) {
      response.status(404).json({ error: 'Advertising asset not found' });
      return;
    }

    const buffer = Buffer.from(asset.body, 'base64');
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', String(buffer.length));
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.send(buffer);
  }

  private getRequestBaseUrl(request: Request): string {
    const forwardedProto = this.pickString(request.headers['x-forwarded-proto']);
    const protocol = forwardedProto ?? (request.secure ? 'https' : 'http');
    const host = this.pickString(request.headers['x-forwarded-host'])
      ?? this.pickString(request.headers.host)
      ?? 'localhost';
    return `${protocol}://${host}`;
  }

  private pickString(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      return this.pickString(value[0]);
    }
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : undefined;
  }
}

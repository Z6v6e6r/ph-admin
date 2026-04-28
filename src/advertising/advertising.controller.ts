import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { UpdateSplitPaymentPromoDto } from './dto/update-split-payment-promo.dto';
import { AdvertisingService } from './advertising.service';
import {
  CabinetHomeAdvertisingAdminSnapshot,
  CabinetHomeAdvertisingPublicSnapshot,
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

  @Get('split-payment-promo')
  getSplitPaymentPromoPublic(
    @Query('forDate') forDate?: string,
    @Query('date') date?: string,
    @Query('gameDate') gameDate?: string,
    @Query('startAt') startAt?: string,
    @Query('startsAt') startsAt?: string
  ): Promise<SplitPaymentPromoPublicSnapshot> {
    const resolvedForDate = this.pickString(forDate)
      ?? this.pickString(date)
      ?? this.pickString(gameDate)
      ?? this.pickString(startAt)
      ?? this.pickString(startsAt);
    return this.advertisingService.getSplitPaymentPromoPublicSnapshot(resolvedForDate);
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

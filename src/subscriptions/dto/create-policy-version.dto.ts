import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
  ValidateNested
} from 'class-validator';

export class CreateGamePolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn([60, 90, 120], { each: true })
  durationsMinutes!: Array<60 | 90 | 120>;
}

export class JoinGamePolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(60)
  @Max(120)
  minDurationMinutes!: number;

  @IsInt()
  @Min(60)
  @Max(120)
  maxDurationMinutes!: number;
}

export class UsageUnitsByDurationDto {
  @IsInt()
  @Min(0)
  '60'!: number;

  @IsInt()
  @Min(0)
  '90'!: number;

  @IsInt()
  @Min(0)
  '120'!: number;
}

export class BenefitRuleDto {
  @IsString()
  @MaxLength(120)
  ruleId!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsIn(['GAME', 'GROUP_TRAINING', 'TOURNAMENT'])
  category!: 'GAME' | 'GROUP_TRAINING' | 'TOURNAMENT';

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  externalEventTypeIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  stationIds!: string[];

  @IsIn([
    'FREE_ENTITLEMENT',
    'FIXED_PRICE',
    'PERCENT_DISCOUNT',
    'FIXED_DISCOUNT',
    'DISABLED'
  ])
  kind!:
    | 'FREE_ENTITLEMENT'
    | 'FIXED_PRICE'
    | 'PERCENT_DISCOUNT'
    | 'FIXED_DISCOUNT'
    | 'DISABLED';

  @IsOptional()
  @IsInt()
  @Min(0)
  valueMinor?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number | null;

  @IsInt()
  priority!: number;
}

export class SubscriptionFreezePolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Max(3660)
  maxDaysPerYear!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  maxPeriodsPerYear!: number;

  @IsInt()
  @Min(0)
  @Max(3660)
  minDaysPerPeriod!: number;

  @IsBoolean()
  extendsValidity!: boolean;
}

export class SubscriptionAdminExtensionPolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Max(3660)
  maxDays!: number;

  @IsBoolean()
  reasonRequired!: boolean;
}

export class SubscriptionLifecyclePolicyDto {
  @IsIn(['PURCHASE', 'FIRST_USE', 'FIXED_DATE'])
  activationMode!: 'PURCHASE' | 'FIRST_USE' | 'FIXED_DATE';

  @IsInt()
  @Min(0)
  @Max(3660)
  activationWindowDays!: number;

  @IsOptional()
  @IsISO8601()
  fixedActivationAt?: string | null;

  @IsIn(['Europe/Moscow'])
  fixedActivationTimeZone!: 'Europe/Moscow';

  @IsInt()
  @Min(0)
  @Max(365)
  gracePeriodDays!: number;

  @IsBoolean()
  allowBookingsAfterExpiry!: boolean;

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionFreezePolicyDto)
  freeze!: SubscriptionFreezePolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionAdminExtensionPolicyDto)
  adminExtension!: SubscriptionAdminExtensionPolicyDto;
}

export class SubscriptionUsageCapabilitiesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  weeklyUsageLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  monthlyUsageLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxFutureBookings?: number | null;

  @IsInt()
  @Min(0)
  @Max(8760)
  minHoursBetweenUses!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  guestPassesPerMonth!: number;

  @IsInt()
  @Min(0)
  @Max(8760)
  earlyBookingAccessHours!: number;

  @IsBoolean()
  waitlistPriority!: boolean;

  @IsIn(['HOME_ONLY', 'ALLOWED', 'ALLOWED_WITH_SURCHARGE'])
  crossStationMode!: 'HOME_ONLY' | 'ALLOWED' | 'ALLOWED_WITH_SURCHARGE';

  @IsInt()
  @Min(0)
  @Max(1000000000)
  crossStationSurchargeMinor!: number;

  @IsArray()
  @ArrayMaxSize(366)
  @ArrayUnique()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true })
  blackoutDates!: string[];
}

export class SubscriptionFreeCancellationHoursDto {
  @IsInt()
  @Min(0)
  @Max(8760)
  GAME!: number;

  @IsInt()
  @Min(0)
  @Max(8760)
  GROUP_TRAINING!: number;

  @IsInt()
  @Min(0)
  @Max(8760)
  TOURNAMENT!: number;
}

export class SubscriptionCancellationPolicyDto {
  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionFreeCancellationHoursDto)
  freeCancellationHours!: SubscriptionFreeCancellationHoursDto;

  @IsInt()
  @Min(0)
  @Max(1000)
  lateCancellationUsageUnits!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  noShowUsageUnits!: number;

  @IsInt()
  @Min(0)
  @Max(365)
  noShowBlockDays!: number;

  @IsBoolean()
  stationCancellationRestoresUsage!: boolean;

  @IsIn(['KEEP_RESERVATION', 'REVALIDATE'])
  reschedulePolicy!: 'KEEP_RESERVATION' | 'REVALIDATE';
}

export class SubscriptionCommercePolicyDto {
  @IsIn(['DISABLED', 'MANUAL', 'AUTO'])
  renewalMode!: 'DISABLED' | 'MANUAL' | 'AUTO';

  @IsInt()
  @Min(0)
  @Max(365)
  renewalWindowDays!: number;

  @IsBoolean()
  priceLockEnabled!: boolean;

  @IsNumber()
  @Min(0)
  @Max(100)
  renewalDiscountPercent!: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  purchaseLimitPerClient!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  reservationTtlMinutes!: number;

  @IsBoolean()
  waitlistWhenSoldOut!: boolean;

  @IsBoolean()
  promoCodesAllowed!: boolean;

  @IsBoolean()
  installmentsAllowed!: boolean;

  @IsIn(['DISABLED', 'MANUAL', 'PRORATED'])
  upgradeDowngradeMode!: 'DISABLED' | 'MANUAL' | 'PRORATED';

  @IsIn(['NONE', 'MANUAL', 'PRORATED'])
  terminationRefundMode!: 'NONE' | 'MANUAL' | 'PRORATED';

  @IsInt()
  @Min(0)
  @Max(365)
  coolingOffDays!: number;

  @IsBoolean()
  giftable!: boolean;

  @IsBoolean()
  transferable!: boolean;

  @IsInt()
  @Min(1)
  @Max(1000)
  familySeats!: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  corporateSeats!: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  maxConcurrentSubscriptions!: number;

  @IsIn(['EXPIRING_FIRST', 'SUBSCRIPTION_FIRST', 'MANUAL'])
  consumptionPriority!: 'EXPIRING_FIRST' | 'SUBSCRIPTION_FIRST' | 'MANUAL';
}

export class SubscriptionEngagementPolicyDto {
  @IsBoolean()
  showSavings!: boolean;

  @IsBoolean()
  showBreakEvenProgress!: boolean;

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(365, { each: true })
  expirationReminderDays!: number[];

  @IsBoolean()
  referralEnabled!: boolean;

  @IsBoolean()
  renewalBonusEnabled!: boolean;

  @IsBoolean()
  personalizedRecommendationsEnabled!: boolean;
}

export class SubscriptionAnalyticsPolicyDto {
  @IsBoolean()
  trackRevenue!: boolean;

  @IsBoolean()
  trackRefunds!: boolean;

  @IsBoolean()
  trackBreakage!: boolean;

  @IsBoolean()
  trackMargin!: boolean;

  @IsBoolean()
  trackPeakLoad!: boolean;

  @IsBoolean()
  trackChurn!: boolean;

  @IsBoolean()
  trackCohorts!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  attributionTag?: string | null;
}

export class SubscriptionCapabilitiesDto {
  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionLifecyclePolicyDto)
  lifecycle!: SubscriptionLifecyclePolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionUsageCapabilitiesDto)
  usage!: SubscriptionUsageCapabilitiesDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionCancellationPolicyDto)
  cancellation!: SubscriptionCancellationPolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionCommercePolicyDto)
  commerce!: SubscriptionCommercePolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionEngagementPolicyDto)
  engagement!: SubscriptionEngagementPolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionAnalyticsPolicyDto)
  analytics!: SubscriptionAnalyticsPolicyDto;
}

export class CreatePolicyVersionDto {
  @IsISO8601()
  effectiveAt!: string;

  @IsIn(['NEW_ONLY', 'ACTIVE_AND_NEW'])
  applyTo!: 'NEW_ONLY' | 'ACTIVE_AND_NEW';

  @IsInt()
  @Min(1)
  @Max(3660)
  validityDays!: number;

  @IsObject()
  @ValidateNested()
  @Type(() => CreateGamePolicyDto)
  createGame!: CreateGamePolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => JoinGamePolicyDto)
  joinGame!: JoinGamePolicyDto;

  @IsInt()
  @Min(0)
  @Max(1000)
  maxActiveServices!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  bookingWindowDays!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  dailyUsageLimit!: number;

  @IsIn(['SUBSCRIPTION_BENEFIT_ONLY', 'ALL_BOOKINGS'])
  activeServiceScope!: 'SUBSCRIPTION_BENEFIT_ONLY' | 'ALL_BOOKINGS';

  @IsObject()
  @ValidateNested()
  @Type(() => UsageUnitsByDurationDto)
  usageUnitsByDuration!: UsageUnitsByDurationDto;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BenefitRuleDto)
  benefitRules!: BenefitRuleDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionCapabilitiesDto)
  capabilities?: SubscriptionCapabilitiesDto;
}

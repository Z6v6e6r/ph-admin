import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../common/rbac/request-user.interface';
import {
  requireResidentStaff,
  requireResidentStation
} from './resident-staff-access';
import { ResidentBenefitsService } from './resident-benefits.service';
import {
  generateResidentPassToken,
  hashResidentPassToken,
  isResidentPassToken
} from './resident-service-crypto';
import {
  assertResidentServicesEnabled,
  requireResidentServicesTenantId,
  requireResidentServicesTokenPepper,
  residentServicesPassTtlSeconds,
  RESIDENT_SERVICES_ID_PATTERN
} from './resident-services.config';
import { ResidentResidencyService, RESIDENT_SERVICES_CLOCK } from './resident-residency.service';
import { ResidentServicesRepository, isResidentDuplicateKeyError } from './resident-services.repository';
import {
  RESIDENT_SERVICES_ERROR_CODES,
  ResidentPassPreviewView,
  ResidentPassStatusState,
  ResidentPassStatusView,
  ResidentPassView,
  StoredResidentPass
} from './resident-services.types';

const ISSUE_PERMISSION = 'resident-services:issue';
const MAX_TOKEN_ATTEMPTS = 3;

@Injectable()
export class ResidentPassesService {
  constructor(
    private readonly repository: ResidentServicesRepository,
    private readonly residency: ResidentResidencyService,
    private readonly benefits: ResidentBenefitsService,
    @Optional() @Inject(RESIDENT_SERVICES_CLOCK) private readonly clock?: () => Date
  ) {}

  async createPass(input: {
    authorization: string | undefined;
    integrationToken: string | undefined;
    clientSubscriptionId: string;
  }): Promise<ResidentPassView> {
    assertResidentServicesEnabled();
    const pepper = requireResidentServicesTokenPepper();
    const ttlSeconds = residentServicesPassTtlSeconds();
    const context = await this.residency.resolveByClientIdentity(
      input.authorization,
      input.integrationToken,
      input.clientSubscriptionId
    );
    const now = this.now();
    const activeTo = Date.parse(context.instance.activeTo ?? '');
    if (!Number.isFinite(activeTo)) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.TERM_EXPIRED,
        message: 'Resident subscription term is not confirmed'
      });
    }
    const expiresAt = Math.min(now.getTime() + ttlSeconds * 1000, activeTo);
    if (expiresAt <= now.getTime()) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.TERM_EXPIRED,
        message: 'Resident subscription term is ending'
      });
    }
    const issuedAt = now.toISOString();
    const pass: StoredResidentPass = {
      schemaVersion: 1,
      passId: 'resident_pass:' + randomUUID(),
      tenantId: context.tenantId,
      subscriptionInstanceId: context.instance.subscriptionInstanceId,
      clientRefHash: context.clientRefHash,
      tokenHash: '',
      state: 'ACTIVE',
      issuedAt,
      expiresAt: new Date(expiresAt).toISOString(),
      expiresAtDate: new Date(expiresAt),
      consumedAt: null,
      consumedBy: null,
      consumedOperationId: null,
      consumedStationId: null,
      revision: 1,
      createdAt: issuedAt,
      updatedAt: issuedAt
    };
    let token = '';
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
      token = generateResidentPassToken();
      pass.tokenHash = hashResidentPassToken(pepper, token);
      try {
        await this.repository.insertPass(pass);
        return {
          schemaVersion: 1,
          passId: pass.passId,
          token,
          issuedAt: pass.issuedAt,
          expiresAt: pass.expiresAt,
          subscriptionInstanceId: pass.subscriptionInstanceId,
          residency: {
            subscriptionTypeId: context.instance.subscriptionTypeId,
            subscriptionTypeTitle: context.subscriptionType.title,
            activeFrom: context.instance.activeFrom!,
            activeTo: context.instance.activeTo!
          }
        };
      } catch (error) {
        if (!isResidentDuplicateKeyError(error)) throw error;
      }
    }
    throw new ConflictException({
      code: RESIDENT_SERVICES_ERROR_CODES.PASS_INVALID,
      message: 'Resident pass token could not be generated'
    });
  }

  async preview(
    token: string,
    stationId: string | undefined,
    user: RequestUser | undefined
  ): Promise<ResidentPassPreviewView> {
    assertResidentServicesEnabled();
    this.repository.requireAvailable();
    const tenantId = requireResidentServicesTenantId();
    const pepper = requireResidentServicesTokenPepper();
    requireResidentStaff(user, ISSUE_PERMISSION);
    const resolvedStationId = requireResidentStation(user, ISSUE_PERMISSION, stationId);
    if (!isResidentPassToken(token)) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.PASS_INVALID,
        message: 'Resident pass token is invalid'
      });
    }
    const tokenHash = hashResidentPassToken(pepper, token);
    const pass = await this.repository.findPassByTokenHash(tokenHash);
    if (!pass || pass.tenantId !== tenantId) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.PASS_NOT_FOUND,
        message: 'Resident pass was not found'
      });
    }
    const now = this.now();
    if (pass.state === 'CONSUMED') {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.PASS_ALREADY_USED,
        message: 'Resident pass was already used'
      });
    }
    if (Date.parse(pass.expiresAt) <= now.getTime()) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.PASS_EXPIRED,
        message: 'Resident pass has expired'
      });
    }
    const context = await this.residency.resolveByInstance(
      tenantId,
      pass.subscriptionInstanceId
    );
    if (pass.clientRefHash !== context.clientRefHash) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.PASS_NOT_FOUND,
        message: 'Resident pass was not found'
      });
    }
    if (!this.residency.stationAllowed(context, resolvedStationId)) {
      throw new ForbiddenException({
        code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
        message: 'Resident subscription does not allow this station'
      });
    }
    const services = await this.benefits.availability(context, resolvedStationId);
    return {
      schemaVersion: 1,
      passId: pass.passId,
      state: pass.state,
      issuedAt: pass.issuedAt,
      expiresAt: pass.expiresAt,
      stationId: resolvedStationId,
      resident: {
        confirmed: true,
        subscriptionInstanceId: context.instance.subscriptionInstanceId,
        subscriptionTypeId: context.instance.subscriptionTypeId,
        subscriptionTypeTitle: context.subscriptionType.title,
        activeFrom: context.instance.activeFrom!,
        activeTo: context.instance.activeTo!,
        homeStationId: context.instance.homeStationId
      },
      services,
      issuable: services.some((service) => service.available)
    };
  }

  /**
   * Read-only pass status for the LK gateway. The stored record is reported as
   * is: residency freshness is not re-validated and no state, limit or journal
   * row is touched. Ownership is decided by tenant and clientRefHash derived
   * from the verified LK identity.
   */
  async status(input: {
    authorization: string | undefined;
    integrationToken: string | undefined;
    passId: string;
  }): Promise<ResidentPassStatusView> {
    const { tenantId, clientRefHash } = await this.residency.verifyClientIdentity(
      input.authorization,
      input.integrationToken
    );
    this.repository.requireAvailable();
    const notFound = (): NotFoundException => new NotFoundException({
      code: RESIDENT_SERVICES_ERROR_CODES.PASS_NOT_FOUND,
      message: 'Resident pass was not found'
    });
    const passId = String(input.passId ?? '');
    if (!RESIDENT_SERVICES_ID_PATTERN.test(passId)) {
      throw notFound();
    }
    const pass = await this.repository.findPassById(passId);
    if (!pass || pass.tenantId !== tenantId || pass.clientRefHash !== clientRefHash) {
      throw notFound();
    }
    return {
      schemaVersion: 1,
      passId: pass.passId,
      state: residentPassStatus(pass, this.now()),
      issuedAt: pass.issuedAt,
      expiresAt: pass.expiresAt,
      consumedAt: pass.state === 'CONSUMED' ? pass.consumedAt : null,
      stationId: pass.state === 'CONSUMED' ? pass.consumedStationId : null
    };
  }

  protected now(): Date {
    return this.clock ? this.clock() : new Date();
  }
}

function residentPassStatus(
  pass: StoredResidentPass,
  now: Date
): ResidentPassStatusState {
  if (pass.state === 'CONSUMED') return 'CONSUMED';
  const expiresAt = Date.parse(pass.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime() ? 'EXPIRED' : 'ACTIVE';
}

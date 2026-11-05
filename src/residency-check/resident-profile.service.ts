import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { normalizeResidentPhotoUrl } from './resident-profile.adapter';
import {
  RESIDENT_PASS_TOKEN_PATTERN,
  RESIDENT_PREVIEW_PORT,
  RESIDENT_PROFILE_PORT,
  ResidentPreviewError,
  ResidentPreviewEvidence,
  ResidentPreviewPort,
  ResidentProfilePort,
  ResidentProfileRecord,
  ResidentProfileResponse,
  ResidentStaffSession
} from './residency-check.types';

const RESIDENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const MAX_DISPLAY_NAME_LENGTH = 240;
const FALLBACK_FULL_NAME = 'Резидент';

/** Raw request body of POST /api/v1/admin/residency/profile. */
export interface ResidentProfileRequestBody {
  passToken?: unknown;
  stationId?: unknown;
  subscriptionInstanceId?: unknown;
}

const PROFILE_FORBIDDEN = {
  code: 'RESIDENCY_PROFILE_FORBIDDEN',
  message: 'Resident profile is not available for this pass'
} as const;

/**
 * Staff-authorized display profile (name/photo) for the mobile resident check.
 *
 * Object authorization is the point of this service: the browser does not get
 * to name a resident. It must present the short-lived pass token it scanned,
 * and E asks D (resident-services) server-side, with the forwarded staff
 * session, to preview that exact pass. Only the subscription instance D
 * confirms inside that preview may be resolved to a display name and photo;
 * any mismatch, unknown/expired pass or upstream refusal returns a stable error
 * with no personal data.
 */
@Injectable()
export class ResidentProfileService {
  constructor(
    @Inject(RESIDENT_PROFILE_PORT) private readonly port: ResidentProfilePort,
    @Inject(RESIDENT_PREVIEW_PORT) private readonly preview: ResidentPreviewPort
  ) {}

  async resolve(
    request: ResidentProfileRequestBody | undefined,
    staffSession: ResidentStaffSession | undefined
  ): Promise<ResidentProfileResponse> {
    this.assertEnabled();
    const session = this.requireStaffSession(staffSession);

    const body = request && typeof request === 'object' ? request : {};
    const passToken = this.requirePassToken(body.passToken);
    const stationId = this.requireStationId(body.stationId);
    const requestedInstanceId = this.readOptionalSubscriptionInstanceId(
      body.subscriptionInstanceId
    );

    const evidence = await this.previewPass(passToken, stationId, session);
    if (
      !evidence.subscriptionInstanceId ||
      !RESIDENT_ID_PATTERN.test(evidence.subscriptionInstanceId)
    ) {
      throw new ForbiddenException(PROFILE_FORBIDDEN);
    }
    if (
      requestedInstanceId &&
      requestedInstanceId !== evidence.subscriptionInstanceId
    ) {
      // The browser asked for a different resident than the verified pass
      // belongs to: refuse instead of partially trusting either claim.
      throw new ForbiddenException(PROFILE_FORBIDDEN);
    }

    const record = await this.loadRecord(evidence.subscriptionInstanceId);
    return {
      subscriptionInstanceId: evidence.subscriptionInstanceId,
      fullName: this.normalizeFullName(record?.displayName),
      photoUrl: normalizeResidentPhotoUrl(record?.avatarUrl)
    };
  }

  /**
   * Server-side D preview. The result is never cached: the pass is short-lived
   * and every profile response is bound to one just-performed verification.
   */
  private async previewPass(
    passToken: string,
    stationId: string,
    staffSession: ResidentStaffSession
  ): Promise<ResidentPreviewEvidence> {
    try {
      return await this.preview.previewPass({
        passToken,
        stationId,
        staffSession
      });
    } catch (error) {
      if (error instanceof ResidentPreviewError) {
        if (error.failure === 'UNAUTHENTICATED') {
          throw new UnauthorizedException({
            code: 'RESIDENCY_AUTH_REQUIRED',
            message: 'Staff authorization is required'
          });
        }
        if (error.failure === 'REJECTED') {
          throw new ForbiddenException({
            code: 'RESIDENCY_PASS_NOT_VERIFIED',
            message: 'Resident pass could not be verified'
          });
        }
      }
      throw new ServiceUnavailableException({
        code: 'RESIDENCY_PASS_PREVIEW_UNAVAILABLE',
        message: 'Resident pass preview is unavailable'
      });
    }
  }

  /**
   * Without forwarded staff credentials D cannot verify anything: fail closed.
   * Only the staff cookie/authorization of the current request is forwarded.
   */
  private requireStaffSession(
    staffSession: ResidentStaffSession | undefined
  ): ResidentStaffSession {
    const cookie = typeof staffSession?.cookie === 'string'
      ? staffSession.cookie.trim()
      : '';
    const authorization = typeof staffSession?.authorization === 'string'
      ? staffSession.authorization.trim()
      : '';
    if (!cookie && !authorization) {
      throw new UnauthorizedException({
        code: 'RESIDENCY_AUTH_REQUIRED',
        message: 'Staff authorization is required'
      });
    }
    return {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {})
    };
  }

  /**
   * A profile lookup failure must not block the resident check; the screen
   * shows the generic label and initials instead. Errors are swallowed without
   * logging values (the port may carry PII).
   */
  private async loadRecord(
    subscriptionInstanceId: string
  ): Promise<ResidentProfileRecord | null> {
    try {
      return await this.port.profileBySubscriptionInstance(subscriptionInstanceId);
    } catch {
      return null;
    }
  }

  /** Disabled feature stays default-deny even for a direct API call. */
  private assertEnabled(): void {
    const enabled = ['1', 'true', 'yes'].includes(
      String(process.env.RESIDENCY_CHECK_ENABLED ?? '').trim().toLowerCase()
    );
    if (!enabled) {
      throw new ServiceUnavailableException({
        code: 'RESIDENCY_CHECK_DISABLED',
        message: 'Residency check is disabled'
      });
    }
  }

  private requirePassToken(value: unknown): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || !RESIDENT_PASS_TOKEN_PATTERN.test(normalized)) {
      throw new BadRequestException({
        code: 'RESIDENCY_REQUEST_INVALID',
        message: 'Resident pass token is invalid'
      });
    }
    return normalized;
  }

  private requireStationId(value: unknown): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || !RESIDENT_ID_PATTERN.test(normalized)) {
      throw new BadRequestException({
        code: 'RESIDENCY_REQUEST_INVALID',
        message: 'Station id is invalid'
      });
    }
    return normalized;
  }

  /**
   * Optional cross-check of the instance id the screen saw in the D preview.
   * An empty value means "use the verified preview instance"; anything else is
   * only compared, never used as a lookup key.
   */
  private readOptionalSubscriptionInstanceId(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      return '';
    }
    if (!RESIDENT_ID_PATTERN.test(normalized)) {
      throw new BadRequestException({
        code: 'RESIDENCY_REQUEST_INVALID',
        message: 'Subscription instance id is invalid'
      });
    }
    return normalized;
  }

  private normalizeFullName(value: unknown): string {
    const normalized = String(value ?? '').trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
    return normalized || FALLBACK_FULL_NAME;
  }
}

import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { normalizeResidentPhotoUrl } from './resident-profile.adapter';
import {
  RESIDENT_PROFILE_PORT,
  ResidentProfilePort,
  ResidentProfileRecord,
  ResidentProfileResponse
} from './residency-check.types';

const SUBSCRIPTION_INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const MAX_DISPLAY_NAME_LENGTH = 240;
const FALLBACK_FULL_NAME = 'Резидент';

/**
 * Read-only display profile (name/photo) for the mobile resident check screen.
 *
 * The resident-services pass preview intentionally carries no personal data:
 * the browser receives the subscription instance id, then asks this endpoint
 * for the display name and photo. The service never writes resident state and
 * never becomes a resident directory.
 */
@Injectable()
export class ResidentProfileService {
  constructor(
    @Inject(RESIDENT_PROFILE_PORT) private readonly port: ResidentProfilePort
  ) {}

  async resolve(
    subscriptionInstanceId: string | undefined
  ): Promise<ResidentProfileResponse> {
    this.assertEnabled();
    const instanceId = this.requireSubscriptionInstanceId(subscriptionInstanceId);
    const record = await this.loadRecord(instanceId);
    return {
      subscriptionInstanceId: instanceId,
      fullName: this.normalizeFullName(record?.displayName),
      photoUrl: normalizeResidentPhotoUrl(record?.avatarUrl)
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

  private requireSubscriptionInstanceId(value: string | undefined): string {
    const normalized = String(value ?? '').trim();
    if (
      !normalized
      || normalized.length > 200
      || !SUBSCRIPTION_INSTANCE_ID_PATTERN.test(normalized)
    ) {
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

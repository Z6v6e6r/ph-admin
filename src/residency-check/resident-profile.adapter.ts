import { Injectable } from '@nestjs/common';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import { SubscriptionsRepository } from '../subscriptions/subscriptions.repository';
import type {
  ResidentProfilePort,
  ResidentProfileRecord
} from './residency-check.types';

/**
 * Read-only bridge between the resident-services pass preview and the existing
 * subscription/Viva profile data. It never creates a resident directory, never
 * writes Viva state and never exposes provider identifiers to the browser.
 *
 * The subscription instance is resolved by PadlHub id only; the Viva admin client
 * id stays inside the server integration. Any failure degrades to null so the
 * screen can show initials instead of blocking the whole check.
 */
@Injectable()
export class SubscriptionsVivaResidentProfileAdapter implements ResidentProfilePort {
  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly viva: VivaAdminService
  ) {}

  async profileBySubscriptionInstance(
    subscriptionInstanceId: string
  ): Promise<ResidentProfileRecord | null> {
    const normalized = String(subscriptionInstanceId ?? '').trim();
    if (!normalized) return null;
    try {
      const instance = await this.subscriptions.runtimeInstanceById(normalized);
      if (!instance) return null;
      const profile = await this.viva.getClientProfile(instance.providerClientId);
      if (!profile) return null;
      const displayName = String(profile.displayName ?? '').trim().slice(0, 240);
      return {
        ...(displayName ? { displayName } : {}),
        avatarUrl: normalizeResidentPhotoUrl(profile.avatarUrl)
      };
    } catch {
      return null;
    }
  }
}

/**
 * The browser loads the photo itself; only https or site-relative single-slash
 * paths are allowed. data:, javascript:, protocol-relative and credentials are
 * rejected instead of being rendered.
 */
export function normalizeResidentPhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

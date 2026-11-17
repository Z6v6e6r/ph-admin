import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

const PROFILE_URL = 'https://api.vivacrm.ru/end-user/api/v1/iSkq6G/profile';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const phone = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('8') ? '7' + digits.slice(1) : digits;
  return /^7\d{10}$/.test(normalized) ? normalized : null;
};

/** The already verified widget JWT may omit the provider id. Resolve only its own profile. */
export async function resolveResidencyProviderIdentity(authorization: string | undefined,
  tenantId: string, phoneNorm: string): Promise<string> {
  if (tenantId !== 'iSkq6G' || !/^Bearer\s+\S+$/i.test(authorization || '') || phone(phoneNorm) !== phoneNorm) {
    throw new UnauthorizedException({ code: 'SUBSCRIPTIONS_RUNTIME_PROVIDER_CLIENT_REQUIRED' });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(PROFILE_URL, { method: 'GET', redirect: 'error',
      headers: { Authorization: authorization!, Accept: 'application/json' }, signal: controller.signal });
    if (response.status !== 200 || response.url !== PROFILE_URL) throw new Error('Profile unavailable');
    const profile: unknown = await response.json();
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Invalid profile');
    const row = profile as Record<string, unknown>;
    const phones = [row.phone, row.phoneNumber, row.mobile].filter(value => value !== undefined && value !== null);
    if (typeof row.id !== 'string' || !ID.test(row.id) || !phones.length
      || phones.some(value => phone(value) !== phoneNorm)) {
      throw new UnauthorizedException({ code: 'SUBSCRIPTIONS_RUNTIME_PROFILE_IDENTITY_MISMATCH' });
    }
    return row.id;
  } catch (error) {
    if (error instanceof UnauthorizedException) throw error;
    throw new ServiceUnavailableException({ code: 'SUBSCRIPTIONS_RUNTIME_PROFILE_UNAVAILABLE' });
  } finally { clearTimeout(timeout); }
}

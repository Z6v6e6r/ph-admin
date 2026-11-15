import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export function authorizeSupportMedia(token?: string): void {
  const expected = String(process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN ?? process.env.SUPPORT_INTEGRATION_TOKEN ?? '').trim();
  if (!expected) throw new ServiceUnavailableException({ code: 'SUPPORT_MEDIA_INTEGRATION_UNCONFIGURED' });
  const a = Buffer.from(expected), b = Buffer.from(token ?? '');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException({ code: 'SUPPORT_MEDIA_INTEGRATION_FORBIDDEN' });
}

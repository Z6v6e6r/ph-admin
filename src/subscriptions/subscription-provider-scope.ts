import { createHash } from 'node:crypto';
import {
  SubscriptionProviderScope,
  SubscriptionRuntimeProjectionSnapshot
} from './subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const STATION_SET_SCOPE_PREFIX = 'station-set:';

export class SubscriptionProviderScopeDerivationError extends Error {
  constructor() {
    super('Subscription provider scope is unsupported');
    this.name = 'SubscriptionProviderScopeDerivationError';
  }
}

export function deriveSubscriptionProviderScope(
  rules: SubscriptionRuntimeProjectionSnapshot['stationAccessRules'],
  tenantId: string
): SubscriptionProviderScope {
  const enabled = rules.filter((rule) => rule.enabled);
  if (enabled.length === 1 && enabled[0].selector.kind === 'ALL_STATIONS') {
    if (!ID_PATTERN.test(tenantId)) throw new SubscriptionProviderScopeDerivationError();
    return { kind: 'TENANT', scopeId: tenantId };
  }
  if (enabled.some((rule) => rule.selector.kind !== 'STATION_LIST')) {
    throw new SubscriptionProviderScopeDerivationError();
  }
  const stationIds = [...new Set(enabled.flatMap((rule) => rule.selector.stationIds))].sort();
  if (stationIds.length === 0 || stationIds.some((stationId) => !ID_PATTERN.test(stationId))) {
    throw new SubscriptionProviderScopeDerivationError();
  }
  if (stationIds.length === 1) return { kind: 'STATION', scopeId: stationIds[0] };
  const stationSetDigest = createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, stationIds }))
    .digest('hex');
  return { kind: 'STATION_SET', scopeId: `${STATION_SET_SCOPE_PREFIX}${stationSetDigest}` };
}

export function subscriptionProviderScopeMatchesProjection(
  providerScope: SubscriptionProviderScope,
  runtimeProjection: SubscriptionRuntimeProjectionSnapshot,
  tenantId: string
): boolean {
  try {
    const expected = deriveSubscriptionProviderScope(runtimeProjection.stationAccessRules, tenantId);
    return expected.kind === providerScope.kind && expected.scopeId === providerScope.scopeId;
  } catch (error) {
    if (error instanceof SubscriptionProviderScopeDerivationError) return false;
    throw error;
  }
}

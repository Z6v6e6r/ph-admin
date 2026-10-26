export type MaxOutboxMode = 'legacy' | 'receipt-v1';

export function maxOutboxMode(environment: NodeJS.ProcessEnv = process.env): MaxOutboxMode {
  const value = String(environment.SUPPORT_MAX_OUTBOX_MODE ?? '').trim();
  if (!value || value === 'legacy') return 'legacy';
  if (value === 'receipt-v1') return 'receipt-v1';
  throw new Error('SUPPORT_MAX_OUTBOX_MODE_INVALID');
}

function enabled(name: string, environment: NodeJS.ProcessEnv): boolean {
  const value = String(environment[name] ?? '').trim().toLowerCase();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name}_INVALID`);
}

export function releaseCapabilities(environment: NodeJS.ProcessEnv = process.env) {
  return {
    locationRecommendationPhotosEnabled: enabled('PHAB_LOCATION_PHOTOS_ENABLED', environment),
    notificationScenariosEnabled: enabled('PHAB_NOTIFICATION_SCENARIOS_ENABLED', environment),
    communityPoliciesEnabled: enabled('PHAB_COMMUNITY_POLICIES_ENABLED', environment)
  };
}

export function validateReleaseCapabilities(): void {
  maxOutboxMode();
  releaseCapabilities();
}

export function containsMaxReceiptFields(value: unknown): boolean {
  return !!value && typeof value === 'object'
    && ['leaseToken', 'failure', 'retryAfterSeconds'].some(key => Object.prototype.hasOwnProperty.call(value, key));
}

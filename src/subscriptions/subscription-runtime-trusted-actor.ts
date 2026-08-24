export interface TrustedSubscriptionRuntimeActor {
  source: 'LK_IDENTITY' | 'LK2_DELEGATION';
  runtimeTenantId: string;
  actorUserId: string;
  provider: 'VIVA';
  providerClientId: string;
  evidenceRef: string;
  verifiedAt: string;
}

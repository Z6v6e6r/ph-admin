export interface LkIdentityActor {
  issuer: string;
  subject: string;
  clientId?: string;
  phoneNorm: string;
  name?: string;
  tenantKey: string;
  authorizedParty: string;
  verified: true;
  source: 'cup-keycloak-jwt';
}
export interface LkIdentityVerificationResult {
  ok: true;
  actor: LkIdentityActor;
  token: {
    expiresAt: string;
  };
}

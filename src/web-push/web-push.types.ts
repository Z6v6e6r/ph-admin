export interface WebPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscriptionData {
  endpoint: string;
  expirationTime?: number | null;
  keys: WebPushSubscriptionKeys;
}

export interface StoredWebPushSubscription {
  clientId: string;
  endpoint: string;
  endpointHash: string;
  subscription: WebPushSubscriptionData;
  threadId?: string;
  createdAt: string;
  updatedAt: string;
  userAgent?: string;
  lastNotifiedAt?: string;
}

export interface WebPushClientConfig {
  enabled: boolean;
  publicKey?: string;
}

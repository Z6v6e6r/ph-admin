import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { Role } from '../common/rbac/role.enum';
import { ChatMessage, ChatThread, ConnectorRoute } from '../messenger/messenger.types';
import { MessengerService } from '../messenger/messenger.service';
import { SupportDialog, SupportConnectorRoute, SupportMessage, SupportMessageDirection } from '../support/support.types';
import { SupportService } from '../support/support.service';
import { WebPushPersistenceService } from './web-push-persistence.service';
import {
  StoredWebPushSubscription,
  WebPushClientConfig,
  WebPushSubscriptionData
} from './web-push.types';

interface WebPushRuntime {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: WebPushSubscriptionData,
    payload?: string,
    options?: Record<string, unknown>
  ): Promise<void>;
}

interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  threadId: string;
  tag: string;
}

const webPush = require('web-push') as WebPushRuntime;

@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private readonly featureEnabled = this.resolveFeatureEnabled();
  private readonly vapidPublicKey = String(
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? ''
  ).trim();
  private readonly vapidPrivateKey = String(
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? ''
  ).trim();
  private readonly vapidSubject =
    String(process.env.WEB_PUSH_SUBJECT ?? '').trim() || 'mailto:support@padelhub.local';
  private readonly clickUrlBase = String(process.env.WEB_PUSH_CLICK_URL ?? '').trim() || '/';
  private readonly subscriptionsByClient = new Map<string, Map<string, StoredWebPushSubscription>>();
  private ready = false;

  constructor(
    private readonly persistence: WebPushPersistenceService,
    private readonly messengerService: MessengerService,
    private readonly supportService: SupportService
  ) {}

  async onModuleInit(): Promise<void> {
    this.messengerService.registerMessageObserver((thread, message) =>
      this.handleMessengerMessage(thread, message)
    );
    this.supportService.registerMessageObserver((dialog, message) =>
      this.handleSupportMessage(dialog, message)
    );

    if (!this.featureEnabled) {
      this.logger.log('Web push disabled by WEB_PUSH_ENABLED=false');
      return;
    }

    if (!this.vapidPublicKey || !this.vapidPrivateKey) {
      this.logger.warn(
        'WEB_PUSH_VAPID_PUBLIC_KEY/WEB_PUSH_VAPID_PRIVATE_KEY are not set. Web push disabled.'
      );
      return;
    }

    try {
      webPush.setVapidDetails(this.vapidSubject, this.vapidPublicKey, this.vapidPrivateKey);
      await this.hydrateFromPersistence();
      this.ready = true;
      this.logger.log('Web push notifications enabled');
    } catch (error) {
      this.ready = false;
      this.logger.error('Failed to initialize web push', error as Error);
    }
  }

  getClientConfig(): WebPushClientConfig {
    if (!this.ready) {
      return { enabled: false };
    }
    return {
      enabled: true,
      publicKey: this.vapidPublicKey
    };
  }

  upsertSubscription(
    clientId: string,
    rawSubscription: Record<string, unknown>,
    options: {
      threadId?: string;
      userAgent?: string;
    } = {}
  ): StoredWebPushSubscription {
    this.ensureReady();
    const subscription = this.normalizeSubscription(rawSubscription);
    if (!subscription) {
      throw new BadRequestException('Invalid push subscription payload');
    }

    const endpointHash = this.hashEndpoint(subscription.endpoint);
    const existing = this.subscriptionsByClient.get(clientId)?.get(endpointHash);
    const now = new Date().toISOString();
    const normalizedThreadId = this.normalizeThreadId(options.threadId);

    const stored: StoredWebPushSubscription = {
      clientId,
      endpoint: subscription.endpoint,
      endpointHash,
      subscription,
      threadId: normalizedThreadId ?? existing?.threadId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      userAgent: options.userAgent?.trim() || existing?.userAgent,
      lastNotifiedAt: existing?.lastNotifiedAt
    };

    this.indexSubscription(stored);
    this.persistence.persistSubscription(stored);

    return stored;
  }

  removeSubscription(clientId: string, endpoint: string): boolean {
    const endpointHash = this.hashEndpoint(endpoint);
    const byClient = this.subscriptionsByClient.get(clientId);
    if (!byClient || !byClient.has(endpointHash)) {
      return false;
    }

    byClient.delete(endpointHash);
    if (byClient.size === 0) {
      this.subscriptionsByClient.delete(clientId);
    }
    this.persistence.removeSubscription(clientId, endpointHash);
    return true;
  }

  private async hydrateFromPersistence(): Promise<void> {
    const persisted = await this.persistence.loadSubscriptions();
    for (const item of persisted) {
      if (!this.isValidStoredSubscription(item)) {
        continue;
      }
      this.indexSubscription(item);
    }
  }

  private isValidStoredSubscription(item: StoredWebPushSubscription): boolean {
    if (!item || typeof item !== 'object') {
      return false;
    }
    if (!item.clientId || !item.endpointHash || !item.endpoint) {
      return false;
    }
    return this.isValidSubscriptionData(item.subscription);
  }

  private handleMessengerMessage(thread: ChatThread, message: ChatMessage): void {
    if (!this.ready) {
      return;
    }
    if (!this.isWebConnector(thread.connector)) {
      return;
    }
    if (message.senderRole === Role.CLIENT) {
      return;
    }

    const payload = this.buildNotificationPayload(
      thread.stationName,
      message.text,
      thread.id
    );
    void this.pushToClient(thread.clientId, payload);
  }

  private handleSupportMessage(dialog: SupportDialog, message: SupportMessage): void {
    if (!this.ready) {
      return;
    }
    if (!this.isWebConnector(message.connector)) {
      return;
    }
    if (message.direction !== SupportMessageDirection.OUTBOUND) {
      return;
    }
    if (String(message.senderRole).trim().toUpperCase() === 'SYSTEM') {
      return;
    }

    const payload = this.buildNotificationPayload(
      dialog.stationName,
      message.text,
      dialog.id
    );
    void this.pushToClient(dialog.clientId, payload);
  }

  private async pushToClient(clientId: string, payload: PushNotificationPayload): Promise<void> {
    const byClient = this.subscriptionsByClient.get(clientId);
    if (!byClient || byClient.size === 0) {
      return;
    }

    const payloadJson = JSON.stringify(payload);
    const subscriptions = Array.from(byClient.values());
    await Promise.all(
      subscriptions.map((subscription) =>
        this.pushToSingleSubscription(subscription, payloadJson)
      )
    );
  }

  private async pushToSingleSubscription(
    subscription: StoredWebPushSubscription,
    payloadJson: string
  ): Promise<void> {
    try {
      await webPush.sendNotification(subscription.subscription, payloadJson, {
        TTL: 60,
        urgency: 'high'
      });
      const notifiedAt = new Date().toISOString();
      subscription.lastNotifiedAt = notifiedAt;
      subscription.updatedAt = notifiedAt;
      this.persistence.touchSubscription(
        subscription.clientId,
        subscription.endpointHash,
        notifiedAt
      );
    } catch (error) {
      if (this.isSubscriptionExpired(error)) {
        this.removeSubscription(subscription.clientId, subscription.endpoint);
        return;
      }
      this.logger.warn(
        `Failed to send push notification for client ${subscription.clientId}: ${this.describePushError(error)}`
      );
    }
  }

  private isSubscriptionExpired(error: unknown): boolean {
    const statusCode = Number(
      (error as { statusCode?: number; status?: number })?.statusCode ??
        (error as { status?: number })?.status
    );
    if (statusCode === 404 || statusCode === 410) {
      return true;
    }

    const body = String((error as { body?: unknown })?.body ?? '').toLowerCase();
    return body.includes('unsubscribed') || body.includes('expired');
  }

  private describePushError(error: unknown): string {
    const statusCode = Number(
      (error as { statusCode?: number; status?: number })?.statusCode ??
        (error as { status?: number })?.status
    );
    const body = String((error as { body?: unknown })?.body ?? '').trim();
    const details = [statusCode > 0 ? `status=${statusCode}` : '', body]
      .filter((part) => part.length > 0)
      .join(' ');
    return details || 'unknown error';
  }

  private buildNotificationPayload(
    stationName: string | undefined,
    messageText: string | undefined,
    threadId: string
  ): PushNotificationPayload {
    const resolvedStationName = String(stationName ?? '').trim();
    const title = resolvedStationName
      ? `Новое сообщение: ${resolvedStationName}`
      : 'Новое сообщение поддержки';
    const trimmedText = String(messageText ?? '').trim();
    const body = trimmedText
      ? trimmedText.slice(0, 180)
      : 'Откройте чат, чтобы прочитать сообщение.';
    return {
      title,
      body,
      url: this.buildClickUrl(threadId),
      threadId,
      tag: `phab-chat-${threadId}`
    };
  }

  private buildClickUrl(threadId: string): string {
    const separator = this.clickUrlBase.includes('?') ? '&' : '?';
    return `${this.clickUrlBase}${separator}threadId=${encodeURIComponent(threadId)}`;
  }

  private normalizeSubscription(
    rawSubscription: Record<string, unknown>
  ): WebPushSubscriptionData | null {
    if (!rawSubscription || typeof rawSubscription !== 'object') {
      return null;
    }

    const endpoint = String(rawSubscription.endpoint ?? '').trim();
    if (!endpoint || !endpoint.startsWith('https://')) {
      return null;
    }

    const keysRaw = rawSubscription.keys;
    if (!keysRaw || typeof keysRaw !== 'object' || Array.isArray(keysRaw)) {
      return null;
    }
    const keys = keysRaw as Record<string, unknown>;
    const p256dh = String(keys.p256dh ?? '').trim();
    const auth = String(keys.auth ?? '').trim();
    if (!p256dh || !auth) {
      return null;
    }

    const expirationTimeRaw = rawSubscription.expirationTime;
    let expirationTime: number | null | undefined;
    if (expirationTimeRaw === null) {
      expirationTime = null;
    } else if (typeof expirationTimeRaw === 'number' && Number.isFinite(expirationTimeRaw)) {
      expirationTime = expirationTimeRaw;
    }

    const normalized: WebPushSubscriptionData = {
      endpoint,
      keys: {
        p256dh,
        auth
      }
    };
    if (expirationTime !== undefined) {
      normalized.expirationTime = expirationTime;
    }

    return normalized;
  }

  private isValidSubscriptionData(subscription: WebPushSubscriptionData | undefined): boolean {
    if (!subscription || typeof subscription !== 'object') {
      return false;
    }
    if (!subscription.endpoint || !subscription.endpoint.startsWith('https://')) {
      return false;
    }
    if (!subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
      return false;
    }
    return true;
  }

  private normalizeThreadId(threadId?: string): string | undefined {
    const normalized = String(threadId ?? '').trim();
    return normalized || undefined;
  }

  private indexSubscription(subscription: StoredWebPushSubscription): void {
    const existingByClient =
      this.subscriptionsByClient.get(subscription.clientId) ?? new Map<string, StoredWebPushSubscription>();
    existingByClient.set(subscription.endpointHash, subscription);
    this.subscriptionsByClient.set(subscription.clientId, existingByClient);
  }

  private hashEndpoint(endpoint: string): string {
    return createHash('sha256').update(String(endpoint).trim()).digest('hex');
  }

  private resolveFeatureEnabled(): boolean {
    const raw = String(process.env.WEB_PUSH_ENABLED ?? '').trim().toLowerCase();
    if (!raw) {
      return true;
    }
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  private isWebConnector(connector: ConnectorRoute | SupportConnectorRoute): boolean {
    return (
      connector === ConnectorRoute.LK_WEB_MESSENGER ||
      connector === ConnectorRoute.LK_ACADEMY_WEB_MESSENGER ||
      connector === SupportConnectorRoute.LK_WEB_MESSENGER ||
      connector === SupportConnectorRoute.LK_ACADEMY_WEB_MESSENGER
    );
  }

  private ensureReady(): void {
    if (this.ready) {
      return;
    }
    throw new BadRequestException('Web push is not configured');
  }
}

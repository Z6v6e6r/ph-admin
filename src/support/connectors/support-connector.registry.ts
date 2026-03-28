import { Injectable } from '@nestjs/common';
import { IngestSupportEventDto } from '../dto/ingest-support-event.dto';
import { SupportConnectorRoute } from '../support.types';
import {
  SupportConnectorAdapter,
  SupportConnectorEventNormalizationPatch,
  SupportConnectorNormalizationHelpers
} from './support-connector-adapter';
import { MaxAcademySupportConnectorAdapter } from './max-academy-support.connector';
import { MaxSupportConnectorAdapter } from './max-support.connector';
import { WebAcademySupportConnectorAdapter } from './web-academy-support.connector';
import { WebSupportConnectorAdapter } from './web-support.connector';

export interface SupportConnectorRegistryEntry {
  route: SupportConnectorRoute;
  aliases: string[];
  hasAdapter: boolean;
}

@Injectable()
export class SupportConnectorRegistry {
  private readonly adaptersByRoute = new Map<SupportConnectorRoute, SupportConnectorAdapter>();
  private readonly routeAliases = new Map<SupportConnectorRoute, Set<string>>();
  private readonly normalizedAliasToRoute = new Map<string, SupportConnectorRoute>();

  constructor(
    maxAdapter: MaxSupportConnectorAdapter,
    maxAcademyAdapter: MaxAcademySupportConnectorAdapter,
    webAdapter: WebSupportConnectorAdapter,
    webAcademyAdapter: WebAcademySupportConnectorAdapter
  ) {
    this.registerAdapter(maxAdapter);
    this.registerAdapter(maxAcademyAdapter);
    this.registerAdapter(webAdapter);
    this.registerAdapter(webAcademyAdapter);
    this.registerAliases(SupportConnectorRoute.TG_BOT, ['TG_BOT', 'TG', 'TELEGRAM']);
    this.registerAliases(SupportConnectorRoute.EMAIL, ['EMAIL', 'MAIL']);
    this.registerAliases(SupportConnectorRoute.PHONE_CALL, ['PHONE_CALL', 'CALL', 'PHONE']);
    this.registerAliases(SupportConnectorRoute.BITRIX, ['BITRIX', 'BITRIX24']);
  }

  resolveRoute(rawRoute: unknown): SupportConnectorRoute | undefined {
    const normalized = this.normalizeAlias(rawRoute);
    if (!normalized) {
      return undefined;
    }
    return this.normalizedAliasToRoute.get(normalized);
  }

  normalizeIncomingEvent(
    dto: IngestSupportEventDto,
    helpers: SupportConnectorNormalizationHelpers
  ): SupportConnectorEventNormalizationPatch {
    const adapterRoute = this.resolveRoute(dto.connector ?? dto.channel);
    const adapter = adapterRoute ? this.adaptersByRoute.get(adapterRoute) : undefined;
    if (!adapter?.normalizeIncomingEvent) {
      return {
        externalUserId: helpers.normalizeIdentityValue(dto.externalUserId),
        externalChatId: helpers.normalizeIdentityValue(dto.externalChatId),
        displayName: helpers.normalizeDisplayName(dto.displayName),
        username: helpers.normalizeIdentityValue(dto.username),
        selectedStationId: helpers.normalizeStationId(dto.selectedStationId),
        selectedStationName: helpers.normalizeDisplayName(dto.selectedStationName),
        deliverToClient: helpers.resolveDeliverToClient(dto)
      };
    }
    return adapter.normalizeIncomingEvent(
      {
        ...dto,
        connector: adapterRoute
      },
      helpers
    );
  }

  listEntries(): SupportConnectorRegistryEntry[] {
    return Object.values(SupportConnectorRoute)
      .map((route) => ({
        route,
        aliases: Array.from(this.routeAliases.get(route) ?? []).sort((left, right) =>
          left.localeCompare(right)
        ),
        hasAdapter: this.adaptersByRoute.has(route)
      }))
      .sort((left, right) => left.route.localeCompare(right.route));
  }

  private registerAdapter(adapter: SupportConnectorAdapter): void {
    this.adaptersByRoute.set(adapter.route, adapter);
    this.registerAliases(adapter.route, adapter.aliases);
  }

  private registerAliases(route: SupportConnectorRoute, aliases: string[]): void {
    const existing = this.routeAliases.get(route) ?? new Set<string>();
    const normalizedRouteAlias = this.normalizeAlias(route);
    if (normalizedRouteAlias) {
      existing.add(normalizedRouteAlias);
      this.normalizedAliasToRoute.set(normalizedRouteAlias, route);
    }

    for (const alias of aliases) {
      const normalizedAlias = this.normalizeAlias(alias);
      if (!normalizedAlias) {
        continue;
      }
      existing.add(normalizedAlias);
      this.normalizedAliasToRoute.set(normalizedAlias, route);
    }

    this.routeAliases.set(route, existing);
  }

  private normalizeAlias(rawAlias: unknown): string | undefined {
    if (typeof rawAlias !== 'string') {
      return undefined;
    }
    const normalizedAlias = rawAlias.trim().toUpperCase();
    return normalizedAlias || undefined;
  }
}

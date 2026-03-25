import { IngestSupportEventDto } from '../dto/ingest-support-event.dto';
import { SupportConnectorRoute } from '../support.types';

export interface SupportStationMappingMatch {
  stationId: string;
  stationName: string;
}

export interface SupportConnectorNormalizationHelpers {
  normalizeIdentityValue(raw?: string): string | undefined;
  normalizeDisplayName(raw?: string): string | undefined;
  normalizeStationId(raw?: string): string | undefined;
  extractMetaPathString(
    meta: Record<string, unknown> | undefined,
    path: string[]
  ): string | undefined;
  resolveSenderIsBot(dto: IngestSupportEventDto): boolean;
  resolveStationMappingFromAction(action?: string): SupportStationMappingMatch | undefined;
  resolveDeliverToClient(dto: IngestSupportEventDto): boolean;
}

export interface SupportConnectorEventNormalizationPatch {
  externalUserId?: string;
  externalChatId?: string;
  displayName?: string;
  username?: string;
  selectedStationId?: string;
  selectedStationName?: string;
  deliverToClient?: boolean;
}

export interface SupportConnectorAdapter {
  readonly route: SupportConnectorRoute;
  readonly aliases: string[];
  normalizeIncomingEvent?(
    dto: IngestSupportEventDto,
    helpers: SupportConnectorNormalizationHelpers
  ): SupportConnectorEventNormalizationPatch;
}


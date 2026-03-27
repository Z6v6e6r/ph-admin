import { Injectable } from '@nestjs/common';
import { IngestSupportEventDto } from '../dto/ingest-support-event.dto';
import { SupportConnectorRoute } from '../support.types';
import {
  SupportConnectorAdapter,
  SupportConnectorEventNormalizationPatch,
  SupportConnectorNormalizationHelpers
} from './support-connector-adapter';

@Injectable()
export class WebSupportConnectorAdapter implements SupportConnectorAdapter {
  readonly route: SupportConnectorRoute = SupportConnectorRoute.LK_WEB_MESSENGER;
  readonly aliases = ['LK_WEB_MESSENGER', 'WEB', 'WEB_LK', 'LK_WEB', 'LK', 'WIDGET'];

  normalizeIncomingEvent(
    dto: IngestSupportEventDto,
    helpers: SupportConnectorNormalizationHelpers
  ): SupportConnectorEventNormalizationPatch {
    const normalizedEventType = String(dto.eventType ?? '')
      .trim()
      .toUpperCase();
    const isStationSelectionEvent =
      normalizedEventType === 'STATION_SELECTION' ||
      normalizedEventType === 'STATION_SELECTED' ||
      normalizedEventType === 'SELECT_STATION';
    const selectedStationIdFromMeta = helpers.normalizeStationId(
      helpers.extractMetaPathString(dto.meta, ['payload', 'selectedStationId']) ??
        helpers.extractMetaPathString(dto.meta, ['payload', 'stationId']) ??
        helpers.extractMetaPathString(dto.meta, ['payload', 'station', 'id']) ??
        helpers.extractMetaPathString(dto.meta, ['data', 'selectedStationId']) ??
        helpers.extractMetaPathString(dto.meta, ['data', 'stationId']) ??
        helpers.extractMetaPathString(dto.meta, ['data', 'station', 'id'])
    );
    const selectedStationNameFromMeta = helpers.normalizeDisplayName(
      helpers.extractMetaPathString(dto.meta, ['payload', 'selectedStationName']) ??
        helpers.extractMetaPathString(dto.meta, ['payload', 'stationName']) ??
        helpers.extractMetaPathString(dto.meta, ['payload', 'stationTitle']) ??
        helpers.extractMetaPathString(dto.meta, ['payload', 'station', 'name']) ??
        helpers.extractMetaPathString(dto.meta, ['payload', 'station', 'title']) ??
        helpers.extractMetaPathString(dto.meta, ['data', 'selectedStationName']) ??
        helpers.extractMetaPathString(dto.meta, ['data', 'stationName']) ??
        helpers.extractMetaPathString(dto.meta, ['data', 'stationTitle']) ??
        helpers.extractMetaPathString(dto.meta, ['data', 'station', 'name']) ??
        helpers.extractMetaPathString(dto.meta, ['data', 'station', 'title'])
    );

    return {
      externalUserId: helpers.normalizeIdentityValue(
        dto.externalUserId ?? dto.userId ?? dto.senderId ?? dto.channelUserId ?? dto.clientId
      ),
      externalChatId: helpers.normalizeIdentityValue(
        dto.externalChatId ?? dto.externalThreadId ?? dto.chatId
      ),
      displayName: helpers.normalizeDisplayName(
        dto.displayName ?? dto.clientName ?? dto.senderName
      ),
      username: helpers.normalizeIdentityValue(dto.username),
      selectedStationId: helpers.normalizeStationId(
        dto.selectedStationId ??
          selectedStationIdFromMeta ??
          dto.stationId ??
          (isStationSelectionEvent ? dto.stationId : undefined)
      ),
      selectedStationName: helpers.normalizeDisplayName(
        dto.selectedStationName ??
          selectedStationNameFromMeta ??
          dto.stationName ??
          (isStationSelectionEvent ? dto.stationName : undefined)
      ),
      deliverToClient: helpers.resolveDeliverToClient(dto)
    };
  }
}

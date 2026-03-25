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
  readonly route = SupportConnectorRoute.LK_WEB_MESSENGER;
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

    return {
      externalUserId: helpers.normalizeIdentityValue(dto.externalUserId),
      externalChatId: helpers.normalizeIdentityValue(dto.externalChatId),
      displayName: helpers.normalizeDisplayName(dto.displayName),
      username: helpers.normalizeIdentityValue(dto.username),
      selectedStationId: helpers.normalizeStationId(
        dto.selectedStationId ?? (isStationSelectionEvent ? dto.stationId : undefined)
      ),
      selectedStationName: helpers.normalizeDisplayName(
        dto.selectedStationName ?? (isStationSelectionEvent ? dto.stationName : undefined)
      ),
      deliverToClient: helpers.resolveDeliverToClient(dto)
    };
  }
}

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
  readonly aliases = ['LK_WEB_MESSENGER', 'WEB', 'LK_WEB', 'LK', 'WIDGET'];

  normalizeIncomingEvent(
    dto: IngestSupportEventDto,
    helpers: SupportConnectorNormalizationHelpers
  ): SupportConnectorEventNormalizationPatch {
    return {
      externalUserId: helpers.normalizeIdentityValue(dto.externalUserId),
      externalChatId: helpers.normalizeIdentityValue(dto.externalChatId),
      displayName: helpers.normalizeDisplayName(dto.displayName),
      username: helpers.normalizeIdentityValue(dto.username),
      selectedStationId: helpers.normalizeStationId(dto.selectedStationId ?? dto.stationId),
      selectedStationName: helpers.normalizeDisplayName(
        dto.selectedStationName ?? dto.stationName
      ),
      deliverToClient: helpers.resolveDeliverToClient(dto)
    };
  }
}


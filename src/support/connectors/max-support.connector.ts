import { Injectable } from '@nestjs/common';
import { IngestSupportEventDto } from '../dto/ingest-support-event.dto';
import { SupportConnectorRoute } from '../support.types';
import {
  SupportConnectorAdapter,
  SupportConnectorEventNormalizationPatch,
  SupportConnectorNormalizationHelpers
} from './support-connector-adapter';

@Injectable()
export class MaxSupportConnectorAdapter implements SupportConnectorAdapter {
  readonly route = SupportConnectorRoute.MAX_BOT;
  readonly aliases = ['MAX_BOT', 'MAX'];

  normalizeIncomingEvent(
    dto: IngestSupportEventDto,
    helpers: SupportConnectorNormalizationHelpers
  ): SupportConnectorEventNormalizationPatch {
    const senderIsBot = helpers.resolveSenderIsBot(dto);
    const recipientExternalUserId =
      helpers.normalizeIdentityValue(dto.recipientExternalUserId) ??
      helpers.extractMetaPathString(dto.meta, ['data', 'recipient', 'user_id']);
    const recipientExternalChatId =
      helpers.normalizeIdentityValue(dto.recipientExternalChatId) ??
      helpers.extractMetaPathString(dto.meta, ['data', 'recipient', 'chat_id']);
    const recipientUsername =
      helpers.normalizeIdentityValue(dto.recipientUsername) ??
      helpers.extractMetaPathString(dto.meta, ['data', 'recipient', 'username']);
    const selectedStation =
      helpers.resolveStationMappingFromAction(dto.action) ??
      helpers.resolveStationMappingFromAction(
        helpers.extractMetaPathString(dto.meta, ['action'])
      ) ??
      helpers.resolveStationMappingFromAction(
        helpers.extractMetaPathString(dto.meta, ['data', 'action'])
      ) ??
      helpers.resolveStationMappingFromAction(
        helpers.extractMetaPathString(dto.meta, ['data', 'payload', 'action'])
      ) ??
      helpers.resolveStationMappingFromAction(dto.selectedStationId) ??
      helpers.resolveStationMappingFromAction(dto.stationId);

    return {
      externalUserId:
        senderIsBot && recipientExternalUserId
          ? recipientExternalUserId
          : helpers.normalizeIdentityValue(dto.externalUserId),
      externalChatId:
        senderIsBot && recipientExternalChatId
          ? recipientExternalChatId
          : helpers.normalizeIdentityValue(dto.externalChatId),
      displayName: senderIsBot ? undefined : helpers.normalizeDisplayName(dto.displayName),
      username: senderIsBot
        ? recipientUsername
        : helpers.normalizeIdentityValue(dto.username),
      selectedStationId:
        helpers.normalizeStationId(dto.selectedStationId ?? dto.stationId) ??
        selectedStation?.stationId,
      selectedStationName:
        helpers.normalizeDisplayName(dto.selectedStationName ?? dto.stationName) ??
        selectedStation?.stationName,
      deliverToClient: helpers.resolveDeliverToClient(dto)
    };
  }
}

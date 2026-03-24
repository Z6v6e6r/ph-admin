import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import {
  VivaAdminService,
  VivaAdminSettingsSnapshot,
  VivaClientCabinetLookup
} from '../integrations/viva/viva-admin.service';
import { SupportService } from '../support/support.service';
import {
  SupportAiInsight,
  SupportConnectorRoute,
  SupportDialogStatus,
  SupportDialogSummary,
  SupportMessage,
  SupportMessageDirection
} from '../support/support.types';
import { CreateAccessRuleDto } from './dto/create-access-rule.dto';
import { CreateConnectorConfigDto } from './dto/create-connector-config.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateStationDto } from './dto/create-station.dto';
import { CreateThreadDto } from './dto/create-thread.dto';
import { ListThreadsDto } from './dto/list-threads.dto';
import { SetAiModeDto } from './dto/set-ai-mode.dto';
import { UpdateAccessRuleDto } from './dto/update-access-rule.dto';
import { UpdateConnectorConfigDto } from './dto/update-connector-config.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { UpdateVivaSettingsDto } from './dto/update-viva-settings.dto';
import {
  AiDialogTopic,
  AiReplySuggestion,
  AiUrgency,
  ChatMessage,
  ChatThread,
  ConnectorRoute,
  ConnectorSummary,
  DialogAiInsight,
  MessageOrigin,
  MessengerAccessRule,
  MessengerConnectorConfig,
  MessengerSettingsSnapshot,
  MessengerStationConfig,
  StaffResponseMetric,
  StationDialogSummary,
  StationSummary,
  ThreadStatus,
  ThreadAiConfig
} from './messenger.types';
import { MessengerService } from './messenger.service';

@Controller('messenger')
@Roles(
  Role.SUPER_ADMIN,
  Role.SUPPORT,
  Role.STATION_ADMIN,
  Role.MANAGER,
  Role.TOURNAMENT_MANAGER,
  Role.GAME_MANAGER,
  Role.CLIENT
)
export class MessengerController {
  constructor(
    private readonly messengerService: MessengerService,
    private readonly supportService: SupportService,
    private readonly vivaAdminService: VivaAdminService
  ) {}

  @Get('threads')
  listThreads(
    @CurrentUser() user?: RequestUser,
    @Query() query: ListThreadsDto = {}
  ): ChatThread[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listThreads(user, query);
  }

  @Get('connectors')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listConnectors(@CurrentUser() user?: RequestUser): ConnectorSummary[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listConnectors(user);
  }

  @Get('connectors/:connector/stations')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listStationsByConnector(
    @Param('connector', new ParseEnumPipe(ConnectorRoute)) connector: ConnectorRoute,
    @CurrentUser() user?: RequestUser
  ): StationSummary[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listStationsByConnector(connector, user);
  }

  @Get('connectors/:connector/stations/:stationId/dialogs')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listDialogsByStation(
    @Param('connector', new ParseEnumPipe(ConnectorRoute)) connector: ConnectorRoute,
    @Param('stationId') stationId: string,
    @CurrentUser() user?: RequestUser
  ): StationDialogSummary[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listDialogsByStation(connector, stationId, user);
  }

  @Get('dialogs')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listDialogs(
    @CurrentUser() user?: RequestUser,
    @Query() query: ListThreadsDto = {}
  ): Promise<StationDialogSummary[]> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.listCompatibleDialogs(user, query);
  }

  @Get('viva/client-cabinet')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  async getVivaClientCabinet(
    @Query('phone') phone: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<VivaClientCabinetLookup | null> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.vivaAdminService.lookupClientCabinetByPhone(phone);
  }

  @Get('settings')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  getSettings(@CurrentUser() user?: RequestUser): MessengerSettingsSnapshot {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.getSettings(user);
  }

  @Get('settings/viva')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  async getVivaSettings(@CurrentUser() user?: RequestUser): Promise<VivaAdminSettingsSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.vivaAdminService.getSettings();
  }

  @Patch('settings/viva')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  async updateVivaSettings(
    @Body() dto: UpdateVivaSettingsDto,
    @CurrentUser() user?: RequestUser
  ): Promise<VivaAdminSettingsSnapshot> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.vivaAdminService.updateSettings({
      baseUrl: dto.baseUrl,
      tokenUrl: dto.tokenUrl,
      clientId: dto.clientId,
      username: dto.username,
      staticToken: dto.staticToken,
      password: dto.password,
      updatedBy: user.id
    });
  }

  @Get('settings/stations')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  listStationConfigs(@CurrentUser() user?: RequestUser): MessengerStationConfig[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listStationConfigs(user);
  }

  @Post('settings/stations')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  createStationConfig(
    @Body() dto: CreateStationDto,
    @CurrentUser() user?: RequestUser
  ): MessengerStationConfig {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.createStationConfig(dto, user);
  }

  @Patch('settings/stations/:stationId')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  updateStationConfig(
    @Param('stationId') stationId: string,
    @Body() dto: UpdateStationDto,
    @CurrentUser() user?: RequestUser
  ): MessengerStationConfig {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.updateStationConfig(stationId, dto, user);
  }

  @Get('settings/connectors')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  listConnectorConfigs(@CurrentUser() user?: RequestUser): MessengerConnectorConfig[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listConnectorConfigs(user);
  }

  @Post('settings/connectors')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  createConnectorConfig(
    @Body() dto: CreateConnectorConfigDto,
    @CurrentUser() user?: RequestUser
  ): MessengerConnectorConfig {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.createConnectorConfig(dto, user);
  }

  @Patch('settings/connectors/:connectorId')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  updateConnectorConfig(
    @Param('connectorId') connectorId: string,
    @Body() dto: UpdateConnectorConfigDto,
    @CurrentUser() user?: RequestUser
  ): MessengerConnectorConfig {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.updateConnectorConfig(connectorId, dto, user);
  }

  @Get('settings/access-rules')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.SUPPORT)
  listAccessRules(@CurrentUser() user?: RequestUser): MessengerAccessRule[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listAccessRules(user);
  }

  @Post('settings/access-rules')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  createAccessRule(
    @Body() dto: CreateAccessRuleDto,
    @CurrentUser() user?: RequestUser
  ): MessengerAccessRule {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.createAccessRule(dto, user);
  }

  @Patch('settings/access-rules/:ruleId')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER)
  updateAccessRule(
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateAccessRuleDto,
    @CurrentUser() user?: RequestUser
  ): MessengerAccessRule {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.updateAccessRule(ruleId, dto, user);
  }

  @Get('threads/:threadId')
  getThread(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): ChatThread {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    try {
      return this.messengerService.getThreadById(threadId, user);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      return this.getSupportThread(threadId, user);
    }
  }

  @Post('threads')
  createThread(
    @Body() dto: CreateThreadDto,
    @CurrentUser() user?: RequestUser
  ): ChatThread {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.createThread(dto, user);
  }

  @Get('threads/:threadId/messages')
  listMessages(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): ChatMessage[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    try {
      return this.messengerService.listMessages(threadId, user);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      return this.supportService
        .listMessages(threadId, user)
        .map((message) => this.mapSupportMessageToLegacy(message));
    }
  }

  @Post('threads/:threadId/messages')
  sendMessage(
    @Param('threadId') threadId: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser() user?: RequestUser
  ): ChatMessage {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    try {
      return this.messengerService.sendMessage(threadId, dto, user);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      const result = this.supportService.replyToDialog(threadId, { text: dto.text }, user);
      return this.mapSupportMessageToLegacy(result.message);
    }
  }

  private async listCompatibleDialogs(
    user: RequestUser,
    query: ListThreadsDto = {}
  ): Promise<StationDialogSummary[]> {
    const legacy = this.messengerService.listDialogs(user, query);
    const mappedSupport = this.supportService
      .listDialogs(user)
      .map((dialog) => this.mapSupportDialogToLegacy(dialog))
      .filter((dialog) => (query.connector ? dialog.connector === query.connector : true))
      .filter((dialog) => (query.stationId ? dialog.stationId === query.stationId : true));

    const merged = new Map<string, StationDialogSummary>();
    legacy.forEach((dialog) => merged.set(dialog.threadId, dialog));
    mappedSupport.forEach((dialog) => merged.set(dialog.threadId, dialog));

    const dialogs = Array.from(merged.values()).sort((left, right) => {
      const leftTs = Date.parse(left.lastMessageAt || '') || 0;
      const rightTs = Date.parse(right.lastMessageAt || '') || 0;
      return rightTs - leftTs;
    });

    return this.attachVivaCabinetUrls(dialogs);
  }

  private getSupportThread(threadId: string, user: RequestUser): ChatThread {
    const dialog = this.supportService
      .listDialogs(user)
      .find((item) => item.dialogId === threadId);
    if (!dialog) {
      throw new NotFoundException(`Thread with id ${threadId} not found`);
    }
    return this.mapSupportDialogToThread(dialog);
  }

  private mapSupportDialogToLegacy(dialog: SupportDialogSummary): StationDialogSummary {
    return {
      threadId: dialog.dialogId,
      connector: this.mapSupportConnector(dialog.connector),
      stationId: dialog.stationId,
      stationName: dialog.currentStationName || dialog.stationName,
      accessStationIds: [...dialog.accessStationIds],
      isActiveForUser: dialog.isActiveForUser,
      currentStationId: dialog.currentStationId,
      currentStationName: dialog.currentStationName,
      clientId: dialog.clientId,
      clientDisplayName: dialog.clientDisplayName,
      primaryPhone: dialog.primaryPhone,
      phones: [...dialog.phones],
      subject: dialog.subject,
      status:
        dialog.status === SupportDialogStatus.CLOSED ? ThreadStatus.CLOSED : ThreadStatus.OPEN,
      lastMessageAt: dialog.lastMessageAt,
      lastRankingMessageAt: dialog.lastRankingMessageAt,
      unreadMessagesCount: dialog.unreadCount,
      pendingClientMessagesCount: dialog.pendingClientMessagesCount,
      lastMessageText: dialog.lastMessageText,
      lastMessageSenderRole: this.mapSupportSenderRole(dialog.lastMessageSenderRole),
      lastMessageSenderRoleRaw: dialog.lastMessageSenderRole,
      averageStaffResponseTimeMs: dialog.averageFirstResponseMs,
      lastStaffResponseTimeMs: dialog.lastFirstResponseMs,
      aiTopic: dialog.ai ? this.mapSupportTopic(dialog.ai.topic) : undefined,
      aiUrgency: dialog.ai ? this.mapSupportPriority(dialog.ai.priority) : undefined,
      aiQualityScore:
        dialog.ai && typeof dialog.ai.confidence === 'number'
          ? Math.round(dialog.ai.confidence * 100)
          : undefined
    };
  }

  private async attachVivaCabinetUrls(
    dialogs: StationDialogSummary[]
  ): Promise<StationDialogSummary[]> {
    // Dialog listing no longer resolves Viva cabinet links to avoid expensive CRM phone LIKE lookups.
    return dialogs;
  }

  private mapSupportDialogToThread(dialog: SupportDialogSummary): ChatThread {
    const timestamp = dialog.lastMessageAt || new Date().toISOString();
    return {
      id: dialog.dialogId,
      connector: this.mapSupportConnector(dialog.connector),
      stationId: dialog.stationId,
      stationName: dialog.currentStationName || dialog.stationName,
      clientId: dialog.clientId,
      subject: dialog.clientDisplayName || dialog.subject,
      status:
        dialog.status === SupportDialogStatus.CLOSED ? ThreadStatus.CLOSED : ThreadStatus.OPEN,
      lastMessageAt: dialog.lastMessageAt,
      lastRankingMessageAt: dialog.lastRankingMessageAt,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private mapSupportMessageToLegacy(message: SupportMessage): ChatMessage {
    return {
      id: message.id,
      threadId: message.dialogId,
      senderId: message.senderId,
      senderRole: this.mapSupportSenderRole(message.senderRole) || Role.SUPPORT,
      senderRoleRaw: message.senderRole,
      senderName: message.senderName,
      origin: MessageOrigin.HUMAN,
      direction: message.direction,
      text: message.text || '',
      createdAt: message.createdAt
    };
  }

  private mapSupportConnector(connector: SupportConnectorRoute): ConnectorRoute {
    switch (connector) {
      case SupportConnectorRoute.TG_BOT:
        return ConnectorRoute.TG_BOT;
      case SupportConnectorRoute.LK_WEB_MESSENGER:
        return ConnectorRoute.LK_WEB_MESSENGER;
      case SupportConnectorRoute.MAX_BOT:
      case SupportConnectorRoute.EMAIL:
      case SupportConnectorRoute.PHONE_CALL:
      case SupportConnectorRoute.BITRIX:
      default:
        return ConnectorRoute.MAX_BOT;
    }
  }

  private mapSupportSenderRole(role?: SupportMessage['senderRole']): Role | undefined {
    if (!role || role === 'SYSTEM') {
      return Role.SUPPORT;
    }
    return role;
  }

  private mapSupportTopic(topic?: SupportAiInsight['topic']): AiDialogTopic | undefined {
    switch (topic) {
      case 'BOOKING':
        return AiDialogTopic.BOOKING;
      case 'PAYMENT':
        return AiDialogTopic.PAYMENT;
      case 'TECHNICAL':
        return AiDialogTopic.TECHNICAL;
      case 'COMPLAINT':
        return AiDialogTopic.COMPLAINT;
      default:
        return topic ? AiDialogTopic.GENERAL : undefined;
    }
  }

  private mapSupportPriority(
    priority?: SupportAiInsight['priority']
  ): AiUrgency | undefined {
    switch (priority) {
      case 'CRITICAL':
      case 'IMPORTANT':
        return AiUrgency.HIGH;
      case 'MEDIUM':
        return AiUrgency.MEDIUM;
      case 'RECOMMENDATION':
      default:
        return priority ? AiUrgency.LOW : undefined;
    }
  }

  @Get('threads/:threadId/response-metrics')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  getResponseMetrics(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): StaffResponseMetric[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listResponseMetrics(threadId, user);
  }

  @Get('threads/:threadId/ai-insight')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  getAiInsight(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): DialogAiInsight {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.getAiInsight(threadId, user);
  }

  @Post('threads/:threadId/ai-analyze')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  analyzeAiInsight(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): DialogAiInsight {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.analyzeAiInsight(threadId, user);
  }

  @Get('threads/:threadId/ai-suggestions')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listAiSuggestions(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): AiReplySuggestion[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listAiSuggestions(threadId, user);
  }

  @Post('threads/:threadId/ai-suggest')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  generateAiSuggestion(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): AiReplySuggestion {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.generateAiSuggestion(threadId, user);
  }

  @Get('threads/:threadId/ai-mode')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  getAiMode(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): ThreadAiConfig {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.getAiMode(threadId, user);
  }

  @Patch('threads/:threadId/ai-mode')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  setAiMode(
    @Param('threadId') threadId: string,
    @Body() dto: SetAiModeDto,
    @CurrentUser() user?: RequestUser
  ): ThreadAiConfig {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.setAiMode(threadId, dto.mode, user);
  }

  @Patch('threads/:threadId/close')
  @Roles(Role.SUPER_ADMIN, Role.SUPPORT, Role.STATION_ADMIN, Role.MANAGER)
  closeThread(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): ChatThread {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.closeThread(threadId, user);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
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

interface ListMessagesQueryOptions {
  limit?: number;
  before?: string;
  includeService?: boolean;
}

interface DialogUpdatesResponse {
  serverTime: string;
  updatedSince?: string;
  pollIntervalMs: number;
  hasMore: boolean;
  dialogs: StationDialogSummary[];
}

interface MessageUpdatesResponse {
  serverTime: string;
  threadId: string;
  updatedSince?: string;
  pollIntervalMs: number;
  hasMore: boolean;
  messages: ChatMessage[];
}

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

  @Get('dialogs/updates')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  async listDialogUpdates(
    @CurrentUser() user?: RequestUser,
    @Query() query: ListThreadsDto = {},
    @Query('updatedSince') updatedSince?: string
  ): Promise<DialogUpdatesResponse> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }

    const limit = this.resolvePollingLimit(query.limit, 30, 200);
    const sourceLimit = this.resolvePollingLimit(limit * 3, 120, 500);
    const sourceDialogs = await this.listCompatibleDialogs(user, {
      ...query,
      limit: sourceLimit,
      offset: 0
    });
    const updatedSinceTs = this.parseUpdatedSince(updatedSince);
    const changed = updatedSinceTs > 0
      ? sourceDialogs.filter(
          (dialog) => this.resolveDialogUpdateTimestamp(dialog) > updatedSinceTs
        )
      : sourceDialogs;
    const dialogs = changed.slice(0, limit);

    return {
      serverTime: new Date().toISOString(),
      updatedSince: updatedSince,
      pollIntervalMs: 1000,
      hasMore: changed.length > dialogs.length,
      dialogs
    };
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
    @Query('dialogId') dialogId: string | undefined,
    @Query('phone') phone: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<VivaClientCabinetLookup | null> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    const normalizedDialogId = String(dialogId ?? '').trim();
    if (normalizedDialogId) {
      try {
        return await this.resolveSupportDialogVivaCabinet(normalizedDialogId, user, phone);
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error;
        }
      }
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
  async getThread(
    @Param('threadId') threadId: string,
    @CurrentUser() user?: RequestUser
  ): Promise<ChatThread> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.getCompatibleThread(threadId, user);
  }

  @Get('dialogs/:dialogId')
  async getDialog(
    @Param('dialogId') dialogId: string,
    @CurrentUser() user?: RequestUser
  ): Promise<ChatThread> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.getCompatibleThread(dialogId, user);
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
  async listMessages(
    @Param('threadId') threadId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number | undefined,
    @Query('before') before: string | undefined,
    @Query('includeService') includeService: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<ChatMessage[]> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.listCompatibleMessages(threadId, user, {
      limit,
      before,
      includeService: this.parseOptionalBoolean(includeService)
    });
  }

  @Get('dialogs/:dialogId/messages')
  async listDialogMessages(
    @Param('dialogId') dialogId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number | undefined,
    @Query('before') before: string | undefined,
    @Query('includeService') includeService: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<ChatMessage[]> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.listCompatibleMessages(dialogId, user, {
      limit,
      before,
      includeService: this.parseOptionalBoolean(includeService)
    });
  }

  @Get('threads/:threadId/messages/updates')
  async listThreadMessageUpdates(
    @Param('threadId') threadId: string,
    @Query('updatedSince') updatedSince: string | undefined,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number | undefined,
    @Query('includeService') includeService: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<MessageUpdatesResponse> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.listCompatibleMessageUpdates(threadId, user, {
      limit,
      includeService: this.parseOptionalBoolean(includeService)
    }, updatedSince);
  }

  @Get('dialogs/:dialogId/messages/updates')
  async listDialogMessageUpdates(
    @Param('dialogId') dialogId: string,
    @Query('updatedSince') updatedSince: string | undefined,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number | undefined,
    @Query('includeService') includeService: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<MessageUpdatesResponse> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.listCompatibleMessageUpdates(dialogId, user, {
      limit,
      includeService: this.parseOptionalBoolean(includeService)
    }, updatedSince);
  }

  @Get('threads/:threadId/service-messages')
  async listThreadServiceMessages(
    @Param('threadId') threadId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number | undefined,
    @Query('before') before: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<ChatMessage[]> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.listCompatibleServiceMessages(threadId, user, { limit, before });
  }

  @Get('dialogs/:dialogId/service-messages')
  async listDialogServiceMessages(
    @Param('dialogId') dialogId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number | undefined,
    @Query('before') before: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<ChatMessage[]> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.listCompatibleServiceMessages(dialogId, user, { limit, before });
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
    return this.sendCompatibleMessage(threadId, dto, user);
  }

  @Post('dialogs/:dialogId/messages')
  sendDialogMessage(
    @Param('dialogId') dialogId: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser() user?: RequestUser
  ): ChatMessage {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.sendCompatibleMessage(dialogId, dto, user);
  }

  @Patch('threads/:threadId/resolution')
  @Roles(Role.SUPER_ADMIN, Role.SUPPORT, Role.STATION_ADMIN, Role.MANAGER)
  setThreadResolution(
    @Param('threadId') threadId: string,
    @Body() body: { resolved?: boolean } = {},
    @CurrentUser() user?: RequestUser
  ): StationDialogSummary {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    if (typeof body.resolved !== 'boolean') {
      throw new BadRequestException('resolved must be boolean');
    }
    return this.setCompatibleDialogResolution(threadId, body.resolved, user);
  }

  @Patch('dialogs/:dialogId/resolution')
  @Roles(Role.SUPER_ADMIN, Role.SUPPORT, Role.STATION_ADMIN, Role.MANAGER)
  setDialogResolution(
    @Param('dialogId') dialogId: string,
    @Body() body: { resolved?: boolean } = {},
    @CurrentUser() user?: RequestUser
  ): StationDialogSummary {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    if (typeof body.resolved !== 'boolean') {
      throw new BadRequestException('resolved must be boolean');
    }
    return this.setCompatibleDialogResolution(dialogId, body.resolved, user);
  }

  private async getCompatibleThread(threadId: string, user: RequestUser): Promise<ChatThread> {
    try {
      return this.messengerService.getThreadById(threadId, user);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      return this.getSupportThread(threadId, user);
    }
  }

  private setCompatibleDialogResolution(
    dialogId: string,
    resolved: boolean,
    user: RequestUser
  ): StationDialogSummary {
    const summary = this.supportService.setDialogResolution(dialogId, resolved, user);
    return this.mapSupportDialogToLegacy(summary);
  }

  private async listCompatibleMessages(
    threadId: string,
    user: RequestUser,
    options: ListMessagesQueryOptions = {}
  ): Promise<ChatMessage[]> {
    try {
      return this.messengerService.listMessages(threadId, user, options);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      const supportMessages = await this.supportService.listMessages(threadId, user, options);
      return supportMessages
        .map((message) => this.mapSupportMessageToLegacy(message));
    }
  }

  private async listCompatibleServiceMessages(
    threadId: string,
    user: RequestUser,
    options: ListMessagesQueryOptions = {}
  ): Promise<ChatMessage[]> {
    try {
      return this.messengerService
        .listMessages(threadId, user, {
          limit: options.limit,
          before: options.before,
          includeService: true
        })
        .filter((message) => {
          const senderRoleRaw = String(message.senderRoleRaw ?? '').trim().toUpperCase();
          const direction = String(message.direction ?? '').trim().toUpperCase();
          return senderRoleRaw === 'SYSTEM' || direction === 'SYSTEM';
        });
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      const supportMessages = await this.supportService.listServiceMessages(threadId, user, options);
      return supportMessages.map((message) => this.mapSupportMessageToLegacy(message));
    }
  }

  private async listCompatibleMessageUpdates(
    threadId: string,
    user: RequestUser,
    options: ListMessagesQueryOptions,
    updatedSince?: string
  ): Promise<MessageUpdatesResponse> {
    const limit = this.resolvePollingLimit(options.limit, 60, 400);
    const sourceLimit = this.resolvePollingLimit(limit * 4, 200, 1000);
    const source = await this.listCompatibleMessages(threadId, user, {
      limit: sourceLimit,
      includeService: options.includeService
    });
    const updatedSinceTs = this.parseUpdatedSince(updatedSince);
    const changed = updatedSinceTs > 0
      ? source.filter((message) => Date.parse(message.createdAt || '') > updatedSinceTs)
      : source;
    const messages = changed.length <= limit ? changed : changed.slice(changed.length - limit);

    return {
      serverTime: new Date().toISOString(),
      threadId,
      updatedSince,
      pollIntervalMs: 1000,
      hasMore: changed.length > messages.length,
      messages
    };
  }

  private sendCompatibleMessage(
    threadId: string,
    dto: CreateMessageDto,
    user: RequestUser
  ): ChatMessage {
    try {
      return this.messengerService.sendMessage(threadId, dto, user);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      const result = this.supportService.replyToDialog(
        threadId,
        {
          text: dto.text,
          attachments: dto.attachments
        },
        user
      );
      return this.mapSupportMessageToLegacy(result.message);
    }
  }

  private async listCompatibleDialogs(
    user: RequestUser,
    query: ListThreadsDto = {}
  ): Promise<StationDialogSummary[]> {
    const normalizedPhone = this.normalizePhoneQuery(query.phone);
    const hasPhoneSearch = normalizedPhone.length >= 10;
    const legacySource = this.messengerService.listDialogs(user, query);
    const legacy = this.sortDialogsByRank(
      hasPhoneSearch
        ? legacySource.filter((dialog) => this.dialogMatchesPhone(dialog, normalizedPhone))
        : legacySource
    );
    const supportConnectorFilter = this.mapLegacyConnectorToSupportFilter(query.connector);
    let supportDialogs = hasPhoneSearch
      ? await this.supportService.listDialogsByPhone(normalizedPhone, user, {
          connector: supportConnectorFilter,
          stationId: query.stationId
        })
      : this.supportService.listDialogs(user, {
          connector: supportConnectorFilter,
          stationId: query.stationId
        });

    if (supportDialogs.length === 0) {
      await this.supportService.hydrateFromPersistence();
      supportDialogs = hasPhoneSearch
        ? await this.supportService.listDialogsByPhone(normalizedPhone, user, {
            connector: supportConnectorFilter,
            stationId: query.stationId
          })
        : this.supportService.listDialogs(user, {
            connector: supportConnectorFilter,
            stationId: query.stationId
          });
    }
    const mappedSupport = this.sortDialogsByRank(
      supportDialogs.map((dialog) => this.mapSupportDialogToLegacy(dialog))
    );
    const visibleLegacy = legacy.filter((dialog) => this.shouldIncludeDialogInList(dialog));
    const visibleSupport = mappedSupport.filter((dialog) =>
      this.shouldIncludeDialogInList(dialog)
    );

    const paging = this.resolveDialogsPaging(query);
    const mergedTop = this.mergeDialogsByRank(
      visibleLegacy,
      visibleSupport,
      paging.offset + paging.limit
    );
    const page = mergedTop.slice(paging.offset, paging.offset + paging.limit);

    return this.attachVivaCabinetUrls(page);
  }

  private normalizePhoneQuery(rawPhone?: string): string {
    const digits = String(rawPhone ?? '').replace(/\D+/g, '');
    if (!digits) {
      return '';
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `7${digits.slice(1)}`;
    }
    if (digits.length === 10) {
      return `7${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('7')) {
      return digits;
    }
    return digits;
  }

  private dialogMatchesPhone(dialog: StationDialogSummary, normalizedPhone: string): boolean {
    if (!normalizedPhone) {
      return true;
    }

    const candidates = Array.from(
      new Set(
        [dialog.primaryPhone, ...(Array.isArray(dialog.phones) ? dialog.phones : [])]
          .map((phone) => this.normalizePhoneQuery(phone))
          .filter((phone) => phone.length > 0)
      )
    );

    if (candidates.includes(normalizedPhone)) {
      return true;
    }

    if (normalizedPhone.length >= 10) {
      return candidates.some((phone) => phone.endsWith(normalizedPhone.slice(-10)));
    }

    return false;
  }

  private parseOptionalBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
    return undefined;
  }

  private parseUpdatedSince(value?: string): number {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return 0;
    }
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private resolvePollingLimit(
    rawLimit: number | undefined,
    fallback: number,
    maxLimit: number
  ): number {
    if (!Number.isFinite(rawLimit) || Number(rawLimit) <= 0) {
      return fallback;
    }
    return Math.min(Math.floor(Number(rawLimit)), maxLimit);
  }

  private resolveDialogUpdateTimestamp(dialog: StationDialogSummary): number {
    const rankingTs = Date.parse(dialog.lastRankingMessageAt || '');
    const lastMessageTs = Date.parse(dialog.lastMessageAt || '');
    const normalizedRankingTs = Number.isFinite(rankingTs) ? rankingTs : 0;
    const normalizedLastMessageTs = Number.isFinite(lastMessageTs) ? lastMessageTs : 0;
    return Math.max(normalizedRankingTs, normalizedLastMessageTs);
  }

  private async getSupportThread(threadId: string, user: RequestUser): Promise<ChatThread> {
    const dialog = this.supportService.getDialogSummary(threadId, user);
    await this.resolveSupportDialogVivaCabinet(
      dialog.dialogId,
      user,
      this.findFirstDialogPhone(dialog)
    );
    const refreshed = this.supportService.getDialogSummary(threadId, user);
    return this.mapSupportDialogToThread(refreshed);
  }

  private async resolveSupportDialogVivaCabinet(
    dialogId: string,
    user: RequestUser,
    fallbackPhone?: string
  ): Promise<VivaClientCabinetLookup | null> {
    const dialog = this.supportService.getDialogSummary(dialogId, user);
    const fromSettings = this.buildLookupFromDialogSettings(dialog, fallbackPhone);
    if (fromSettings) {
      return fromSettings;
    }

    const phone = this.findFirstDialogPhone(dialog) ?? String(fallbackPhone ?? '').trim();
    if (!phone) {
      return null;
    }

    const lookup = await this.vivaAdminService.lookupClientCabinetByPhone(phone);
    if (lookup?.status === 'FOUND' && String(lookup.vivaCabinetUrl ?? '').trim()) {
      this.supportService.cacheDialogVivaCabinetLookup(dialogId, user, lookup);
    }
    return lookup;
  }

  private buildLookupFromDialogSettings(
    dialog: SupportDialogSummary,
    fallbackPhone?: string
  ): VivaClientCabinetLookup | null {
    const settings = dialog.settings;
    const vivaCabinetUrl = String(
      settings?.vivaCabinetUrl ?? dialog.vivaCabinetUrl ?? ''
    ).trim();
    if (!vivaCabinetUrl) {
      return null;
    }

    const phone = this.findFirstDialogPhone(dialog) ?? String(fallbackPhone ?? '').trim();
    const vivaClientId = String(settings?.vivaClientId ?? dialog.vivaClientId ?? '').trim();
    return {
      phone,
      status: 'FOUND',
      vivaClientId: vivaClientId || undefined,
      vivaCabinetUrl
    };
  }

  private findFirstDialogPhone(dialog: SupportDialogSummary): string | undefined {
    const primary = String(dialog.primaryPhone ?? '').trim();
    if (primary) {
      return primary;
    }

    if (Array.isArray(dialog.phones)) {
      for (const phone of dialog.phones) {
        const normalized = String(phone ?? '').trim();
        if (normalized) {
          return normalized;
        }
      }
    }

    return undefined;
  }

  private mapSupportDialogToLegacy(dialog: SupportDialogSummary): StationDialogSummary {
    const vivaSettings = dialog.settings;
    const vivaStatus = vivaSettings?.vivaStatus ?? dialog.vivaStatus;
    const vivaClientId = vivaSettings?.vivaClientId ?? dialog.vivaClientId;
    const vivaCabinetUrl = vivaSettings?.vivaCabinetUrl ?? dialog.vivaCabinetUrl;

    return {
      threadId: dialog.dialogId,
      connector: this.mapSupportConnector(dialog.connector),
      stationId: dialog.stationId,
      stationName: dialog.stationName,
      accessStationIds: [...dialog.accessStationIds],
      writeStationIds: [...dialog.writeStationIds],
      readOnlyStationIds: [...dialog.readOnlyStationIds],
      isActiveForUser: dialog.isActiveForUser,
      isReadOnlyForUser: dialog.isReadOnlyForUser,
      isResolved: dialog.isResolved,
      resolvedAt: dialog.resolvedAt,
      resolvedByUserId: dialog.resolvedByUserId,
      currentStationId: dialog.currentStationId,
      currentStationName: dialog.currentStationName,
      clientId: dialog.clientId,
      clientDisplayName: dialog.clientDisplayName,
      settings: vivaSettings || vivaStatus || vivaClientId || vivaCabinetUrl
        ? {
            vivaStatus,
            vivaClientId,
            vivaCabinetUrl
          }
        : undefined,
      vivaStatus,
      vivaClientId,
      vivaCabinetUrl,
      primaryPhone: dialog.primaryPhone,
      phones: [...dialog.phones],
      subject: dialog.subject,
      status:
        dialog.status === SupportDialogStatus.CLOSED ? ThreadStatus.CLOSED : ThreadStatus.OPEN,
      lastMessageAt: dialog.lastMessageAt,
      lastRankingMessageAt: dialog.lastRankingMessageAt,
      unreadMessagesCount: dialog.unreadCount,
      hasUnreadMessages: dialog.hasUnreadMessages,
      hasNewMessages: dialog.hasNewMessages,
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

  private compareCompatibleDialogRank(
    left: StationDialogSummary,
    right: StationDialogSummary
  ): number {
    const leftUnread = Number(left.unreadMessagesCount ?? 0);
    const rightUnread = Number(right.unreadMessagesCount ?? 0);
    if (leftUnread !== rightUnread) {
      return rightUnread - leftUnread;
    }

    const leftPending = Number(left.pendingClientMessagesCount ?? 0);
    const rightPending = Number(right.pendingClientMessagesCount ?? 0);
    if (leftPending !== rightPending) {
      return rightPending - leftPending;
    }

    const leftRankTs = this.resolveDialogRankTimestamp(left);
    const rightRankTs = this.resolveDialogRankTimestamp(right);
    if (leftRankTs !== rightRankTs) {
      return rightRankTs - leftRankTs;
    }

    const leftTs = Date.parse(left.lastMessageAt || '') || 0;
    const rightTs = Date.parse(right.lastMessageAt || '') || 0;
    if (leftTs !== rightTs) {
      return rightTs - leftTs;
    }

    return left.threadId.localeCompare(right.threadId);
  }

  private resolveDialogRankTimestamp(dialog: StationDialogSummary): number {
    const explicitRankingTs = Date.parse(dialog.lastRankingMessageAt || '') || 0;
    if (explicitRankingTs > 0) {
      return explicitRankingTs;
    }

    const senderRoleRaw = String(
      dialog.lastMessageSenderRoleRaw ?? dialog.lastMessageSenderRole ?? ''
    )
      .trim()
      .toUpperCase();

    if (senderRoleRaw === 'SYSTEM') {
      return 0;
    }

    return Date.parse(dialog.lastMessageAt || '') || 0;
  }

  private shouldIncludeDialogInList(dialog: StationDialogSummary): boolean {
    return this.resolveDialogRankTimestamp(dialog) > 0;
  }

  private sortDialogsByRank(dialogs: StationDialogSummary[]): StationDialogSummary[] {
    return [...dialogs].sort((left, right) => this.compareCompatibleDialogRank(left, right));
  }

  private mergeDialogsByRank(
    legacy: StationDialogSummary[],
    mappedSupport: StationDialogSummary[],
    targetCount: number
  ): StationDialogSummary[] {
    const result: StationDialogSummary[] = [];
    const seenThreadIds = new Set<string>();
    let legacyIndex = 0;
    let supportIndex = 0;

    while (
      result.length < targetCount &&
      (legacyIndex < legacy.length || supportIndex < mappedSupport.length)
    ) {
      let candidate: StationDialogSummary | undefined;

      if (legacyIndex >= legacy.length) {
        candidate = mappedSupport[supportIndex];
        supportIndex += 1;
      } else if (supportIndex >= mappedSupport.length) {
        candidate = legacy[legacyIndex];
        legacyIndex += 1;
      } else {
        const legacyDialog = legacy[legacyIndex];
        const supportDialog = mappedSupport[supportIndex];
        if (this.compareCompatibleDialogRank(legacyDialog, supportDialog) <= 0) {
          candidate = legacyDialog;
          legacyIndex += 1;
        } else {
          candidate = supportDialog;
          supportIndex += 1;
        }
      }

      if (!candidate || seenThreadIds.has(candidate.threadId)) {
        continue;
      }

      seenThreadIds.add(candidate.threadId);
      result.push(candidate);
    }

    return result;
  }

  private resolveDialogsPaging(query: ListThreadsDto): { limit: number; offset: number } {
    const fallbackLimit = 30;
    const maxLimit = 200;
    const limit =
      Number.isFinite(query.limit) && Number(query.limit) > 0
        ? Math.min(Math.floor(Number(query.limit)), maxLimit)
        : fallbackLimit;
    const offset =
      Number.isFinite(query.offset) && Number(query.offset) > 0
        ? Math.floor(Number(query.offset))
        : 0;

    return { limit, offset };
  }

  private mapLegacyConnectorToSupportFilter(
    connector?: ConnectorRoute
  ): SupportConnectorRoute | undefined {
    if (!connector) {
      return undefined;
    }

    switch (connector) {
      case ConnectorRoute.TG_BOT:
        return SupportConnectorRoute.TG_BOT;
      case ConnectorRoute.LK_WEB_MESSENGER:
        return SupportConnectorRoute.LK_WEB_MESSENGER;
      case ConnectorRoute.LK_ACADEMY_WEB_MESSENGER:
        return SupportConnectorRoute.LK_ACADEMY_WEB_MESSENGER;
      case ConnectorRoute.PROMO_WEB_MESSENGER:
        return SupportConnectorRoute.PROMO_WEB_MESSENGER;
      case ConnectorRoute.MAX_ACADEMY_BOT:
        return SupportConnectorRoute.MAX_ACADEMY_BOT;
      default:
        return undefined;
    }
  }

  private mapSupportDialogToThread(dialog: SupportDialogSummary): ChatThread {
    const timestamp = dialog.lastMessageAt || new Date().toISOString();
    const vivaSettings = dialog.settings;
    const vivaStatus = vivaSettings?.vivaStatus ?? dialog.vivaStatus;
    const vivaClientId = vivaSettings?.vivaClientId ?? dialog.vivaClientId;
    const vivaCabinetUrl = vivaSettings?.vivaCabinetUrl ?? dialog.vivaCabinetUrl;

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
      settings:
        vivaSettings || vivaStatus || vivaClientId || vivaCabinetUrl
          ? {
              vivaStatus,
              vivaClientId,
              vivaCabinetUrl
            }
          : undefined,
      vivaStatus,
      vivaClientId,
      vivaCabinetUrl,
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
      attachments: Array.isArray(message.attachments)
        ? message.attachments.map((attachment) => ({ ...attachment }))
        : undefined,
      createdAt: message.createdAt
    };
  }

  private mapSupportConnector(connector: SupportConnectorRoute): ConnectorRoute {
    switch (connector) {
      case SupportConnectorRoute.TG_BOT:
        return ConnectorRoute.TG_BOT;
      case SupportConnectorRoute.LK_WEB_MESSENGER:
        return ConnectorRoute.LK_WEB_MESSENGER;
      case SupportConnectorRoute.LK_ACADEMY_WEB_MESSENGER:
        return ConnectorRoute.LK_ACADEMY_WEB_MESSENGER;
      case SupportConnectorRoute.PROMO_WEB_MESSENGER:
        return ConnectorRoute.PROMO_WEB_MESSENGER;
      case SupportConnectorRoute.MAX_ACADEMY_BOT:
        return ConnectorRoute.MAX_ACADEMY_BOT;
      case SupportConnectorRoute.MAX_BOT:
      case SupportConnectorRoute.EMAIL:
      case SupportConnectorRoute.PHONE_CALL:
      case SupportConnectorRoute.BITRIX:
      default:
        return ConnectorRoute.MAX_BOT;
    }
  }

  private mapSupportSenderRole(role?: SupportMessage['senderRole']): Role | undefined {
    if (role === Role.CLIENT) {
      return Role.CLIENT;
    }
    return Role.SUPPORT;
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

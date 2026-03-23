import {
  Body,
  Controller,
  Get,
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
import {
  AiReplySuggestion,
  ChatMessage,
  ChatThread,
  ConnectorRoute,
  ConnectorSummary,
  DialogAiInsight,
  MessengerAccessRule,
  MessengerConnectorConfig,
  MessengerSettingsSnapshot,
  MessengerStationConfig,
  StaffResponseMetric,
  StationDialogSummary,
  StationSummary,
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
  constructor(private readonly messengerService: MessengerService) {}

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
  ): StationDialogSummary[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.listDialogs(user, query);
  }

  @Get('settings')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.STATION_ADMIN, Role.SUPPORT)
  getSettings(@CurrentUser() user?: RequestUser): MessengerSettingsSnapshot {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.messengerService.getSettings(user);
  }

  @Get('settings/stations')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.STATION_ADMIN, Role.SUPPORT)
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
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.STATION_ADMIN, Role.SUPPORT)
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
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.STATION_ADMIN, Role.SUPPORT)
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
    return this.messengerService.getThreadById(threadId, user);
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
    return this.messengerService.listMessages(threadId, user);
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
    return this.messengerService.sendMessage(threadId, dto, user);
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

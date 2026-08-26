import { Controller, Get, Post, Put, Patch, Body, Param, Delete, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { OngoingService } from './ongoing.service';
import { CreateOngoingEventDto } from './dto/create-ongoing-event.dto';
import { UpdateOngoingConfigDto } from './dto/update-ongoing-config.dto';
import { SetOngoingTeamsDto } from './dto/set-ongoing-teams.dto';
import { AddOngoingTeamDto } from './dto/add-ongoing-team.dto';
import { UpdateOngoingGameScoreDto } from './dto/update-ongoing-game-score.dto';
import {
  OngoingEventListItemDto,
  OngoingEventResponseDto,
  OngoingGameResponseDto,
  OngoingOpenEventDto,
} from './dto/ongoing-event-response.dto';
import { JwtAuthGuard } from '../auth-guards';
import type { AuthedRequest } from '../auth-guards';

@Controller('ongoing')
export class OngoingController {
  constructor(private readonly ongoingService: OngoingService) {}

  @Get()
  async findAll(): Promise<OngoingEventListItemDto[]> {
    return this.ongoingService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async create(
    @Body() createOngoingEventDto: CreateOngoingEventDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.create(createOngoingEventDto, req.user);
  }

  @Put(':id/config')
  @UseGuards(JwtAuthGuard)
  async updateConfig(
    @Param('id') id: string,
    @Body() updateOngoingConfigDto: UpdateOngoingConfigDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.updateConfig(id, updateOngoingConfigDto, req.user);
  }

  @Put(':id/teams')
  @UseGuards(JwtAuthGuard)
  async setTeams(
    @Param('id') id: string,
    @Body() setOngoingTeamsDto: SetOngoingTeamsDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.setTeams(id, setOngoingTeamsDto, req.user);
  }

  @Post(':id/schedule')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async generateSchedule(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.generateSchedule(id, req.user);
  }

  @Patch('games/:gameId')
  @UseGuards(JwtAuthGuard)
  async updateGameScore(
    @Param('gameId') gameId: string,
    @Body() updateOngoingGameScoreDto: UpdateOngoingGameScoreDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingGameResponseDto> {
    return this.ongoingService.updateGameScore(gameId, updateOngoingGameScoreDto, req.user);
  }

  @Delete('games/:gameId/result')
  @UseGuards(JwtAuthGuard)
  async clearGameResult(@Param('gameId') gameId: string, @Req() req: AuthedRequest): Promise<OngoingGameResponseDto> {
    return this.ongoingService.clearGameResult(gameId, req.user);
  }

  @Post(':id/teams')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async addTeam(
    @Param('id') id: string,
    @Body() addOngoingTeamDto: AddOngoingTeamDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.addTeam(id, addOngoingTeamDto, req.user);
  }

  @Delete('teams/:teamId')
  @UseGuards(JwtAuthGuard)
  async removeTeam(@Param('teamId') teamId: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.removeTeam(teamId, req.user);
  }

  @Get('open')
  async findOpen(): Promise<OngoingOpenEventDto[]> {
    return this.ongoingService.findOpen();
  }

  @Post(':id/playoff')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async generatePlayoff(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.generatePlayoff(id, req.user);
  }

  @Delete(':id/playoff')
  @UseGuards(JwtAuthGuard)
  async deletePlayoff(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.deletePlayoff(id, req.user);
  }

  @Patch(':id/finish')
  @UseGuards(JwtAuthGuard)
  async finishTournament(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.finishTournament(id, req.user);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req: AuthedRequest): Promise<void> {
    return this.ongoingService.remove(id, req.user);
  }
}

import { Controller, Get, Post, Put, Patch, Body, Param, Delete, HttpCode, HttpStatus } from '@nestjs/common';
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

@Controller('ongoing')
export class OngoingController {
  constructor(private readonly ongoingService: OngoingService) {}

  @Get()
  async findAll(): Promise<OngoingEventListItemDto[]> {
    return this.ongoingService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createOngoingEventDto: CreateOngoingEventDto): Promise<OngoingEventResponseDto> {
    return this.ongoingService.create(createOngoingEventDto);
  }

  @Put(':id/config')
  async updateConfig(
    @Param('id') id: string,
    @Body() updateOngoingConfigDto: UpdateOngoingConfigDto,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.updateConfig(id, updateOngoingConfigDto);
  }

  @Put(':id/teams')
  async setTeams(
    @Param('id') id: string,
    @Body() setOngoingTeamsDto: SetOngoingTeamsDto,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.setTeams(id, setOngoingTeamsDto);
  }

  @Post(':id/schedule')
  @HttpCode(HttpStatus.OK)
  async generateSchedule(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.generateSchedule(id);
  }

  @Patch('games/:gameId')
  async updateGameScore(
    @Param('gameId') gameId: string,
    @Body() updateOngoingGameScoreDto: UpdateOngoingGameScoreDto,
  ): Promise<OngoingGameResponseDto> {
    return this.ongoingService.updateGameScore(gameId, updateOngoingGameScoreDto);
  }

  @Delete('games/:gameId/result')
  async clearGameResult(@Param('gameId') gameId: string): Promise<OngoingGameResponseDto> {
    return this.ongoingService.clearGameResult(gameId);
  }

  @Post(':id/teams')
  @HttpCode(HttpStatus.CREATED)
  async addTeam(
    @Param('id') id: string,
    @Body() addOngoingTeamDto: AddOngoingTeamDto,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.addTeam(id, addOngoingTeamDto);
  }

  @Delete('teams/:teamId')
  async removeTeam(@Param('teamId') teamId: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.removeTeam(teamId);
  }

  @Get('open')
  async findOpen(): Promise<OngoingOpenEventDto[]> {
    return this.ongoingService.findOpen();
  }

  @Post(':id/playoff')
  @HttpCode(HttpStatus.OK)
  async generatePlayoff(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.generatePlayoff(id);
  }

  @Delete(':id/playoff')
  async deletePlayoff(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.deletePlayoff(id);
  }

  @Patch(':id/finish')
  async finishTournament(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.finishTournament(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.ongoingService.remove(id);
  }
}

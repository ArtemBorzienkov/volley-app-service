import { Controller, Get, Query } from '@nestjs/common';
import { RankingsService } from './rankings.service';
import { RankingFiltersDto } from '../common/dto/ranking-filters.dto';
import { RankingResponseDto } from './dto/ranking-response.dto';
import { GroupedRankingResponseDto } from './dto/grouped-ranking-response.dto';
import { TeamCombinationResponseDto } from './dto/team-combination-response.dto';

@Controller('rankings')
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get('wins')
  async getTopByWins(
    @Query() filters: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    return this.rankingsService.getTopPlayersByWins(
      filters.limit || 10,
      filters,
    );
  }

  @Get('sets')
  async getTopBySets(
    @Query() filters: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    return this.rankingsService.getTopPlayersBySetsWon(
      filters.limit || 10,
      filters,
    );
  }

  @Get('tournaments')
  async getTopByTournaments(
    @Query() filters: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    return this.rankingsService.getTopPlayersByTournamentsWon(
      filters.limit || 10,
      filters,
    );
  }

  @Get('lowest-losses')
  async getTopByLowestLosses(
    @Query() filters: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    return this.rankingsService.getTopPlayersByLowestLosses(
      filters.limit || 10,
      filters,
    );
  }

  @Get('points-difference')
  async getTopByPointsDifference(
    @Query() filters: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    return this.rankingsService.getTopPlayersByPointsDifference(
      filters.limit || 10,
      filters,
    );
  }

  @Get('won-events')
  async getTopByWonEvents(
    @Query() filters: RankingFiltersDto,
  ): Promise<GroupedRankingResponseDto> {
    const limit = filters.limit ? Number(filters.limit) : 10;
    return this.rankingsService.getTopPlayersByWonEventsGrouped(
      limit,
      filters,
    );
  }

  @Get('win-rate')
  async getTopByWinRate(
    @Query() filters: RankingFiltersDto,
  ): Promise<GroupedRankingResponseDto> {
    const limit = filters.limit ? Number(filters.limit) : 10;
    return this.rankingsService.getTopPlayersByWinRateGrouped(
      limit,
      filters,
    );
  }

  @Get('games-played')
  async getTopByGamesPlayed(
    @Query() filters: RankingFiltersDto,
  ): Promise<GroupedRankingResponseDto> {
    const limit = filters.limit ? Number(filters.limit) : 10;
    return this.rankingsService.getTopPlayersByGamesPlayedGrouped(
      limit,
      filters,
    );
  }

  @Get('best-team-combinations')
  async getBestTeamCombinations(
    @Query('limit') limit?: string,
  ): Promise<TeamCombinationResponseDto[]> {
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    return this.rankingsService.getBestTeamCombinations(limitNumber);
  }
}

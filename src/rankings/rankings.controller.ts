import { Controller, Get, Query } from '@nestjs/common';
import { RankingsService } from './rankings.service';
import { RankingFiltersDto } from '../common/dto/ranking-filters.dto';
import { RankingResponseDto } from './dto/ranking-response.dto';

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

  @Get('win-rate')
  async getTopByWinRate(
    @Query() filters: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    return this.rankingsService.getTopPlayersByWinRate(
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
}

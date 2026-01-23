import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlayerStatisticsService } from '../statistics/player-statistics.service';
import { RankingFiltersDto } from '../common/dto/ranking-filters.dto';
import { RankingResponseDto } from './dto/ranking-response.dto';
import { PlayerResponseDto } from '../players/dto/player-response.dto';

@Injectable()
export class RankingsService {
  constructor(
    private prisma: PrismaService,
    private playerStatisticsService: PlayerStatisticsService,
  ) {}

  private mapPlayerToResponseDto(player: any): PlayerResponseDto {
    return {
      id: player.id,
      tgId: player.tgId,
      name: player.name,
      avatar: player.avatar,
      gender: player.gender,
      active: player.active,
      totalGames: player.totalGames,
      totalWins: player.totalWins,
      totalLosses: player.totalLosses,
      createdAt: player.createdAt,
      updatedAt: player.updatedAt,
    };
  }

  private buildGameWhereClause(filters?: RankingFiltersDto) {
    const where: any = {};

    if (filters?.eventId) {
      where.eventId = filters.eventId;
    }

    if (filters?.startDate || filters?.endDate) {
      where.date = {};
      if (filters.startDate) {
        where.date.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.date.lte = new Date(filters.endDate);
      }
    }

    return where;
  }

  async getTopPlayersByWins(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
      orderBy: {
        totalWins: 'desc',
      },
      take: limit,
    });

    return players.map((player, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(player),
      value: player.totalWins,
      metric: 'wins',
    }));
  }

  async getTopPlayersByWinRate(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    const dateRange = filters
      ? {
          start: filters.startDate ? new Date(filters.startDate) : undefined,
          end: filters.endDate ? new Date(filters.endDate) : undefined,
        }
      : undefined;

    // Get all active players
    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
    });

    // Calculate win rate for each player with filters
    const playerStats = await Promise.all(
      players.map(async (player) => {
        const stats = await this.playerStatisticsService.getPlayerStats(
          player.id,
          dateRange,
        );
        return {
          player,
          winRate: stats.winRate,
          totalGames: stats.totalGames,
        };
      }),
    );

    // Filter by eventId if specified
    let filteredStats = playerStats;
    if (filters?.eventId) {
      const eventMemberIds = await this.prisma.eventMember.findMany({
        where: { eventId: filters.eventId },
        select: { userId: true },
      });
      const eventPlayerIds = new Set(
        eventMemberIds.map((em) => em.userId),
      );
      filteredStats = playerStats.filter((ps) =>
        eventPlayerIds.has(ps.player.id),
      );
    }

    // Filter players with at least 1 game and sort by win rate
    const sortedStats = filteredStats
      .filter((ps) => ps.totalGames > 0)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, limit);

    return sortedStats.map((stat, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.winRate,
      metric: 'winRate',
    }));
  }

  async getTopPlayersBySetsWon(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    const dateRange = filters
      ? {
          start: filters.startDate ? new Date(filters.startDate) : undefined,
          end: filters.endDate ? new Date(filters.endDate) : undefined,
        }
      : undefined;

    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
    });

    const playerStats = await Promise.all(
      players.map(async (player) => {
        const stats = await this.playerStatisticsService.getPlayerStats(
          player.id,
          dateRange,
        );
        return {
          player,
          setsWon: stats.setsWon,
        };
      }),
    );

    // Filter by eventId if specified
    let filteredStats = playerStats;
    if (filters?.eventId) {
      const eventMemberIds = await this.prisma.eventMember.findMany({
        where: { eventId: filters.eventId },
        select: { userId: true },
      });
      const eventPlayerIds = new Set(
        eventMemberIds.map((em) => em.userId),
      );
      filteredStats = playerStats.filter((ps) =>
        eventPlayerIds.has(ps.player.id),
      );
    }

    const sortedStats = filteredStats
      .sort((a, b) => b.setsWon - a.setsWon)
      .slice(0, limit);

    return sortedStats.map((stat, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.setsWon,
      metric: 'setsWon',
    }));
  }

  async getTopPlayersByTournamentsWon(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    // Get all events (filtered by date if specified)
    const eventWhere: any = {};
    if (filters?.startDate || filters?.endDate) {
      eventWhere.date = {};
      if (filters.startDate) {
        eventWhere.date.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        eventWhere.date.lte = new Date(filters.endDate);
      }
    }
    if (filters?.eventId) {
      eventWhere.id = filters.eventId;
    }

    const events = await this.prisma.event.findMany({
      where: eventWhere,
      include: {
        games: true,
      },
    });

    // Count tournaments won per player
    const tournamentWins = new Map<string, number>();

    for (const event of events) {
      if (event.games.length === 0) continue;

      // Find winner of tournament (player with most wins in this event)
      const playerWinsInEvent = new Map<string, number>();

      for (const game of event.games) {
        const team1Won = game.team1Sets > game.team2Sets;
        const team1Players = [game.team1Player1Id, game.team1Player2Id];
        const team2Players = [game.team2Player1Id, game.team2Player2Id];

        if (team1Won) {
          team1Players.forEach((playerId) => {
            playerWinsInEvent.set(
              playerId,
              (playerWinsInEvent.get(playerId) || 0) + 1,
            );
          });
        } else {
          team2Players.forEach((playerId) => {
            playerWinsInEvent.set(
              playerId,
              (playerWinsInEvent.get(playerId) || 0) + 1,
            );
          });
        }
      }

      // Find player(s) with most wins in this event
      if (playerWinsInEvent.size > 0) {
        const maxWins = Math.max(...Array.from(playerWinsInEvent.values()));
        const winners = Array.from(playerWinsInEvent.entries())
          .filter(([, wins]) => wins === maxWins)
          .map(([playerId]) => playerId);

        winners.forEach((playerId) => {
          tournamentWins.set(
            playerId,
            (tournamentWins.get(playerId) || 0) + 1,
          );
        });
      }
    }

    // Get player details and sort
    const playerIds = Array.from(tournamentWins.keys());
    const players = await this.prisma.player.findMany({
      where: {
        id: { in: playerIds },
        active: true,
      },
    });

    const sortedPlayers = players
      .map((player) => ({
        player,
        tournamentsWon: tournamentWins.get(player.id) || 0,
      }))
      .sort((a, b) => b.tournamentsWon - a.tournamentsWon)
      .slice(0, limit);

    return sortedPlayers.map((item, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(item.player),
      value: item.tournamentsWon,
      metric: 'tournamentsWon',
    }));
  }

  async getTopPlayersByLowestLosses(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
      orderBy: {
        totalLosses: 'asc',
      },
      take: limit,
    });

    return players.map((player, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(player),
      value: player.totalLosses,
      metric: 'lowestLosses',
    }));
  }

  async getTopPlayersByPointsDifference(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<RankingResponseDto[]> {
    const dateRange = filters
      ? {
          start: filters.startDate ? new Date(filters.startDate) : undefined,
          end: filters.endDate ? new Date(filters.endDate) : undefined,
        }
      : undefined;

    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
    });

    const playerStats = await Promise.all(
      players.map(async (player) => {
        const stats = await this.playerStatisticsService.getPlayerStats(
          player.id,
          dateRange,
        );
        return {
          player,
          pointsDifference: stats.pointsDifference,
        };
      }),
    );

    // Filter by eventId if specified
    let filteredStats = playerStats;
    if (filters?.eventId) {
      const eventMemberIds = await this.prisma.eventMember.findMany({
        where: { eventId: filters.eventId },
        select: { userId: true },
      });
      const eventPlayerIds = new Set(
        eventMemberIds.map((em) => em.userId),
      );
      filteredStats = playerStats.filter((ps) =>
        eventPlayerIds.has(ps.player.id),
      );
    }

    const sortedStats = filteredStats
      .sort((a, b) => b.pointsDifference - a.pointsDifference)
      .slice(0, limit);

    return sortedStats.map((stat, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.pointsDifference,
      metric: 'pointsDifference',
    }));
  }
}

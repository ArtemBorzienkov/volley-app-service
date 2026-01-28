import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlayerStatisticsService } from '../statistics/player-statistics.service';
import { RankingFiltersDto } from '../common/dto/ranking-filters.dto';
import { RankingResponseDto } from './dto/ranking-response.dto';
import { GroupedRankingResponseDto } from './dto/grouped-ranking-response.dto';
import { TeamCombinationResponseDto } from './dto/team-combination-response.dto';
import { PlayerResponseDto } from '../players/dto/player-response.dto';

@Injectable()
export class RankingsService {
  constructor(private prisma: PrismaService, private playerStatisticsService: PlayerStatisticsService) {}

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

  private groupRankingsByGender(rankings: RankingResponseDto[], limit: number = 10): GroupedRankingResponseDto {
    const grouped: GroupedRankingResponseDto = {
      ALL: [],
      W: [],
      M: [],
    };

    // Separate rankings by gender first
    const allRankings: RankingResponseDto[] = []
    const womenRankings: RankingResponseDto[] = []
    const menRankings: RankingResponseDto[] = []

    rankings.forEach((ranking) => {
      // Add to ALL
      allRankings.push(ranking)

      // Add to gender-specific group
      if (ranking.player.gender === 'female') {
        womenRankings.push(ranking)
      } else if (ranking.player.gender === 'male') {
        menRankings.push(ranking)
      }
    })

    // Apply limit to each category and assign ranks
    grouped.ALL = allRankings.slice(0, limit).map((ranking, index) => ({
      ...ranking,
      rank: index + 1,
    }))

    grouped.W = womenRankings.slice(0, limit).map((ranking, index) => ({
      ...ranking,
      rank: index + 1,
    }))

    grouped.M = menRankings.slice(0, limit).map((ranking, index) => ({
      ...ranking,
      rank: index + 1,
    }))

    return grouped;
  }

  async getTopPlayersByWins(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
    // Ensure limit is a number
    const limitNumber = typeof limit === 'string' ? parseInt(limit, 10) : limit;
    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
      orderBy: {
        totalWins: 'desc',
      },
      take: limitNumber,
    });

    return players.map((player, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(player),
      value: player.totalWins,
      metric: 'wins',
    }));
  }

  async getTopPlayersByWinRate(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
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
        const stats = await this.playerStatisticsService.getPlayerStats(player.id, dateRange);
        return {
          player,
          winRate: stats.winRate,
          totalGames: stats.totalGames,
          totalWins: stats.totalWins,
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
      const eventPlayerIds = new Set(eventMemberIds.map((em) => em.userId));
      filteredStats = playerStats.filter((ps) => eventPlayerIds.has(ps.player.id));
    }

    // Filter players with at least 1 game and sort by win rate, then by total wins
    // Don't apply limit here - let groupRankingsByGender handle it
    const sortedStats = filteredStats
      .filter((ps) => ps.totalGames > 0)
      .sort((a, b) => {
        // First sort by win rate (descending)
        if (b.winRate !== a.winRate) {
          return b.winRate - a.winRate;
        }
        // If win rate is equal, sort by total wins (descending)
        return b.totalWins - a.totalWins;
      });

    const rankings = sortedStats.map((stat) => ({
      rank: 0, // Will be set in groupRankingsByGender
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.winRate,
      metric: 'winRate',
    }));

    return rankings;
  }

  async getTopPlayersBySetsWon(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
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
        const stats = await this.playerStatisticsService.getPlayerStats(player.id, dateRange);
        return {
          player,
          setsWon: stats.totalWins,
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
      const eventPlayerIds = new Set(eventMemberIds.map((em) => em.userId));
      filteredStats = playerStats.filter((ps) => eventPlayerIds.has(ps.player.id));
    }

    const sortedStats = filteredStats.sort((a, b) => b.setsWon - a.setsWon).slice(0, limit);

    return sortedStats.map((stat, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.setsWon,
      metric: 'setsWon',
    }));
  }

  async getTopPlayersByTournamentsWon(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
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
        const team1Won = game.team1Points > game.team2Points;
        const team1Players = [game.team1Player1Id, game.team1Player2Id];
        const team2Players = [game.team2Player1Id, game.team2Player2Id];

        if (team1Won) {
          team1Players.forEach((playerId) => {
            playerWinsInEvent.set(playerId, (playerWinsInEvent.get(playerId) || 0) + 1);
          });
        } else {
          team2Players.forEach((playerId) => {
            playerWinsInEvent.set(playerId, (playerWinsInEvent.get(playerId) || 0) + 1);
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
          tournamentWins.set(playerId, (tournamentWins.get(playerId) || 0) + 1);
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

  async getTopPlayersByWonEvents(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
    // Maps to store medal counts per player
    const goldMedalsMap = new Map<string, number>(); // userId: count
    const silverMedalsMap = new Map<string, number>(); // userId: count
    const bronzeMedalsMap = new Map<string, number>(); // userId: count
    const userTotalEventsMap = new Map<string, number>(); // userId: total count of all places

    const events = await this.prisma.event.findMany({
      where: {},
    });

    if (!events.length) {
      return [];
    }

    // Count medals from event data places
    for (const event of events) {
      // Check if event has places data
      if (!event.data || typeof event.data !== 'object') {
        continue;
      }

      for (const [place, playerIds] of Object.entries(event.data as Record<string, string[]>)) {
        // Ensure playerIds is an array
        const playerIdArray = Array.isArray(playerIds) ? playerIds : [];
        
        playerIdArray.forEach((playerId) => {
          if (typeof playerId !== 'string') return;

          // Count total events (all places)
          userTotalEventsMap.set(playerId, (userTotalEventsMap.get(playerId) || 0) + 1);

          // Count medals based on place
          if (place === '1') {
            goldMedalsMap.set(playerId, (goldMedalsMap.get(playerId) || 0) + 1);
          } else if (place === '2') {
            silverMedalsMap.set(playerId, (silverMedalsMap.get(playerId) || 0) + 1);
          } else if (place === '3') {
            bronzeMedalsMap.set(playerId, (bronzeMedalsMap.get(playerId) || 0) + 1);
          }
        });
      }
    }

    // Get all unique player IDs who have participated in events
    const allUserIds = Array.from(new Set([
      ...Array.from(goldMedalsMap.keys()),
      ...Array.from(silverMedalsMap.keys()),
      ...Array.from(bronzeMedalsMap.keys()),
      ...Array.from(userTotalEventsMap.keys()),
    ]));

    if (!allUserIds.length) {
      return [];
    }

    const players = await this.prisma.player.findMany({
      where: {
        id: { in: allUserIds },
        active: true,
      },
    });

    // Don't apply limit here - let groupRankingsByGender handle it
    const sortedPlayers = players
      .map((player) => {
        const gold = goldMedalsMap.get(player.id) || 0;
        const silver = silverMedalsMap.get(player.id) || 0;
        const bronze = bronzeMedalsMap.get(player.id) || 0;
        const totalEvents = userTotalEventsMap.get(player.id) || 0;
        return {
          player,
          gold,
          silver,
          bronze,
          totalEvents,
        };
      })
      .sort((a, b) => {
        // First sort by gold (descending)
        if (b.gold !== a.gold) {
          return b.gold - a.gold;
        }
        // Then by silver (descending)
        if (b.silver !== a.silver) {
          return b.silver - a.silver;
        }
        // Finally by bronze (descending)
        return b.bronze - a.bronze;
      });

    const rankings = sortedPlayers.map((item) => ({
      rank: 0, // Will be set in groupRankingsByGender
      player: this.mapPlayerToResponseDto(item.player),
      value: {
        gold: item.gold,
        silver: item.silver,
        bronze: item.bronze,
      },
      metric: 'eventsWon',
      totalEvents: item.totalEvents,
      eventsWon: item.gold, // Keep for backward compatibility
    }));

    return rankings;
  }

  async getTopPlayersByGamesPlayed(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
    // Ensure limit is a number
    const limitNumber = typeof limit === 'string' ? parseInt(limit, 10) : limit;

    // Get all active players
    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
    });

    // Calculate win rate for each player
    const playerStats = await Promise.all(
      players.map(async (player) => {
        const stats = await this.playerStatisticsService.getPlayerStats(player.id);
        return {
          player,
          totalGames: stats.totalGames,
          winRate: stats.winRate,
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
      const eventPlayerIds = new Set(eventMemberIds.map((em) => em.userId));
      filteredStats = playerStats.filter((ps) => eventPlayerIds.has(ps.player.id));
    }

    // Sort by total games (descending), then by win rate (descending)
    // Don't apply limit here - let groupRankingsByGender handle it
    const sortedStats = filteredStats
      .filter((ps) => ps.totalGames > 0)
      .sort((a, b) => {
        // First sort by total games (descending)
        if (b.totalGames !== a.totalGames) {
          return b.totalGames - a.totalGames;
        }
        // If total games are equal, sort by win rate (descending)
        return b.winRate - a.winRate;
      });

    const rankings = sortedStats.map((stat) => ({
      rank: 0, // Will be set in groupRankingsByGender
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.totalGames,
      metric: 'gamesPlayed',
    }));

    return rankings;
  }

  async getTopPlayersByWonEventsGrouped(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<GroupedRankingResponseDto> {
    // Get all rankings without limit first
    const allRankings = await this.getTopPlayersByWonEvents(1000, filters);
    return this.groupRankingsByGender(allRankings, limit);
  }

  async getTopPlayersByWinRateGrouped(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<GroupedRankingResponseDto> {
    // Get all rankings without limit first
    const allRankings = await this.getTopPlayersByWinRate(1000, filters);
    return this.groupRankingsByGender(allRankings, limit);
  }

  async getTopPlayersByGamesPlayedGrouped(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<GroupedRankingResponseDto> {
    // Get all rankings without limit first
    const allRankings = await this.getTopPlayersByGamesPlayed(1000, filters);
    return this.groupRankingsByGender(allRankings, limit);
  }

  async getTopPlayersByLowestLosses(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
    // Ensure limit is a number
    const limitNumber = typeof limit === 'string' ? parseInt(limit, 10) : limit;
    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
      orderBy: {
        totalLosses: 'asc',
      },
      take: limitNumber,
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
        const stats = await this.playerStatisticsService.getPlayerStats(player.id, dateRange);
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
      const eventPlayerIds = new Set(eventMemberIds.map((em) => em.userId));
      filteredStats = playerStats.filter((ps) => eventPlayerIds.has(ps.player.id));
    }

    const sortedStats = filteredStats.sort((a, b) => b.pointsDifference - a.pointsDifference).slice(0, limit);

    return sortedStats.map((stat, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.pointsDifference,
      metric: 'pointsDifference',
    }));
  }

  async getBestTeamCombinations(limit: number = 5): Promise<TeamCombinationResponseDto[]> {
    // Get all games
    const games = await this.prisma.game.findMany({
      orderBy: { date: 'desc' },
    });

    // Map to track team combinations: key is sorted player IDs (player1Id_player2Id where player1Id < player2Id)
    const teamStats = new Map<
      string,
      {
        player1Id: string;
        player2Id: string;
        gamesPlayed: number;
        wins: number;
        losses: number;
        setsWon: number;
        setsLost: number;
        pointsScored: number;
        pointsConceded: number;
      }
    >();

    // Process each game
    for (const game of games) {
      // Team 1
      const team1Players = [game.team1Player1Id, game.team1Player2Id].sort();
      const team1Key = `${team1Players[0]}_${team1Players[1]}`;

      if (!teamStats.has(team1Key)) {
        teamStats.set(team1Key, {
          player1Id: team1Players[0],
          player2Id: team1Players[1],
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          setsWon: 0,
          setsLost: 0,
          pointsScored: 0,
          pointsConceded: 0,
        });
      }

      const team1Stats = teamStats.get(team1Key)!;
      team1Stats.gamesPlayed++;
      team1Stats.pointsScored += game.team1Points;
      team1Stats.pointsConceded += game.team2Points;

      if (game.team1Points > game.team2Points) {
        team1Stats.wins++;
      } else if (game.team2Points > game.team1Points) {
        team1Stats.losses++;
      }

      // Team 2
      const team2Players = [game.team2Player1Id, game.team2Player2Id].sort();
      const team2Key = `${team2Players[0]}_${team2Players[1]}`;

      if (!teamStats.has(team2Key)) {
        teamStats.set(team2Key, {
          player1Id: team2Players[0],
          player2Id: team2Players[1],
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          setsWon: 0,
          setsLost: 0,
          pointsScored: 0,
          pointsConceded: 0,
        });
      }

      const team2Stats = teamStats.get(team2Key)!;
      team2Stats.gamesPlayed++;
      team2Stats.pointsScored += game.team2Points;
      team2Stats.pointsConceded += game.team1Points;

      if (game.team2Points > game.team1Points) {
        team2Stats.wins++;
      } else if (game.team1Points > game.team2Points) {
        team2Stats.losses++;
      }
    }

    // Get all unique player IDs
    const allPlayerIds = new Set<string>();
    teamStats.forEach((stats) => {
      allPlayerIds.add(stats.player1Id);
      allPlayerIds.add(stats.player2Id);
    });

    // Fetch all players
    const players = await this.prisma.player.findMany({
      where: {
        id: { in: Array.from(allPlayerIds) },
      },
    });

    const playerMap = new Map(players.map((p) => [p.id, p]));

    // Convert to array and calculate win rate, then sort
    const combinations = Array.from(teamStats.values())
      .map((stats) => ({
        ...stats,
        player1: playerMap.get(stats.player1Id),
        player2: playerMap.get(stats.player2Id),
        winRate: stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 100 * 100) / 100 : 0,
      }))
      .filter(
        (stats) =>
          stats.gamesPlayed > 0 && stats.player1 && stats.player2 && stats.player1.active && stats.player2.active,
      ) // Only include teams that have played at least one game and both players are active
      .sort((a, b) => {
        // Sort by win rate first, then by wins, then by games played
        if (b.winRate !== a.winRate) {
          return b.winRate - a.winRate;
        }
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }
        return b.gamesPlayed - a.gamesPlayed;
      })
      .slice(0, limit);

    return combinations.map((combo, index) => ({
      rank: index + 1,
      player1: this.mapPlayerToResponseDto(combo.player1),
      player2: this.mapPlayerToResponseDto(combo.player2),
      gamesPlayed: combo.gamesPlayed,
      wins: combo.wins,
      losses: combo.losses,
      winRate: combo.winRate,
      setsWon: combo.setsWon,
      setsLost: combo.setsLost,
      pointsScored: combo.pointsScored,
      pointsConceded: combo.pointsConceded,
    }));
  }
}

const top = {
  '1': ['f6908ef4-b100-4e8c-bbef-2d59cb52bc8a'], // Yevhen Sh
  '2': ['5a17e842-2bf0-4ea9-827a-0f70df3028c5'], // Alex
  '3': ['9575ce0f-2d94-4e84-ad9d-ec118f193913'], // Taras
  '4': ['c04cff53-48b1-43cc-99d6-50c5ce280840'], // Viktor
  '5': ['43a38877-a066-4907-be74-3ad570e4b7af'], // Maciej
  '6': ['5b5516c1-e9ff-4ea1-bbe4-7c5d34a218d3'], // Alina Ch
  '7': ['a7539a33-1cf9-4f7e-89d3-05a35d073526'], // Vitalina
  '8': ['8553cb6a-5d39-4b34-93c9-d0aef1d9b64d'], // Yevhen Ul
};

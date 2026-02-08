import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlayerStatisticsService } from '../statistics/player-statistics.service';
import { RankingFiltersDto } from '../common/dto/ranking-filters.dto';
import { RankingResponseDto } from './dto/ranking-response.dto';
import { GroupedRankingResponseDto } from './dto/grouped-ranking-response.dto';
import { TeamCombinationResponseDto } from './dto/team-combination-response.dto';
import { PlayerResponseDto } from '../players/dto/player-response.dto';

type PlayerWithStats = {
  id: string;
  playerStats?: {
    rank: number;
  } | null;
};

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
      totalGames: player.playerStats?.totalGames ?? 0,
      totalWins: player.playerStats?.totalWins ?? 0,
      totalLosses: player.playerStats?.totalLosses ?? 0,
      createdAt: player.createdAt,
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
    const allRankings: RankingResponseDto[] = [];
    const womenRankings: RankingResponseDto[] = [];
    const menRankings: RankingResponseDto[] = [];

    rankings.forEach((ranking) => {
      // Add to ALL
      allRankings.push(ranking);

      // Add to gender-specific group
      if (ranking.player.gender === 'female') {
        womenRankings.push(ranking);
      } else if (ranking.player.gender === 'male') {
        menRankings.push(ranking);
      }
    });

    // Apply limit to each category and assign ranks
    grouped.ALL = allRankings.slice(0, limit).map((ranking, index) => ({
      ...ranking,
      rank: index + 1,
    }));

    grouped.W = womenRankings.slice(0, limit).map((ranking, index) => ({
      ...ranking,
      rank: index + 1,
    }));

    grouped.M = menRankings.slice(0, limit).map((ranking, index) => ({
      ...ranking,
      rank: index + 1,
    }));

    return grouped;
  }

  async getTopPlayersByWins(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
    // Ensure limit is a number
    const limitNumber = typeof limit === 'string' ? parseInt(limit, 10) : limit;
    const playerStats = await this.prisma.playerStats.findMany({
      where: {
        player: {
          active: true,
        },
      },
      include: {
        player: true,
      },
      orderBy: {
        totalWins: 'desc',
      },
      take: limitNumber,
    });

    return playerStats.map((stat, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.totalWins,
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
      include: {
        playerStats: true,
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

    // Filter players with at least 10 games and sort by win rate, then by total wins
    // Don't apply limit here - let groupRankingsByGender handle it
    const sortedStats = filteredStats
      .filter((ps) => ps.totalGames >= 10)
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
      include: {
        playerStats: true,
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
    const allUserIds = Array.from(
      new Set([
        ...Array.from(goldMedalsMap.keys()),
        ...Array.from(silverMedalsMap.keys()),
        ...Array.from(bronzeMedalsMap.keys()),
        ...Array.from(userTotalEventsMap.keys()),
      ]),
    );

    if (!allUserIds.length) {
      return [];
    }

    const players = await this.prisma.player.findMany({
      where: {
        id: { in: allUserIds },
        active: true,
      },
      include: {
        playerStats: true,
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
      include: {
        playerStats: true,
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

  async getTopPlayersByRank(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
    // Ensure limit is a number
    const limitNumber = typeof limit === 'string' ? parseInt(limit, 10) : limit;

    // Build where clause for player filters
    const playerWhere: any = {
      active: true,
    };

    // Filter by eventId if specified
    let playerIds: string[] | undefined;
    if (filters?.eventId) {
      const eventMemberIds = await this.prisma.eventMember.findMany({
        where: { eventId: filters.eventId },
        select: { userId: true },
      });
      playerIds = eventMemberIds.map((em) => em.userId);
      playerWhere.id = { in: playerIds };
    }

    // Get player stats ordered by rank (descending - higher rank is better)
    const playerStats = await this.prisma.playerStats.findMany({
      where: {
        player: playerWhere,
      },
      include: {
        player: true,
      },
      orderBy: {
        rank: 'desc',
      },
      take: limitNumber * 10, // Get more to allow for gender filtering
    });

    // Map to ranking response format
    const rankings = playerStats.map((stat) => {
      const playerDto = this.mapPlayerToResponseDto(stat.player);
      // Ensure totalGames is set from playerStats since player relation doesn't include playerStats
      playerDto.totalGames = stat.totalGames ?? 0;
      playerDto.totalWins = stat.totalWins ?? 0;
      playerDto.totalLosses = stat.totalLosses ?? 0;

      return {
        rank: 0, // Will be set in groupRankingsByGender
        player: playerDto,
        value: stat.rank,
        metric: 'rank',
      };
    });

    return rankings;
  }

  async getTopPlayersByRankGrouped(
    limit: number = 10,
    filters?: RankingFiltersDto,
  ): Promise<GroupedRankingResponseDto> {
    // Get all rankings without limit first
    const allRankings = await this.getTopPlayersByRank(1000, filters);
    return this.groupRankingsByGender(allRankings, limit);
  }

  async getTopPlayersByLowestLosses(limit: number = 10, filters?: RankingFiltersDto): Promise<RankingResponseDto[]> {
    // Ensure limit is a number
    const limitNumber = typeof limit === 'string' ? parseInt(limit, 10) : limit;
    const playerStats = await this.prisma.playerStats.findMany({
      where: {
        player: {
          active: true,
        },
      },
      include: {
        player: true,
      },
      orderBy: {
        totalLosses: 'asc',
      },
      take: limitNumber,
    });

    return playerStats.map((stat, index) => ({
      rank: index + 1,
      player: this.mapPlayerToResponseDto(stat.player),
      value: stat.totalLosses,
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
      include: {
        playerStats: true,
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

  async updatePlayersRankByGameResult(game: {
    id: string;
    team1Points: number;
    team2Points: number;
    team1Player1: PlayerWithStats;
    team1Player2: PlayerWithStats;
    team2Player1: PlayerWithStats;
    team2Player2: PlayerWithStats;
  }): Promise<void> {
    const { team1Player1, team1Player2, team2Player1, team2Player2, team1Points, team2Points } = game;

    // Extract player ranks (use default 1000 if playerStats is null)
    const team1Player1Rank = team1Player1?.playerStats?.rank ?? 1000;
    const team1Player2Rank = team1Player2?.playerStats?.rank ?? 1000;
    const team2Player1Rank = team2Player1?.playerStats?.rank ?? 1000;
    const team2Player2Rank = team2Player2?.playerStats?.rank ?? 1000;

    // Calculate team sums
    const team1Sum = team1Player1Rank + team1Player2Rank;
    const team2Sum = team2Player1Rank + team2Player2Rank;

    // Handle tie games - no rank change
    if (team1Points === team2Points) {
      return;
    }

    // Determine winner
    const team1Won = team1Points > team2Points;

    // Calculate rank difference
    const rankDifference = Math.abs(team1Sum - team2Sum);

    // Calculate rank change
    let rankChange: number;
    const maxRankChange = 50;

    if (rankDifference === 0) {
      // Equal teams
      rankChange = Math.round(maxRankChange / 2);
    } else {
      // Determine if team1 is favorite or underdog
      const team1IsFavorite = team1Sum > team2Sum;
      const favoriteWon = team1IsFavorite ? team1Won : !team1Won;
      const isUnderdogWin = team1IsFavorite ? !team1Won : team1Won;

      if (rankDifference > 250 && favoriteWon) {
        // Favorite wins with large difference - no rank change
        rankChange = 0;
      } else if (rankDifference > 250 && isUnderdogWin) {
        // Underdog wins with large difference - maximum rank change
        rankChange = maxRankChange;
      } else {
        // Get multiplier based on rank difference
        let multiplier: number;
        if (rankDifference <= 50) {
          multiplier = isUnderdogWin ? 1.1 : 0.9;
        } else if (rankDifference <= 100) {
          multiplier = isUnderdogWin ? 1.15 : 0.85;
        } else if (rankDifference <= 150) {
          multiplier = isUnderdogWin ? 1.2 : 0.8;
        } else if (rankDifference <= 200) {
          multiplier = isUnderdogWin ? 1.3 : 0.75;
        } else {
          // 201-250
          multiplier = isUnderdogWin ? 1.4 : 0.7;
        }

        // Calculate base change: (max_rank_change / 2) * multiplier = 25 * multiplier
        const baseChange = (maxRankChange / 2) * multiplier;
        rankChange = baseChange;
        // Cap at max rank change
        rankChange = Math.min(rankChange, maxRankChange);
      }
    }

    // If no rank change, return early
    if (rankChange === 0) {
      console.log(
        `[Rank Update] Game ${game.id}: Rank diff=${rankDifference}, ` +
          `Team1 won=${team1Won}, Favorite won with large diff - No rank change`,
      );
      return;
    }

    // Distribute rank changes based on player's percentage contribution to team rank
    // For winners: inverted distribution (lower-ranked players get more)
    //   rankParcentagePlayer = playerRank * 100 / teamSumRank
    //   rankChangeCoeficient = (100 - rankParcentagePlayer) / 100
    // For losers: proportional distribution (higher-ranked players lose more)
    //   rankParcentagePlayer = playerRank * 100 / teamSumRank
    //   rankChangeCoeficient = rankParcentagePlayer / 100

    // Team1 coefficients (winners if team1Won, losers if team2Won)
    const team1Player1RankPercentage = (team1Player1Rank * 100) / team1Sum;
    const team1Player2RankPercentage = (team1Player2Rank * 100) / team1Sum;
    const team1Player1RankChangeCoeficient = team1Won
      ? (100 - team1Player1RankPercentage) / 100 // Inverted for winners
      : team1Player1RankPercentage / 100; // Proportional for losers
    const team1Player2RankChangeCoeficient = team1Won
      ? (100 - team1Player2RankPercentage) / 100 // Inverted for winners
      : team1Player2RankPercentage / 100; // Proportional for losers

    // Team2 coefficients (losers if team1Won, winners if team2Won)
    const team2Player1RankPercentage = (team2Player1Rank * 100) / team2Sum;
    const team2Player2RankPercentage = (team2Player2Rank * 100) / team2Sum;
    const team2Player1RankChangeCoeficient = team1Won
      ? team2Player1RankPercentage / 100 // Proportional for losers
      : (100 - team2Player1RankPercentage) / 100; // Inverted for winners
    const team2Player2RankChangeCoeficient = team1Won
      ? team2Player2RankPercentage / 100 // Proportional for losers
      : (100 - team2Player2RankPercentage) / 100; // Inverted for winners

    const team1Player1Change = team1Won
      ? rankChange * team1Player1RankChangeCoeficient
      : -rankChange * team1Player1RankChangeCoeficient;
    const team1Player2Change = team1Won
      ? rankChange * team1Player2RankChangeCoeficient
      : -rankChange * team1Player2RankChangeCoeficient;
    const team2Player1Change = team1Won
      ? -rankChange * team2Player1RankChangeCoeficient
      : rankChange * team2Player1RankChangeCoeficient;
    const team2Player2Change = team1Won
      ? -rankChange * team2Player2RankChangeCoeficient
      : rankChange * team2Player2RankChangeCoeficient;

    // Calculate total rank change per team
    const team1TotalChange = team1Player1Change + team1Player2Change;
    const team2TotalChange = team2Player1Change + team2Player2Change;

    // Log rank changes
    console.log(
      `[Rank Update] Game ${game.id}: ` +
        `Rank diff=${rankDifference}, ` +
        `Team1 won=${team1Won}, ` +
        `Total rank change=${rankChange.toFixed(2)}, ` +
        `Team1 change=${team1TotalChange.toFixed(2)}, ` +
        `Team2 change=${team2TotalChange.toFixed(2)}`,
    );

    // Update ranks in database with bounds checking (0-3000)
    const updateRank = async (playerId: string, rankChange: number) => {
      const currentStats = await this.prisma.playerStats.findUnique({
        where: { playerId },
      });

      const currentRank = currentStats?.rank ?? 1000;
      const newRank = Math.max(0, Math.min(3000, currentRank + rankChange));

      await this.prisma.playerStats.upsert({
        where: { playerId },
        create: {
          playerId,
          rank: Math.round(newRank),
          totalGames: 0,
          totalWins: 0,
          totalLosses: 0,
        },
        update: {
          rank: Math.round(newRank),
        },
      });
    };

    await Promise.all([
      updateRank(team1Player1.id, team1Player1Change),
      updateRank(team1Player2.id, team1Player2Change),
      updateRank(team2Player1.id, team2Player1Change),
      updateRank(team2Player2.id, team2Player2Change),
    ]);
  }

  async agregateRankings(): Promise<void> {
    this.prisma.playerStats.updateMany({
      where: {
        rank: {
          not: 1000,
        },
      },
      data: {
        rank: 1000,
      },
    });

    const allGamesWithPlayerStats = await this.prisma.game.findMany({
      include: {
        team1Player1: {
          include: {
            playerStats: true,
          },
        },
        team1Player2: {
          include: {
            playerStats: true,
          },
        },
        team2Player1: {
          include: {
            playerStats: true,
          },
        },
        team2Player2: {
          include: {
            playerStats: true,
          },
        },
      },
    });

    // Process each game
    for (const game of allGamesWithPlayerStats) {
      await this.updatePlayersRankByGameResult(game);
    }
  }
}

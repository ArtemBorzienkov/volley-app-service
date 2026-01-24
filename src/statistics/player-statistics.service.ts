import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlayerStatisticsService {
  constructor(private prisma: PrismaService) {}

  async getPlayerStats(
    playerId: string,
    dateRange?: { start: Date; end: Date },
  ) {
    // Verify player exists
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      throw new NotFoundException(`Player with ID ${playerId} not found`);
    }

    // Build date filter
    const dateFilter: any = {};
    if (dateRange?.start) {
      dateFilter.gte = dateRange.start;
    }
    if (dateRange?.end) {
      dateFilter.lte = dateRange.end;
    }

    const dateWhere =
      Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {};

    // Get all games where player participated
    const gamesAsTeam1Player1 = await this.prisma.game.findMany({
      where: {
        team1Player1Id: playerId,
        ...dateWhere,
      },
    });

    const gamesAsTeam1Player2 = await this.prisma.game.findMany({
      where: {
        team1Player2Id: playerId,
        ...dateWhere,
      },
    });

    const gamesAsTeam2Player1 = await this.prisma.game.findMany({
      where: {
        team2Player1Id: playerId,
        ...dateWhere,
      },
    });

    const gamesAsTeam2Player2 = await this.prisma.game.findMany({
      where: {
        team2Player2Id: playerId,
        ...dateWhere,
      },
    });

    // Combine all games (avoid duplicates by using Set with game IDs)
    const allGames = [
      ...gamesAsTeam1Player1,
      ...gamesAsTeam1Player2,
      ...gamesAsTeam2Player1,
      ...gamesAsTeam2Player2,
    ];

    // Remove duplicates
    const uniqueGames = Array.from(
      new Map(allGames.map((game) => [game.id, game])).values(),
    );

    // Calculate statistics
    let totalGames = uniqueGames.length;
    let totalWins = 0;
    let totalLosses = 0;
    let setsWon = 0;
    let setsLost = 0;
    let pointsScored = 0;
    let pointsConceded = 0;

    for (const game of uniqueGames) {
      const isTeam1 =
        game.team1Player1Id === playerId || game.team1Player2Id === playerId;
      const isTeam2 =
        game.team2Player1Id === playerId || game.team2Player2Id === playerId;

      if (isTeam1) {
        setsWon += game.team1Sets;
        setsLost += game.team2Sets;
        pointsScored += game.team1Points;
        pointsConceded += game.team2Points;

        if (game.team1Sets > game.team2Sets) {
          totalWins++;
        } else if (game.team2Sets > game.team1Sets) {
          totalLosses++;
        }
      } else if (isTeam2) {
        setsWon += game.team2Sets;
        setsLost += game.team1Sets;
        pointsScored += game.team2Points;
        pointsConceded += game.team1Points;

        if (game.team2Sets > game.team1Sets) {
          totalWins++;
        } else if (game.team1Sets > game.team2Sets) {
          totalLosses++;
        }
      }
    }

    const winRate = totalGames > 0 ? (totalWins / totalGames) * 100 : 0;
    const pointsDifference = pointsScored - pointsConceded;

    return {
      playerId,
      totalGames,
      totalWins,
      totalLosses,
      winRate: Math.round(winRate * 100) / 100, // Round to 2 decimal places
      setsWon,
      setsLost,
      pointsScored,
      pointsConceded,
      pointsDifference,
    };
  }

  async getPlayerWinRate(playerId: string): Promise<number> {
    const stats = await this.getPlayerStats(playerId);
    return stats.winRate;
  }

  async getPlayerSetsWon(playerId: string): Promise<number> {
    const stats = await this.getPlayerStats(playerId);
    return stats.setsWon;
  }
}

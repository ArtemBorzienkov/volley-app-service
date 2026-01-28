import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { PlayerResponseDto } from './dto/player-response.dto';
import { EventResponseDto } from '../events/dto/event-response.dto';
import { FullPlayerResponseDto } from './dto/full-player-response.dto';
import { PlayerStatisticsService } from '../statistics/player-statistics.service';

@Injectable()
export class PlayersService {
  constructor(
    private prisma: PrismaService,
    private playerStatisticsService: PlayerStatisticsService,
  ) {}

  async create(createPlayerDto: CreatePlayerDto): Promise<PlayerResponseDto> {
    // Check if player with tgId already exists (only if tgId is provided)
    if (createPlayerDto.tgId) {
      const existingPlayer = await this.prisma.player.findUnique({
        where: { tgId: createPlayerDto.tgId },
      });

      if (existingPlayer) {
        throw new ConflictException(
          `Player with tgId ${createPlayerDto.tgId} already exists`,
        );
      }
    }

    const player = await this.prisma.player.create({
      data: {
        tgId: createPlayerDto.tgId,
        name: createPlayerDto.name,
        avatar: createPlayerDto.avatar,
        gender: createPlayerDto.gender,
        active: createPlayerDto.active ?? true,
      },
    });

    return this.mapToResponseDto(player);
  }

  async findAllActive(): Promise<PlayerResponseDto[]> {
    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return players.map((player) => this.mapToResponseDto(player));
  }

  async findAllFull(): Promise<FullPlayerResponseDto[]> {
    // Get all active players
    const players = await this.prisma.player.findMany({
      where: {
        active: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Maps to store medal counts per player
    const goldMedalsMap = new Map<string, number>();
    const silverMedalsMap = new Map<string, number>();
    const bronzeMedalsMap = new Map<string, number>();
    const userTotalEventsMap = new Map<string, number>();

    // Get all events to calculate medals
    const events = await this.prisma.event.findMany({
      where: {},
    });

    // Count medals from event data places
    for (const event of events) {
      if (!event.data || typeof event.data !== 'object') {
        continue;
      }

      for (const [place, playerIds] of Object.entries(event.data as Record<string, string[]>)) {
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

    // Calculate extended stats for each player
    const fullPlayers = await Promise.all(
      players.map(async (player) => {
        const basePlayer = this.mapToResponseDto(player);
        const gold = goldMedalsMap.get(player.id) || 0;
        const silver = silverMedalsMap.get(player.id) || 0;
        const bronze = bronzeMedalsMap.get(player.id) || 0;
        const totalEvents = userTotalEventsMap.get(player.id) || 0;

        // Get player statistics
        const stats = await this.playerStatisticsService.getPlayerStats(player.id);

        // Get recent games (6 most recent)
        const recentGames = await this.prisma.game.findMany({
          where: {
            OR: [
              { team1Player1Id: player.id },
              { team1Player2Id: player.id },
              { team2Player1Id: player.id },
              { team2Player2Id: player.id },
            ],
          },
          orderBy: { date: 'desc' },
          take: 6,
        });

        // Map games to 'win' or 'lose' results
        const recentGamesResults = recentGames.map((game) => {
          const isTeam1 =
            game.team1Player1Id === player.id || game.team1Player2Id === player.id;
          const isTeam2 =
            game.team2Player1Id === player.id || game.team2Player2Id === player.id;

          if (isTeam1) {
            return game.team1Points > game.team2Points ? 'win' : 'lose';
          } else if (isTeam2) {
            return game.team2Points > game.team1Points ? 'win' : 'lose';
          }

          // Fallback (should not happen)
          return 'lose';
        });

        return {
          ...basePlayer,
          totalEvents,
          medals: {
            gold,
            silver,
            bronze,
          },
          totalGames: stats.totalGames,
          winRate: Math.round(stats.winRate * 100) / 100, // Round to 2 decimal places
          recentGames: recentGamesResults,
        } as FullPlayerResponseDto;
      }),
    );

    return fullPlayers;
  }

  async getPlayerEvents(playerId: string): Promise<EventResponseDto[]> {
    // Verify player exists
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      throw new NotFoundException(`Player with ID ${playerId} not found`);
    }

    // Get event members for this player
    const eventMembers = await this.prisma.eventMember.findMany({
      where: { userId: playerId },
      include: {
        event: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Map to EventResponseDto
    return eventMembers.map((member) => ({
      id: member.event.id,
      name: member.event.name,
      date: member.event.date,
      createdBy: member.event.createdBy,
      location: member.event.location,
      createdAt: member.event.createdAt,
      updatedAt: member.event.updatedAt,
    }));
  }

  private mapToResponseDto(player: any): PlayerResponseDto {
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
}

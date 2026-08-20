import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RankingsService } from '../rankings/rankings.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { CreateEventWithGamesDto } from './dto/create-event-with-games.dto';
import { Prisma } from '@prisma/client';

const EVENTS_PER_PAGE = 5;

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService, private rankingsService: RankingsService) {}

  async create(createEventDto: CreateEventDto): Promise<EventResponseDto> {
    // Validate that creator (player) exists
    const creator = await this.prisma.player.findUnique({
      where: { id: createEventDto.createdBy },
    });

    if (!creator) {
      throw new NotFoundException(`Player with ID ${createEventDto.createdBy} not found`);
    }

    const event = await this.prisma.event.create({
      data: {
        name: createEventDto.name,
        date: new Date(createEventDto.date),
        createdBy: createEventDto.createdBy,
        location: createEventDto.location,
      },
    });

    return this.mapToResponseDto(event);
  }

  async createWithGames(createEventWithGamesDto: CreateEventWithGamesDto): Promise<EventResponseDto> {
    // Validate creator if provided
    if (createEventWithGamesDto.createdBy) {
      const creator = await this.prisma.player.findUnique({
        where: { id: createEventWithGamesDto.createdBy },
      });

      if (!creator) {
        throw new NotFoundException(`Player with ID ${createEventWithGamesDto.createdBy} not found`);
      }
    }

    // Validate all games before creating
    for (const game of createEventWithGamesDto.games) {
      await this.validateTeamComposition(
        game.team1Player1Id,
        game.team1Player2Id,
        game.team2Player1Id,
        game.team2Player2Id,
      );
    }

    const eventDate = new Date(createEventWithGamesDto.date);

    // Create event and all games in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create event - build data object conditionally
      const eventCreateData: {
        name: string;
        date: Date;
        createdBy?: string | null;
        location?: string;
        data?: any;
      } = {
        name: createEventWithGamesDto.name,
        date: eventDate,
      };

      // Handle optional createdBy - set to null explicitly if not provided
      // This works with Prisma's optional relation handling
      if (createEventWithGamesDto.createdBy !== undefined) {
        eventCreateData.createdBy = createEventWithGamesDto.createdBy || null;
      } else {
        eventCreateData.createdBy = null;
      }

      if (createEventWithGamesDto.location) {
        eventCreateData.location = createEventWithGamesDto.location;
      }

      // Store places as JSON in data field
      if (createEventWithGamesDto.places && Object.keys(createEventWithGamesDto.places).length > 0) {
        eventCreateData.data = createEventWithGamesDto.places;
      } else {
        eventCreateData.data = Prisma.JsonNull;
      }

      const event = await tx.event.create({
        data: eventCreateData,
      });

      // Create all games and update player statistics.
      // Games are inserted in UI order (first game first, last game last). Because bulk
      // inserts share the same `date` and Postgres `now()` is constant within a transaction,
      // we assign each game a strictly increasing `createdAt` (base + index ms) so the game
      // order is deterministically preserved and reproduced by every `date/createdAt/id asc`
      // ordering (rankings aggregation + read endpoints).
      const createdGames = [];
      const baseCreatedAt = new Date();
      for (let index = 0; index < createEventWithGamesDto.games.length; index++) {
        const gameDto = createEventWithGamesDto.games[index];
        // Determine winner by points (team with more points wins)
        const team1Won = gameDto.team1Points > gameDto.team2Points;

        // Create game
        const game = await tx.game.create({
          data: {
            eventId: event.id,
            team1Player1Id: gameDto.team1Player1Id,
            team1Player2Id: gameDto.team1Player2Id,
            team2Player1Id: gameDto.team2Player1Id,
            team2Player2Id: gameDto.team2Player2Id,
            team1Points: gameDto.team1Points,
            team2Points: gameDto.team2Points,
            date: eventDate,
            location: createEventWithGamesDto.location,
            createdAt: new Date(baseCreatedAt.getTime() + index),
          },
        });

        // Update player statistics
        await this.updatePlayerStatsForGame(tx, gameDto.team1Player1Id, team1Won);
        await this.updatePlayerStatsForGame(tx, gameDto.team1Player2Id, team1Won);
        await this.updatePlayerStatsForGame(tx, gameDto.team2Player1Id, !team1Won);
        await this.updatePlayerStatsForGame(tx, gameDto.team2Player2Id, !team1Won);

        createdGames.push(game);
      }

      return { event, games: createdGames };
    });

    for (const game of result.games) {
      await this.prisma.$transaction(async (tx) => {
        // Fetch game with player stats for rank update
        const gameWithPlayerStats = await tx.game.findUnique({
          where: { id: game.id },
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

        if (gameWithPlayerStats) {
          await this.rankingsService.updatePlayersRankByGameResult(tx, gameWithPlayerStats);
        }
      });
    }

    // Return event with games included
    return this.mapToResponseDto(result.event);
  }

  async findAll(
    page: number,
    type: 'all' | 'tournament' | 'training' = 'all',
  ): Promise<{ events: EventResponseDto[]; page: number; hasMore: boolean; totalEvents: number }> {
    const where: Prisma.EventWhereInput | undefined =
      type === 'all'
        ? undefined
        : type === 'tournament'
        ? { NOT: { data: { equals: Prisma.JsonNull } } }
        : { data: { equals: Prisma.JsonNull } };

    const [events, totalEvents] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * EVENTS_PER_PAGE,
        take: EVENTS_PER_PAGE,
        include: {
          games: {
            include: {
              gamePlayerRanks: true,
            },
          },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      events: events.map((event) => this.mapToResponseDto(event)),
      page,
      hasMore: totalEvents > page * EVENTS_PER_PAGE,
      totalEvents,
    };
  }

  async findOne(id: string): Promise<EventResponseDto> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        games: {
          include: {
            gamePlayerRanks: true,
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    return this.mapToResponseDto(event);
  }

  async update(id: string, updateEventDto: UpdateEventDto): Promise<EventResponseDto> {
    const existingEvent = await this.prisma.event.findUnique({
      where: { id },
    });

    if (!existingEvent) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    const updateData: any = {};

    if (updateEventDto.name !== undefined) {
      updateData.name = updateEventDto.name;
    }

    if (updateEventDto.date !== undefined) {
      updateData.date = new Date(updateEventDto.date);
    }

    if (updateEventDto.createdBy !== undefined) {
      // Validate that creator (player) exists
      const creator = await this.prisma.player.findUnique({
        where: { id: updateEventDto.createdBy },
      });

      if (!creator) {
        throw new NotFoundException(`Player with ID ${updateEventDto.createdBy} not found`);
      }

      updateData.createdBy = updateEventDto.createdBy;
    }

    if (updateEventDto.location !== undefined) {
      updateData.location = updateEventDto.location;
    }

    const event = await this.prisma.event.update({
      where: { id },
      data: updateData,
    });

    return this.mapToResponseDto(event);
  }

  async remove(id: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: { id: true, games: { select: { id: true } } },
    });

    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    const gameIds = event.games.map((game) => game.id);

    // Rank rows first: the FK is ON DELETE RESTRICT and would abort the games cascade.
    await this.prisma.$transaction(async (tx) => {
      await tx.gamePlayerRank.deleteMany({ where: { gameId: { in: gameIds } } });
      await tx.event.delete({ where: { id } });
    });

    // Nothing entered the rank chain.
    if (!gameIds.length) return;

    // rank is chained across games, so the whole chain is replayed. Outside the transaction
    // above - it opens its own per-game transactions.
    try {
      await this.rankingsService.agregateRankings();
    } catch (error) {
      console.error(
        `[Event Delete] Event ${id} was deleted but the ranking re-aggregation failed. ` +
          'player_stats and game_player_rank are mid-reset - re-run POST /rankings/agregate-rankings.',
        error,
      );
      throw error;
    }
  }

  private mapToResponseDto(event: any): EventResponseDto {
    const dto: EventResponseDto = {
      id: event.id,
      name: event.name,
      date: event.date,
      createdBy: event.createdBy || undefined,
      location: event.location,
      data: event.data as Record<string, string[]> | undefined,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      games: (event.games || []).map((game: any) => ({
        id: game.id,
        eventId: game.eventId,
        team1Player1Id: game.team1Player1Id,
        team1Player2Id: game.team1Player2Id,
        team2Player1Id: game.team2Player1Id,
        team2Player2Id: game.team2Player2Id,
        team1Points: game.team1Points,
        team2Points: game.team2Points,
        date: game.date,
        location: game.location,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
        gamePlayerRanks: (game.gamePlayerRanks || []).map((gamePlayerRank: any) => ({
          id: gamePlayerRank.id,
          gameId: gamePlayerRank.gameId,
          playerId: gamePlayerRank.playerId,
          rank: gamePlayerRank.rank,
          rankChange: gamePlayerRank.rankChange,
        })),
      })),
    };
    return dto;
  }

  private async validateTeamComposition(
    team1Player1Id: string,
    team1Player2Id: string,
    team2Player1Id: string,
    team2Player2Id: string,
  ): Promise<void> {
    // Check that team1 has 2 unique players
    if (team1Player1Id === team1Player2Id) {
      throw new BadRequestException('Team 1 must have 2 different players');
    }

    // Check that team2 has 2 unique players
    if (team2Player1Id === team2Player2Id) {
      throw new BadRequestException('Team 2 must have 2 different players');
    }

    // Check that no player is on both teams
    const team1Players = [team1Player1Id, team1Player2Id];
    const team2Players = [team2Player1Id, team2Player2Id];

    for (const playerId of team1Players) {
      if (team2Players.includes(playerId)) {
        throw new BadRequestException(`Player ${playerId} cannot be on both teams`);
      }
    }

    // Verify all players exist
    const allPlayerIds = [team1Player1Id, team1Player2Id, team2Player1Id, team2Player2Id];
    const uniquePlayerIds = [...new Set(allPlayerIds)];

    const players = await this.prisma.player.findMany({
      where: {
        id: {
          in: uniquePlayerIds,
        },
      },
    });

    if (players.length !== uniquePlayerIds.length) {
      const foundIds = players.map((p) => p.id);
      const missingIds = uniquePlayerIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException(`Players not found: ${missingIds.join(', ')}`);
    }
  }

  private async updatePlayerStatsForGame(tx: any, playerId: string, won: boolean): Promise<void> {
    await tx.playerStats.upsert({
      where: { playerId },
      create: {
        playerId,
        totalGames: 1,
        totalWins: won ? 1 : 0,
        totalLosses: won ? 0 : 1,
      },
      update: {
        totalGames: { increment: 1 },
        totalWins: won ? { increment: 1 } : undefined,
        totalLosses: won ? undefined : { increment: 1 },
      },
    });
  }
}

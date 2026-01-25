import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { CreateEventWithGamesDto } from './dto/create-event-with-games.dto';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async create(createEventDto: CreateEventDto): Promise<EventResponseDto> {
    // Validate that creator (player) exists
    const creator = await this.prisma.player.findUnique({
      where: { id: createEventDto.createdBy },
    });

    if (!creator) {
      throw new NotFoundException(
        `Player with ID ${createEventDto.createdBy} not found`,
      );
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

  async createWithGames(
    createEventWithGamesDto: CreateEventWithGamesDto,
  ): Promise<EventResponseDto> {
    // Validate creator if provided
    if (createEventWithGamesDto.createdBy) {
      const creator = await this.prisma.player.findUnique({
        where: { id: createEventWithGamesDto.createdBy },
      });

      if (!creator) {
        throw new NotFoundException(
          `Player with ID ${createEventWithGamesDto.createdBy} not found`,
        );
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

    // Validate places if provided
    if (createEventWithGamesDto.places) {
      await this.validatePlaces(createEventWithGamesDto.places);
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
      }

      const event = await tx.event.create({
        data: eventCreateData,
      });

      // Create all games and update player statistics
      const createdGames = [];
      for (const gameDto of createEventWithGamesDto.games) {
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
          },
        });

        // Update player statistics
        await this.updatePlayerStatsForGame(
          tx,
          gameDto.team1Player1Id,
          team1Won,
        );
        await this.updatePlayerStatsForGame(
          tx,
          gameDto.team1Player2Id,
          team1Won,
        );
        await this.updatePlayerStatsForGame(
          tx,
          gameDto.team2Player1Id,
          !team1Won,
        );
        await this.updatePlayerStatsForGame(
          tx,
          gameDto.team2Player2Id,
          !team1Won,
        );

        createdGames.push(game);
      }

      return { event, games: createdGames };
    });

    // Return event with games included
    return this.mapToResponseDto(result.event, true);
  }

  async findAll(): Promise<EventResponseDto[]> {
    const events = await this.prisma.event.findMany({
      orderBy: { date: 'desc' },
    });

    return events.map((event) => this.mapToResponseDto(event));
  }

  async findOne(
    id: string,
    includeGames = false,
    includeMembers = false,
  ): Promise<EventResponseDto> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        games: includeGames,
        eventMembers: includeMembers,
      },
    });

    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    return this.mapToResponseDto(event, includeGames, includeMembers);
  }

  async update(
    id: string,
    updateEventDto: UpdateEventDto,
  ): Promise<EventResponseDto> {
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
        throw new NotFoundException(
          `Player with ID ${updateEventDto.createdBy} not found`,
        );
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
    });

    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    await this.prisma.event.delete({
      where: { id },
    });
  }

  private mapToResponseDto(
    event: any,
    includeGames = false,
    includeMembers = false,
  ): EventResponseDto {
    const dto: EventResponseDto = {
      id: event.id,
      name: event.name,
      date: event.date,
      createdBy: event.createdBy || undefined,
      location: event.location,
      data: event.data as Record<string, string> | undefined,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };

    if (includeGames && event.games) {
      dto.games = event.games.map((game: any) => ({
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
      }));
    }

    if (includeMembers && event.eventMembers) {
      dto.members = event.eventMembers.map((member: any) => ({
        id: member.id,
        userId: member.userId,
        eventId: member.eventId,
        createdAt: member.createdAt,
      }));
    }

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
      throw new BadRequestException(
        'Team 1 must have 2 different players',
      );
    }

    // Check that team2 has 2 unique players
    if (team2Player1Id === team2Player2Id) {
      throw new BadRequestException(
        'Team 2 must have 2 different players',
      );
    }

    // Check that no player is on both teams
    const team1Players = [team1Player1Id, team1Player2Id];
    const team2Players = [team2Player1Id, team2Player2Id];

    for (const playerId of team1Players) {
      if (team2Players.includes(playerId)) {
        throw new BadRequestException(
          `Player ${playerId} cannot be on both teams`,
        );
      }
    }

    // Verify all players exist
    const allPlayerIds = [
      team1Player1Id,
      team1Player2Id,
      team2Player1Id,
      team2Player2Id,
    ];
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
      const missingIds = uniquePlayerIds.filter(
        (id) => !foundIds.includes(id),
      );
      throw new NotFoundException(
        `Players not found: ${missingIds.join(', ')}`,
      );
    }
  }

  private async updatePlayerStatsForGame(
    tx: any,
    playerId: string,
    won: boolean,
  ): Promise<void> {
    await tx.player.update({
      where: { id: playerId },
      data: {
        totalGames: { increment: 1 },
        totalWins: won ? { increment: 1 } : undefined,
        totalLosses: won ? undefined : { increment: 1 },
      },
    });
  }

  private async validatePlaces(places: Record<string, string>): Promise<void> {
    // Extract all player IDs from places
    const playerIds = Object.values(places).filter((id) => id && id.trim() !== '');

    if (playerIds.length === 0) {
      return; // No places to validate
    }

    // Check for duplicate player IDs (same player can't have multiple places)
    const uniquePlayerIds = [...new Set(playerIds)];
    if (uniquePlayerIds.length !== playerIds.length) {
      throw new BadRequestException(
        'Each player can only have one tournament place',
      );
    }

    // Verify all player IDs exist
    const players = await this.prisma.player.findMany({
      where: {
        id: {
          in: uniquePlayerIds,
        },
      },
    });

    if (players.length !== uniquePlayerIds.length) {
      const foundIds = players.map((p) => p.id);
      const missingIds = uniquePlayerIds.filter(
        (id) => !foundIds.includes(id),
      );
      throw new NotFoundException(
        `Players not found for places: ${missingIds.join(', ')}`,
      );
    }
  }
}

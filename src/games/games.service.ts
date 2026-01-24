import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { GameResponseDto } from './dto/game-response.dto';

@Injectable()
export class GamesService {
  constructor(private prisma: PrismaService) {}

  async create(createGameDto: CreateGameDto): Promise<GameResponseDto> {
    // Validate team composition
    await this.validateTeamComposition(
      createGameDto.team1Player1Id,
      createGameDto.team1Player2Id,
      createGameDto.team2Player1Id,
      createGameDto.team2Player2Id,
    );

    // Validate event exists
    const event = await this.prisma.event.findUnique({
      where: { id: createGameDto.eventId },
    });

    if (!event) {
      throw new NotFoundException(
        `Event with ID ${createGameDto.eventId} not found`,
      );
    }

    const gameDate = new Date(createGameDto.date);

    // Create game and update player statistics in a transaction
    const game = await this.prisma.$transaction(async (tx) => {
      const newGame = await tx.game.create({
        data: {
          eventId: createGameDto.eventId,
          team1Player1Id: createGameDto.team1Player1Id,
          team1Player2Id: createGameDto.team1Player2Id,
          team2Player1Id: createGameDto.team2Player1Id,
          team2Player2Id: createGameDto.team2Player2Id,
          team1Points: createGameDto.team1Points,
          team2Points: createGameDto.team2Points,
          date: gameDate,
          location: createGameDto.location,
        },
      });

      // Determine winner by points
      const team1Won = createGameDto.team1Points > createGameDto.team2Points;

      // Update player statistics
      await this.updatePlayerStatsForGame(
        tx,
        createGameDto.team1Player1Id,
        team1Won,
      );
      await this.updatePlayerStatsForGame(
        tx,
        createGameDto.team1Player2Id,
        team1Won,
      );
      await this.updatePlayerStatsForGame(
        tx,
        createGameDto.team2Player1Id,
        !team1Won,
      );
      await this.updatePlayerStatsForGame(
        tx,
        createGameDto.team2Player2Id,
        !team1Won,
      );

      return newGame;
    });

    return this.mapToResponseDto(game);
  }

  async findAll(limit: number = 5): Promise<GameResponseDto[]> {
    const games = await this.prisma.game.findMany({
      orderBy: { date: 'desc' },
      take: limit,
    });

    return games.map((game) => this.mapToResponseDto(game));
  }

  async findOne(id: string): Promise<GameResponseDto> {
    const game = await this.prisma.game.findUnique({
      where: { id },
    });

    if (!game) {
      throw new NotFoundException(`Game with ID ${id} not found`);
    }

    return this.mapToResponseDto(game);
  }

  async update(
    id: string,
    updateGameDto: UpdateGameDto,
  ): Promise<GameResponseDto> {
    const existingGame = await this.prisma.game.findUnique({
      where: { id },
    });

    if (!existingGame) {
      throw new NotFoundException(`Game with ID ${id} not found`);
    }

    // If team composition is being updated, validate it
    if (
      updateGameDto.team1Player1Id ||
      updateGameDto.team1Player2Id ||
      updateGameDto.team2Player1Id ||
      updateGameDto.team2Player2Id
    ) {
      await this.validateTeamComposition(
        updateGameDto.team1Player1Id ?? existingGame.team1Player1Id,
        updateGameDto.team1Player2Id ?? existingGame.team1Player2Id,
        updateGameDto.team2Player1Id ?? existingGame.team2Player1Id,
        updateGameDto.team2Player2Id ?? existingGame.team2Player2Id,
      );
    }

    // If event is being updated, validate it exists
    const eventId = updateGameDto.eventId ?? existingGame.eventId;
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    const gameDate = updateGameDto.date
      ? new Date(updateGameDto.date)
      : existingGame.date;

    // Update game and recalculate statistics in a transaction
    const updatedGame = await this.prisma.$transaction(async (tx) => {
      // First, revert old statistics
      const oldTeam1Won = existingGame.team1Points > existingGame.team2Points;
      await this.revertPlayerStatsForGame(
        tx,
        existingGame.team1Player1Id,
        oldTeam1Won,
      );
      await this.revertPlayerStatsForGame(
        tx,
        existingGame.team1Player2Id,
        oldTeam1Won,
      );
      await this.revertPlayerStatsForGame(
        tx,
        existingGame.team2Player1Id,
        !oldTeam1Won,
      );
      await this.revertPlayerStatsForGame(
        tx,
        existingGame.team2Player2Id,
        !oldTeam1Won,
      );

      // Update game
      const updateData: any = {};
      if (updateGameDto.eventId !== undefined)
        updateData.eventId = updateGameDto.eventId;
      if (updateGameDto.team1Player1Id !== undefined)
        updateData.team1Player1Id = updateGameDto.team1Player1Id;
      if (updateGameDto.team1Player2Id !== undefined)
        updateData.team1Player2Id = updateGameDto.team1Player2Id;
      if (updateGameDto.team2Player1Id !== undefined)
        updateData.team2Player1Id = updateGameDto.team2Player1Id;
      if (updateGameDto.team2Player2Id !== undefined)
        updateData.team2Player2Id = updateGameDto.team2Player2Id;
      if (updateGameDto.team1Points !== undefined)
        updateData.team1Points = updateGameDto.team1Points;
      if (updateGameDto.team2Points !== undefined)
        updateData.team2Points = updateGameDto.team2Points;
      if (updateGameDto.date !== undefined)
        updateData.date = new Date(updateGameDto.date);
      if (updateGameDto.location !== undefined)
        updateData.location = updateGameDto.location;

      const game = await tx.game.update({
        where: { id },
        data: updateData,
      });

      // Apply new statistics
      const newTeam1Won = game.team1Points > game.team2Points;
      await this.updatePlayerStatsForGame(
        tx,
        game.team1Player1Id,
        newTeam1Won,
      );
      await this.updatePlayerStatsForGame(
        tx,
        game.team1Player2Id,
        newTeam1Won,
      );
      await this.updatePlayerStatsForGame(
        tx,
        game.team2Player1Id,
        !newTeam1Won,
      );
      await this.updatePlayerStatsForGame(
        tx,
        game.team2Player2Id,
        !newTeam1Won,
      );

      return game;
    });

    return this.mapToResponseDto(updatedGame);
  }

  async remove(id: string): Promise<void> {
    const game = await this.prisma.game.findUnique({
      where: { id },
    });

    if (!game) {
      throw new NotFoundException(`Game with ID ${id} not found`);
    }

    // Delete game and revert statistics in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Revert statistics
      const team1Won = game.team1Points > game.team2Points;
      await this.revertPlayerStatsForGame(
        tx,
        game.team1Player1Id,
        team1Won,
      );
      await this.revertPlayerStatsForGame(
        tx,
        game.team1Player2Id,
        team1Won,
      );
      await this.revertPlayerStatsForGame(
        tx,
        game.team2Player1Id,
        !team1Won,
      );
      await this.revertPlayerStatsForGame(
        tx,
        game.team2Player2Id,
        !team1Won,
      );

      // Delete game
      await tx.game.delete({
        where: { id },
      });
    });
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

  private async revertPlayerStatsForGame(
    tx: any,
    playerId: string,
    won: boolean,
  ): Promise<void> {
    await tx.player.update({
      where: { id: playerId },
      data: {
        totalGames: { decrement: 1 },
        totalWins: won ? { decrement: 1 } : undefined,
        totalLosses: won ? undefined : { decrement: 1 },
      },
    });
  }

  private mapToResponseDto(game: any): GameResponseDto {
    return {
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
    };
  }
}

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { PlayerResponseDto } from './dto/player-response.dto';
import { EventResponseDto } from '../events/dto/event-response.dto';

@Injectable()
export class PlayersService {
  constructor(private prisma: PrismaService) {}

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

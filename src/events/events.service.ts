import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventResponseDto } from './dto/event-response.dto';

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
      createdBy: event.createdBy,
      location: event.location,
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
        team1Sets: game.team1Sets,
        team2Sets: game.team2Sets,
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
}

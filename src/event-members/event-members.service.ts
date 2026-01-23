import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventMemberDto } from './dto/create-event-member.dto';
import { EventMemberResponseDto } from './dto/event-member-response.dto';
import { EventMemberNotFoundException } from '../common/exceptions/event-member-not-found.exception';
import { DuplicateEventMemberException } from '../common/exceptions/duplicate-event-member.exception';

@Injectable()
export class EventMembersService {
  constructor(private prisma: PrismaService) {}

  async create(
    createEventMemberDto: CreateEventMemberDto,
  ): Promise<EventMemberResponseDto> {
    // Validate player exists
    const player = await this.prisma.player.findUnique({
      where: { id: createEventMemberDto.userId },
    });

    if (!player) {
      throw new NotFoundException(
        `Player with ID ${createEventMemberDto.userId} not found`,
      );
    }

    // Validate event exists
    const event = await this.prisma.event.findUnique({
      where: { id: createEventMemberDto.eventId },
    });

    if (!event) {
      throw new NotFoundException(
        `Event with ID ${createEventMemberDto.eventId} not found`,
      );
    }

    // Check for duplicate registration
    const existingMember = await this.prisma.eventMember.findUnique({
      where: {
        userId_eventId: {
          userId: createEventMemberDto.userId,
          eventId: createEventMemberDto.eventId,
        },
      },
    });

    if (existingMember) {
      throw new DuplicateEventMemberException(
        createEventMemberDto.userId,
        createEventMemberDto.eventId,
      );
    }

    const eventMember = await this.prisma.eventMember.create({
      data: {
        userId: createEventMemberDto.userId,
        eventId: createEventMemberDto.eventId,
      },
    });

    return this.mapToResponseDto(eventMember);
  }

  async findByEvent(eventId: string): Promise<EventMemberResponseDto[]> {
    const eventMembers = await this.prisma.eventMember.findMany({
      where: { eventId },
      include: {
        player: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return eventMembers.map((member) => this.mapToResponseDto(member, true));
  }

  async findByPlayer(userId: string): Promise<EventMemberResponseDto[]> {
    const eventMembers = await this.prisma.eventMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return eventMembers.map((member) => this.mapToResponseDto(member));
  }

  async remove(id: string): Promise<void> {
    const eventMember = await this.prisma.eventMember.findUnique({
      where: { id },
    });

    if (!eventMember) {
      throw new EventMemberNotFoundException(id);
    }

    await this.prisma.eventMember.delete({
      where: { id },
    });
  }

  async removeByEventAndPlayer(eventId: string, userId: string): Promise<void> {
    const eventMember = await this.prisma.eventMember.findUnique({
      where: {
        userId_eventId: {
          userId,
          eventId,
        },
      },
    });

    if (!eventMember) {
      throw new EventMemberNotFoundException();
    }

    await this.prisma.eventMember.delete({
      where: {
        userId_eventId: {
          userId,
          eventId,
        },
      },
    });
  }

  private mapToResponseDto(
    eventMember: any,
    includeRelations = false,
  ): EventMemberResponseDto {
    const dto: EventMemberResponseDto = {
      id: eventMember.id,
      userId: eventMember.userId,
      eventId: eventMember.eventId,
      createdAt: eventMember.createdAt,
    };

    if (includeRelations) {
      if (eventMember.player) {
        dto.player = {
          id: eventMember.player.id,
          tgId: eventMember.player.tgId,
          name: eventMember.player.name,
          avatar: eventMember.player.avatar,
          gender: eventMember.player.gender,
          active: eventMember.player.active,
          totalGames: eventMember.player.totalGames,
          totalWins: eventMember.player.totalWins,
          totalLosses: eventMember.player.totalLosses,
          createdAt: eventMember.player.createdAt,
          updatedAt: eventMember.player.updatedAt,
        };
      }

      if (eventMember.event) {
        dto.event = {
          id: eventMember.event.id,
          name: eventMember.event.name,
          date: eventMember.event.date,
          createdBy: eventMember.event.createdBy,
          location: eventMember.event.location,
          createdAt: eventMember.event.createdAt,
          updatedAt: eventMember.event.updatedAt,
        };
      }
    }

    return dto;
  }
}

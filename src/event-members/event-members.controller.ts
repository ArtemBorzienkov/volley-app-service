import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EventMembersService } from './event-members.service';
import { CreateEventMemberDto } from './dto/create-event-member.dto';
import { EventMemberResponseDto } from './dto/event-member-response.dto';

@Controller('event-members')
export class EventMembersController {
  constructor(private readonly eventMembersService: EventMembersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createEventMemberDto: CreateEventMemberDto,
  ): Promise<EventMemberResponseDto> {
    return this.eventMembersService.create(createEventMemberDto);
  }

  @Get('event/:eventId')
  async findByEvent(
    @Param('eventId') eventId: string,
  ): Promise<EventMemberResponseDto[]> {
    return this.eventMembersService.findByEvent(eventId);
  }

  @Get('player/:userId')
  async findByPlayer(
    @Param('userId') userId: string,
  ): Promise<EventMemberResponseDto[]> {
    return this.eventMembersService.findByPlayer(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.eventMembersService.remove(id);
  }

  @Delete('event/:eventId/player/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeByEventAndPlayer(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.eventMembersService.removeByEventAndPlayer(eventId, userId);
  }
}

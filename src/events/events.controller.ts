import { Controller, Get, Post, Body, Patch, Param, Delete, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { CreateEventWithGamesDto } from './dto/create-event-with-games.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createEventDto: CreateEventDto): Promise<EventResponseDto> {
    return this.eventsService.create(createEventDto);
  }

  @Post('with-games')
  @HttpCode(HttpStatus.CREATED)
  async createWithGames(@Body() createEventWithGamesDto: CreateEventWithGamesDto): Promise<EventResponseDto> {
    return this.eventsService.createWithGames(createEventWithGamesDto);
  }

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('type') type?: 'all' | 'tournament' | 'training',
  ): Promise<{ events: EventResponseDto[]; page: number; hasMore: boolean; totalEvents: number }> {
    return this.eventsService.findAll(+page || 1, type);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<EventResponseDto> {
    return this.eventsService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateEventDto: UpdateEventDto): Promise<EventResponseDto> {
    return this.eventsService.update(id, updateEventDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.eventsService.remove(id);
  }
}

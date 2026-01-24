import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
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
  async createWithGames(
    @Body() createEventWithGamesDto: CreateEventWithGamesDto,
  ): Promise<EventResponseDto> {
    return this.eventsService.createWithGames(createEventWithGamesDto);
  }

  @Get()
  async findAll(): Promise<EventResponseDto[]> {
    return this.eventsService.findAll();
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Query('includeGames') includeGames?: string,
    @Query('includeMembers') includeMembers?: string,
  ): Promise<EventResponseDto> {
    return this.eventsService.findOne(
      id,
      includeGames === 'true',
      includeMembers === 'true',
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateEventDto: UpdateEventDto,
  ): Promise<EventResponseDto> {
    return this.eventsService.update(id, updateEventDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.eventsService.remove(id);
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PlayersService } from './players.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { PlayerResponseDto } from './dto/player-response.dto';
import { FullPlayerResponseDto } from './dto/full-player-response.dto';
import { EventResponseDto } from '../events/dto/event-response.dto';

@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createPlayerDto: CreatePlayerDto,
  ): Promise<PlayerResponseDto> {
    return this.playersService.create(createPlayerDto);
  }

  @Get()
  async findAllActive(): Promise<PlayerResponseDto[]> {
    return this.playersService.findAllActive();
  }

  @Get('full')
  async findAllFull(): Promise<FullPlayerResponseDto[]> {
    return this.playersService.findAllFull();
  }

  @Get(':id/events')
  async getPlayerEvents(@Param('id') id: string): Promise<EventResponseDto[]> {
    return this.playersService.getPlayerEvents(id);
  }
}

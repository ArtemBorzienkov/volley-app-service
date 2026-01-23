import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { GamesService } from './games.service';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { GameResponseDto } from './dto/game-response.dto';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createGameDto: CreateGameDto): Promise<GameResponseDto> {
    return this.gamesService.create(createGameDto);
  }

  @Get()
  async findAll(): Promise<GameResponseDto[]> {
    return this.gamesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<GameResponseDto> {
    return this.gamesService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateGameDto: UpdateGameDto,
  ): Promise<GameResponseDto> {
    return this.gamesService.update(id, updateGameDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.gamesService.remove(id);
  }
}

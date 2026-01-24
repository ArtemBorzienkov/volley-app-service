import {
  IsString,
  IsDateString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreateGameDto {
  @IsString()
  team1Player1Id: string;

  @IsString()
  team1Player2Id: string;

  @IsString()
  team2Player1Id: string;

  @IsString()
  team2Player2Id: string;

  @IsInt()
  @Min(0)
  team1Points: number;

  @IsInt()
  @Min(0)
  team2Points: number;
}

export class CreateEventWithGamesDto {
  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGameDto)
  games: CreateGameDto[];
}

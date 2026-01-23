import {
  IsString,
  IsInt,
  IsDateString,
  IsOptional,
  Min,
  IsArray,
  ArrayUnique,
} from 'class-validator';

export class CreateGameDto {
  @IsString()
  eventId: string;

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
  team1Sets: number;

  @IsInt()
  @Min(0)
  team2Sets: number;

  @IsInt()
  @Min(0)
  team1Points: number;

  @IsInt()
  @Min(0)
  team2Points: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  location?: string;
}

import {
  IsString,
  IsInt,
  IsDateString,
  IsOptional,
  Min,
} from 'class-validator';

export class UpdateGameDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  team1Player1Id?: string;

  @IsOptional()
  @IsString()
  team1Player2Id?: string;

  @IsOptional()
  @IsString()
  team2Player1Id?: string;

  @IsOptional()
  @IsString()
  team2Player2Id?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  team1Sets?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  team2Sets?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  team1Points?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  team2Points?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

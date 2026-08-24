import { IsString, IsDateString, IsOptional, IsArray, IsInt } from 'class-validator';

export class CreateOngoingEventDto {
  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsArray()
  teams?: Array<{ player1Id: string; player2Id: string }>;

  @IsOptional()
  @IsInt()
  maxTeams?: number;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  scheme?: string;

  @IsOptional()
  @IsInt()
  groupCount?: number;

  @IsOptional()
  @IsInt()
  qualifiersPerGroup?: number;
}

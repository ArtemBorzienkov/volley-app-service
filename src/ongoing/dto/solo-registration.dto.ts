import { IsArray, IsOptional, IsString } from 'class-validator';

export class AddSoloPlayerDto {
  @IsOptional()
  @IsString()
  playerId?: string;
}

export class FormTeamsFromSoloDto {
  @IsArray()
  teams: Array<{ player1Id: string; player2Id: string }>;
}

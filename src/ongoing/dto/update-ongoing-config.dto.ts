import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateOngoingConfigDto {
  @IsInt()
  gamesPerPair: number;

  @IsInt()
  courts: number;

  @IsOptional()
  @IsInt()
  maxTeams?: number;

  @IsOptional()
  @IsString()
  scheme?: string;

  @IsOptional()
  @IsInt()
  groupCount?: number;

  @IsOptional()
  @IsInt()
  qualifiersPerGroup?: number;

  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @IsBoolean()
  allowSoloRegistration?: boolean;
}

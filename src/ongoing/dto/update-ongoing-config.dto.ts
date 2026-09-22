import { IsArray, IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

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
  @IsInt()
  rotationRounds?: number;

  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @IsBoolean()
  allowSoloRegistration?: boolean;

  /** Pairs cannot register at all; implies allowSoloRegistration, which the service forces on. */
  @IsOptional()
  @IsBoolean()
  soloOnlyRegistration?: boolean;

  /**
   * Rule keys to leave off this tournament's Rules tab. The complete set every time — omitting the
   * field keeps what is stored, sending [] shows every rule again.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hiddenRules?: string[];
}

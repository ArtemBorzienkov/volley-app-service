import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Matches, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NewPlayerDto } from './new-player.dto';

export class CreateUserDto {
  @IsEmail()
  email: string;

  /**
   * Optional — the only identity field sign-up asks for, and it is there so organisers can reach
   * players. Telegram's own rule for usernames is 5–32 characters of letters, digits and
   * underscores; a leading @ is accepted here and stripped before storing.
   */
  @IsOptional()
  @IsString()
  @Matches(/^@?[A-Za-z0-9_]{5,32}$/, {
    message: 'telegramNickname must be 5-32 letters, digits or underscores',
  })
  telegramNickname?: string;

  @IsString()
  @MinLength(8)
  password: string;

  /**
   * Consent to the processing described in the privacy notice. Required: results are published under
   * a player's name, and GDPR art. 6(1)(a) needs that agreed to before the account exists. The
   * instant it was given is stored so the controller can demonstrate it (art. 7(1)).
   */
  @IsBoolean()
  acceptDataProcessing: boolean;

  /** Opt out of having the name published unmasked. Stored as a preference; the name is not changed. */
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @IsOptional()
  @IsUUID()
  playerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewPlayerDto)
  newPlayer?: NewPlayerDto;
}

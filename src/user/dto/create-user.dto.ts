import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NewPlayerDto } from './new-player.dto';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewPlayerDto)
  newPlayer?: NewPlayerDto;
}

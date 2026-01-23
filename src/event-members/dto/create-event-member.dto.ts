import { IsString, IsNotEmpty } from 'class-validator';

export class CreateEventMemberDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  eventId: string;
}

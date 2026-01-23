import { PlayerResponseDto } from '../../players/dto/player-response.dto';
import { EventResponseDto } from '../../events/dto/event-response.dto';

export class EventMemberResponseDto {
  id: string;
  userId: string;
  eventId: string;
  createdAt: Date;
  player?: PlayerResponseDto;
  event?: EventResponseDto;
}

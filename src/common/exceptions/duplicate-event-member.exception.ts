import { ConflictException } from '@nestjs/common';

export class DuplicateEventMemberException extends ConflictException {
  constructor(userId: string, eventId: string) {
    super(
      `Player ${userId} is already registered for event ${eventId}`,
    );
  }
}

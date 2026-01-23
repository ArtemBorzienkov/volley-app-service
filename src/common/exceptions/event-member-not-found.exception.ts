import { NotFoundException } from '@nestjs/common';

export class EventMemberNotFoundException extends NotFoundException {
  constructor(id?: string) {
    super(
      id
        ? `Event member with ID ${id} not found`
        : 'Event member not found',
    );
  }
}

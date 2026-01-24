export class EventResponseDto {
  id: string;
  name: string;
  date: Date;
  createdBy?: string;
  location?: string;
  createdAt: Date;
  updatedAt: Date;
  games?: any[]; // GameResponseDto[] - avoiding circular dependency
  members?: any[]; // EventMemberResponseDto[] - avoiding circular dependency
}

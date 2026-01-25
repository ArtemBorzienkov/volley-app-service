export class EventResponseDto {
  id: string;
  name: string;
  date: Date;
  createdBy?: string;
  location?: string;
  data?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  games?: any[]; // GameResponseDto[] - avoiding circular dependency
  members?: any[]; // EventMemberResponseDto[] - avoiding circular dependency
}

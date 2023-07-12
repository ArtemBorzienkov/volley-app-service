export interface Config {
  id?: number;
  chat_id: string;
  coach_id: number;
  day: string;
  time: string;
  max: number;
  location: string;
  isForum: boolean;
  publish_day: string;
  topic_id: number;
}

export interface User {
  id: number;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  isPremium: boolean;
}

export interface Training {
  id?: number;
  configId: number;
  date: number;
  msg?: number;
  maxMembers?: number;
}

export interface TrainingMember {
  id: number;
  userId: number;
  trainingId: number;
  createdAt: number;
  isInvited: boolean;
}

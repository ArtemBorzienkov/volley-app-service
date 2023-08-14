export interface Config {
  id: string;
  chat_id: string;
  chat_title: string;
  coach_id: string;
  day: string;
  time: string;
  max: number;
  location: string;
  isForum: boolean;
  publish_day: string;
  topic_id: number;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  isPremium: boolean;
}

export interface Training {
  id: string;
  configId: string;
  coachId: string;
  date: string;
  msg?: number;
  maxMembers?: number;
}

export interface TrainingMember {
  id: string;
  userId: string;
  trainingId: string;
  name: string;
  createdAt: number;
  isInvited: boolean;
}

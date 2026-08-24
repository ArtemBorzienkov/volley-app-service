import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PlayersModule } from './players/players.module';
import { EventsModule } from './events/events.module';
import { GamesModule } from './games/games.module';
import { EventMembersModule } from './event-members/event-members.module';
import { StatisticsModule } from './statistics/statistics.module';
import { RankingsModule } from './rankings/rankings.module';
import { OngoingModule } from './ongoing/ongoing.module';

@Module({
  imports: [
    PrismaModule,
    PlayersModule,
    EventsModule,
    GamesModule,
    EventMembersModule,
    StatisticsModule,
    RankingsModule,
    OngoingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

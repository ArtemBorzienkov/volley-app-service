import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PlayersModule } from './players/players.module';
import { EventsModule } from './events/events.module';
import { GamesModule } from './games/games.module';
import { EventMembersModule } from './event-members/event-members.module';
import { StatisticsModule } from './statistics/statistics.module';
import { RankingsModule } from './rankings/rankings.module';

@Module({
  imports: [
    PrismaModule,
    PlayersModule,
    EventsModule,
    GamesModule,
    EventMembersModule,
    StatisticsModule,
    RankingsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

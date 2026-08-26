import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { PlayersModule } from './players/players.module';
import { EventsModule } from './events/events.module';
import { GamesModule } from './games/games.module';
import { EventMembersModule } from './event-members/event-members.module';
import { StatisticsModule } from './statistics/statistics.module';
import { RankingsModule } from './rankings/rankings.module';
import { OngoingModule } from './ongoing/ongoing.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PlayersModule,
    EventsModule,
    GamesModule,
    EventMembersModule,
    StatisticsModule,
    RankingsModule,
    OngoingModule,
    UserModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

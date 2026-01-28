import { Module } from '@nestjs/common';
import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StatisticsModule } from '../statistics/statistics.module';

@Module({
  imports: [PrismaModule, StatisticsModule],
  controllers: [PlayersController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}

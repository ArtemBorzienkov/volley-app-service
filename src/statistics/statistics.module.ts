import { Module } from '@nestjs/common';
import { PlayerStatisticsService } from './player-statistics.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PlayerStatisticsService],
  exports: [PlayerStatisticsService],
})
export class StatisticsModule {}

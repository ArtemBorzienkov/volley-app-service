import { Module } from '@nestjs/common';
import { RankingsService } from './rankings.service';
import { RankingsController } from './rankings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StatisticsModule } from '../statistics/statistics.module';

@Module({
  imports: [PrismaModule, StatisticsModule],
  controllers: [RankingsController],
  providers: [RankingsService],
  exports: [RankingsService],
})
export class RankingsModule {}

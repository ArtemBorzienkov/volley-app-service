import { Module } from '@nestjs/common';
import { ConfigController } from './config/config.controller';
import { ConfigService } from './config/config.service';
import { TrainingController } from './training/training.controller';
import { TrainingService } from './training/Training.service';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [],
  controllers: [ConfigController, TrainingController],
  providers: [ConfigService, TrainingService, PrismaService],
})
export class AppModule {}

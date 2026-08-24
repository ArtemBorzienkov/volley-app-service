import { Module } from '@nestjs/common';
import { OngoingService } from './ongoing.service';
import { OngoingController } from './ongoing.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OngoingController],
  providers: [OngoingService],
  exports: [OngoingService],
})
export class OngoingModule {}

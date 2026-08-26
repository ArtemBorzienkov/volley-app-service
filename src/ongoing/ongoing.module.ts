import { Module } from '@nestjs/common';
import { OngoingService } from './ongoing.service';
import { OngoingController } from './ongoing.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { AuthGuardsModule } from '../auth-guards';

@Module({
  imports: [PrismaModule, UserModule, AuthGuardsModule],
  controllers: [OngoingController],
  providers: [OngoingService],
  exports: [OngoingService],
})
export class OngoingModule {}

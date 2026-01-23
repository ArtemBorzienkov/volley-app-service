import { Module } from '@nestjs/common';
import { EventMembersService } from './event-members.service';
import { EventMembersController } from './event-members.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EventMembersController],
  providers: [EventMembersService],
  exports: [EventMembersService],
})
export class EventMembersModule {}

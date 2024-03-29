import { Module } from '@nestjs/common';
import { ConfigController } from './config/config.controller';
import { ConfigService } from './config/config.service';
import { TrainingController } from './training/training.controller';
import { TrainingService } from './training/training.service';
import { PrismaService } from './prisma/prisma.service';
import { UserController } from './user/user.controller';
import { UserService } from './user/user.service';
import { MemberController } from './member/member.controller';
import { MemberService } from './member/member.service';
import { GroupController } from './group/group.controller';
import { GroupService } from './group/group.service';

@Module({
  imports: [],
  controllers: [
    ConfigController,
    TrainingController,
    UserController,
    MemberController,
    GroupController,
  ],
  providers: [
    ConfigService,
    TrainingService,
    PrismaService,
    UserService,
    MemberService,
    GroupService,
  ],
})
export class AppModule {}

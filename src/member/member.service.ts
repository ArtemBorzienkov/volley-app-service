import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { TrainingMember } from 'src/utils/types';

@Injectable()
export class MemberService {
  constructor(private prisma: PrismaService) {}

  async createMember(data: TrainingMember) {
    try {
      console.log(
        `[MEMBER] Creating new member by user: ${data.userId} for training ${data.trainingId}`,
      );
      const member = await this.prisma.trainingMember.create({ data });
      return member || {};
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }

  async deleteMember(id: number) {
    try {
      console.log(`[MEMBER] Delete member by id: ${id}`);
      const member = await this.prisma.trainingMember.delete({ where: { id } });
      return member || {};
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }
}

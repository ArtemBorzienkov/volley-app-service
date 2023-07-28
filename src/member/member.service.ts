import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { TrainingMember } from 'src/utils/types';

@Injectable()
export class MemberService {
  constructor(private prisma: PrismaService) {}

  async createMember(data: TrainingMember[]) {
    try {
      if (!data || data.length === 0) {
        return [];
      }
      console.log(
        `[MEMBER] Creating new member by user: ${data[0].userId} for training ${data[0].trainingId}`,
      );
      const member = await this.prisma.trainingMember.createMany({ data });
      return member || [];
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

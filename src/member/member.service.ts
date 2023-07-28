import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { TrainingMember } from 'src/utils/types';

@Injectable()
export class MemberService {
  constructor(private prisma: PrismaService) {}

  async createMember(data: TrainingMember[]): Promise<TrainingMember[]> {
    try {
      if (!data || data.length === 0) {
        return [];
      }
      const rootMemb = data[0];
      console.log(
        `[MEMBER] Creating new member by user: ${rootMemb.userId} for training ${rootMemb.trainingId}`,
      );
      await this.prisma.trainingMember.createMany({ data });
      const members = this.getMembersByTrainId(rootMemb.trainingId);
      return members || [];
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }

  async getMembersByTrainId(trainingId: number): Promise<TrainingMember[]> {
    try {
      console.log(`[MEMBER] Get members by train_id: ${trainingId}`);
      const members = await this.prisma.trainingMember.findMany({
        where: { trainingId },
      });
      return members || [];
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }

  async deleteMember(id: number): Promise<TrainingMember[]> {
    try {
      console.log(`[MEMBER] Delete member by id: ${id}`);
      const memberToRemove = await this.prisma.trainingMember.findUnique({
        where: { id },
      });
      await this.prisma.trainingMember.delete({ where: { id } });
      const members = this.getMembersByTrainId(memberToRemove.trainingId);
      return members || [];
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }
}

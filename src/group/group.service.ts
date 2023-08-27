import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Group } from 'src/utils/types';

@Injectable()
export class GroupService {
  constructor(private prisma: PrismaService) {}

  async createGroup(data: Group): Promise<Group> {
    try {
      console.log(`[GROUP] Creating new group: ${data.chat_title}`);
      const group = await this.prisma.group.create({ data });
      return group;
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create group');
    }
  }
}

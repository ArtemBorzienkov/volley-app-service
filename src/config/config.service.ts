import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Config } from 'src/utils/types';

@Injectable({})
export class ConfigService {
  constructor(private prisma: PrismaService) {}

  async createConfig(data: Config) {
    try {
      console.log(
        `[CONFIG] Creating new config for chat: ${data.chat_id}, coach is: ${data.coach_id}`,
      );
      const config = await this.prisma.configEvent.create({ data });
      return config || {};
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create config');
    }
  }

  async getConfig() {
    try {
      console.log('[CONFIG] Fetch all configs');
      const config = await this.prisma.configEvent.findMany();
      return config || {};
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot get config');
    }
  }

  async updateConfig(data: Config) {
    try {
      console.log(`[CONFIG] Update config by id: ${data.id}`);
      const config = await this.prisma.configEvent.update({
        where: { id: data.id },
        data,
      });
      return config || {};
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot update config');
    }
  }

  async deleteConfig(id: number) {
    try {
      console.log(`[CONFIG] Delete config by id: ${id}`);
      await this.prisma.configEvent.delete({
        where: { id },
      });
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot delete config');
    }
  }
}

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
      let config = [];
      config = await this.getConfigsByCoachId(data.coach_id);
      if (config.length === 0) {
        const newConfig = await this.prisma.configEvent.create({ data });
        config = [newConfig];
      }
      return config || {};
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create config');
    }
  }

  async getConfigsByCoachId(id: number): Promise<Config[]> {
    try {
      console.log('[CONFIG] Fetch all configs');
      const config = (await this.prisma.configEvent.findMany({
        where: { coach_id: id },
      })) as Config[];
      return config || [];
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot get config');
    }
  }

  async updateConfig(data: Config) {
    try {
      console.log(`[CONFIG] Update config by id: ${data.chat_id}`);
      const config = await this.prisma.configEvent.update({
        where: { chat_id: data.chat_id },
        data,
      });
      return config || {};
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot update config');
    }
  }

  async deleteConfig(chat_id: string) {
    try {
      console.log(`[CONFIG] Delete config by id: ${chat_id}`);
      await this.prisma.configEvent.delete({
        where: { chat_id },
      });
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot delete config');
    }
  }
}

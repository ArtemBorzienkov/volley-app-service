import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Config } from 'src/utils/types';

const uniqid = require('uniqid');

@Injectable({})
export class ConfigService {
  constructor(private prisma: PrismaService) {}

  async createConfig(data: Config) {
    try {
      console.log(
        `[CONFIG] Creating new config for chat: ${data.chat_id}, coach is: ${data.coach_id}`,
      );
      const newConfig = await this.prisma.configEvent.create({
        data: { ...data, id: uniqid() },
      });
      return newConfig;
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create config');
    }
  }

  async getAllConfigs(): Promise<Config[]> {
    try {
      console.log('[CONFIG] Get all configs');
      const config = (await this.prisma.configEvent.findMany()) as Config[];
      return config || [];
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot get all configs');
    }
  }

  async getConfigsByCoachId(id: string): Promise<Config[]> {
    try {
      console.log('[CONFIG] Get config by coach_id');
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

  async deleteConfigById(id: string) {
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

  async deleteConfigByChatId(chat_id: string) {
    try {
      console.log(`[CONFIG] Delete configs by chat_id: ${chat_id}`);
      await this.prisma.configEvent.deleteMany({
        where: { chat_id },
      });
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot delete config');
    }
  }
}

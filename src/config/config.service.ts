import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Config } from 'src/utils/types';

@Injectable({})
export class ConfigService {
  constructor(private prisma: PrismaService) {}

  async createConfig(data: Config) {
    try {
      const config = await this.prisma.configEvent.create({ data });
      return config;
    } catch (e) {
      throw new ForbiddenException('cannot create config');
    }
  }

  async getConfig() {
    try {
      const config = await this.prisma.configEvent.findMany();
      return config;
    } catch (e) {
      throw new ForbiddenException('cannot get config');
    }
  }

  async updateConfig(data: Config) {
    try {
      const config = await this.prisma.configEvent.update({
        where: { chat_id: data.chat_id, day: data.day },
        data,
      });
      return config;
    } catch (e) {
      throw new ForbiddenException('cannot update config');
    }
  }
}

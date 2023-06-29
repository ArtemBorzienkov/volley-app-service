import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable({})
export class ConfigService {
  constructor(private prisma: PrismaService) {}

  async getConfig() {
    try {
      const config = await this.prisma.configEvent.findMany({});
      return config;
    } catch (e) {
      console.log(
        '🚀 ~ file: config.service.ts:13 ~ ConfigService ~ getConfig ~ e):',
        e,
      );
      throw new ForbiddenException('cannot get config');
    }
  }
  updateConfig(): string {
    return 'upd some config';
  }
}

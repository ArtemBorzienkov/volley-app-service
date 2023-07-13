import { Controller, Get, Post, Put, Req, Delete, Query } from '@nestjs/common';
import { ConfigService } from './config.service';
import { Request } from 'express';

@Controller('/config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Post()
  createConfig(@Req() req: Request) {
    return this.configService.createConfig(req.body);
  }

  @Get()
  getConfigByCoachId(@Query() query: { id: string }) {
    return this.configService.getConfigsByCoachId(Number(query.id));
  }

  @Put()
  updateConfig(@Req() req: Request) {
    return this.configService.updateConfig(req.body);
  }

  @Delete()
  deleteConfig(@Query() query: { id: string }) {
    return this.configService.deleteConfig(query.id);
  }
}

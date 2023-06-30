import { Controller, Get, Post, Put, Req, Param } from '@nestjs/common';
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
  getConfig() {
    return this.configService.getConfig();
  }

  @Put()
  updateConfig(@Req() req: Request) {
    console.log(
      'req.params',
      req.params,
      'req.query',
      req.query,
      'req.body',
      req.body,
    );
    // return this.configService.updateConfig();
  }
}

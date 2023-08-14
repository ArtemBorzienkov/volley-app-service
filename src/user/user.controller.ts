import { Controller, Delete, Get, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { UserService } from './user.service';

@Controller('/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  createConfig(@Req() req: Request) {
    return this.userService.createUser(req.body);
  }

  @Get()
  getConfig(@Query() query: { id: string }) {
    return this.userService.getUserById(query.id);
  }

  @Put()
  updateConfig(@Req() req: Request) {
    return this.userService.updateUser(req.body);
  }

  @Delete()
  deleteConfig(@Query() query: { id: string }) {
    return this.userService.deleteUser(query.id);
  }
}

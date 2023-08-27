import { Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { GroupService } from './group.service';

@Controller('/group')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @Post()
  createMember(@Req() req: Request) {
    return this.groupService.createGroup(req.body);
  }
}

import { Controller, Delete, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { MemberService } from './member.service';

@Controller('/member')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Post()
  createMember(@Req() req: Request) {
    return this.memberService.createMember(req.body);
  }

  @Get()
  getMembersByTrainingId(@Query() query: { training_id: string }) {
    return this.memberService.getMembersByTrainId(query.training_id);
  }

  @Delete()
  deleteMember(@Query() query: { user_id: string; training_id: string }) {
    return this.memberService.deleteMember(query.user_id, query.training_id);
  }
}

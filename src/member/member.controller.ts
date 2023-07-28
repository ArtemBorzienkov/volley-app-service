import { Controller, Delete, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { MemberService } from './member.service';

@Controller('/member')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Post()
  createMember(@Req() req: Request) {
    return this.memberService.createMember(req.body);
  }

  @Delete()
  deleteMember(@Query() query: { user_id: string; training_id: string }) {
    return this.memberService.deleteMember(
      Number(query.user_id),
      Number(query.training_id),
    );
  }
}

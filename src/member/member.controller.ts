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
  deleteMember(@Query() query: { id: string }) {
    return this.memberService.deleteMember(Number(query.id));
  }
}

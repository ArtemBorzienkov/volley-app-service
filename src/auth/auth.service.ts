import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';
import { LogInDto } from './dto/log-in.dto';
import { JwtPayload, TokenBlocklistService } from '../auth-guards';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly tokenBlocklist: TokenBlocklistService,
  ) {}

  async logIn(dto: LogInDto): Promise<{ accessToken: string }> {
    const currUser = await this.userService.findByEmail(dto.email);
    if (!currUser) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordMatches = await bcrypt.compare(dto.password, currUser.password);
    if (!isPasswordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.userService.updateLastVisit(currUser.id);

    const accessToken = await this.jwtService.signAsync(
      { sub: currUser.id, email: currUser.email, role: currUser.role },
      { jwtid: randomUUID() },
    );

    return { accessToken };
  }

  /**
   * Rotate a valid token: confirm the user still exists, revoke the old token so it can't be
   * reused, and issue a fresh one with a new TTL.
   */
  async refreshJWT(payload: JwtPayload): Promise<{ accessToken: string }> {
    const user = await this.userService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { jwtid: randomUUID() },
    );

    this.tokenBlocklist.revoke(payload.jti);

    return { accessToken };
  }

  /** Revoke the token so it can no longer be used, even before it expires. */
  logOut(payload: JwtPayload): void {
    this.tokenBlocklist.revoke(payload.jti);
  }
}

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS,
  accessTokenCookieOptions,
  isProductionEnv,
} from './jwt.config';
import { JwtPayload } from './jwt-payload.interface';
import { TokenBlocklistService } from './token-blocklist.service';

export interface AuthedRequest extends Request {
  user: JwtPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tokenBlocklist: TokenBlocklistService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (this.tokenBlocklist.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const rotatedPayload = await this.refreshIfExpiringSoon(payload, response);

    request.user = rotatedPayload ?? payload;
    return true;
  }

  /**
   * Sliding session: if the token is within the refresh window of expiring, issue a fresh
   * one (new jti, full TTL) and set the new cookie on the response. Deliberately does NOT
   * revoke the old jti — this transparent rotation can fire on any guarded request, and
   * immediately revoking could 401 a concurrent request still holding the old cookie. The
   * old token has under ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS left anyway, so it simply
   * expires naturally. Returns the new payload so callers (e.g. an explicit refresh route)
   * operate on the current jti instead of a stale one.
   */
  private async refreshIfExpiringSoon(payload: JwtPayload, response: Response): Promise<JwtPayload | null> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const secondsToExpiry = payload.exp - nowSeconds;
    if (secondsToExpiry >= ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS) {
      return null;
    }

    const newToken = await this.jwtService.signAsync(
      { sub: payload.sub, email: payload.email, role: payload.role },
      { jwtid: randomUUID() },
    );
    const rotatedPayload = await this.jwtService.verifyAsync<JwtPayload>(newToken);

    const isProduction = isProductionEnv(this.configService);
    response.cookie(ACCESS_TOKEN_COOKIE, newToken, accessTokenCookieOptions(isProduction));

    return rotatedPayload;
  }
}

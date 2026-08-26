import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LogInDto } from './dto/log-in.dto';
import { ACCESS_TOKEN_COOKIE, accessTokenCookieOptions, isProductionEnv, JwtAuthGuard } from '../auth-guards';
import type { AuthedRequest, JwtPayload } from '../auth-guards';

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true }))
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  private get isProduction(): boolean {
    return isProductionEnv(this.configService);
  }

  @Post('log-in')
  @HttpCode(HttpStatus.OK)
  async logIn(@Body() dto: LogInDto, @Res({ passthrough: true }) res: Response): Promise<{ success: true }> {
    const { accessToken } = await this.authService.logIn(dto);
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, accessTokenCookieOptions(this.isProduction));
    return { success: true };
  }

  @Post('refresh-jwt')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async refreshJWT(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<{ success: true }> {
    const { accessToken } = await this.authService.refreshJWT(req.user);
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, accessTokenCookieOptions(this.isProduction));
    return { success: true };
  }

  // Idempotent: always clears the cookie, even when the token is already invalid/expired (so
  // the client can recover from a 401). Revokes the jti only when a still-valid token is present.
  @Post('log-out')
  @HttpCode(HttpStatus.OK)
  async logOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ success: true }> {
    const token = req.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;
    if (token) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
        this.authService.logOut(payload);
      } catch {
        // invalid/expired token — nothing to revoke, just clear the cookie
        console.log('Invalid/expired token');
      }
    }
    res.clearCookie(ACCESS_TOKEN_COOKIE, { ...accessTokenCookieOptions(this.isProduction), maxAge: undefined });
    return { success: true };
  }
}

import { ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';
import type { CookieOptions } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes
// When a token has less than this left, the guard rotates it transparently.
export const ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = 10 * 60; // 10 minutes

export const accessTokenCookieOptions = (isProduction: boolean): CookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: '/',
  maxAge: ACCESS_TOKEN_TTL_MS,
});

export const isProductionEnv = (config: ConfigService): boolean => {
  const nodeEnv = config.get<string>('NODE_ENV');
  return nodeEnv === 'production' || nodeEnv === 'prod';
};

export const handleJwtOptions = (config: ConfigService): JwtModuleOptions => {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret) {
    if (isProductionEnv(config)) {
      throw new Error('JWT_SECRET must be set when NODE_ENV is production/prod');
    }
    return { secret: 'dev-secret-change-me', signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS } };
  }
  return { secret, signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS } };
};

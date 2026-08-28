import { ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';
import type { CookieOptions } from 'express';

export const HOUR_IN_MS = 60 * 60 * 1000;
const DAY_IN_MS = 24 * HOUR_IN_MS;

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const ACCESS_TOKEN_TTL_MS = 3 * DAY_IN_MS; // 3 days
export const ACCESS_TOKEN_TTL_SECONDS = (3 * DAY_IN_MS) / 1000; // 3 days
// When a token has less than this left, the guard rotates it transparently.
export const ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = (1 * HOUR_IN_MS) / 1000; // 1 day

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

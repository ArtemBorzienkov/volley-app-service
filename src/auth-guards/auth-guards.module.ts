import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { handleJwtOptions } from './jwt.config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenBlocklistService } from './token-blocklist.service';

/**
 * Shared auth infrastructure (JWT verification, guard, token blocklist), kept apart from
 * AuthModule so feature modules (e.g. UserModule) can guard routes without a dependency cycle.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: handleJwtOptions,
    }),
  ],
  providers: [JwtAuthGuard, TokenBlocklistService],
  exports: [JwtAuthGuard, TokenBlocklistService, JwtModule],
})
export class AuthGuardsModule {}

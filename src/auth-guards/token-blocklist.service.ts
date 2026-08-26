import { Injectable } from '@nestjs/common';

const REVOKED_JWTS_CLEANUP_INTERVAL_MS = 1000 * 60 * 60 * 24; // 24 hours

@Injectable()
export class TokenBlocklistService {
  private readonly revokedJWTsMap = new Map<string, number>();

  constructor() {
    setInterval(() => {
      this.cleanup();
    }, REVOKED_JWTS_CLEANUP_INTERVAL_MS);
  }

  revoke(jti: string): void {
    const now = Date.now().valueOf();
    this.revokedJWTsMap.set(jti, now);
  }

  isRevoked(jti: string): boolean {
    return this.revokedJWTsMap.has(jti);
  }

  private cleanup(): void {
    const dayStart = new Date(Date.now()).setHours(0, 0, 0, 0).valueOf();
    this.revokedJWTsMap.forEach((timestamp, jti) =>
      timestamp < dayStart ? this.revokedJWTsMap.delete(jti) : null,
    );
  }
}

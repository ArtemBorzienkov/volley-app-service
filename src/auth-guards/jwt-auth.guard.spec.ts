import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const buildContext = (cookies: Record<string, string> = {}) => {
  const request: any = { cookies };
  const response: any = { cookie: jest.fn() };
  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as any,
    request,
    response,
  };
};

describe('JwtAuthGuard', () => {
  let jwtService: { verifyAsync: jest.Mock; signAsync: jest.Mock };
  let tokenBlocklist: { isRevoked: jest.Mock; revoke: jest.Mock };
  let configService: { get: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn(), signAsync: jest.fn() };
    tokenBlocklist = { isRevoked: jest.fn().mockReturnValue(false), revoke: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('development') };
    guard = new JwtAuthGuard(jwtService as any, tokenBlocklist as any, configService as any);
  });

  it('rejects a request with no access-token cookie', async () => {
    const { context } = buildContext();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid or expired token', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad token'));
    const { context } = buildContext({ access_token: 'bad' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token whose jti has been revoked', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'jane@example.com',
      role: 'player',
      jti: 'jti-1',
      iat: nowSeconds,
      exp: nowSeconds + 1800,
    });
    tokenBlocklist.isRevoked.mockReturnValue(true);
    const { context } = buildContext({ access_token: 'valid' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches the payload to the request and allows the request through', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-1',
      email: 'jane@example.com',
      role: 'player',
      jti: 'jti-1',
      iat: nowSeconds,
      exp: nowSeconds + 1800, // 30 minutes left — above the 10-minute refresh threshold
    };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const { context, request, response } = buildContext({ access_token: 'valid' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user).toEqual(payload);
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('rotates the cookie and updates request.user, without revoking the old jti, when the token is within the refresh threshold', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const oldPayload = {
      sub: 'user-1',
      email: 'jane@example.com',
      role: 'player',
      jti: 'jti-old',
      iat: nowSeconds - 1500,
      exp: nowSeconds + 300, // 5 minutes left — below the 10-minute refresh threshold
    };
    const newPayload = { ...oldPayload, jti: 'jti-new', iat: nowSeconds, exp: nowSeconds + 1800 };
    jwtService.verifyAsync.mockResolvedValueOnce(oldPayload).mockResolvedValueOnce(newPayload);
    jwtService.signAsync.mockResolvedValue('new-token');
    const { context, request, response } = buildContext({ access_token: 'valid' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { sub: 'user-1', email: 'jane@example.com', role: 'player' },
      { jwtid: expect.any(String) },
    );
    expect(tokenBlocklist.revoke).not.toHaveBeenCalled();
    expect(response.cookie).toHaveBeenCalledWith(
      'access_token',
      'new-token',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(request.user).toEqual(newPayload);
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { TokenBlocklistService } from '../auth-guards';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let userService: { findByEmail: jest.Mock; findById: jest.Mock; updateLastVisit: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let tokenBlocklist: { revoke: jest.Mock };

  beforeEach(async () => {
    userService = { findByEmail: jest.fn(), findById: jest.fn(), updateLastVisit: jest.fn() };
    jwtService = { signAsync: jest.fn() };
    tokenBlocklist = { revoke: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: TokenBlocklistService, useValue: tokenBlocklist },
      ],
    }).compile();

    service = module.get(AuthService);
    jest.clearAllMocks();
  });

  describe('logIn', () => {
    const dto = { email: 'jane@example.com', password: 'secret123' };
    const user = { id: 'user-1', email: 'jane@example.com', password: 'hashed-password', role: 'player' };

    it('issues an access token and bumps lastVisit on valid credentials', async () => {
      userService.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync.mockResolvedValue('token-123');

      const result = await service.logIn(dto);

      expect(bcrypt.compare).toHaveBeenCalledWith('secret123', 'hashed-password');
      expect(userService.updateLastVisit).toHaveBeenCalledWith('user-1');
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'jane@example.com', role: 'player' },
        { jwtid: expect.any(String) },
      );
      expect(result).toEqual({ accessToken: 'token-123' });
    });

    it('throws UnauthorizedException when the email is unknown', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(service.logIn(dto)).rejects.toThrow(UnauthorizedException);
      expect(userService.updateLastVisit).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the password does not match', async () => {
      userService.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.logIn(dto)).rejects.toThrow(UnauthorizedException);
      expect(userService.updateLastVisit).not.toHaveBeenCalled();
    });
  });

  describe('refreshJWT', () => {
    const payload = { sub: 'user-1', email: 'jane@example.com', role: 'player', jti: 'jti-old', iat: 0, exp: 0 };

    it('issues a new token and revokes the old jti', async () => {
      userService.findById.mockResolvedValue({ id: 'user-1', email: 'jane@example.com', role: 'admin' });
      jwtService.signAsync.mockResolvedValue('token-new');

      const result = await service.refreshJWT(payload);

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'jane@example.com', role: 'admin' },
        { jwtid: expect.any(String) },
      );
      expect(tokenBlocklist.revoke).toHaveBeenCalledWith('jti-old');
      expect(result).toEqual({ accessToken: 'token-new' });
    });

    it('throws UnauthorizedException when the user no longer exists', async () => {
      userService.findById.mockResolvedValue(null);

      await expect(service.refreshJWT(payload)).rejects.toThrow(UnauthorizedException);
      expect(tokenBlocklist.revoke).not.toHaveBeenCalled();
    });
  });

  describe('logOut', () => {
    it('revokes the jti', () => {
      service.logOut({ sub: 'user-1', email: 'jane@example.com', role: 'player', jti: 'jti-1', iat: 0, exp: 0 });

      expect(tokenBlocklist.revoke).toHaveBeenCalledWith('jti-1');
    });
  });
});

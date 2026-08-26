import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcrypt');

const buildUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'jane@example.com',
  name: 'Jane',
  password: 'hashed-password',
  playerId: null,
  lastVisit: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('UserService', () => {
  let service: UserService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    player: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      player: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UserService);
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    const dto = { email: 'jane@example.com', name: 'Jane', password: 'secret123' };

    it('throws ConflictException when the email is already in use', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(service.createUser({ ...dto, playerId: 'player-1' })).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the given playerId does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.player.findUnique.mockResolvedValue(null);

      await expect(service.createUser({ ...dto, playerId: 'player-1' })).rejects.toThrow(NotFoundException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the given playerId is already linked to another account', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // email lookup
        .mockResolvedValueOnce(buildUser({ id: 'user-2', playerId: 'player-1' })); // playerId lookup
      prisma.player.findUnique.mockResolvedValue({ id: 'player-1' });

      await expect(service.createUser({ ...dto, playerId: 'player-1' })).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('hashes the password and links the given playerId when it exists and is unclaimed', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.player.findUnique.mockResolvedValue({ id: 'player-1' });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(buildUser({ playerId: 'player-1' }));

      const result = await service.createUser({ ...dto, playerId: 'player-1' });

      expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'jane@example.com', name: 'Jane', password: 'hashed-password', playerId: 'player-1' },
      });
      expect(result).toEqual({
        id: 'user-1',
        email: 'jane@example.com',
        name: 'Jane',
        playerId: 'player-1',
        createdAt: buildUser().createdAt,
      });
    });

    it('throws BadRequestException when neither playerId nor newPlayer is given', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createUser(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when both playerId and newPlayer are given', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createUser({ ...dto, playerId: 'player-1', newPlayer: { name: 'Jane', gender: 'female' } }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a new player and links it, transactionally, when newPlayer is given', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      const createdPlayer = { id: 'player-new' };
      const tx = {
        player: { create: jest.fn().mockResolvedValue(createdPlayer) },
        user: { create: jest.fn().mockResolvedValue(buildUser({ playerId: 'player-new' })) },
      };
      prisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      const result = await service.createUser({ ...dto, newPlayer: { name: 'Jane', gender: 'female' } });

      expect(tx.player.create).toHaveBeenCalledWith({
        data: {
          name: 'Jane',
          gender: 'female',
          active: true,
          playerStats: { create: { totalGames: 0, totalWins: 0, totalLosses: 0 } },
        },
      });
      expect(tx.user.create).toHaveBeenCalledWith({
        data: { email: 'jane@example.com', name: 'Jane', password: 'hashed-password', playerId: 'player-new' },
      });
      expect(result.playerId).toBe('player-new');
    });
  });

  describe('findByEmail', () => {
    it('looks the user up by email', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(service.findByEmail('jane@example.com')).resolves.toBe(user);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'jane@example.com' } });
    });
  });

  describe('findById', () => {
    it('looks the user up by id', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(service.findById('user-1')).resolves.toBe(user);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
  });

  describe('updateLastVisit', () => {
    it('updates lastVisit to a Date', async () => {
      prisma.user.update.mockResolvedValue(buildUser());

      await service.updateLastVisit('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lastVisit: expect.any(Date) },
      });
    });
  });

  describe('getCurrentUser', () => {
    it('returns the user without the password', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      const result = await service.getCurrentUser('user-1');

      expect(result).not.toHaveProperty('password');
      expect(result).toMatchObject({ id: 'user-1', email: 'jane@example.com' });
    });

    it('throws NotFoundException when the user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentUser('nope')).rejects.toThrow(NotFoundException);
    });
  });
});

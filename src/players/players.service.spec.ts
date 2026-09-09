import { Test, TestingModule } from '@nestjs/testing';
import { PlayersService } from './players.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlayerStatisticsService } from '../statistics/player-statistics.service';

const playerRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  tgId: null,
  name: 'Artem Borzienkov',
  avatar: null,
  gender: 'male',
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  playerStats: { totalGames: 4, totalWins: 3, totalLosses: 1, rank: 1200 },
  user: null,
  ...overrides,
});

describe('PlayersService anonymity flag', () => {
  let service: PlayersService;
  let prisma: { player: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      player: {
        findMany: jest.fn(async () => [playerRow()]),
        findUnique: jest.fn(async () => playerRow()),
        create: jest.fn(async () => playerRow()),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlayerStatisticsService, useValue: {} },
      ],
    }).compile();

    service = module.get(PlayersService);
  });

  it('selects the linked account alongside the stats, so the flag is available to map', async () => {
    await service.findAllActive();

    expect(prisma.player.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { playerStats: true, user: { select: { isAnonymous: true } } },
      }),
    );
  });

  it('reports a player whose account opted out as anonymous', async () => {
    prisma.player.findMany = jest.fn(async () => [playerRow({ user: { isAnonymous: true } })]);

    const [player] = await service.findAllActive();

    expect(player.isAnonymous).toBe(true);
  });

  it('returns the stored name unchanged: masking is the client’s job', async () => {
    prisma.player.findMany = jest.fn(async () => [playerRow({ user: { isAnonymous: true } })]);

    const [player] = await service.findAllActive();

    // The flag travels; the name does not get rewritten on the way out.
    expect(player.name).toBe('Artem Borzienkov');
  });

  it('reports a player whose account did not opt out as not anonymous', async () => {
    prisma.player.findMany = jest.fn(async () => [playerRow({ user: { isAnonymous: false } })]);

    const [player] = await service.findAllActive();

    expect(player.isAnonymous).toBe(false);
  });

  it('treats a player with no account at all as not anonymous', async () => {
    const [player] = await service.findAllActive();

    expect(player.isAnonymous).toBe(false);
  });
});

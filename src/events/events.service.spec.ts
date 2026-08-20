import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RankingsService } from '../rankings/rankings.service';

// Records every DB operation in order, so the tests can assert the sequence: rank rows
// before the event (the FK is ON DELETE RESTRICT), replay only after the commit.
function buildHarness() {
  const calls: string[] = [];

  const tx = {
    gamePlayerRank: {
      deleteMany: jest.fn(async () => {
        calls.push('tx.gamePlayerRank.deleteMany');
        return { count: 0 };
      }),
    },
    event: {
      delete: jest.fn(async () => {
        calls.push('tx.event.delete');
        return {};
      }),
    },
  };

  const prisma = {
    event: {
      findUnique: jest.fn(async () => null as any),
      // Mirrors the real PrismaClient: a non-transactional delete exists, so calling it
      // shows up as a wrong-order failure rather than a TypeError.
      delete: jest.fn(async () => {
        calls.push('prisma.event.delete (outside transaction)');
        return {};
      }),
    },
    $transaction: jest.fn(async (cb: any) => {
      calls.push('transaction:begin');
      const result = await cb(tx);
      calls.push('transaction:commit');
      return result;
    }),
  };

  const rankings = {
    // Resolves on a later tick, so "awaited" differs from "fired off".
    agregateRankings: jest.fn(async () => {
      calls.push('agregateRankings:start');
      await new Promise((resolve) => setImmediate(resolve));
      calls.push('agregateRankings:finish');
    }),
  };

  return { calls, tx, prisma, rankings };
}

describe('EventsService.remove', () => {
  let service: EventsService;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(async () => {
    harness = buildHarness();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: harness.prisma },
        { provide: RankingsService, useValue: harness.rankings },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('rejects an unknown event id without touching the database or the rankings', async () => {
    harness.prisma.event.findUnique.mockResolvedValue(null);

    await expect(service.remove('missing-event')).rejects.toThrow(
      new NotFoundException('Event with ID missing-event not found'),
    );

    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.rankings.agregateRankings).not.toHaveBeenCalled();
  });

  it("deletes the rank rows of exactly the event's games before deleting the event", async () => {
    harness.prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      games: [{ id: 'game-a' }, { id: 'game-b' }],
    });

    await service.remove('event-1');

    expect(harness.tx.gamePlayerRank.deleteMany).toHaveBeenCalledWith({
      where: { gameId: { in: ['game-a', 'game-b'] } },
    });
    expect(harness.tx.event.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });

    expect(harness.calls.slice(0, 4)).toEqual([
      'transaction:begin',
      'tx.gamePlayerRank.deleteMany',
      'tx.event.delete',
      'transaction:commit',
    ]);
  });

  it('awaits the ranking replay after the delete transaction has committed', async () => {
    harness.prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      games: [{ id: 'game-a' }],
    });

    await service.remove('event-1');

    expect(harness.calls).toEqual([
      'transaction:begin',
      'tx.gamePlayerRank.deleteMany',
      'tx.event.delete',
      'transaction:commit',
      'agregateRankings:start',
      'agregateRankings:finish',
    ]);
  });

  it('skips the ranking replay when the event had no games', async () => {
    harness.prisma.event.findUnique.mockResolvedValue({ id: 'event-1', games: [] });

    await service.remove('event-1');

    expect(harness.tx.event.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });
    expect(harness.rankings.agregateRankings).not.toHaveBeenCalled();
  });
});

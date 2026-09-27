import { Test, TestingModule } from '@nestjs/testing';
import { RankingsService } from './rankings.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlayerStatisticsService } from '../statistics/player-statistics.service';

/**
 * Covers the seam between the pure change table (utils.spec.ts) and what actually gets written:
 * updatePlayersRankByGameResult runs inside agregateRankings' per-game transaction, so anything that
 * throws here aborts a destructive full replay part-way through.
 */
describe('RankingsService.updatePlayersRankByGameResult', () => {
  let service: RankingsService;
  let tx: {
    playerStats: { findUnique: jest.Mock; update: jest.Mock; upsert: jest.Mock };
    gamePlayerRank: { create: jest.Mock };
  };

  const player = (id: string, rank: number, totalGames = 10) => ({ id, playerStats: { rank, totalGames } });

  const game = (team1Points: number, team2Points: number, ranks = [1000, 1000, 1000, 1000]) => ({
    id: 'game-1',
    team1Points,
    team2Points,
    team1Player1: player('t1p1', ranks[0]),
    team1Player2: player('t1p2', ranks[1]),
    team2Player1: player('t2p1', ranks[2]),
    team2Player2: player('t2p2', ranks[3]),
  });

  /** The rankChange written for each player, keyed by playerId. */
  const written = () =>
    Object.fromEntries(
      tx.gamePlayerRank.create.mock.calls.map((call) => [call[0].data.playerId, call[0].data.rankChange]),
    );

  beforeEach(async () => {
    tx = {
      playerStats: {
        findUnique: jest.fn(async () => ({ rank: 1000 })),
        update: jest.fn(async () => ({})),
        upsert: jest.fn(async () => ({})),
      },
      gamePlayerRank: { create: jest.fn(async () => ({})) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingsService,
        { provide: PrismaService, useValue: {} },
        { provide: PlayerStatisticsService, useValue: {} },
      ],
    }).compile();

    service = module.get(RankingsService);
  });

  it('writes a rank row per player, with the losing side negative', async () => {
    await service.updatePlayersRankByGameResult(tx as never, game(21, 15));

    expect(written()).toEqual({ t1p1: 15, t1p2: 15, t2p1: -15, t2p2: -15 });
  });

  it('writes the losing side negative when team2 wins', async () => {
    await service.updatePlayersRankByGameResult(tx as never, game(15, 21));

    expect(written()).toEqual({ t1p1: -15, t1p2: -15, t2p1: 15, t2p2: 15 });
  });

  it('takes rating from a losing favourite and gives it to the winning underdog', async () => {
    // The reported game: 2364 against 1447, a 917-point gap, favourites beaten.
    await service.updatePlayersRankByGameResult(tx as never, game(6, 15, [1250, 1114, 886, 561]));

    expect(written()).toEqual({ t1p1: -28, t1p2: -28, t2p1: 28, t2p2: 28 });
  });

  it('handles a gap beyond the change table without inverting the sign', async () => {
    await service.updatePlayersRankByGameResult(tx as never, game(15, 21, [2000, 2000, 1000, 1000]));

    expect(written()).toEqual({ t1p1: -30, t1p2: -30, t2p1: 30, t2p2: 30 });
  });

  it('writes nothing for a drawn score instead of crashing the replay', async () => {
    await expect(service.updatePlayersRankByGameResult(tx as never, game(21, 21))).resolves.toBeUndefined();

    expect(tx.gamePlayerRank.create).not.toHaveBeenCalled();
    expect(tx.playerStats.update).not.toHaveBeenCalled();
  });

  it('writes nothing for an unscored 0-0 row — the column default, not a real result', async () => {
    await expect(service.updatePlayersRankByGameResult(tx as never, game(0, 0))).resolves.toBeUndefined();

    expect(tx.gamePlayerRank.create).not.toHaveBeenCalled();
  });

  it('rounds the change before storing it', async () => {
    await service.updatePlayersRankByGameResult(tx as never, game(21, 15));

    for (const change of Object.values(written())) {
      expect(Number.isInteger(change)).toBe(true);
    }
  });
});

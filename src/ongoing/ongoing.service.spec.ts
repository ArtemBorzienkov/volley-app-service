import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OngoingService, isGamePlayed } from './ongoing.service';
import { PrismaService } from '../prisma/prisma.service';

const EVENT_ROW = {
  id: 'event-1',
  name: 'WBSA Warsaw',
  date: new Date('2026-08-23T10:00:00.000Z'),
  createdAt: new Date('2026-08-23T09:00:00.000Z'),
  updatedAt: new Date('2026-08-23T09:00:00.000Z'),
  config: { gamesPerPair: 1, courts: 2 },
  teams: [],
  games: [],
};

function buildPrismaMock() {
  return {
    ongoingEvent: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async (_args?: any) => EVENT_ROW as any),
      create: jest.fn(async () => EVENT_ROW as any),
      update: jest.fn(async (args: any) => ({ ...EVENT_ROW, ...args.data })),
      delete: jest.fn(async () => EVENT_ROW as any),
    },
    ongoingEventConfig: {
      upsert: jest.fn(async () => ({ gamesPerPair: 1, courts: 2 })),
    },
    ongoingTeam: {
      create: jest.fn(async () => ({ id: 't2' })),
      createMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null as any),
      delete: jest.fn(async () => ({})),
      update: jest.fn(async (args: any) => args),
    },
    ongoingGame: {
      createMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null as any),
      findFirst: jest.fn(async (_args?: any) => null as any),
      update: jest.fn(async (args: any) => ({ ...args.data, id: 'game-1', eventId: 'event-1' })),
      count: jest.fn(async () => 0),
      // No 3rd-place row by default: the semifinal-detection query resolves to "there is no such
      // round", so tests that don't care about the 3rd-place match keep seeing exactly one successor.
      aggregate: jest.fn(async () => ({ _max: { bracketRound: null } })),
    },
    player: {
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (cb: any) => cb(this)),
  };
}

describe('OngoingService', () => {
  let service: OngoingService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [OngoingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  describe('OngoingService.create', () => {
    it('creates the event together with a default config row', async () => {
      await service.create({ name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z' });

      expect(prisma.ongoingEvent.create).toHaveBeenCalledWith({
        data: {
          name: 'WBSA Warsaw',
          date: new Date('2026-08-23T10:00:00.000Z'),
          startTime: null,
          location: null,
          config: {
            create: {
              gamesPerPair: 1,
              courts: 1,
              maxTeams: null,
              scheme: 'roundRobin',
              groupCount: 1,
              qualifiersPerGroup: null,
            },
          },
        },
        include: expect.anything(),
      });
    });

    it('rejects a missing or empty name without touching Postgres', async () => {
      await expect(service.create({ name: '   ', date: '2026-08-23T10:00:00.000Z' })).rejects.toThrow(
        new BadRequestException('name must be a non-empty string'),
      );
      await expect(service.create({ date: '2026-08-23T10:00:00.000Z' } as any)).rejects.toThrow(
        new BadRequestException('name must be a non-empty string'),
      );

      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });

    it('rejects a missing or unparseable date without touching Postgres', async () => {
      await expect(service.create({ name: 'WBSA Warsaw', date: 'tomorrow' })).rejects.toThrow(
        new BadRequestException('date must be a valid date'),
      );
      await expect(service.create({ name: 'WBSA Warsaw' } as any)).rejects.toThrow(
        new BadRequestException('date must be a valid date'),
      );

      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.findOne', () => {
    it('throws a 404 naming the id when the event does not exist', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.findOne('missing')).rejects.toThrow(
        new NotFoundException('Ongoing event with ID missing not found'),
      );
    });

    it('returns the config, teams and games of the event', async () => {
      const result = await service.findOne('event-1');

      expect(result.id).toBe('event-1');
      expect(result.config).toEqual({
        gamesPerPair: 1,
        courts: 2,
        maxTeams: null,
        scheme: 'roundRobin',
        groupCount: 1,
        qualifiersPerGroup: null,
      });
      expect(result.teams).toEqual([]);
      expect(result.games).toEqual([]);
    });

    it('asks Postgres for games in round then order sequence', async () => {
      await service.findOne('event-1');

      const args = prisma.ongoingEvent.findUnique.mock.calls[0][0] as any;
      expect(args.include.games.orderBy).toEqual([{ round: 'asc' }, { order: 'asc' }]);
    });
  });

  describe('OngoingService.remove', () => {
    it('deletes the event and lets the cascade clear config, teams and games', async () => {
      await service.remove('event-1');

      expect(prisma.ongoingEvent.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });
    });

    it('throws a 404 rather than deleting when the event is missing', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingEvent.delete).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.updateConfig', () => {
    it('rejects a gamesPerPair outside 1..3', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 4, courts: 2 })).rejects.toThrow(
        new BadRequestException('gamesPerPair must be 1, 2 or 3'),
      );
    });

    it('rejects fewer than one court', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 1, courts: 0 })).rejects.toThrow(
        new BadRequestException('courts must be at least 1'),
      );
    });

    it('upserts the config row for the event', async () => {
      await service.updateConfig('event-1', { gamesPerPair: 2, courts: 3 });

      expect(prisma.ongoingEventConfig.upsert).toHaveBeenCalledWith({
        where: { eventId: 'event-1' },
        create: {
          eventId: 'event-1',
          gamesPerPair: 2,
          courts: 3,
          maxTeams: null,
          scheme: 'roundRobin',
          groupCount: 1,
          qualifiersPerGroup: null,
        },
        update: {
          gamesPerPair: 2,
          courts: 3,
          maxTeams: null,
          scheme: 'roundRobin',
          groupCount: 1,
          qualifiersPerGroup: null,
        },
      });
    });

    it('rejects a missing request body instead of throwing a raw TypeError', async () => {
      await expect(service.updateConfig('event-1', undefined as any)).rejects.toThrow(
        new BadRequestException('gamesPerPair and courts are required'),
      );
    });
  });

  describe('OngoingService.setTeams', () => {
    beforeEach(() => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] as any);
    });

    it('rejects a team whose two players are the same person', async () => {
      await expect(service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p1' }] })).rejects.toThrow(
        new BadRequestException('A team must have two different players'),
      );
    });

    it('rejects a player appearing in more than one team', async () => {
      await expect(
        service.setTeams('event-1', {
          teams: [
            { player1Id: 'p1', player2Id: 'p2' },
            { player1Id: 'p1', player2Id: 'p3' },
          ],
        }),
      ).rejects.toThrow(new BadRequestException('Player p1 is already in another team'));
    });

    it('rejects an unknown player id', async () => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }] as any);

      await expect(service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'ghost' }] })).rejects.toThrow(
        new NotFoundException('Player with ID ghost not found'),
      );
    });

    it('drops the existing games before replacing the roster, since fixtures would dangle', async () => {
      const calls: string[] = [];
      prisma.ongoingGame.deleteMany = jest.fn(async () => {
        calls.push('games.deleteMany');
        return { count: 0 };
      });
      prisma.ongoingTeam.deleteMany = jest.fn(async () => {
        calls.push('teams.deleteMany');
        return { count: 0 };
      });
      prisma.ongoingTeam.createMany = jest.fn(async () => {
        calls.push('teams.createMany');
        return { count: 1 };
      });

      await service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] });

      expect(calls).toEqual(['games.deleteMany', 'teams.deleteMany', 'teams.createMany']);
    });

    it('writes each team with the event id attached', async () => {
      await service.setTeams('event-1', {
        teams: [
          { player1Id: 'p1', player2Id: 'p2' },
          { player1Id: 'p3', player2Id: 'p4' },
        ],
      });

      expect(prisma.ongoingTeam.createMany).toHaveBeenCalledWith({
        data: [
          { eventId: 'event-1', player1Id: 'p1', player2Id: 'p2' },
          { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
        ],
      });
    });

    it('accepts an empty roster and just clears everything', async () => {
      await service.setTeams('event-1', { teams: [] });

      expect(prisma.ongoingTeam.createMany).not.toHaveBeenCalled();
      expect(prisma.ongoingTeam.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'event-1' } });
    });

    it('rejects a non-array teams payload instead of throwing a raw TypeError', async () => {
      await expect(service.setTeams('event-1', { teams: 5 as any })).rejects.toThrow(
        new BadRequestException('teams must be an array'),
      );
    });

    it('rejects a missing request body instead of throwing a raw TypeError', async () => {
      await expect(service.setTeams('event-1', undefined as any)).rejects.toThrow(
        new BadRequestException('teams must be an array'),
      );
    });

    it('rejects a team missing player1Id or player2Id', async () => {
      await expect(service.setTeams('event-1', { teams: [{ player2Id: 'p2' } as any] })).rejects.toThrow(
        new BadRequestException('A team must include both player1Id and player2Id'),
      );
    });
  });

  describe('OngoingService.setTeams planning guard', () => {
    it('refuses to replace the roster once any match has a result', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] })).rejects.toThrow(
        new ConflictException('The tournament has already started; its roster is locked'),
      );
    });

    it('counts only games that carry a result when deciding whether the tournament started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }] as any);

      await service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] });

      expect(prisma.ongoingGame.count).toHaveBeenCalledWith({
        where: { eventId: 'event-1', team1Points: { not: null }, team2Points: { not: null } },
      });
    });

    it('does not touch the roster when the guard rejects', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 2);

      await expect(service.setTeams('event-1', { teams: [] })).rejects.toThrow(ConflictException);
      expect(prisma.ongoingTeam.deleteMany).not.toHaveBeenCalled();
      expect(prisma.ongoingGame.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.generateSchedule', () => {
    const TEAM_ROWS = [
      { id: 't1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } },
      { id: 't2', player1: { id: 'p3', name: 'C' }, player2: { id: 'p4', name: 'D' } },
      { id: 't3', player1: { id: 'p5', name: 'E' }, player2: { id: 'p6', name: 'F' } },
    ];

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { gamesPerPair: 1, courts: 1 },
            teams: TEAM_ROWS,
          } as any),
      );
    });

    it('refuses to build a schedule with fewer than two teams', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { gamesPerPair: 1, courts: 1 },
            teams: [TEAM_ROWS[0]],
          } as any),
      );

      await expect(service.generateSchedule('event-1')).rejects.toThrow(
        new BadRequestException('At least two teams are required to generate a schedule'),
      );
    });

    it('wipes the existing fixtures before writing the new ones', async () => {
      const calls: string[] = [];
      prisma.ongoingGame.deleteMany = jest.fn(async () => {
        calls.push('deleteMany');
        return { count: 3 };
      });
      prisma.ongoingGame.createMany = jest.fn(async () => {
        calls.push('createMany');
        return { count: 3 };
      });

      await service.generateSchedule('event-1');

      expect(calls).toEqual(['deleteMany', 'createMany']);
    });

    it('writes one fixture per pairing, each carrying the event id', async () => {
      await service.generateSchedule('event-1');

      const data = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      expect(data).toHaveLength(3);
      for (const row of data) {
        expect(row.eventId).toBe('event-1');
        expect(row.team1Points).toBeNull();
        expect(row.team2Points).toBeNull();
      }
    });

    it('honours gamesPerPair from the config', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { gamesPerPair: 2, courts: 2 },
            teams: TEAM_ROWS,
          } as any),
      );

      await service.generateSchedule('event-1');

      expect((prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data).toHaveLength(6);
    });
  });

  describe('OngoingService.updateGameScore', () => {
    const GAME_ROW = {
      id: 'game-1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: null,
      team2Points: null,
      round: 1,
      court: 1,
      order: 0,
    };

    beforeEach(() => {
      prisma.ongoingGame.findUnique = jest.fn(async () => GAME_ROW as any);
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ ...GAME_ROW, ...args.data }));
    });

    it('throws a 404 naming the id when the game does not exist', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => null as any);

      await expect(service.updateGameScore('missing', { team1Points: 15, team2Points: 7 })).rejects.toThrow(
        new NotFoundException('Ongoing game with ID missing not found'),
      );
    });

    it('rejects a negative score', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: -1, team2Points: 7 })).rejects.toThrow(
        new BadRequestException('Points must be whole numbers of 0 or more'),
      );
    });

    it('rejects a non-integer score', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: 15.5, team2Points: 7 })).rejects.toThrow(
        new BadRequestException('Points must be whole numbers of 0 or more'),
      );
    });

    it('rejects a draw, because a set always has a winner', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: 15, team2Points: 15 })).rejects.toThrow(
        new BadRequestException('A set cannot end in a draw'),
      );
    });

    it('stores both scores on the game', async () => {
      const result = await service.updateGameScore('game-1', { team1Points: 15, team2Points: 7 });

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: { team1Points: 15, team2Points: 7 },
      });
      expect(result.team1Points).toBe(15);
      expect(result.team2Points).toBe(7);
    });

    it('fails closed with a 400 when invoked directly with no dto, rather than throwing a TypeError', async () => {
      await expect(service.updateGameScore('game-1', undefined as any)).rejects.toThrow(
        new BadRequestException('team1Points and team2Points are required'),
      );
    });

    it('rejects a string score instead of throwing a raw TypeError', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: '15' as any, team2Points: 7 })).rejects.toThrow(
        new BadRequestException('Points must be whole numbers of 0 or more'),
      );
    });

    it('rejects a null score instead of throwing a raw TypeError', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: null as any, team2Points: 7 })).rejects.toThrow(
        new BadRequestException('Points must be whole numbers of 0 or more'),
      );
    });

    it('rejects an absent team2Points instead of throwing a raw TypeError', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: 15 } as any)).rejects.toThrow(
        new BadRequestException('Points must be whole numbers of 0 or more'),
      );
    });
  });

  describe('OngoingService.updateGameScore with empty slots', () => {
    it('refuses a score on a game whose first slot is empty', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () =>
          ({
            id: 'g1',
            eventId: 'event-1',
            team1Id: null,
            team2Id: 't2',
            team1Points: null,
            team2Points: null,
            round: 1,
            court: 1,
            order: 0,
            phase: 'playoff',
            bracketRound: 2,
            bracketSlot: 0,
          } as any),
      );

      await expect(service.updateGameScore('g1', { team1Points: 15, team2Points: 9 })).rejects.toThrow(
        new BadRequestException('Both teams must be known before a result can be recorded'),
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses a score on a game whose second slot is empty', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () =>
          ({
            id: 'g1',
            eventId: 'event-1',
            team1Id: 't1',
            team2Id: null,
            team1Points: null,
            team2Points: null,
            round: 1,
            court: 1,
            order: 0,
            phase: 'playoff',
            bracketRound: 2,
            bracketSlot: 0,
          } as any),
      );

      await expect(service.updateGameScore('g1', { team1Points: 15, team2Points: 9 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('OngoingService game phase exposure', () => {
    it('returns phase and bracket position on every game', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            games: [
              {
                id: 'g1',
                eventId: 'event-1',
                team1Id: 't1',
                team2Id: 't2',
                team1Points: null,
                team2Points: null,
                round: 1,
                court: 1,
                order: 0,
                phase: 'group',
                bracketRound: null,
                bracketSlot: null,
              },
            ],
          } as any),
      );

      const result = await service.findOne('event-1');

      expect(result.games[0].phase).toBe('group');
      expect(result.games[0].bracketRound).toBeNull();
      expect(result.games[0].bracketSlot).toBeNull();
    });

    it('returns thirdPlace on every game, true only for the 3rd-place row', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            games: [
              {
                id: 'g-semi',
                eventId: 'event-1',
                team1Id: 't1',
                team2Id: 't2',
                team1Points: null,
                team2Points: null,
                round: 0,
                court: 0,
                order: 0,
                phase: 'playoff',
                bracketRound: 1,
                bracketSlot: 0,
                thirdPlace: false,
              },
              {
                id: 'g-third',
                eventId: 'event-1',
                team1Id: null,
                team2Id: null,
                team1Points: null,
                team2Points: null,
                round: 0,
                court: 0,
                order: 3,
                phase: 'playoff',
                bracketRound: null,
                bracketSlot: null,
                thirdPlace: true,
              },
            ],
          } as any),
      );

      const result = await service.findOne('event-1');

      expect(result.games.find((g) => g.id === 'g-semi')!.thirdPlace).toBe(false);
      expect(result.games.find((g) => g.id === 'g-third')!.thirdPlace).toBe(true);
    });
  });

  describe('OngoingService.clearGameResult', () => {
    beforeEach(() => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () =>
          ({
            id: 'game-1',
            eventId: 'event-1',
            team1Id: 't1',
            team2Id: 't2',
            team1Points: 15,
            team2Points: 7,
            round: 1,
            court: 1,
            order: 0,
          } as any),
      );
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({
        id: 'game-1',
        eventId: 'event-1',
        team1Id: 't1',
        team2Id: 't2',
        round: 1,
        court: 1,
        order: 0,
        ...args.data,
      }));
    });

    it('nulls both scores and keeps the fixture', async () => {
      const result = await service.clearGameResult('game-1');

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: { team1Points: null, team2Points: null },
      });
      expect(result.team1Points).toBeNull();
      expect(result.round).toBe(1);
    });

    it('throws a 404 when the game does not exist', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => null as any);

      await expect(service.clearGameResult('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('OngoingService group results lock (rule 3)', () => {
    const groupGame = (over: any = {}) => ({
      id: 'g-group-1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: null,
      team2Points: null,
      round: 1,
      court: 1,
      order: 0,
      phase: 'group',
      bracketRound: null,
      bracketSlot: null,
      ...over,
    });

    it('refuses to record a group result once any playoff game exists', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => groupGame() as any);
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.updateGameScore('g-group-1', { team1Points: 15, team2Points: 10 })).rejects.toThrow(
        new ConflictException('Group results are locked once the playoff has been generated; delete the playoff to edit them'),
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses to clear a group result once any playoff game exists', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => groupGame({ team1Points: 15, team2Points: 10 }) as any);
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.clearGameResult('g-group-1')).rejects.toThrow(
        new ConflictException('Group results are locked once the playoff has been generated; delete the playoff to edit them'),
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('still edits a group result freely when no playoff exists (regression guard)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => groupGame() as any);
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ ...groupGame(), ...args.data }));

      const result = await service.updateGameScore('g-group-1', { team1Points: 15, team2Points: 10 });

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-group-1' },
        data: { team1Points: 15, team2Points: 10 },
      });
      expect(result.team1Points).toBe(15);
    });

    it('still clears a group result freely when no playoff exists (regression guard)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => groupGame({ team1Points: 15, team2Points: 10 }) as any);
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ ...groupGame(), ...args.data }));

      const result = await service.clearGameResult('g-group-1');

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-group-1' },
        data: { team1Points: null, team2Points: null },
      });
      expect(result.team1Points).toBeNull();
    });
  });

  describe('OngoingService.updateGameScore playoff advancement', () => {
    const playoffGame = (over: any = {}) => ({
      id: 'g1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: null,
      team2Points: null,
      round: 0,
      court: 0,
      order: 0,
      phase: 'playoff',
      bracketRound: 1,
      bracketSlot: 0,
      ...over,
    });

    const nextRoundGame = (over: any = {}) => ({
      id: 'g-next',
      eventId: 'event-1',
      team1Id: null,
      team2Id: null,
      team1Points: null,
      team2Points: null,
      round: 0,
      court: 0,
      order: 1,
      phase: 'playoff',
      bracketRound: 2,
      bracketSlot: 0,
      ...over,
    });

    beforeEach(() => {
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ id: args.where.id, ...args.data }));
    });

    it('advances the winner into the next round team1Id when the slot is even', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame({ bracketSlot: 0 }) as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame({ bracketRound: 2, bracketSlot: 0 }) as any);

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 });

      expect(prisma.ongoingGame.findFirst).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'playoff', bracketRound: 2, bracketSlot: 0 },
      });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-next' },
        data: { team1Id: 't1' },
      });
    });

    it('advances the winner into the next round team2Id when the slot is odd', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame({ bracketSlot: 1, team1Id: 't3', team2Id: 't4' }) as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame({ bracketRound: 2, bracketSlot: 0 }) as any);

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 });

      expect(prisma.ongoingGame.findFirst).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'playoff', bracketRound: 2, bracketSlot: 0 },
      });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-next' },
        data: { team2Id: 't4' },
      });
    });

    it('advances round 1 slot 2 (even) into round 2 slot 1 team1Id', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => playoffGame({ bracketSlot: 2, team1Id: 't5', team2Id: 't6' }) as any,
      );
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame({ bracketRound: 2, bracketSlot: 1 }) as any);

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 9 });

      expect(prisma.ongoingGame.findFirst).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'playoff', bracketRound: 2, bracketSlot: 1 },
      });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-next' },
        data: { team1Id: 't5' },
      });
    });

    it('advances the winner derived from the scores, never a stored winner field', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame({ team1Id: 't1', team2Id: 't2' }) as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame() as any);

      await service.updateGameScore('g1', { team1Points: 5, team2Points: 15 });

      // team2 (t2) won on points, so t2 — not t1 — must be the id written downstream.
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-next' },
        data: { team1Id: 't2' },
      });
    });

    it('the final round advances nobody and does not error', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame({ bracketRound: 2, bracketSlot: 0 }) as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => null as any);

      await expect(service.updateGameScore('g1', { team1Points: 15, team2Points: 10 })).resolves.toBeDefined();

      expect(prisma.ongoingGame.findFirst).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'playoff', bracketRound: 3, bracketSlot: 0 },
      });
      // Only the game's own score write happens; nothing downstream to advance into.
      expect(prisma.ongoingGame.update).toHaveBeenCalledTimes(1);
    });

    it('writes the score and the advancement in the same transaction', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame() as any);

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('never sets points when filling a downstream slot (rule 6 guard)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame() as any);

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 });

      const advancementCall = (prisma.ongoingGame.update as jest.Mock).mock.calls.find(
        (call) => call[0].where.id === 'g-next',
      );
      expect(advancementCall[0].data).not.toHaveProperty('team1Points');
      expect(advancementCall[0].data).not.toHaveProperty('team2Points');
    });
  });

  describe('OngoingService.clearGameResult playoff rules', () => {
    const playedPlayoffGame = (over: any = {}) => ({
      id: 'g1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: 15,
      team2Points: 10,
      round: 0,
      court: 0,
      order: 0,
      phase: 'playoff',
      bracketRound: 1,
      bracketSlot: 0,
      ...over,
    });

    beforeEach(() => {
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ id: args.where.id, ...args.data }));
    });

    it('rule 4: refuses to clear a playoff result while the next round already has a result', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(
        async () =>
          ({
            id: 'g-next',
            eventId: 'event-1',
            team1Id: 't1',
            team2Id: 't7',
            team1Points: 15,
            team2Points: 12,
            phase: 'playoff',
            bracketRound: 2,
            bracketSlot: 0,
          } as any),
      );

      await expect(service.clearGameResult('g1')).rejects.toThrow(
        new ConflictException("This game's winner has already advanced into a played later round; clear that result first"),
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('clears a playoff result and empties the slot it filled when the next round is still unplayed', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(
        async () =>
          ({
            id: 'g-next',
            eventId: 'event-1',
            team1Id: 't1',
            team2Id: null,
            team1Points: null,
            team2Points: null,
            phase: 'playoff',
            bracketRound: 2,
            bracketSlot: 0,
          } as any),
      );

      const result = await service.clearGameResult('g1');

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-next' },
        data: { team1Id: null },
      });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { team1Points: null, team2Points: null },
      });
      expect(result.team1Points).toBeNull();
    });

    it('clears a playoff result cleanly when it is the final (no next round exists)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame({ bracketRound: 2, bracketSlot: 0 }) as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => null as any);

      const result = await service.clearGameResult('g1');

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { team1Points: null, team2Points: null },
      });
      expect(result.team1Points).toBeNull();
    });
  });

  describe('OngoingService.updateGameScore playoff rule 4 (editing a played result)', () => {
    const playedPlayoffGame = (over: any = {}) => ({
      id: 'g1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: 15,
      team2Points: 10,
      round: 0,
      court: 0,
      order: 0,
      phase: 'playoff',
      bracketRound: 1,
      bracketSlot: 0,
      ...over,
    });

    const successor = (over: any = {}) => ({
      id: 'g-next',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't7',
      team1Points: null,
      team2Points: null,
      round: 0,
      court: 0,
      order: 1,
      phase: 'playoff',
      bracketRound: 2,
      bracketSlot: 0,
      ...over,
    });

    const RULE_4 = new ConflictException(
      "This game's winner has already advanced into a played later round; clear that result first",
    );

    beforeEach(() => {
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ id: args.where.id, ...args.data }));
    });

    it('refuses to flip the winner of a playoff game whose successor is already played', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => successor({ team1Points: 15, team2Points: 12 }) as any);

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 })).rejects.toThrow(RULE_4);
    });

    it('writes nothing at all when it refuses, so the score and the bracket stay in agreement', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => successor({ team1Points: 15, team2Points: 12 }) as any);

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 })).rejects.toThrow(RULE_4);
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses uniformly, even when the edit keeps the same winner', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => successor({ team1Points: 15, team2Points: 12 }) as any);

      // t1 still wins, so the successor's slot would not actually change — refused anyway, because
      // "undo the later round first" is a rule a caller can hold in their head; a same-winner
      // exception is not.
      await expect(service.updateGameScore('g1', { team1Points: 21, team2Points: 3 })).rejects.toThrow(RULE_4);
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('allows the edit and re-advances the new winner while the successor is still unplayed', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => successor() as any);

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 });

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { team1Points: 10, team2Points: 15 },
      });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-next' },
        data: { team1Id: 't2' },
      });
    });

    it('allows the edit when the game is the final and has no successor', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame({ bracketRound: 2 }) as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => null as any);

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 });

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { team1Points: 10, team2Points: 15 },
      });
    });

    it('does not apply rule 4 to group games, which have no successor geometry', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () =>
          playedPlayoffGame({ phase: 'group', bracketRound: null, bracketSlot: null, round: 1 }) as any,
      );
      prisma.ongoingGame.findFirst = jest.fn(async () => null as any);
      prisma.ongoingGame.count = jest.fn(async () => 0);

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 });

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { team1Points: 10, team2Points: 15 },
      });
    });
  });

  describe('OngoingService.updateGameScore advancing into a 3rd-place row', () => {
    const semifinal = (over: any = {}) => ({
      id: 'g1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: null,
      team2Points: null,
      round: 0,
      court: 0,
      order: 0,
      phase: 'playoff',
      bracketRound: 1,
      bracketSlot: 0,
      ...over,
    });

    const finalGame = (over: any = {}) => ({
      id: 'g-final',
      eventId: 'event-1',
      team1Id: null,
      team2Id: null,
      team1Points: null,
      team2Points: null,
      phase: 'playoff',
      bracketRound: 2,
      bracketSlot: 0,
      thirdPlace: false,
      ...over,
    });

    const thirdPlaceGame = (over: any = {}) => ({
      id: 'g-third',
      eventId: 'event-1',
      team1Id: null,
      team2Id: null,
      team1Points: null,
      team2Points: null,
      phase: 'playoff',
      bracketRound: null,
      bracketSlot: null,
      thirdPlace: true,
      ...over,
    });

    // Routes the mocked findFirst to whichever row the successor lookup is actually asking for,
    // the same way the real query's `where` clause distinguishes them.
    const routeFindFirst = (next: any, third: any) =>
      jest.fn(async (args: any) => (args.where.thirdPlace ? third : next));

    beforeEach(() => {
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ id: args.where.id, ...args.data }));
      // A 4-team bracket: round 1 is the semifinal (maxBracketRound - 1 = 1).
      prisma.ongoingGame.aggregate = jest.fn(async () => ({ _max: { bracketRound: 2 } }));
    });

    it('advances the winner into the final and the loser into the 3rd-place row (even slot)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal({ bracketSlot: 0 }) as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame(), thirdPlaceGame());

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 });

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-final' }, data: { team1Id: 't1' } });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-third' }, data: { team1Id: 't2' } });
    });

    it('advances the winner and the loser mirrored into team2Id for the odd-slot semifinal', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => semifinal({ bracketSlot: 1, team1Id: 't3', team2Id: 't4' }) as any,
      );
      prisma.ongoingGame.findFirst = routeFindFirst(
        finalGame({ bracketSlot: 0 }),
        thirdPlaceGame(),
      );

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 });

      // t4 won, t3 lost.
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-final' }, data: { team2Id: 't4' } });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-third' }, data: { team2Id: 't3' } });
    });

    it('does not touch a 3rd-place row for a non-semifinal round, even when one exists in the event', async () => {
      // An 8-team bracket: round 1 is the quarterfinal (maxBracketRound - 1 = 2, not 1).
      prisma.ongoingGame.aggregate = jest.fn(async () => ({ _max: { bracketRound: 3 } }));
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal({ bracketRound: 1, bracketSlot: 0 }) as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame({ bracketRound: 2 }), thirdPlaceGame());

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 });

      // Score write + exactly one advancement write (the quarterfinal's normal successor only).
      expect(prisma.ongoingGame.update).toHaveBeenCalledTimes(2);
      expect(prisma.ongoingGame.update).not.toHaveBeenCalledWith({
        where: { id: 'g-third' },
        data: expect.anything(),
      });
    });

    it('does not query for a 3rd-place row when advancing the final, which has no normal successor', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal({ bracketRound: 2, bracketSlot: 0 }) as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => null as any);

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 });

      expect(prisma.ongoingGame.aggregate).not.toHaveBeenCalled();
      expect(prisma.ongoingGame.update).toHaveBeenCalledTimes(1);
    });

    it('never carries a score when filling the 3rd-place row (rule 6 guard)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame(), thirdPlaceGame());

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 });

      const thirdPlaceCall = (prisma.ongoingGame.update as jest.Mock).mock.calls.find(
        (call) => call[0].where.id === 'g-third',
      );
      expect(thirdPlaceCall[0].data).not.toHaveProperty('team1Points');
      expect(thirdPlaceCall[0].data).not.toHaveProperty('team2Points');
    });
  });

  describe('OngoingService playoff rule 4 over multiple successors (3rd-place row)', () => {
    const RULE_4 = new ConflictException(
      "This game's winner has already advanced into a played later round; clear that result first",
    );

    const semifinal = (over: any = {}) => ({
      id: 'g1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: 15,
      team2Points: 10,
      round: 0,
      court: 0,
      order: 0,
      phase: 'playoff',
      bracketRound: 1,
      bracketSlot: 0,
      ...over,
    });

    const finalGame = (over: any = {}) => ({
      id: 'g-final',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: null,
      team1Points: null,
      team2Points: null,
      phase: 'playoff',
      bracketRound: 2,
      bracketSlot: 0,
      thirdPlace: false,
      ...over,
    });

    const thirdPlaceGame = (over: any = {}) => ({
      id: 'g-third',
      eventId: 'event-1',
      team1Id: 't2',
      team2Id: null,
      team1Points: null,
      team2Points: null,
      phase: 'playoff',
      bracketRound: null,
      bracketSlot: null,
      thirdPlace: true,
      ...over,
    });

    const routeFindFirst = (next: any, third: any) =>
      jest.fn(async (args: any) => (args.where.thirdPlace ? third : next));

    beforeEach(() => {
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ id: args.where.id, ...args.data }));
      prisma.ongoingGame.aggregate = jest.fn(async () => ({ _max: { bracketRound: 2 } }));
    });

    it('refuses to edit the semifinal once the 3rd-place match it feeds has been played, even though the final has not', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(
        finalGame(), // still unplayed
        thirdPlaceGame({ team1Points: 15, team2Points: 8 }), // played
      );

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 })).rejects.toThrow(RULE_4);
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses to clear the semifinal once the 3rd-place match it feeds has been played, even though the final has not', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame(), thirdPlaceGame({ team1Points: 15, team2Points: 8 }));

      await expect(service.clearGameResult('g1')).rejects.toThrow(RULE_4);
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses to edit the semifinal once the final has been played, even though the 3rd-place match has not', async () => {
      // Symmetric to the case above: either played successor blocks, regardless of which one it is.
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(
        finalGame({ team1Points: 21, team2Points: 18 }), // played
        thirdPlaceGame(), // still unplayed
      );

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 })).rejects.toThrow(RULE_4);
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('allows editing the semifinal when neither the final nor the 3rd-place match has been played', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame(), thirdPlaceGame());

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 })).resolves.toBeDefined();
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { team1Points: 10, team2Points: 15 },
      });
    });
  });

  describe('OngoingService.clearGameResult empties every slot a semifinal filled', () => {
    const semifinal = (over: any = {}) => ({
      id: 'g1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: 15,
      team2Points: 10,
      round: 0,
      court: 0,
      order: 0,
      phase: 'playoff',
      bracketRound: 1,
      bracketSlot: 0,
      ...over,
    });

    const finalGame = (over: any = {}) => ({
      id: 'g-final',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: null,
      team1Points: null,
      team2Points: null,
      phase: 'playoff',
      bracketRound: 2,
      bracketSlot: 0,
      thirdPlace: false,
      ...over,
    });

    const thirdPlaceGame = (over: any = {}) => ({
      id: 'g-third',
      eventId: 'event-1',
      team1Id: 't2',
      team2Id: null,
      team1Points: null,
      team2Points: null,
      phase: 'playoff',
      bracketRound: null,
      bracketSlot: null,
      thirdPlace: true,
      ...over,
    });

    const routeFindFirst = (next: any, third: any) =>
      jest.fn(async (args: any) => (args.where.thirdPlace ? third : next));

    beforeEach(() => {
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ id: args.where.id, ...args.data }));
      prisma.ongoingGame.aggregate = jest.fn(async () => ({ _max: { bracketRound: 2 } }));
    });

    it('nulls out both the final slot and the 3rd-place slot it had filled', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame(), thirdPlaceGame());

      const result = await service.clearGameResult('g1');

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-final' }, data: { team1Id: null } });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-third' }, data: { team1Id: null } });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { team1Points: null, team2Points: null },
      });
      expect(result.team1Points).toBeNull();
    });
  });

  describe('OngoingService.addTeam', () => {
    const OPEN_EVENT = {
      ...EVENT_ROW,
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      config: { gamesPerPair: 1, courts: 2, maxTeams: null },
      teams: [{ id: 't1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } }],
    };

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => OPEN_EVENT as any);
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }, { id: 'p4' }] as any);
      prisma.ongoingTeam.create = jest.fn(async () => ({ id: 't2' }));
    });

    it('appends the team without touching the existing roster', async () => {
      await service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' });

      expect(prisma.ongoingTeam.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
      });
      expect(prisma.ongoingTeam.deleteMany).not.toHaveBeenCalled();
      expect(prisma.ongoingGame.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses once the tournament has started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).rejects.toThrow(ConflictException);
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('refuses once the tournament date has passed', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...OPEN_EVENT,
            date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          } as any),
      );

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).rejects.toThrow(
        new ConflictException('Registration for this tournament has closed'),
      );
    });

    describe('registration date boundary', () => {
      // Pinned to an early-morning UTC instant on today's actual date (not a hardcoded calendar date),
      // so the "today but late in the day" case below is deterministic without the tests rotting.
      const realNow = new Date();
      const NOW = new Date(Date.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth(), realNow.getUTCDate(), 2, 0, 0));

      beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      const eventDatedAt = (date: Date) => ({ ...OPEN_EVENT, date });

      it('is open for a tournament dated exactly today', async () => {
        prisma.ongoingEvent.findUnique = jest.fn(async () => eventDatedAt(NOW) as any);

        await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).resolves.toBeDefined();
      });

      it('is closed for a tournament dated yesterday', async () => {
        const yesterday = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() - 1));
        prisma.ongoingEvent.findUnique = jest.fn(async () => eventDatedAt(yesterday) as any);

        await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).rejects.toThrow(
          new ConflictException('Registration for this tournament has closed'),
        );
      });

      it('is open for a tournament dated today at 23:00 even though "now" is early morning', async () => {
        const todayLate = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate(), 23, 0, 0));
        prisma.ongoingEvent.findUnique = jest.fn(async () => eventDatedAt(todayLate) as any);

        await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).resolves.toBeDefined();
      });

      it('is open for a tournament dated tomorrow', async () => {
        const tomorrow = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + 1));
        prisma.ongoingEvent.findUnique = jest.fn(async () => eventDatedAt(tomorrow) as any);

        await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).resolves.toBeDefined();
      });
    });

    it('refuses when the tournament is full', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...OPEN_EVENT,
            config: { gamesPerPair: 1, courts: 2, maxTeams: 1 },
          } as any),
      );

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).rejects.toThrow(
        new ConflictException('This tournament is full'),
      );
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('treats a null maxTeams as unlimited', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...OPEN_EVENT,
            config: { gamesPerPair: 1, courts: 2, maxTeams: null },
            teams: [
              { id: 't1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } },
              { id: 't2', player1: { id: 'p5', name: 'C' }, player2: { id: 'p6', name: 'D' } },
              { id: 't3', player1: { id: 'p7', name: 'E' }, player2: { id: 'p8', name: 'F' } },
            ],
          } as any),
      );

      await service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' });

      expect(prisma.ongoingTeam.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
      });
    });

    it('refuses a player who is already in a team of this tournament', async () => {
      await expect(service.addTeam('event-1', { player1Id: 'p1', player2Id: 'p3' })).rejects.toThrow(
        new BadRequestException('Player p1 is already in another team'),
      );
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('refuses two identical players', async () => {
      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p3' })).rejects.toThrow(
        new BadRequestException('A team must have two different players'),
      );
    });

    it('refuses an unknown player', async () => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }] as any);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'ghost' })).rejects.toThrow(
        new NotFoundException('Player with ID ghost not found'),
      );
    });
  });

  describe('OngoingService.removeTeam', () => {
    beforeEach(() => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => ({ id: 't1', eventId: 'event-1' } as any));
      prisma.ongoingTeam.delete = jest.fn(async () => ({ id: 't1' }));
      prisma.ongoingGame.count = jest.fn(async () => 0);
    });

    it('throws a 404 naming the id when the team does not exist', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => null as any);

      await expect(service.removeTeam('missing')).rejects.toThrow(
        new NotFoundException('Ongoing team with ID missing not found'),
      );
    });

    it('refuses once the tournament has started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.removeTeam('t1')).rejects.toThrow(ConflictException);
      expect(prisma.ongoingTeam.delete).not.toHaveBeenCalled();
    });

    it('deletes the team, letting the FK cascade take its unplayed fixtures', async () => {
      await service.removeTeam('t1');

      expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('checks the planning stage of the team OWN event', async () => {
      // Distinct from the default 'event-1' fixtures used elsewhere in this describe, so this test
      // actually binds to team.eventId rather than passing against a hardcoded 'event-1'.
      prisma.ongoingTeam.findUnique = jest.fn(async () => ({ id: 't1', eventId: 'event-owning-the-team' } as any));

      await service.removeTeam('t1');

      expect(prisma.ongoingGame.count).toHaveBeenCalledWith({
        where: { eventId: 'event-owning-the-team', team1Points: { not: null }, team2Points: { not: null } },
      });
    });
  });

  describe('OngoingService.findOpen', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const team = { id: 't1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } };

    const row = (over: any) => ({
      id: 'e',
      name: 'n',
      date: future,
      config: { gamesPerPair: 1, courts: 1, maxTeams: null },
      teams: [team],
      games: [],
      ...over,
    });

    it('excludes a tournament whose date has passed', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [row({ date: past })] as any);

      expect(await service.findOpen()).toEqual([]);
    });

    it('excludes a tournament that has a recorded result', async () => {
      prisma.ongoingEvent.findMany = jest.fn(
        async () => [row({ games: [{ team1Points: 15, team2Points: 7 }] })] as any,
      );

      expect(await service.findOpen()).toEqual([]);
    });

    it('includes a tournament whose fixtures exist but are all unplayed', async () => {
      prisma.ongoingEvent.findMany = jest.fn(
        async () => [row({ games: [{ team1Points: null, team2Points: null }] })] as any,
      );

      expect(await service.findOpen()).toHaveLength(1);
    });

    it('excludes a tournament that is full', async () => {
      prisma.ongoingEvent.findMany = jest.fn(
        async () => [row({ config: { gamesPerPair: 1, courts: 1, maxTeams: 1 } })] as any,
      );

      expect(await service.findOpen()).toEqual([]);
    });

    it('returns each open tournament with its roster and counts', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [row({})] as any);

      const result = await service.findOpen();

      expect(result).toHaveLength(1);
      expect(result[0].teamsCount).toBe(1);
      expect(result[0].maxTeams).toBeNull();
      expect(result[0].teams[0].player1.name).toBe('A');
    });

    it('orders soonest first', async () => {
      await service.findOpen();

      const args = (prisma.ongoingEvent.findMany as jest.Mock).mock.calls[0][0];
      expect(args.orderBy).toEqual({ date: 'asc' });
    });
  });

  describe('OngoingService — "started" agreement between findOpen and addTeam', () => {
    // Both guards must treat a game as "played" only once BOTH scores are recorded. This pins that
    // agreement to the single shared predicate (isGamePlayed) so the two call sites cannot silently
    // drift apart again.
    const playedGame = { team1Points: 15, team2Points: 7 };

    it('findOpen excludes, and addTeam rejects, the exact same played-game fixture', async () => {
      prisma.ongoingEvent.findMany = jest.fn(
        async () =>
          [
            {
              id: 'e',
              name: 'n',
              date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              config: { gamesPerPair: 1, courts: 1, maxTeams: null },
              teams: [],
              games: [playedGame],
            },
          ] as any,
      );

      expect(await service.findOpen()).toEqual([]);

      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            id: 'event-1',
            date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            config: { gamesPerPair: 1, courts: 2, maxTeams: null },
            teams: [],
          } as any),
      );
      // Derived from the same isGamePlayed predicate findOpen used above, standing in for the DB
      // count that assertPlanning issues with PLAYED_GAME_WHERE.
      prisma.ongoingGame.count = jest.fn(async () => [playedGame].filter(isGamePlayed).length);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).rejects.toThrow(ConflictException);
    });
  });

  describe('OngoingService.create with a roster', () => {
    beforeEach(() => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }] as any);
    });

    it('creates the event, its config and the roster in one call', async () => {
      await service.create({
        name: 'T',
        date: '2030-01-01T10:00:00.000Z',
        maxTeams: 8,
        teams: [{ player1Id: 'p1', player2Id: 'p2' }],
      });

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.config.create).toEqual({
        gamesPerPair: 1,
        courts: 1,
        maxTeams: 8,
        scheme: 'roundRobin',
        groupCount: 1,
        qualifiersPerGroup: null,
      });
      expect(args.data.teams.create).toEqual([{ player1Id: 'p1', player2Id: 'p2' }]);
    });

    it('rejects an unknown player before creating anything', async () => {
      prisma.player.findMany = jest.fn(async () => [] as any);

      await expect(
        service.create({ name: 'T', date: '2030-01-01T10:00:00.000Z', teams: [{ player1Id: 'p1', player2Id: 'p2' }] }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });

    it('still creates a tournament with no roster at all', async () => {
      await service.create({ name: 'T', date: '2030-01-01T10:00:00.000Z' });

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.teams).toBeUndefined();
      expect(args.data.config.create.maxTeams).toBeNull();
    });
  });

  describe('OngoingService.create startTime and location', () => {
    const base = { name: 'T', date: '2030-01-01T00:00:00.000Z' };

    it('stores a valid HH:MM start time and a location', async () => {
      await service.create({ ...base, startTime: '18:30', location: 'Beach Court 2' });

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.startTime).toBe('18:30');
      expect(args.data.location).toBe('Beach Court 2');
    });

    it('accepts a tournament with neither field', async () => {
      await service.create(base);

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.startTime).toBeNull();
      expect(args.data.location).toBeNull();
    });

    it('accepts midnight and the last minute of the day', async () => {
      await service.create({ ...base, startTime: '00:00' });
      await service.create({ ...base, startTime: '23:59' });

      expect(prisma.ongoingEvent.create).toHaveBeenCalledTimes(2);
    });

    it('rejects a malformed start time', async () => {
      for (const bad of ['24:00', '18:60', '6:30', '1830', 'evening', '18:30:00']) {
        await expect(service.create({ ...base, startTime: bad })).rejects.toThrow(
          new BadRequestException('startTime must be in HH:MM 24-hour format'),
        );
      }
    });

    it('rejects a non-string location', async () => {
      await expect(service.create({ ...base, location: 42 as any })).rejects.toThrow(
        new BadRequestException('location must be a string'),
      );
    });

    it('trims the location and treats an empty one as absent', async () => {
      await service.create({ ...base, location: '   ' });

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.location).toBeNull();
    });

    it('creates nothing when the start time is malformed', async () => {
      await expect(service.create({ ...base, startTime: 'nope' })).rejects.toThrow(BadRequestException);
      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService team ordering', () => {
    it('breaks createdAt ties by id so the order is deterministic', async () => {
      await service.findOne('event-1');

      const args = (prisma.ongoingEvent.findUnique as jest.Mock).mock.calls[0][0];
      expect(args.include.teams.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    });
  });

  describe('OngoingService mapTeam rating', () => {
    it('sums both players current ranks', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            teams: [
              {
                id: 't1',
                player1: { id: 'p1', name: 'A', playerStats: { rank: 1200 } },
                player2: { id: 'p2', name: 'B', playerStats: { rank: 1180 } },
              },
            ],
          } as any),
      );

      const result = await service.findOne('event-1');

      expect(result.teams[0].rating).toBe(2380);
    });

    it('falls back to 1000 for a player with no stats row', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            teams: [
              {
                id: 't1',
                player1: { id: 'p1', name: 'A', playerStats: { rank: 1200 } },
                player2: { id: 'p2', name: 'B' },
              },
            ],
          } as any),
      );

      const result = await service.findOne('event-1');

      expect(result.teams[0].rating).toBe(2200);
    });

    it('falls back to 1000 for both players when neither has a stats row', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            teams: [{ id: 't1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } }],
          } as any),
      );

      const result = await service.findOne('event-1');

      expect(result.teams[0].rating).toBe(2000);
    });

    it('keeps the teams orderBy as createdAt then id, and loads playerStats for the rating', async () => {
      await service.findOne('event-1');

      const args = (prisma.ongoingEvent.findUnique as jest.Mock).mock.calls[0][0];
      expect(args.include.teams.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
      expect(args.include.teams.include).toEqual({
        player1: { include: { playerStats: true } },
        player2: { include: { playerStats: true } },
      });
    });
  });

  describe('OngoingService.updateConfig maxTeams', () => {
    it('rejects a maxTeams below two', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, maxTeams: 1 })).rejects.toThrow(
        new BadRequestException('maxTeams must be at least 2'),
      );
    });

    it('rejects a maxTeams below the number of teams already registered', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            teams: [
              { id: 'a', player1: { id: '1', name: 'x' }, player2: { id: '2', name: 'y' } },
              { id: 'b', player1: { id: '3', name: 'z' }, player2: { id: '4', name: 'w' } },
              { id: 'c', player1: { id: '5', name: 'q' }, player2: { id: '6', name: 'r' } },
            ],
          } as any),
      );

      await expect(service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, maxTeams: 2 })).rejects.toThrow(
        new BadRequestException('maxTeams cannot be lower than the number of registered teams'),
      );
    });

    it('accepts an absent maxTeams as unlimited', async () => {
      await service.updateConfig('event-1', { gamesPerPair: 1, courts: 1 });

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.maxTeams).toBeNull();
    });
  });

  describe('OngoingService.updateConfig scheme and groups', () => {
    it('rejects an unknown scheme', async () => {
      await expect(
        service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, scheme: 'ladder' } as any),
      ).rejects.toThrow(new BadRequestException('scheme must be roundRobin or groupsPlayoff'));
    });

    it('forces roundRobin to a single group with no qualifiers', async () => {
      await service.updateConfig('event-1', {
        gamesPerPair: 1,
        courts: 1,
        scheme: 'roundRobin',
        groupCount: 3,
        qualifiersPerGroup: 2,
      } as any);

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.groupCount).toBe(1);
      expect(args.update.qualifiersPerGroup).toBeNull();
    });

    it('requires at least one group for groupsPlayoff', async () => {
      await expect(
        service.updateConfig('event-1', {
          gamesPerPair: 1,
          courts: 1,
          scheme: 'groupsPlayoff',
          groupCount: 0,
          qualifiersPerGroup: 2,
        } as any),
      ).rejects.toThrow(new BadRequestException('groupsPlayoff needs at least 1 group'));
    });

    it('accepts a single group, which seeds the playoff straight off one table', async () => {
      await service.updateConfig('event-1', {
        gamesPerPair: 1,
        courts: 1,
        scheme: 'groupsPlayoff',
        groupCount: 1,
        qualifiersPerGroup: 4,
      } as any);

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.scheme).toBe('groupsPlayoff');
      expect(args.update.groupCount).toBe(1);
      expect(args.update.qualifiersPerGroup).toBe(4);
    });

    it('rejects a bracket size that is not a power of two', async () => {
      await expect(
        service.updateConfig('event-1', {
          gamesPerPair: 1,
          courts: 1,
          scheme: 'groupsPlayoff',
          groupCount: 3,
          qualifiersPerGroup: 3,
        } as any),
      ).rejects.toThrow(new BadRequestException('groupCount times qualifiersPerGroup must be a power of two'));
    });

    it('accepts 2 groups with 2 qualifiers each', async () => {
      await service.updateConfig('event-1', {
        gamesPerPair: 1,
        courts: 1,
        scheme: 'groupsPlayoff',
        groupCount: 2,
        qualifiersPerGroup: 2,
      } as any);

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.scheme).toBe('groupsPlayoff');
      expect(args.update.groupCount).toBe(2);
      expect(args.update.qualifiersPerGroup).toBe(2);
    });

    it('accepts 2 groups with 4 qualifiers each', async () => {
      await service.updateConfig('event-1', {
        gamesPerPair: 1,
        courts: 1,
        scheme: 'groupsPlayoff',
        groupCount: 2,
        qualifiersPerGroup: 4,
      } as any);

      expect(prisma.ongoingEventConfig.upsert).toHaveBeenCalled();
    });
  });

  describe('OngoingService.generateSchedule with groups', () => {
    const teams = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `t${i}`,
        player1: { id: `p${i}a`, name: `A${i}` },
        player2: { id: `p${i}b`, name: `B${i}` },
      }));

    it('assigns every team a group index and writes them back', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: {
              gamesPerPair: 1,
              courts: 2,
              maxTeams: null,
              scheme: 'groupsPlayoff',
              groupCount: 2,
              qualifiersPerGroup: 2,
            },
            teams: teams(8),
          } as any),
      );

      await service.generateSchedule('event-1');

      expect(prisma.ongoingTeam.update).toHaveBeenCalledTimes(8);
      const indices = (prisma.ongoingTeam.update as jest.Mock).mock.calls.map((c) => c[0].data.groupIndex);
      expect(indices.filter((i) => i === 0)).toHaveLength(4);
      expect(indices.filter((i) => i === 1)).toHaveLength(4);
    });

    it('never schedules a cross-group fixture', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: {
              gamesPerPair: 1,
              courts: 2,
              maxTeams: null,
              scheme: 'groupsPlayoff',
              groupCount: 2,
              qualifiersPerGroup: 2,
            },
            teams: teams(8),
          } as any),
      );

      await service.generateSchedule('event-1');

      const groupOf = new Map<string, number>();
      for (const call of (prisma.ongoingTeam.update as jest.Mock).mock.calls) {
        groupOf.set(call[0].where.id, call[0].data.groupIndex);
      }
      const rows = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(groupOf.get(row.team1Id)).toBe(groupOf.get(row.team2Id));
      }
    });

    it('keeps the flat round-robin unchanged for roundRobin', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: {
              gamesPerPair: 1,
              courts: 2,
              maxTeams: null,
              scheme: 'roundRobin',
              groupCount: 1,
              qualifiersPerGroup: null,
            },
            teams: teams(4),
          } as any),
      );

      await service.generateSchedule('event-1');

      expect((prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data).toHaveLength(6);
    });

    it('refuses when a group would be too small for the configured qualifiers', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: {
              gamesPerPair: 1,
              courts: 2,
              maxTeams: null,
              scheme: 'groupsPlayoff',
              groupCount: 2,
              qualifiersPerGroup: 4,
            },
            teams: teams(6),
          } as any),
      );

      await expect(service.generateSchedule('event-1')).rejects.toThrow(BadRequestException);
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.generatePlayoff', () => {
    const teamRow = (id: string, groupIndex: number) => ({
      id,
      player1: { id: `${id}-p1`, name: `${id}-p1` },
      player2: { id: `${id}-p2`, name: `${id}-p2` },
      groupIndex,
    });

    // Group A (index 0): registration order is a, b, c but the table order is b, a, c — b has
    // 2 wins, a has 1, c has 0. This is what proves seeding follows the table, not registration.
    const TEAM_A_A = teamRow('tAa', 0);
    const TEAM_A_B = teamRow('tAb', 0);
    const TEAM_A_C = teamRow('tAc', 0);
    // Group B (index 1): exactly two teams, both qualify.
    const TEAM_B_X = teamRow('tBx', 1);
    const TEAM_B_Y = teamRow('tBy', 1);

    const groupGame = (team1Id: string, team2Id: string, team1Points: number | null, team2Points: number | null) => ({
      id: `${team1Id}-vs-${team2Id}`,
      eventId: 'event-1',
      team1Id,
      team2Id,
      team1Points,
      team2Points,
      round: 1,
      court: 1,
      order: 0,
      phase: 'group',
      bracketRound: null,
      bracketSlot: null,
    });

    const PLAYED_GROUP_GAMES = [
      groupGame('tAa', 'tAb', 10, 15), // b beats a
      groupGame('tAa', 'tAc', 15, 5), // a beats c
      groupGame('tAb', 'tAc', 15, 3), // b beats c
      groupGame('tBx', 'tBy', 15, 10), // x beats y
    ];

    const GROUPS_PLAYOFF_EVENT = {
      ...EVENT_ROW,
      config: {
        gamesPerPair: 1,
        courts: 1,
        maxTeams: null,
        scheme: 'groupsPlayoff',
        groupCount: 2,
        qualifiersPerGroup: 2,
      },
      teams: [TEAM_A_A, TEAM_A_B, TEAM_A_C, TEAM_B_X, TEAM_B_Y],
      games: PLAYED_GROUP_GAMES,
    };

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => GROUPS_PLAYOFF_EVENT as any);
    });

    it('refuses when the scheme is roundRobin, since there is no playoff in a flat round-robin', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: {
              gamesPerPair: 1,
              courts: 1,
              maxTeams: null,
              scheme: 'roundRobin',
              groupCount: 1,
              qualifiersPerGroup: null,
            },
          } as any),
      );

      await expect(service.generatePlayoff('event-1')).rejects.toThrow(
        new BadRequestException('The playoff is only available for the groupsPlayoff scheme'),
      );
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });

    it('refuses when the tournament has no group games at all', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({ ...GROUPS_PLAYOFF_EVENT, games: [] } as any));

      await expect(service.generatePlayoff('event-1')).rejects.toThrow(
        new ConflictException('The group stage has not been scheduled yet'),
      );
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });

    it('refuses when any group game still lacks a result, and creates nothing', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...GROUPS_PLAYOFF_EVENT,
            games: [...PLAYED_GROUP_GAMES.slice(0, 3), groupGame('tBx', 'tBy', null, null)],
          } as any),
      );

      await expect(service.generatePlayoff('event-1')).rejects.toThrow(
        new ConflictException('Every group game must have a result before the playoff can be generated'),
      );
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });

    it('refuses when playoff games already exist, naming that the playoff must be deleted first', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...GROUPS_PLAYOFF_EVENT,
            games: [
              ...PLAYED_GROUP_GAMES,
              {
                id: 'p1',
                eventId: 'event-1',
                team1Id: 'tAb',
                team2Id: 'tBy',
                team1Points: null,
                team2Points: null,
                round: 0,
                court: 0,
                order: 0,
                phase: 'playoff',
                bracketRound: 1,
                bracketSlot: 0,
              },
            ],
          } as any),
      );

      await expect(service.generatePlayoff('event-1')).rejects.toThrow(
        new ConflictException('The playoff already exists; delete it first before generating a new one'),
      );
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });

    it('writes log2(groupCount x qualifiersPerGroup) rounds plus a 3rd-place row, round 1 full and the rest empty', async () => {
      await service.generatePlayoff('event-1');

      const data = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      // 2 groups x 2 qualifiers = a 4-team bracket: round 1 has 2 games, round 2 (the final) has 1,
      // plus one 3rd-place row since the bracket has a real semifinal.
      expect(data).toHaveLength(4);
      for (const row of data) {
        expect(row.eventId).toBe('event-1');
        expect(row.phase).toBe('playoff');
        expect(row.team1Points).toBeNull();
        expect(row.team2Points).toBeNull();
        expect(row.round).toBe(0);
        expect(row.court).toBe(0);
      }
      expect(data.map((row: any) => row.order)).toEqual([0, 1, 2, 3]);

      const round1 = data.filter((row: any) => row.bracketRound === 1);
      const round2 = data.filter((row: any) => row.bracketRound === 2);
      const thirdPlaceRows = data.filter((row: any) => row.thirdPlace);
      expect(round1).toHaveLength(2);
      expect(round2).toHaveLength(1);
      expect(thirdPlaceRows).toHaveLength(1);
      for (const row of round1) {
        expect(row.team1Id).not.toBeNull();
        expect(row.team2Id).not.toBeNull();
      }
      for (const row of round2) {
        expect(row.team1Id).toBeNull();
        expect(row.team2Id).toBeNull();
      }

      const thirdPlaceRow = thirdPlaceRows[0];
      expect(thirdPlaceRow.bracketRound).toBeNull();
      expect(thirdPlaceRow.bracketSlot).toBeNull();
      expect(thirdPlaceRow.team1Id).toBeNull();
      expect(thirdPlaceRow.team2Id).toBeNull();
      expect(thirdPlaceRow.order).toBe(3);
    });

    it('does not mark any normal bracket row as the 3rd-place row', async () => {
      await service.generatePlayoff('event-1');

      const data = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      const normalRows = data.filter((row: any) => row.bracketRound !== null);
      for (const row of normalRows) {
        expect(row.thirdPlace).toBe(false);
      }
    });

    it('seeds from the group standings, not registration order', async () => {
      await service.generatePlayoff('event-1');

      const data = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      const round1 = data.filter((row: any) => row.bracketRound === 1);
      const pairs = round1.map((row: any) => [row.team1Id, row.team2Id].sort());

      // Group A's table order is b (1st), a (2nd), c (eliminated) — not the registration order
      // a, b, c. The standard bracket pairing for a 2x2 bracket is A1-B2, A2-B1.
      expect(pairs).toEqual(expect.arrayContaining([['tAb', 'tBy'].sort(), ['tAa', 'tBx'].sort()]));
    });

    it('refuses when a group has fewer ranked teams than the configured qualifiersPerGroup', async () => {
      // Simulates an admin raising qualifiersPerGroup via updateConfig after generateSchedule already
      // validated a smaller value — group B here has only one team but qualifiersPerGroup is 2.
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...GROUPS_PLAYOFF_EVENT,
            teams: [TEAM_A_A, TEAM_A_B, TEAM_A_C, TEAM_B_X],
          } as any),
      );

      await expect(service.generatePlayoff('event-1')).rejects.toThrow(
        new BadRequestException('Group 2 has 1 ranked team(s), fewer than the 2 qualifiersPerGroup configured'),
      );
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.generatePlayoff with a single group', () => {
    // A field too small to split into two groups: everyone plays everyone once, then the top 4
    // of that one table seed straight into a playoff (1st vs 4th, 2nd vs 3rd), and whoever finishes
    // 5th does not advance. Ranks by wins here: e (3), d (2), c (2, worse diff), b (1), a (0).
    const team = (id: string) => ({
      id,
      player1: { id: `${id}-p1`, name: `${id}-p1` },
      player2: { id: `${id}-p2`, name: `${id}-p2` },
      groupIndex: 0,
    });
    const TEAMS = ['ta', 'tb', 'tc', 'td', 'te'].map(team);

    const g = (team1Id: string, team2Id: string, team1Points: number, team2Points: number) => ({
      id: `${team1Id}-vs-${team2Id}`,
      eventId: 'event-1',
      team1Id,
      team2Id,
      team1Points,
      team2Points,
      round: 1,
      court: 1,
      order: 0,
      phase: 'group',
      bracketRound: null,
      bracketSlot: null,
    });

    // Every pair plays once; e wins all 4, d beats everyone but e, c beats a and b, b beats only a.
    const PLAYED_GAMES = [
      g('ta', 'tb', 5, 21),
      g('ta', 'tc', 5, 21),
      g('ta', 'td', 5, 21),
      g('ta', 'te', 5, 21),
      g('tb', 'tc', 5, 21),
      g('tb', 'td', 5, 21),
      g('tb', 'te', 5, 21),
      g('tc', 'td', 5, 21),
      g('tc', 'te', 5, 21),
      g('td', 'te', 5, 21),
    ];

    const SINGLE_GROUP_EVENT = {
      ...EVENT_ROW,
      config: {
        gamesPerPair: 1,
        courts: 1,
        maxTeams: null,
        scheme: 'groupsPlayoff',
        groupCount: 1,
        qualifiersPerGroup: 4,
      },
      teams: TEAMS,
      games: PLAYED_GAMES,
    };

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => SINGLE_GROUP_EVENT as any);
    });

    it('seeds 1st vs 4th and 2nd vs 3rd off the single table, leaving 5th out entirely', async () => {
      await service.generatePlayoff('event-1');

      const data = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      expect(data).toHaveLength(4); // a 4-team bracket: 2 semifinals + 1 final + 1 3rd-place row

      const round1 = data.filter((row: any) => row.bracketRound === 1);
      const pairs = round1.map((row: any) => [row.team1Id, row.team2Id].sort());
      // Table order is te(1st) td(2nd) tc(3rd) tb(4th) ta(5th, eliminated).
      expect(pairs).toEqual(expect.arrayContaining([['te', 'tb'].sort(), ['td', 'tc'].sort()]));

      // es2017 has no Array.flatMap; .reduce keeps this test consistent with the repo's target lib.
      const allBracketTeamIds = new Set(
        data.reduce((ids: any[], row: any) => ids.concat([row.team1Id, row.team2Id]), []),
      );
      expect(allBracketTeamIds.has('ta')).toBe(false);
    });
  });

  describe('OngoingService.generatePlayoff with only 2 qualifiers (a bare final, no semifinal)', () => {
    // 1 group of 3, top 2 qualify: a 2-team bracket is a single final with no semifinal round, so
    // there is nothing to seed a 3rd-place match with.
    const team = (id: string) => ({
      id,
      player1: { id: `${id}-p1`, name: `${id}-p1` },
      player2: { id: `${id}-p2`, name: `${id}-p2` },
      groupIndex: 0,
    });
    const TEAMS = ['ta', 'tb', 'tc'].map(team);

    const g = (team1Id: string, team2Id: string, team1Points: number, team2Points: number) => ({
      id: `${team1Id}-vs-${team2Id}`,
      eventId: 'event-1',
      team1Id,
      team2Id,
      team1Points,
      team2Points,
      round: 1,
      court: 1,
      order: 0,
      phase: 'group',
      bracketRound: null,
      bracketSlot: null,
    });

    // c beats everyone, b beats a: table order c, b, a.
    const PLAYED_GAMES = [g('ta', 'tb', 5, 21), g('ta', 'tc', 5, 21), g('tb', 'tc', 5, 21)];

    const TWO_QUALIFIER_EVENT = {
      ...EVENT_ROW,
      config: {
        gamesPerPair: 1,
        courts: 1,
        maxTeams: null,
        scheme: 'groupsPlayoff',
        groupCount: 1,
        qualifiersPerGroup: 2,
      },
      teams: TEAMS,
      games: PLAYED_GAMES,
    };

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => TWO_QUALIFIER_EVENT as any);
    });

    it('generates only the final, with no 3rd-place row', async () => {
      await service.generatePlayoff('event-1');

      const data = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      expect(data).toHaveLength(1);
      expect(data[0].bracketRound).toBe(1);
      expect(data[0].team1Id).not.toBeNull();
      expect(data[0].team2Id).not.toBeNull();
      expect(data.some((row: any) => row.thirdPlace)).toBe(false);
    });
  });

  describe('OngoingService.findAll', () => {
    it('excludes finished tournaments from the current-tournaments list', async () => {
      await service.findAll();

      expect(prisma.ongoingEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { finishedAt: null } }),
      );
    });
  });

  describe('OngoingService.finishTournament', () => {
    const game = (over: any) => ({
      id: 'g',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: null,
      team2Points: null,
      round: 0,
      court: 0,
      order: 0,
      phase: 'group',
      bracketRound: null,
      bracketSlot: null,
      thirdPlace: false,
      ...over,
    });

    it('refuses to finish a groupsPlayoff tournament before the final is played', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { scheme: 'groupsPlayoff', groupCount: 2, qualifiersPerGroup: 2 },
            games: [
              game({ id: 'sf1', phase: 'playoff', bracketRound: 1, bracketSlot: 0, team1Points: 21, team2Points: 10 }),
              game({ id: 'sf2', phase: 'playoff', bracketRound: 1, bracketSlot: 1, team1Points: 21, team2Points: 12 }),
              game({ id: 'final', phase: 'playoff', bracketRound: 2, bracketSlot: 0 }),
            ],
          } as any),
      );

      await expect(service.finishTournament('event-1')).rejects.toThrow(ConflictException);
      expect(prisma.ongoingEvent.update).not.toHaveBeenCalled();
    });

    it('refuses to finish a groupsPlayoff tournament when a 3rd-place match exists but is unplayed', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { scheme: 'groupsPlayoff', groupCount: 2, qualifiersPerGroup: 2 },
            games: [
              game({ id: 'final', phase: 'playoff', bracketRound: 2, team1Points: 21, team2Points: 15 }),
              game({ id: 'third', phase: 'playoff', bracketRound: null, thirdPlace: true }),
            ],
          } as any),
      );

      await expect(service.finishTournament('event-1')).rejects.toThrow(ConflictException);
      expect(prisma.ongoingEvent.update).not.toHaveBeenCalled();
    });

    it('finishes a groupsPlayoff tournament once the final and the 3rd-place match are both played', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { scheme: 'groupsPlayoff', groupCount: 2, qualifiersPerGroup: 2 },
            games: [
              game({ id: 'final', phase: 'playoff', bracketRound: 2, team1Points: 21, team2Points: 15 }),
              game({ id: 'third', phase: 'playoff', bracketRound: null, thirdPlace: true, team1Points: 21, team2Points: 18 }),
            ],
          } as any),
      );

      await service.finishTournament('event-1');

      expect(prisma.ongoingEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { finishedAt: expect.any(Date) },
      });
    });

    it('finishes a groupsPlayoff tournament with no 3rd-place match once the final alone is played', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { scheme: 'groupsPlayoff', groupCount: 1, qualifiersPerGroup: 2 },
            games: [game({ id: 'final', phase: 'playoff', bracketRound: 1, team1Points: 21, team2Points: 15 })],
          } as any),
      );

      await service.finishTournament('event-1');

      expect(prisma.ongoingEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { finishedAt: expect.any(Date) },
      });
    });

    it('refuses to finish a roundRobin tournament with no games at all', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () => ({ ...EVENT_ROW, config: { scheme: 'roundRobin', groupCount: 1 }, games: [] } as any),
      );

      await expect(service.finishTournament('event-1')).rejects.toThrow(ConflictException);
      expect(prisma.ongoingEvent.update).not.toHaveBeenCalled();
    });

    it('refuses to finish a roundRobin tournament while any game is unplayed', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { scheme: 'roundRobin', groupCount: 1 },
            games: [game({ id: 'g1', team1Points: 21, team2Points: 10 }), game({ id: 'g2' })],
          } as any),
      );

      await expect(service.finishTournament('event-1')).rejects.toThrow(ConflictException);
      expect(prisma.ongoingEvent.update).not.toHaveBeenCalled();
    });

    it('finishes a roundRobin tournament once every game is played', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () =>
          ({
            ...EVENT_ROW,
            config: { scheme: 'roundRobin', groupCount: 1 },
            games: [game({ id: 'g1', team1Points: 21, team2Points: 10 })],
          } as any),
      );

      await service.finishTournament('event-1');

      expect(prisma.ongoingEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { finishedAt: expect.any(Date) },
      });
    });

    it('throws a 404 rather than finishing when the event is missing', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.finishTournament('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingEvent.update).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.deletePlayoff', () => {
    it('removes only phase playoff games and leaves group games untouched', async () => {
      await service.deletePlayoff('event-1');

      expect(prisma.ongoingGame.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'playoff' },
      });
    });

    it('throws a 404 rather than deleting when the event is missing', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.deletePlayoff('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingGame.deleteMany).not.toHaveBeenCalled();
    });
  });
});

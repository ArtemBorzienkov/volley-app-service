import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OngoingService, isGamePlayed } from './ongoing.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';

const EVENT_ROW = {
  id: 'event-1',
  name: 'WBSA Warsaw',
  date: new Date('2026-08-23T10:00:00.000Z'),
  createdAt: new Date('2026-08-23T09:00:00.000Z'),
  updatedAt: new Date('2026-08-23T09:00:00.000Z'),
  config: { gamesPerPair: 1, courts: 2, visibility: 'public', allowSoloRegistration: false },
  teams: [],
  soloPlayers: [],
  rotationSlots: [],
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
      create: jest.fn(async (args: any) => ({ id: 'game-new', ...args.data })),
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
    ongoingSoloPlayer: {
      create: jest.fn(async () => ({ id: 'solo-1' })),
      createMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null as any),
      findMany: jest.fn(async () => []),
      delete: jest.fn(async () => ({})),
    },
    ongoingRotationSlot: {
      create: jest.fn(async () => ({ id: 'slot-1' })),
      createMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
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
  let userService: { findById: jest.Mock };

  const CURRENT_USER = { sub: 'user-1', email: 'user1@example.com', role: 'admin', jti: 'jti-1', iat: 0, exp: 0 };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    userService = { findById: jest.fn(async () => ({ playerId: 'p3' } as any)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  describe('OngoingService.create', () => {
    it('creates the event together with a default config row', async () => {
      await service.create({ name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z' }, CURRENT_USER);

      expect(prisma.ongoingEvent.create).toHaveBeenCalledWith({
        data: {
          name: 'WBSA Warsaw',
          date: new Date('2026-08-23T10:00:00.000Z'),
          startTime: null,
          location: null,
          createdByUserId: 'user-1',
          config: {
            create: {
              gamesPerPair: 1,
              courts: 1,
              maxTeams: null,
              scheme: 'roundRobin',
              groupCount: 1,
              qualifiersPerGroup: null,
              rotationRounds: 3,
              visibility: 'public',
              allowSoloRegistration: false,
              soloOnlyRegistration: false,
            },
          },
        },
        include: expect.anything(),
      });
    });

    it('rejects a missing or empty name without touching Postgres', async () => {
      await expect(service.create({ name: '   ', date: '2026-08-23T10:00:00.000Z' }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('name must be a non-empty string'),
      );
      await expect(service.create({ date: '2026-08-23T10:00:00.000Z' } as any, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('name must be a non-empty string'),
      );

      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });

    it('rejects a missing or unparseable date without touching Postgres', async () => {
      await expect(service.create({ name: 'WBSA Warsaw', date: 'tomorrow' }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('date must be a valid date'),
      );
      await expect(service.create({ name: 'WBSA Warsaw' } as any, CURRENT_USER)).rejects.toThrow(
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
        visibility: 'public',
        allowSoloRegistration: false,
        soloOnlyRegistration: false,
        hiddenRules: [],
        maxTeams: null,
        scheme: 'roundRobin',
        groupCount: 1,
        qualifiersPerGroup: null,
        rotationRounds: 3,
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
      await service.remove('event-1', CURRENT_USER);

      expect(prisma.ongoingEvent.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });
    });

    it('throws a 404 rather than deleting when the event is missing', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.remove('missing', CURRENT_USER)).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingEvent.delete).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.updateConfig', () => {
    it('rejects a gamesPerPair outside 1..3', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 4, courts: 2 }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('gamesPerPair must be 1, 2 or 3'),
      );
    });

    it('rejects fewer than one court', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 1, courts: 0 }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('courts must be at least 1'),
      );
    });

    it('upserts the config row for the event', async () => {
      await service.updateConfig('event-1', { gamesPerPair: 2, courts: 3 }, CURRENT_USER);

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
          rotationRounds: 3,
          visibility: 'public',
          allowSoloRegistration: false,
          soloOnlyRegistration: false,
          hiddenRules: [],
        },
        update: {
          gamesPerPair: 2,
          courts: 3,
          maxTeams: null,
          scheme: 'roundRobin',
          groupCount: 1,
          qualifiersPerGroup: null,
          rotationRounds: 3,
          visibility: 'public',
          allowSoloRegistration: false,
          soloOnlyRegistration: false,
          hiddenRules: [],
        },
      });
    });

    it('rejects a missing request body instead of throwing a raw TypeError', async () => {
      await expect(service.updateConfig('event-1', undefined as any, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('gamesPerPair and courts are required'),
      );
    });
  });

  describe('OngoingService.setTeams', () => {
    beforeEach(() => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] as any);
    });

    it('rejects a team whose two players are the same person', async () => {
      await expect(
        service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p1' }] }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('A team must have two different players'));
    });

    it('rejects a player appearing in more than one team', async () => {
      await expect(
        service.setTeams(
          'event-1',
          {
            teams: [
              { player1Id: 'p1', player2Id: 'p2' },
              { player1Id: 'p1', player2Id: 'p3' },
            ],
          },
          CURRENT_USER,
        ),
      ).rejects.toThrow(new BadRequestException('Player p1 is already in another team'));
    });

    it('rejects an unknown player id', async () => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }] as any);

      await expect(
        service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'ghost' }] }, CURRENT_USER),
      ).rejects.toThrow(new NotFoundException('Player with ID ghost not found'));
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

      await service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] }, CURRENT_USER);

      expect(calls).toEqual(['games.deleteMany', 'teams.deleteMany', 'teams.createMany']);
    });

    it('writes each team with the event id attached', async () => {
      await service.setTeams(
        'event-1',
        {
          teams: [
            { player1Id: 'p1', player2Id: 'p2' },
            { player1Id: 'p3', player2Id: 'p4' },
          ],
        },
        CURRENT_USER,
      );

      expect(prisma.ongoingTeam.createMany).toHaveBeenCalledWith({
        data: [
          { eventId: 'event-1', player1Id: 'p1', player2Id: 'p2' },
          { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
        ],
      });
    });

    it('accepts an empty roster and just clears everything', async () => {
      await service.setTeams('event-1', { teams: [] }, CURRENT_USER);

      expect(prisma.ongoingTeam.createMany).not.toHaveBeenCalled();
      expect(prisma.ongoingTeam.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'event-1' } });
    });

    it('rejects a non-array teams payload instead of throwing a raw TypeError', async () => {
      await expect(service.setTeams('event-1', { teams: 5 as any }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('teams must be an array'),
      );
    });

    it('rejects a missing request body instead of throwing a raw TypeError', async () => {
      await expect(service.setTeams('event-1', undefined as any, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('teams must be an array'),
      );
    });

    it('rejects a team missing player1Id or player2Id', async () => {
      await expect(service.setTeams('event-1', { teams: [{ player2Id: 'p2' } as any] }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('A team must include both player1Id and player2Id'),
      );
    });
  });

  describe('OngoingService.setTeams planning guard', () => {
    it('refuses to replace the roster once any match has a result', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(
        service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] }, CURRENT_USER),
      ).rejects.toThrow(new ConflictException('The tournament has already started; its roster is locked'));
    });

    it('counts only games that carry a result when deciding whether the tournament started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }] as any);

      await service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] }, CURRENT_USER);

      expect(prisma.ongoingGame.count).toHaveBeenCalledWith({
        where: { eventId: 'event-1', team1Points: { not: null }, team2Points: { not: null } },
      });
    });

    it('does not touch the roster when the guard rejects', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 2);

      await expect(service.setTeams('event-1', { teams: [] }, CURRENT_USER)).rejects.toThrow(ConflictException);
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

      await expect(service.generateSchedule('event-1', CURRENT_USER)).rejects.toThrow(
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

      await service.generateSchedule('event-1', CURRENT_USER);

      expect(calls).toEqual(['deleteMany', 'createMany']);
    });

    it('writes one fixture per pairing, each carrying the event id', async () => {
      await service.generateSchedule('event-1', CURRENT_USER);

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

      await service.generateSchedule('event-1', CURRENT_USER);

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

      await expect(
        service.updateGameScore('missing', { team1Points: 15, team2Points: 7 }, CURRENT_USER),
      ).rejects.toThrow(new NotFoundException('Ongoing game with ID missing not found'));
    });

    it('rejects a negative score', async () => {
      await expect(
        service.updateGameScore('game-1', { team1Points: -1, team2Points: 7 }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('Points must be whole numbers of 0 or more'));
    });

    it('rejects a non-integer score', async () => {
      await expect(
        service.updateGameScore('game-1', { team1Points: 15.5, team2Points: 7 }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('Points must be whole numbers of 0 or more'));
    });

    it('rejects a draw, because a set always has a winner', async () => {
      await expect(
        service.updateGameScore('game-1', { team1Points: 15, team2Points: 15 }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('A set cannot end in a draw'));
    });

    it('stores both scores on the game', async () => {
      const result = await service.updateGameScore('game-1', { team1Points: 15, team2Points: 7 }, CURRENT_USER);

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: { team1Points: 15, team2Points: 7 },
      });
      expect(result.team1Points).toBe(15);
      expect(result.team2Points).toBe(7);
    });

    it('fails closed with a 400 when invoked directly with no dto, rather than throwing a TypeError', async () => {
      await expect(service.updateGameScore('game-1', undefined as any, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('team1Points and team2Points are required'),
      );
    });

    it('rejects a string score instead of throwing a raw TypeError', async () => {
      await expect(
        service.updateGameScore('game-1', { team1Points: '15' as any, team2Points: 7 }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('Points must be whole numbers of 0 or more'));
    });

    it('rejects a null score instead of throwing a raw TypeError', async () => {
      await expect(
        service.updateGameScore('game-1', { team1Points: null as any, team2Points: 7 }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('Points must be whole numbers of 0 or more'));
    });

    it('rejects an absent team2Points instead of throwing a raw TypeError', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: 15 } as any, CURRENT_USER)).rejects.toThrow(
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

      await expect(service.updateGameScore('g1', { team1Points: 15, team2Points: 9 }, CURRENT_USER)).rejects.toThrow(
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

      await expect(service.updateGameScore('g1', { team1Points: 15, team2Points: 9 }, CURRENT_USER)).rejects.toThrow(
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
      const result = await service.clearGameResult('game-1', CURRENT_USER);

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: { team1Points: null, team2Points: null },
      });
      expect(result.team1Points).toBeNull();
      expect(result.round).toBe(1);
    });

    it('throws a 404 when the game does not exist', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => null as any);

      await expect(service.clearGameResult('missing', CURRENT_USER)).rejects.toThrow(NotFoundException);
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

      await expect(
        service.updateGameScore('g-group-1', { team1Points: 15, team2Points: 10 }, CURRENT_USER),
      ).rejects.toThrow(
        new ConflictException(
          'Group results are locked once the playoff has been generated; delete the playoff to edit them',
        ),
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses to clear a group result once any playoff game exists', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => groupGame({ team1Points: 15, team2Points: 10 }) as any);
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.clearGameResult('g-group-1', CURRENT_USER)).rejects.toThrow(
        new ConflictException(
          'Group results are locked once the playoff has been generated; delete the playoff to edit them',
        ),
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('still edits a group result freely when no playoff exists (regression guard)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => groupGame() as any);
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ ...groupGame(), ...args.data }));

      const result = await service.updateGameScore('g-group-1', { team1Points: 15, team2Points: 10 }, CURRENT_USER);

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

      const result = await service.clearGameResult('g-group-1', CURRENT_USER);

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

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 }, CURRENT_USER);

      expect(prisma.ongoingGame.findFirst).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'playoff', bracketRound: 2, bracketSlot: 0 },
      });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-next' },
        data: { team1Id: 't1' },
      });
    });

    it('advances the winner into the next round team2Id when the slot is odd', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => playoffGame({ bracketSlot: 1, team1Id: 't3', team2Id: 't4' }) as any,
      );
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame({ bracketRound: 2, bracketSlot: 0 }) as any);

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER);

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

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 9 }, CURRENT_USER);

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

      await service.updateGameScore('g1', { team1Points: 5, team2Points: 15 }, CURRENT_USER);

      // team2 (t2) won on points, so t2 — not t1 — must be the id written downstream.
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g-next' },
        data: { team1Id: 't2' },
      });
    });

    it('the final round advances nobody and does not error', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame({ bracketRound: 2, bracketSlot: 0 }) as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => null as any);

      await expect(
        service.updateGameScore('g1', { team1Points: 15, team2Points: 10 }, CURRENT_USER),
      ).resolves.toBeDefined();

      expect(prisma.ongoingGame.findFirst).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'playoff', bracketRound: 3, bracketSlot: 0 },
      });
      // Only the game's own score write happens; nothing downstream to advance into.
      expect(prisma.ongoingGame.update).toHaveBeenCalledTimes(1);
    });

    it('writes the score and the advancement in the same transaction', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame() as any);

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 }, CURRENT_USER);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('never sets points when filling a downstream slot (rule 6 guard)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => nextRoundGame() as any);

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 }, CURRENT_USER);

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

      await expect(service.clearGameResult('g1', CURRENT_USER)).rejects.toThrow(
        new ConflictException(
          "This game's winner has already advanced into a played later round; clear that result first",
        ),
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

      const result = await service.clearGameResult('g1', CURRENT_USER);

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
      prisma.ongoingGame.findUnique = jest.fn(
        async () => playedPlayoffGame({ bracketRound: 2, bracketSlot: 0 }) as any,
      );
      prisma.ongoingGame.findFirst = jest.fn(async () => null as any);

      const result = await service.clearGameResult('g1', CURRENT_USER);

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

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER)).rejects.toThrow(
        RULE_4,
      );
    });

    it('writes nothing at all when it refuses, so the score and the bracket stay in agreement', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => successor({ team1Points: 15, team2Points: 12 }) as any);

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER)).rejects.toThrow(
        RULE_4,
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses uniformly, even when the edit keeps the same winner', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => successor({ team1Points: 15, team2Points: 12 }) as any);

      // t1 still wins, so the successor's slot would not actually change — refused anyway, because
      // "undo the later round first" is a rule a caller can hold in their head; a same-winner
      // exception is not.
      await expect(service.updateGameScore('g1', { team1Points: 21, team2Points: 3 }, CURRENT_USER)).rejects.toThrow(
        RULE_4,
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('allows the edit and re-advances the new winner while the successor is still unplayed', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => playedPlayoffGame() as any);
      prisma.ongoingGame.findFirst = jest.fn(async () => successor() as any);

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER);

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

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER);

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { team1Points: 10, team2Points: 15 },
      });
    });

    it('does not apply rule 4 to group games, which have no successor geometry', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => playedPlayoffGame({ phase: 'group', bracketRound: null, bracketSlot: null, round: 1 }) as any,
      );
      prisma.ongoingGame.findFirst = jest.fn(async () => null as any);
      prisma.ongoingGame.count = jest.fn(async () => 0);

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER);

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

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 }, CURRENT_USER);

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-final' }, data: { team1Id: 't1' } });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-third' }, data: { team1Id: 't2' } });
    });

    it('advances the winner and the loser mirrored into team2Id for the odd-slot semifinal', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => semifinal({ bracketSlot: 1, team1Id: 't3', team2Id: 't4' }) as any,
      );
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame({ bracketSlot: 0 }), thirdPlaceGame());

      await service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER);

      // t4 won, t3 lost.
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-final' }, data: { team2Id: 't4' } });
      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({ where: { id: 'g-third' }, data: { team2Id: 't3' } });
    });

    it('does not touch a 3rd-place row for a non-semifinal round, even when one exists in the event', async () => {
      // An 8-team bracket: round 1 is the quarterfinal (maxBracketRound - 1 = 2, not 1).
      prisma.ongoingGame.aggregate = jest.fn(async () => ({ _max: { bracketRound: 3 } }));
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal({ bracketRound: 1, bracketSlot: 0 }) as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame({ bracketRound: 2 }), thirdPlaceGame());

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 }, CURRENT_USER);

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

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 }, CURRENT_USER);

      expect(prisma.ongoingGame.aggregate).not.toHaveBeenCalled();
      expect(prisma.ongoingGame.update).toHaveBeenCalledTimes(1);
    });

    it('never carries a score when filling the 3rd-place row (rule 6 guard)', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame(), thirdPlaceGame());

      await service.updateGameScore('g1', { team1Points: 15, team2Points: 10 }, CURRENT_USER);

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

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER)).rejects.toThrow(
        RULE_4,
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses to clear the semifinal once the 3rd-place match it feeds has been played, even though the final has not', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame(), thirdPlaceGame({ team1Points: 15, team2Points: 8 }));

      await expect(service.clearGameResult('g1', CURRENT_USER)).rejects.toThrow(RULE_4);
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses to edit the semifinal once the final has been played, even though the 3rd-place match has not', async () => {
      // Symmetric to the case above: either played successor blocks, regardless of which one it is.
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(
        finalGame({ team1Points: 21, team2Points: 18 }), // played
        thirdPlaceGame(), // still unplayed
      );

      await expect(service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER)).rejects.toThrow(
        RULE_4,
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('allows editing the semifinal when neither the final nor the 3rd-place match has been played', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => semifinal() as any);
      prisma.ongoingGame.findFirst = routeFindFirst(finalGame(), thirdPlaceGame());

      await expect(
        service.updateGameScore('g1', { team1Points: 10, team2Points: 15 }, CURRENT_USER),
      ).resolves.toBeDefined();
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

      const result = await service.clearGameResult('g1', CURRENT_USER);

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
      await service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER);

      expect(prisma.ongoingTeam.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
      });
      expect(prisma.ongoingTeam.deleteMany).not.toHaveBeenCalled();
      expect(prisma.ongoingGame.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses once the tournament has started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER)).rejects.toThrow(
        ConflictException,
      );
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

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER)).rejects.toThrow(
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

        await expect(
          service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER),
        ).resolves.toBeDefined();
      });

      it('is closed for a tournament dated yesterday', async () => {
        const yesterday = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() - 1));
        prisma.ongoingEvent.findUnique = jest.fn(async () => eventDatedAt(yesterday) as any);

        await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER)).rejects.toThrow(
          new ConflictException('Registration for this tournament has closed'),
        );
      });

      it('is open for a tournament dated today at 23:00 even though "now" is early morning', async () => {
        const todayLate = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate(), 23, 0, 0));
        prisma.ongoingEvent.findUnique = jest.fn(async () => eventDatedAt(todayLate) as any);

        await expect(
          service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER),
        ).resolves.toBeDefined();
      });

      it('is open for a tournament dated tomorrow', async () => {
        const tomorrow = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + 1));
        prisma.ongoingEvent.findUnique = jest.fn(async () => eventDatedAt(tomorrow) as any);

        await expect(
          service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER),
        ).resolves.toBeDefined();
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

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER)).rejects.toThrow(
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

      await service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER);

      expect(prisma.ongoingTeam.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
      });
    });

    it('refuses a player who is already in a team of this tournament', async () => {
      await expect(service.addTeam('event-1', { player1Id: 'p1', player2Id: 'p3' }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('Player p1 is already in another team'),
      );
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('refuses two identical players', async () => {
      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p3' }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('A team must have two different players'),
      );
    });

    it('refuses an unknown player', async () => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }] as any);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'ghost' }, CURRENT_USER)).rejects.toThrow(
        new NotFoundException('Player with ID ghost not found'),
      );
    });
  });

  describe('OngoingService authorization', () => {
    const NON_CREATOR_USER = { ...CURRENT_USER, sub: 'user-2', role: 'player' };
    const CREATOR_USER = { ...CURRENT_USER, sub: 'creator-1', role: 'player' };
    const EVENT_WITH_CREATOR = { ...EVENT_ROW, createdByUserId: 'creator-1' };

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => EVENT_WITH_CREATOR as any);
    });

    it('create() stamps the event with the current user as creator', async () => {
      await service.create({ name: 'T', date: '2030-01-01T00:00:00.000Z' }, CURRENT_USER);

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.createdByUserId).toBe('user-1');
    });

    it('remove() allows the creator', async () => {
      await expect(service.remove('event-1', CREATOR_USER)).resolves.toBeUndefined();
      expect(prisma.ongoingEvent.delete).toHaveBeenCalled();
    });

    it('remove() allows an admin who is not the creator', async () => {
      const admin = { ...NON_CREATOR_USER, role: 'admin' };

      await expect(service.remove('event-1', admin)).resolves.toBeUndefined();
      expect(prisma.ongoingEvent.delete).toHaveBeenCalled();
    });

    it('remove() refuses a logged-in user who is neither the creator nor an admin', async () => {
      await expect(service.remove('event-1', NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
      expect(prisma.ongoingEvent.delete).not.toHaveBeenCalled();
    });

    it('updateConfig() refuses a non-creator, non-admin user', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 1, courts: 1 }, NON_CREATOR_USER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('setTeams() refuses a non-creator, non-admin user', async () => {
      await expect(service.setTeams('event-1', { teams: [] }, NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
    });

    it('generateSchedule() refuses a non-creator, non-admin user', async () => {
      await expect(service.generateSchedule('event-1', NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
    });

    it('generatePlayoff() refuses a non-creator, non-admin user', async () => {
      await expect(service.generatePlayoff('event-1', NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
    });

    it('deletePlayoff() refuses a non-creator, non-admin user', async () => {
      await expect(service.deletePlayoff('event-1', NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
    });

    it('finishTournament() refuses a non-creator, non-admin user', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 0);
      await expect(service.finishTournament('event-1', NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
    });

    it('updateGameScore() refuses a user who is neither manager nor an entrant', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => ({ eventId: 'event-1', team1Id: 't1', team2Id: 't2', phase: 'group' } as any),
      );

      await expect(
        service.updateGameScore('game-1', { team1Points: 21, team2Points: 15 }, NON_CREATOR_USER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('clearGameResult() refuses a user who is neither manager nor an entrant', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => ({ eventId: 'event-1', team1Id: 't1', team2Id: 't2', phase: 'group' } as any),
      );

      await expect(service.clearGameResult('game-1', NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
    });

    it('removeTeam() refuses a non-creator, non-admin user', async () => {
      // A future date and two players other than the caller's, so the refusal is unambiguously about
      // who they are rather than about the cancellation deadline.
      prisma.ongoingTeam.findUnique = jest.fn(
        async () =>
          ({
            id: 't1',
            eventId: 'event-1',
            player1Id: 'p1',
            player2Id: 'p2',
            event: { createdByUserId: 'user-1', date: new Date('2999-01-01T00:00:00.000Z') },
          } as any),
      );
      prisma.ongoingGame.count = jest.fn(async () => 0);

      await expect(service.removeTeam('t1', NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('OngoingService.addTeam self-registration rule', () => {
    const OPEN_EVENT = {
      ...EVENT_ROW,
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      config: { gamesPerPair: 1, courts: 2, maxTeams: null },
      teams: [],
    };

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => OPEN_EVENT as any);
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }, { id: 'p4' }] as any);
      prisma.ongoingTeam.create = jest.fn(async () => ({ id: 't2' }));
    });

    it('allows registration when the current user is player1', async () => {
      userService.findById.mockResolvedValue({ playerId: 'p3' } as any);

      await expect(
        service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER),
      ).resolves.toBeDefined();
    });

    it('allows registration when the current user is player2', async () => {
      userService.findById.mockResolvedValue({ playerId: 'p4' } as any);

      await expect(
        service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER),
      ).resolves.toBeDefined();
    });

    // The rule only binds a non-manager: a creator or admin may register any pair (see the visibility
    // design), so these two use a plain player rather than CURRENT_USER, which is an admin.
    const PLAIN_PLAYER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

    it('refuses when neither player is the current user', async () => {
      userService.findById.mockResolvedValue({ playerId: 'p5' } as any);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, PLAIN_PLAYER)).rejects.toThrow(
        new BadRequestException('You must register yourself as one of the two players'),
      );
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('refuses when the current user has no linked player', async () => {
      userService.findById.mockResolvedValue({ playerId: null } as any);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, PLAIN_PLAYER)).rejects.toThrow(
        new BadRequestException('You must register yourself as one of the two players'),
      );
    });
  });

  describe('OngoingService.removeTeam', () => {
    beforeEach(() => {
      prisma.ongoingTeam.findUnique = jest.fn(
        async () =>
          ({
            id: 't1',
            eventId: 'event-1',
            player1Id: 'p1',
            player2Id: 'p2',
            event: { createdByUserId: 'user-1', date: new Date('2999-01-01T00:00:00.000Z') },
          } as any),
      );
      prisma.ongoingTeam.delete = jest.fn(async () => ({ id: 't1' }));
      prisma.ongoingGame.count = jest.fn(async () => 0);
    });

    it('throws a 404 naming the id when the team does not exist', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => null as any);

      await expect(service.removeTeam('missing', CURRENT_USER)).rejects.toThrow(
        new NotFoundException('Ongoing team with ID missing not found'),
      );
    });

    it('refuses once the tournament has started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.removeTeam('t1', CURRENT_USER)).rejects.toThrow(ConflictException);
      expect(prisma.ongoingTeam.delete).not.toHaveBeenCalled();
    });

    it('deletes the team, letting the FK cascade take its unplayed fixtures', async () => {
      await service.removeTeam('t1', CURRENT_USER);

      expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('checks the planning stage of the team OWN event', async () => {
      // Distinct from the default 'event-1' fixtures used elsewhere in this describe, so this test
      // actually binds to team.eventId rather than passing against a hardcoded 'event-1'.
      prisma.ongoingTeam.findUnique = jest.fn(
        async () =>
          ({
            id: 't1',
            eventId: 'event-owning-the-team',
            player1Id: 'p1',
            player2Id: 'p2',
            event: { createdByUserId: 'user-1', date: new Date('2999-01-01T00:00:00.000Z') },
          } as any),
      );

      await service.removeTeam('t1', CURRENT_USER);

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
      createdByUserId: 'user-1',
      createdByUser: { id: 'user-1', name: 'Ann Organiser' },
      config: { gamesPerPair: 1, courts: 1, maxTeams: null, visibility: 'public', allowSoloRegistration: false },
      teams: [team],
      soloPlayers: [],
      games: [],
      ...over,
    });

    it('still lists a tournament whose date has passed, marking registration closed', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [row({ date: past })] as any);

      const [listed] = await service.findOpen();

      expect(listed).toMatchObject({ registrationOpen: false, hasStarted: false });
    });

    it('still lists a tournament that has started, marking it as such', async () => {
      prisma.ongoingEvent.findMany = jest.fn(
        async () => [row({ games: [{ team1Points: 15, team2Points: 7 }] })] as any,
      );

      const [listed] = await service.findOpen();

      expect(listed).toMatchObject({ hasStarted: true, registrationOpen: true });
    });

    it('asks the database only for unfinished tournaments — a finished one drops off entirely', async () => {
      await service.findOpen();

      const args = (prisma.ongoingEvent.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual({ finishedAt: null });
    });

    it('reports a tournament whose fixtures exist but are all unplayed as not started', async () => {
      prisma.ongoingEvent.findMany = jest.fn(
        async () => [row({ games: [{ team1Points: null, team2Points: null }] })] as any,
      );

      const listed = await service.findOpen();

      expect(listed).toHaveLength(1);
      expect(listed[0].hasStarted).toBe(false);
    });

    // Full tournaments stay listed on purpose: the calendar shows them with registration disabled and
    // a "no spots left" note, rather than making a filled-up tournament vanish from the page.
    it('still lists a tournament that is full', async () => {
      prisma.ongoingEvent.findMany = jest.fn(
        async () => [row({ config: { gamesPerPair: 1, courts: 1, maxTeams: 1 } })] as any,
      );

      const result = await service.findOpen();

      expect(result).toHaveLength(1);
      expect(result[0].maxTeams).toBe(1);
      expect(result[0].teamsCount).toBe(1);
    });

    it('returns each open tournament with its roster and counts', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [row({})] as any);

      const result = await service.findOpen();

      expect(result).toHaveLength(1);
      expect(result[0].teamsCount).toBe(1);
      expect(result[0].maxTeams).toBeNull();
      expect(result[0].teams[0].player1.name).toBe('A');
      // The calendar decides whether to offer registration on a private tournament from this field.
      expect(result[0].createdByUserId).toBe('user-1');
      // The calendar card names the organiser, so the account travels with the open-events payload.
      expect(result[0].createdBy).toEqual({ id: 'user-1', name: 'Ann Organiser', isAnonymous: false });
      expect(result[0].visibility).toBe('public');
      expect(result[0].allowSoloRegistration).toBe(false);
    });

    it('orders soonest first', async () => {
      await service.findOpen();

      const args = (prisma.ongoingEvent.findMany as jest.Mock).mock.calls[0][0];
      expect(args.orderBy).toEqual({ date: 'asc' });
    });
  });

  describe('OngoingService — "started" agreement between findOpen and addTeam', () => {
    // Both guards must treat a game as "played" only once BOTH scores are recorded. findOpen no longer
    // hides a started tournament — it flags it — so the agreement being pinned here is that the flag
    // the calendar reads and the rejection addTeam issues come from the same isGamePlayed predicate.
    const playedGame = { team1Points: 15, team2Points: 7 };

    it('findOpen flags as started, and addTeam rejects, the exact same played-game fixture', async () => {
      prisma.ongoingEvent.findMany = jest.fn(
        async () =>
          [
            {
              id: 'e',
              name: 'n',
              date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              config: { gamesPerPair: 1, courts: 1, maxTeams: null },
              teams: [],
              soloPlayers: [],
              games: [playedGame],
            },
          ] as any,
      );

      const [listed] = await service.findOpen();
      expect(listed).toMatchObject({ id: 'e', hasStarted: true });

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

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('OngoingService.create with a roster', () => {
    beforeEach(() => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }] as any);
    });

    it('creates the event, its config and the roster in one call', async () => {
      await service.create(
        {
          name: 'T',
          date: '2030-01-01T10:00:00.000Z',
          maxTeams: 8,
          teams: [{ player1Id: 'p1', player2Id: 'p2' }],
        },
        CURRENT_USER,
      );

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.config.create).toEqual({
        gamesPerPair: 1,
        courts: 1,
        maxTeams: 8,
        scheme: 'roundRobin',
        groupCount: 1,
        qualifiersPerGroup: null,
        rotationRounds: 3,
        visibility: 'public',
        allowSoloRegistration: false,
        soloOnlyRegistration: false,
      });
      expect(args.data.teams.create).toEqual([{ player1Id: 'p1', player2Id: 'p2' }]);
    });

    it('rejects an unknown player before creating anything', async () => {
      prisma.player.findMany = jest.fn(async () => [] as any);

      await expect(
        service.create(
          { name: 'T', date: '2030-01-01T10:00:00.000Z', teams: [{ player1Id: 'p1', player2Id: 'p2' }] },
          CURRENT_USER,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });

    it('still creates a tournament with no roster at all', async () => {
      await service.create({ name: 'T', date: '2030-01-01T10:00:00.000Z' }, CURRENT_USER);

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.teams).toBeUndefined();
      expect(args.data.config.create.maxTeams).toBeNull();
    });
  });

  describe('OngoingService.create startTime and location', () => {
    const base = { name: 'T', date: '2030-01-01T00:00:00.000Z' };

    it('stores a valid HH:MM start time and a location', async () => {
      await service.create({ ...base, startTime: '18:30', location: 'Beach Court 2' }, CURRENT_USER);

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.startTime).toBe('18:30');
      expect(args.data.location).toBe('Beach Court 2');
    });

    it('accepts a tournament with neither field', async () => {
      await service.create(base, CURRENT_USER);

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.startTime).toBeNull();
      expect(args.data.location).toBeNull();
    });

    it('accepts midnight and the last minute of the day', async () => {
      await service.create({ ...base, startTime: '00:00' }, CURRENT_USER);
      await service.create({ ...base, startTime: '23:59' }, CURRENT_USER);

      expect(prisma.ongoingEvent.create).toHaveBeenCalledTimes(2);
    });

    it('rejects a malformed start time', async () => {
      for (const bad of ['24:00', '18:60', '6:30', '1830', 'evening', '18:30:00']) {
        await expect(service.create({ ...base, startTime: bad }, CURRENT_USER)).rejects.toThrow(
          new BadRequestException('startTime must be in HH:MM 24-hour format'),
        );
      }
    });

    it('rejects a non-string location', async () => {
      await expect(service.create({ ...base, location: 42 as any }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('location must be a string'),
      );
    });

    it('trims the location and treats an empty one as absent', async () => {
      await service.create({ ...base, location: '   ' }, CURRENT_USER);

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.location).toBeNull();
    });

    it('creates nothing when the start time is malformed', async () => {
      await expect(service.create({ ...base, startTime: 'nope' }, CURRENT_USER)).rejects.toThrow(BadRequestException);
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
      // playerStats feeds the rating; the user select feeds the display-anonymity flag.
      expect(args.include.teams.include).toEqual({
        player1: { include: { playerStats: true, user: { select: { isAnonymous: true } } } },
        player2: { include: { playerStats: true, user: { select: { isAnonymous: true } } } },
      });
    });
  });

  describe('OngoingService.updateConfig maxTeams', () => {
    it('rejects a maxTeams below two', async () => {
      await expect(
        service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, maxTeams: 1 }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('maxTeams must be at least 2'));
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

      await expect(
        service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, maxTeams: 2 }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('maxTeams cannot be lower than the number of registered teams'));
    });

    it('accepts an absent maxTeams as unlimited', async () => {
      await service.updateConfig('event-1', { gamesPerPair: 1, courts: 1 }, CURRENT_USER);

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.maxTeams).toBeNull();
    });
  });

  describe('OngoingService.updateConfig scheme and groups', () => {
    it('rejects an unknown scheme', async () => {
      await expect(
        service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, scheme: 'ladder' } as any, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('scheme must be roundRobin, groupsPlayoff or fullRotation'));
    });

    it('forces roundRobin to a single group with no qualifiers', async () => {
      await service.updateConfig(
        'event-1',
        {
          gamesPerPair: 1,
          courts: 1,
          scheme: 'roundRobin',
          groupCount: 3,
          qualifiersPerGroup: 2,
        } as any,
        CURRENT_USER,
      );

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.groupCount).toBe(1);
      expect(args.update.qualifiersPerGroup).toBeNull();
    });

    it('requires at least one group for groupsPlayoff', async () => {
      await expect(
        service.updateConfig(
          'event-1',
          {
            gamesPerPair: 1,
            courts: 1,
            scheme: 'groupsPlayoff',
            groupCount: 0,
            qualifiersPerGroup: 2,
          } as any,
          CURRENT_USER,
        ),
      ).rejects.toThrow(new BadRequestException('groupsPlayoff needs at least 1 group'));
    });

    it('accepts a single group, which seeds the playoff straight off one table', async () => {
      await service.updateConfig(
        'event-1',
        {
          gamesPerPair: 1,
          courts: 1,
          scheme: 'groupsPlayoff',
          groupCount: 1,
          qualifiersPerGroup: 4,
        } as any,
        CURRENT_USER,
      );

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.scheme).toBe('groupsPlayoff');
      expect(args.update.groupCount).toBe(1);
      expect(args.update.qualifiersPerGroup).toBe(4);
    });

    it('rejects a bracket size that is not a power of two', async () => {
      await expect(
        service.updateConfig(
          'event-1',
          {
            gamesPerPair: 1,
            courts: 1,
            scheme: 'groupsPlayoff',
            groupCount: 3,
            qualifiersPerGroup: 3,
          } as any,
          CURRENT_USER,
        ),
      ).rejects.toThrow(new BadRequestException('groupCount times qualifiersPerGroup must be a power of two'));
    });

    it('accepts 2 groups with 2 qualifiers each', async () => {
      await service.updateConfig(
        'event-1',
        {
          gamesPerPair: 1,
          courts: 1,
          scheme: 'groupsPlayoff',
          groupCount: 2,
          qualifiersPerGroup: 2,
        } as any,
        CURRENT_USER,
      );

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.scheme).toBe('groupsPlayoff');
      expect(args.update.groupCount).toBe(2);
      expect(args.update.qualifiersPerGroup).toBe(2);
    });

    it('accepts 2 groups with 4 qualifiers each', async () => {
      await service.updateConfig(
        'event-1',
        {
          gamesPerPair: 1,
          courts: 1,
          scheme: 'groupsPlayoff',
          groupCount: 2,
          qualifiersPerGroup: 4,
        } as any,
        CURRENT_USER,
      );

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

      await service.generateSchedule('event-1', CURRENT_USER);

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

      await service.generateSchedule('event-1', CURRENT_USER);

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
              rotationRounds: 3,
            },
            teams: teams(4),
          } as any),
      );

      await service.generateSchedule('event-1', CURRENT_USER);

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

      await expect(service.generateSchedule('event-1', CURRENT_USER)).rejects.toThrow(BadRequestException);
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
              rotationRounds: 3,
              visibility: 'public',
              allowSoloRegistration: false,
              soloOnlyRegistration: false,
            },
          } as any),
      );

      await expect(service.generatePlayoff('event-1', CURRENT_USER)).rejects.toThrow(
        new BadRequestException('The playoff is only available for the groupsPlayoff scheme'),
      );
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });

    it('refuses when the tournament has no group games at all', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({ ...GROUPS_PLAYOFF_EVENT, games: [] } as any));

      await expect(service.generatePlayoff('event-1', CURRENT_USER)).rejects.toThrow(
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

      await expect(service.generatePlayoff('event-1', CURRENT_USER)).rejects.toThrow(
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

      await expect(service.generatePlayoff('event-1', CURRENT_USER)).rejects.toThrow(
        new ConflictException('The playoff already exists; delete it first before generating a new one'),
      );
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });

    it('writes log2(groupCount x qualifiersPerGroup) rounds plus a 3rd-place row, round 1 full and the rest empty', async () => {
      await service.generatePlayoff('event-1', CURRENT_USER);

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
      await service.generatePlayoff('event-1', CURRENT_USER);

      const data = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      const normalRows = data.filter((row: any) => row.bracketRound !== null);
      for (const row of normalRows) {
        expect(row.thirdPlace).toBe(false);
      }
    });

    it('seeds from the group standings, not registration order', async () => {
      await service.generatePlayoff('event-1', CURRENT_USER);

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

      await expect(service.generatePlayoff('event-1', CURRENT_USER)).rejects.toThrow(
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
      await service.generatePlayoff('event-1', CURRENT_USER);

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
      await service.generatePlayoff('event-1', CURRENT_USER);

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

    // The list card names the roster, the solo pool and the organiser, so all three travel with it
    // rather than the page having to fan out to the detail endpoint per tournament.
    it('carries the roster, the solo pool and the creator on each list item', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [
        {
          ...EVENT_ROW,
          createdByUser: { id: 'user-1', name: 'Ann Organiser' },
          teams: [
            {
              id: 'team-1',
              player1: { id: 'p1', name: 'Ann', avatar: null, playerStats: { rank: 1200 } },
              player2: { id: 'p2', name: 'Bob', avatar: null, playerStats: { rank: 900 } },
            },
          ],
          soloPlayers: [{ id: 'solo-1', player: { id: 'p3', name: 'Cid', avatar: null, playerStats: null } }],
          games: [],
        },
      ]) as any;

      const [item] = await service.findAll();

      expect(item.teamsCount).toBe(1);
      expect(item.teams).toEqual([
        {
          id: 'team-1',
          player1: { id: 'p1', name: 'Ann', avatar: null, isAnonymous: false },
          player2: { id: 'p2', name: 'Bob', avatar: null, isAnonymous: false },
          rating: 2100,
          groupIndex: null,
        },
      ]);
      expect(item.soloPlayers).toEqual([
        { id: 'solo-1', player: { id: 'p3', name: 'Cid', avatar: null, isAnonymous: false }, rating: 1000 },
      ]);
      expect(item.createdBy).toEqual({ id: 'user-1', name: 'Ann Organiser', isAnonymous: false });
      expect(item.visibility).toBe('public');
    });

    it('marks a private tournament on the list item', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [
        { ...EVENT_ROW, config: { ...EVENT_ROW.config, visibility: 'private' }, games: [] },
      ]) as any;

      const [item] = await service.findAll();

      expect(item.visibility).toBe('private');
    });

    it('falls back to public when the config row is absent', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [{ ...EVENT_ROW, config: null, games: [] }]) as any;

      const [item] = await service.findAll();

      expect(item.visibility).toBe('public');
    });

    it('reports a null creator when the account behind the tournament is gone', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [
        { ...EVENT_ROW, createdByUserId: null, createdByUser: null, games: [] },
      ]) as any;

      const [item] = await service.findAll();

      expect(item.createdBy).toBeNull();
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

      await expect(service.finishTournament('event-1', CURRENT_USER)).rejects.toThrow(ConflictException);
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

      await expect(service.finishTournament('event-1', CURRENT_USER)).rejects.toThrow(ConflictException);
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
              game({
                id: 'third',
                phase: 'playoff',
                bracketRound: null,
                thirdPlace: true,
                team1Points: 21,
                team2Points: 18,
              }),
            ],
          } as any),
      );

      await service.finishTournament('event-1', CURRENT_USER);

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

      await service.finishTournament('event-1', CURRENT_USER);

      expect(prisma.ongoingEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { finishedAt: expect.any(Date) },
      });
    });

    it('refuses to finish a roundRobin tournament with no games at all', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(
        async () => ({ ...EVENT_ROW, config: { scheme: 'roundRobin', groupCount: 1 }, games: [] } as any),
      );

      await expect(service.finishTournament('event-1', CURRENT_USER)).rejects.toThrow(ConflictException);
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

      await expect(service.finishTournament('event-1', CURRENT_USER)).rejects.toThrow(ConflictException);
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

      await service.finishTournament('event-1', CURRENT_USER);

      expect(prisma.ongoingEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { finishedAt: expect.any(Date) },
      });
    });

    it('throws a 404 rather than finishing when the event is missing', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.finishTournament('missing', CURRENT_USER)).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingEvent.update).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.deletePlayoff', () => {
    it('removes only phase playoff games and leaves group games untouched', async () => {
      await service.deletePlayoff('event-1', CURRENT_USER);

      expect(prisma.ongoingGame.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'playoff' },
      });
    });

    it('throws a 404 rather than deleting when the event is missing', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.deletePlayoff('missing', CURRENT_USER)).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingGame.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService.findOne solo pool', () => {
    it('maps solo entrants with their own rating, not a team sum', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        soloPlayers: [
          {
            id: 'solo-1',
            player: { id: 'p1', name: 'Ann', avatar: null, playerStats: { rank: 1300 } },
          },
          {
            id: 'solo-2',
            player: { id: 'p2', name: 'Bob', avatar: null, playerStats: null },
          },
        ],
      })) as any;

      const event = await service.findOne('event-1');

      expect(event.soloPlayers).toEqual([
        { id: 'solo-1', player: { id: 'p1', name: 'Ann', avatar: null, isAnonymous: false }, rating: 1300 },
        { id: 'solo-2', player: { id: 'p2', name: 'Bob', avatar: null, isAnonymous: false }, rating: 1000 },
      ]);
    });

    it('exposes the two registration flags on the config', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { ...EVENT_ROW.config, visibility: 'private', allowSoloRegistration: true },
      })) as any;

      const event = await service.findOne('event-1');

      expect(event.config.visibility).toBe('private');
      expect(event.config.allowSoloRegistration).toBe(true);
    });

    it('defaults the flags when the config row is absent', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({ ...EVENT_ROW, config: null })) as any;

      const event = await service.findOne('event-1');

      expect(event.config.visibility).toBe('public');
      expect(event.config.allowSoloRegistration).toBe(false);
    });
  });

  describe('OngoingService registration flags', () => {
    it('defaults a new tournament to public with solo registration off', async () => {
      await service.create({ name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z' }, CURRENT_USER);

      expect(prisma.ongoingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: { create: expect.objectContaining({ visibility: 'public', allowSoloRegistration: false }) },
          }),
        }),
      );
    });

    it('persists the flags given at creation', async () => {
      await service.create(
        { name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z', visibility: 'private', allowSoloRegistration: true },
        CURRENT_USER,
      );

      expect(prisma.ongoingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: { create: expect.objectContaining({ visibility: 'private', allowSoloRegistration: true }) },
          }),
        }),
      );
    });

    it('rejects a visibility that is neither public nor private', async () => {
      await expect(
        service.create(
          { name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z', visibility: 'secret' } as any,
          CURRENT_USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-boolean allowSoloRegistration', async () => {
      await expect(
        service.create(
          { name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z', allowSoloRegistration: 'yes' } as any,
          CURRENT_USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('writes both flags through updateConfig', async () => {
      await service.updateConfig(
        'event-1',
        { gamesPerPair: 1, courts: 2, visibility: 'private', allowSoloRegistration: true },
        CURRENT_USER,
      );

      expect(prisma.ongoingEventConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ visibility: 'private', allowSoloRegistration: true }),
        }),
      );
    });

    it('refuses to turn solo registration off while the pool is not empty', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { ...EVENT_ROW.config, allowSoloRegistration: true },
        soloPlayers: [{ id: 'solo-1', player: { id: 'p1', name: 'Ann', avatar: null, playerStats: null } }],
      })) as any;

      await expect(
        service.updateConfig('event-1', { gamesPerPair: 1, courts: 2, allowSoloRegistration: false }, CURRENT_USER),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('OngoingService.addSoloPlayer', () => {
    const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

    const openSoloEvent = (overrides: any = {}) => ({
      ...EVENT_ROW,
      date: new Date('2999-01-01T00:00:00.000Z'),
      config: { ...EVENT_ROW.config, allowSoloRegistration: true },
      ...overrides,
    });

    it('registers the caller into the pool of a public tournament', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => openSoloEvent()) as any;
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }]) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await service.addSoloPlayer('event-1', {}, PLAYER_USER);

      expect(prisma.ongoingSoloPlayer.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', playerId: 'p3' },
      });
    });

    it('refuses a non-manager registering somebody else', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => openSoloEvent()) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await expect(service.addSoloPlayer('event-1', { playerId: 'p7' }, PLAYER_USER)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a non-manager on a private tournament', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        openSoloEvent({ config: { ...EVENT_ROW.config, allowSoloRegistration: true, visibility: 'private' } }),
      ) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await expect(service.addSoloPlayer('event-1', {}, PLAYER_USER)).rejects.toThrow(ForbiddenException);
    });

    it('lets a manager add any player to a private tournament', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        openSoloEvent({
          createdByUserId: 'user-1',
          config: { ...EVENT_ROW.config, allowSoloRegistration: true, visibility: 'private' },
        }),
      ) as any;
      prisma.player.findMany = jest.fn(async () => [{ id: 'p7' }]) as any;

      await service.addSoloPlayer('event-1', { playerId: 'p7' }, CURRENT_USER);

      expect(prisma.ongoingSoloPlayer.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', playerId: 'p7' },
      });
    });

    it('refuses when solo registration is switched off', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => openSoloEvent({ config: { ...EVENT_ROW.config } })) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await expect(service.addSoloPlayer('event-1', {}, PLAYER_USER)).rejects.toThrow(ConflictException);
    });

    it('refuses a player who is already on the roster', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        openSoloEvent({
          teams: [
            {
              id: 'team-1',
              player1: { id: 'p3', name: 'Ann', avatar: null, playerStats: null },
              player2: { id: 'p4', name: 'Bob', avatar: null, playerStats: null },
            },
          ],
        }),
      ) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await expect(service.addSoloPlayer('event-1', {}, PLAYER_USER)).rejects.toThrow(ConflictException);
    });
  });

  describe('OngoingService.removeSoloPlayer', () => {
    const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

    it('lets the entrant withdraw before the day of the tournament', async () => {
      prisma.ongoingSoloPlayer.findUnique = jest.fn(async () => ({
        id: 'solo-1',
        eventId: 'event-1',
        playerId: 'p3',
        event: { createdByUserId: 'user-1', date: new Date('2999-01-01T00:00:00.000Z') },
      })) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await service.removeSoloPlayer('solo-1', PLAYER_USER);

      expect(prisma.ongoingSoloPlayer.delete).toHaveBeenCalledWith({ where: { id: 'solo-1' } });
    });

    it('refuses the entrant on the day of the tournament', async () => {
      prisma.ongoingSoloPlayer.findUnique = jest.fn(async () => ({
        id: 'solo-1',
        eventId: 'event-1',
        playerId: 'p3',
        event: { createdByUserId: 'user-1', date: new Date() },
      })) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await expect(service.removeSoloPlayer('solo-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
    });

    it('lets a manager withdraw an entrant on the day of the tournament', async () => {
      prisma.ongoingSoloPlayer.findUnique = jest.fn(async () => ({
        id: 'solo-1',
        eventId: 'event-1',
        playerId: 'p3',
        event: { createdByUserId: 'user-1', date: new Date() },
      })) as any;

      await service.removeSoloPlayer('solo-1', CURRENT_USER);

      expect(prisma.ongoingSoloPlayer.delete).toHaveBeenCalledWith({ where: { id: 'solo-1' } });
    });

    it('refuses an unrelated player', async () => {
      prisma.ongoingSoloPlayer.findUnique = jest.fn(async () => ({
        id: 'solo-1',
        eventId: 'event-1',
        playerId: 'p3',
        event: { createdByUserId: 'user-1', date: new Date('2999-01-01T00:00:00.000Z') },
      })) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p8' } as any));

      await expect(service.removeSoloPlayer('solo-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('OngoingService.addTeam access and capacity', () => {
    const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

    const futureEvent = (overrides: any = {}) => ({
      ...EVENT_ROW,
      date: new Date('2999-01-01T00:00:00.000Z'),
      ...overrides,
    });

    it('refuses a non-manager on a private tournament', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        futureEvent({ config: { ...EVENT_ROW.config, visibility: 'private' } }),
      ) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, PLAYER_USER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets a manager register a pair they are not part of', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        futureEvent({ createdByUserId: 'user-1', config: { ...EVENT_ROW.config, visibility: 'private' } }),
      ) as any;
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }, { id: 'p4' }]) as any;

      await service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER);

      expect(prisma.ongoingTeam.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
      });
    });

    it('counts solo entrants against maxTeams', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        futureEvent({
          config: { ...EVENT_ROW.config, maxTeams: 2 },
          teams: [
            {
              id: 'team-1',
              player1: { id: 'p1', name: 'Ann', avatar: null, playerStats: null },
              player2: { id: 'p2', name: 'Bob', avatar: null, playerStats: null },
            },
          ],
          soloPlayers: [
            { id: 'solo-1', player: { id: 'p5', name: 'Cid', avatar: null, playerStats: null } },
            { id: 'solo-2', player: { id: 'p6', name: 'Dot', avatar: null, playerStats: null } },
          ],
        }),
      ) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, PLAYER_USER)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses a pair containing somebody already in the solo pool', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        futureEvent({
          soloPlayers: [{ id: 'solo-1', player: { id: 'p4', name: 'Dot', avatar: null, playerStats: null } }],
        }),
      ) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p3' } as any));

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, PLAYER_USER)).rejects.toThrow(
        ConflictException,
      );
    });

    it('drops the solo entries of everybody named in a replaced roster', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => futureEvent({ createdByUserId: 'user-1' })) as any;
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }, { id: 'p4' }]) as any;

      await service.setTeams('event-1', { teams: [{ player1Id: 'p3', player2Id: 'p4' }] }, CURRENT_USER);

      expect(prisma.ongoingSoloPlayer.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', playerId: { in: ['p3', 'p4'] } },
      });
    });

    // The capacity is reported, not enforced, by findOpen — the client decides what to disable. addTeam
    // stays the enforcement point and still 409s once the slots are gone.
    it('lists a tournament whose capacity is taken by solo entrants, with the numbers to judge it', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [
        futureEvent({
          config: { ...EVENT_ROW.config, maxTeams: 1 },
          soloPlayers: [
            { id: 'solo-1', player: { id: 'p5', name: 'Cid', avatar: null, playerStats: null } },
            { id: 'solo-2', player: { id: 'p6', name: 'Dot', avatar: null, playerStats: null } },
          ],
        }),
      ]) as any;

      const result = await service.findOpen();

      expect(result).toHaveLength(1);
      expect(result[0].maxTeams).toBe(1);
      expect(result[0].teamsCount).toBe(0);
      expect(result[0].soloPlayers).toHaveLength(2);
    });
  });

  describe('OngoingService.removeTeam self-cancellation', () => {
    const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

    const teamRow = (eventDate: Date, startTime: string | null = null) => ({
      id: 'team-1',
      eventId: 'event-1',
      player1Id: 'p3',
      player2Id: 'p4',
      event: { createdByUserId: 'user-1', date: eventDate, startTime },
    });

    // The day the tournament starts on, so a start time can move the deadline within it.
    const inDays = (days: number) => {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + days);
      return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    };

    /** "HH:MM" this many minutes from now, in the UTC frame eventStartInstant reads. */
    const utcClock = (offsetMinutes: number) => {
      const at = new Date(Date.now() + offsetMinutes * 60_000);
      return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
    };

    it('lets a member remove their own team before the day of the tournament', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date('2999-01-01T00:00:00.000Z'))) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p4' } as any));

      await service.removeTeam('team-1', PLAYER_USER);

      expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
    });

    it('refuses a member on the day of the tournament', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date())) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p4' } as any));

      await expect(service.removeTeam('team-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
    });

    it('lets a manager remove a team on the day of the tournament', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date())) as any;

      await service.removeTeam('team-1', CURRENT_USER);

      expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
    });

    it('refuses a player who is in neither slot', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date('2999-01-01T00:00:00.000Z'))) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p8' } as any));

      await expect(service.removeTeam('team-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
    });

    // The 24-hour window, exercised either side of the boundary rather than at whole days: with a
    // start time the deadline falls inside the day before, which the old day-granular rule allowed.
    it('refuses a member once the tournament is less than 24 hours away', async () => {
      // Tomorrow, starting ten minutes earlier in the day than the current clock — 23h50m from now.
      prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(inDays(1), utcClock(-10))) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p4' } as any));

      await expect(service.removeTeam('team-1', PLAYER_USER)).rejects.toThrow(
        'Registration can no longer be cancelled — the deadline was 24 hours before the tournament',
      );
    });

    it('lets a member cancel while the tournament is still more than 24 hours away', async () => {
      // Tomorrow, starting ten minutes later in the day — 24h10m from now, just inside the window.
      prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(inDays(1), utcClock(10))) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p4' } as any));

      await service.removeTeam('team-1', PLAYER_USER);

      expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
    });

    // Pinned on a fixed clock: exactly 24 hours out is already closed, one second more is open.
    describe('at the boundary', () => {
      const START = new Date('2026-09-16T08:00:00.000Z');

      afterEach(() => jest.useRealTimers());

      const cancelAt = async (now: string) => {
        jest.useFakeTimers({ doNotFake: ['nextTick'] });
        jest.setSystemTime(new Date(now));
        prisma.ongoingTeam.findUnique = jest.fn(async () =>
          teamRow(new Date('2026-09-16T00:00:00.000Z'), '08:00'),
        ) as any;
        userService.findById = jest.fn(async () => ({ playerId: 'p4' } as any));
        return service.removeTeam('team-1', PLAYER_USER);
      };

      it('is closed exactly 24 hours before the start', async () => {
        await expect(cancelAt('2026-09-15T08:00:00.000Z')).rejects.toThrow(ForbiddenException);
      });

      it('is open one second earlier', async () => {
        await cancelAt('2026-09-15T07:59:59.000Z');

        expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
      });

      // The whole point of reading startTime: under the old end-of-previous-day rule this instant
      // was still cancellable.
      it('is closed at midday the day before an 08:00 start', async () => {
        await expect(cancelAt('2026-09-15T12:00:00.000Z')).rejects.toThrow(ForbiddenException);
        expect(START.getUTCHours()).toBe(8);
      });
    });

    it('refuses a member with an unreadable event date instead of letting the cancel through', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date('not-a-date'))) as any;
      userService.findById = jest.fn(async () => ({ playerId: 'p4' } as any));

      await expect(service.removeTeam('team-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('OngoingService solo pairing', () => {
    const poolEvent = (ratings: Array<[string, number | null]>) => ({
      ...EVENT_ROW,
      createdByUserId: 'user-1',
      date: new Date('2999-01-01T00:00:00.000Z'),
      soloPlayers: ratings.map(([id, rank], index) => ({
        id: `solo-${index + 1}`,
        player: {
          id,
          name: id.toUpperCase(),
          avatar: null,
          playerStats: rank === null ? null : { rank },
        },
      })),
    });

    it('previews strongest-with-weakest pairs and the team rating', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        poolEvent([
          ['a', 1300],
          ['b', 1200],
          ['c', 1000],
          ['d', 800],
        ]),
      ) as any;

      const preview = await service.previewSoloPairing('event-1', CURRENT_USER);

      expect(preview.pairs.map((pair) => [pair.player1.id, pair.player2.id, pair.rating])).toEqual([
        ['a', 'd', 2100],
        ['b', 'c', 2200],
      ]);
      expect(preview.unpaired).toEqual([]);
    });

    it('reports the leftover player when the pool is odd', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        poolEvent([
          ['a', 1300],
          ['b', 1200],
          ['c', 1000],
        ]),
      ) as any;

      const preview = await service.previewSoloPairing('event-1', CURRENT_USER);

      expect(preview.unpaired.map((player) => player.id)).toEqual(['b']);
    });

    it('creates the confirmed teams and empties the matching pool rows in one transaction', async () => {
      const calls: string[] = [];
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        poolEvent([
          ['a', 1300],
          ['b', 800],
        ]),
      ) as any;
      prisma.ongoingTeam.createMany = jest.fn(async () => {
        calls.push('createTeams');
        return { count: 1 };
      });
      prisma.ongoingSoloPlayer.deleteMany = jest.fn(async () => {
        calls.push('deleteSolo');
        return { count: 2 };
      });

      await service.formTeamsFromSolo('event-1', { teams: [{ player1Id: 'a', player2Id: 'b' }] }, CURRENT_USER);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(calls).toEqual(['createTeams', 'deleteSolo']);
      expect(prisma.ongoingTeam.createMany).toHaveBeenCalledWith({
        data: [{ eventId: 'event-1', player1Id: 'a', player2Id: 'b' }],
      });
      expect(prisma.ongoingSoloPlayer.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', playerId: { in: ['a', 'b'] } },
      });
    });

    it('rejects a player who is not in this pool without writing anything', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        poolEvent([
          ['a', 1300],
          ['b', 800],
        ]),
      ) as any;

      await expect(
        service.formTeamsFromSolo('event-1', { teams: [{ player1Id: 'a', player2Id: 'zz' }] }, CURRENT_USER),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.ongoingTeam.createMany).not.toHaveBeenCalled();
    });

    it('rejects the same player appearing in two confirmed teams', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        poolEvent([
          ['a', 1300],
          ['b', 1000],
          ['c', 800],
        ]),
      ) as any;

      await expect(
        service.formTeamsFromSolo(
          'event-1',
          {
            teams: [
              { player1Id: 'a', player2Id: 'b' },
              { player1Id: 'a', player2Id: 'c' },
            ],
          },
          CURRENT_USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a subset and leaves the rest in the pool', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        poolEvent([
          ['a', 1300],
          ['b', 1000],
          ['c', 800],
        ]),
      ) as any;

      await service.formTeamsFromSolo('event-1', { teams: [{ player1Id: 'a', player2Id: 'c' }] }, CURRENT_USER);

      expect(prisma.ongoingSoloPlayer.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', playerId: { in: ['a', 'c'] } },
      });
    });

    it('refuses a non-manager', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => poolEvent([['a', 1300]])) as any;

      await expect(
        service.previewSoloPairing('event-1', {
          sub: 'user-9',
          email: 'p9@example.com',
          role: 'player',
          jti: 'jti-9',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

describe('OngoingService fullRotation', () => {
  let service: OngoingService;
  let prisma: any;
  let userService: { findById: jest.Mock };

  const CURRENT_USER = { sub: 'user-1', email: 'user1@example.com', role: 'admin', jti: 'jti-1', iat: 0, exp: 0 };

  /** Eight players, descending rating, so seeding is predictable. */
  const soloRoster = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `solo-${index + 1}`,
      player: {
        id: `p${index + 1}`,
        name: `Player ${index + 1}`,
        avatar: null,
        playerStats: { rank: 2000 - index * 100 },
      },
    }));

  const slotsFor = (round: number, groups: string[][]) =>
    groups.flatMap((group, groupIndex) =>
      group.map((playerId) => ({
        id: `slot-${round}-${playerId}`,
        playerId,
        round,
        groupIndex,
        player: { id: playerId, name: playerId.toUpperCase(), avatar: null, playerStats: { rank: 1000 } },
      })),
    );

  /** The three fixtures of one group, with the scores given (null for "not played"). */
  const gamesFor = (round: number, groupIndex: number, group: string[], scores: Array<[number, number] | null>) => {
    const [a, b, c, d] = group;
    const sides: Array<[string[], string[]]> = [
      [
        [a, b],
        [c, d],
      ],
      [
        [a, c],
        [b, d],
      ],
      [
        [a, d],
        [b, c],
      ],
    ];
    return sides.map(([side1, side2], index) => ({
      id: `g-${round}-${groupIndex}-${index}`,
      eventId: 'event-1',
      team1Id: null,
      team2Id: null,
      team1Points: scores[index] ? scores[index][0] : null,
      team2Points: scores[index] ? scores[index][1] : null,
      round,
      court: index + 1,
      order: index,
      phase: 'rotation',
      groupIndex,
      bracketRound: null,
      bracketSlot: null,
      thirdPlace: false,
      sidePlayers: [
        ...side1.map((playerId) => ({ playerId, side: 1, player: { id: playerId, name: playerId, avatar: null } })),
        ...side2.map((playerId) => ({ playerId, side: 2, player: { id: playerId, name: playerId, avatar: null } })),
      ],
    }));
  };

  const buildEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'event-1',
    name: 'Rotation Cup',
    // Relative to now: a fixed date silently expires into "registration closed" once it passes.
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdByUserId: 'user-1',
    config: {
      gamesPerPair: 1,
      courts: 1,
      maxTeams: null,
      scheme: 'fullRotation',
      groupCount: 2,
      qualifiersPerGroup: null,
      rotationRounds: 3,
      visibility: 'public',
      allowSoloRegistration: true,
    },
    teams: [],
    soloPlayers: soloRoster(8),
    games: [],
    rotationSlots: [],
    ...overrides,
  });

  const load = (event: any) => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => event);
  };

  beforeEach(async () => {
    prisma = {
      ongoingEvent: { findUnique: jest.fn(async () => buildEvent()) },
      ongoingTeam: { create: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
      ongoingGame: {
        create: jest.fn(async (args: any) => ({ id: 'game-new', ...args.data })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        count: jest.fn(async () => 0),
      },
      ongoingSoloPlayer: { create: jest.fn(async () => ({ id: 'solo-new' })) },
      ongoingRotationSlot: {
        create: jest.fn(async (args: any) => ({ id: 'slot-new', ...args.data })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      ongoingEventConfig: { upsert: jest.fn(async () => ({})) },
      player: { findMany: jest.fn(async (args: any) => args.where.id.in.map((id: string) => ({ id }))) },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    userService = { findById: jest.fn(async () => ({ playerId: 'p1' } as any)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  describe('registration', () => {
    it('refuses a team: the scheme registers individual players', async () => {
      await expect(service.addTeam('event-1', { player1Id: 'p1', player2Id: 'p2' }, CURRENT_USER)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('refuses a player past the seats the groups define, ignoring maxTeams', async () => {
      load(buildEvent({ soloPlayers: soloRoster(8) }));

      await expect(service.addSoloPlayer('event-1', { playerId: 'p9' }, CURRENT_USER)).rejects.toThrow(
        new ConflictException('This tournament is full'),
      );
    });

    it('accepts a player while a seat is free', async () => {
      load(buildEvent({ soloPlayers: soloRoster(7) }));

      await service.addSoloPlayer('event-1', { playerId: 'p9' }, CURRENT_USER);

      expect(prisma.ongoingSoloPlayer.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', playerId: 'p9' },
      });
    });
  });

  describe('generateSchedule', () => {
    it('refuses a roster that does not fill every group exactly', async () => {
      load(buildEvent({ soloPlayers: soloRoster(7) }));

      await expect(service.generateSchedule('event-1', CURRENT_USER)).rejects.toThrow(
        /needs exactly 8 registered players, and this one has 7/,
      );
      expect(prisma.ongoingGame.create).not.toHaveBeenCalled();
    });

    it('seeds the strongest four into group 0 and writes a slot per player', async () => {
      // Rating runs opposite to the ids, so neither the roster's own order nor the playerId tiebreak
      // can produce the expected groups — only reading the rating can.
      const inverted = Array.from({ length: 8 }, (_, index) => ({
        id: `solo-${index + 1}`,
        player: {
          id: `p${index + 1}`,
          name: `Player ${index + 1}`,
          avatar: null,
          playerStats: { rank: 1000 + index * 100 },
        },
      }));
      load(buildEvent({ soloPlayers: inverted }));

      await service.generateSchedule('event-1', CURRENT_USER);

      const slots = prisma.ongoingRotationSlot.create.mock.calls.map((call: any) => call[0].data);
      expect(slots).toHaveLength(8);
      expect(slots.filter((slot: any) => slot.groupIndex === 0).map((slot: any) => slot.playerId)).toEqual([
        'p8',
        'p7',
        'p6',
        'p5',
      ]);
      expect(slots.every((slot: any) => slot.round === 1)).toBe(true);
    });

    it('writes three fixtures per group, each with two players on each side', async () => {
      await service.generateSchedule('event-1', CURRENT_USER);

      const games = prisma.ongoingGame.create.mock.calls.map((call: any) => call[0].data);
      expect(games).toHaveLength(6);
      expect(games.every((game: any) => game.phase === 'rotation' && game.round === 1)).toBe(true);
      expect(games.filter((game: any) => game.groupIndex === 0)).toHaveLength(3);

      for (const game of games) {
        const created = game.sidePlayers.create;
        expect(created.filter((entry: any) => entry.side === 1)).toHaveLength(2);
        expect(created.filter((entry: any) => entry.side === 2)).toHaveLength(2);
      }
    });

    it('replaces only the round it writes, so earlier results survive a regenerate', async () => {
      await service.generateSchedule('event-1', CURRENT_USER);

      expect(prisma.ongoingGame.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', phase: 'rotation', round: 1 },
      });
      expect(prisma.ongoingRotationSlot.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', round: 1 },
      });
    });
  });

  describe('advanceRotationRound', () => {
    const groupA = ['p1', 'p2', 'p3', 'p4'];
    const groupB = ['p5', 'p6', 'p7', 'p8'];

    /** Round 1 played so that the group order comes out as listed. */
    const playedRoundOne = () =>
      buildEvent({
        rotationSlots: slotsFor(1, [groupA, groupB]),
        games: [
          // p1 wins all three in group 0; p5 wins all three in group 1.
          ...gamesFor(1, 0, groupA, [
            [21, 15],
            [21, 15],
            [21, 15],
          ]),
          ...gamesFor(1, 1, groupB, [
            [21, 15],
            [21, 15],
            [21, 15],
          ]),
        ],
      });

    it('refuses before the first round exists', async () => {
      load(buildEvent());

      await expect(service.advanceRotationRound('event-1', CURRENT_USER)).rejects.toThrow(
        new ConflictException('The first round has not been generated yet'),
      );
    });

    it('refuses while any game of the round is unplayed', async () => {
      load(
        buildEvent({
          rotationSlots: slotsFor(1, [groupA, groupB]),
          games: [...gamesFor(1, 0, groupA, [[21, 15], null, null]), ...gamesFor(1, 1, groupB, [null, null, null])],
        }),
      );

      await expect(service.advanceRotationRound('event-1', CURRENT_USER)).rejects.toThrow(
        new ConflictException('Every game of the current round must have a result before the next round'),
      );
      expect(prisma.ongoingRotationSlot.create).not.toHaveBeenCalled();
    });

    it('promotes the top two and relegates the bottom two into the next round', async () => {
      load(playedRoundOne());

      await service.advanceRotationRound('event-1', CURRENT_USER);

      const slots = prisma.ongoingRotationSlot.create.mock.calls.map((call: any) => call[0].data);
      expect(slots.every((slot: any) => slot.round === 2)).toBe(true);

      const group0 = slots.filter((slot: any) => slot.groupIndex === 0).map((slot: any) => slot.playerId);
      const group1 = slots.filter((slot: any) => slot.groupIndex === 1).map((slot: any) => slot.playerId);

      // Group 0 keeps its own top two and receives group 1's top two.
      expect(group0).toContain('p1');
      expect(group1).not.toContain('p1');
      expect(group0).toContain('p5');
      // Group 0's bottom two drop into group 1.
      expect(group1.length).toBe(4);
      expect(group0.length).toBe(4);
      expect([...group0, ...group1].sort()).toEqual([...groupA, ...groupB].sort());
    });

    it('refuses to advance past the configured last round', async () => {
      const event = playedRoundOne();
      event.config.rotationRounds = 1;
      load(event);

      await expect(service.advanceRotationRound('event-1', CURRENT_USER)).rejects.toThrow(/Round 1 is the last one/);
    });

    it('refuses on a scheme that has no rounds', async () => {
      const event = buildEvent();
      event.config.scheme = 'roundRobin';
      load(event);

      await expect(service.advanceRotationRound('event-1', CURRENT_USER)).rejects.toThrow(
        new BadRequestException('Rounds can only be advanced in a fullRotation tournament'),
      );
    });
  });

  describe('rotation state in the response', () => {
    it('is null for a scheme that does not use it', async () => {
      const event = buildEvent();
      event.config.scheme = 'roundRobin';
      load(event);

      const result = await service.findOne('event-1');

      expect(result.rotation).toBeNull();
    });

    it('reports the round tables and stays unfinished before the last round', async () => {
      load(
        buildEvent({
          rotationSlots: slotsFor(1, [
            ['p1', 'p2', 'p3', 'p4'],
            ['p5', 'p6', 'p7', 'p8'],
          ]),
          games: [
            ...gamesFor(
              1,
              0,
              ['p1', 'p2', 'p3', 'p4'],
              [
                [21, 15],
                [21, 15],
                [21, 15],
              ],
            ),
            ...gamesFor(
              1,
              1,
              ['p5', 'p6', 'p7', 'p8'],
              [
                [21, 15],
                [21, 15],
                [21, 15],
              ],
            ),
          ],
        }),
      );

      const result = await service.findOne('event-1');

      expect(result.rotation).toMatchObject({ totalRounds: 3, currentRound: 1, isFinished: false });
      expect(result.rotation!.rounds).toHaveLength(1);
      expect(result.rotation!.rounds[0].isComplete).toBe(true);
      expect(result.rotation!.rounds[0].groups).toHaveLength(2);
      expect(result.rotation!.rounds[0].groups[0].standings[0]).toMatchObject({ place: 1, wins: 3 });
      expect(result.rotation!.finalStandings).toEqual([]);
    });

    it('takes the podium from the strongest group once the last round is complete', async () => {
      const event = buildEvent({
        rotationSlots: slotsFor(1, [
          ['p1', 'p2', 'p3', 'p4'],
          ['p5', 'p6', 'p7', 'p8'],
        ]),
        games: [
          ...gamesFor(
            1,
            0,
            ['p1', 'p2', 'p3', 'p4'],
            [
              [21, 15],
              [21, 15],
              [21, 15],
            ],
          ),
          ...gamesFor(
            1,
            1,
            ['p5', 'p6', 'p7', 'p8'],
            [
              [21, 15],
              [21, 15],
              [21, 15],
            ],
          ),
        ],
      });
      event.config.rotationRounds = 1;
      load(event);

      const result = await service.findOne('event-1');

      expect(result.rotation!.isFinished).toBe(true);
      expect(result.rotation!.finalStandings).toHaveLength(8);
      // The winner of group 0 wins the tournament; group 1 fills the places below group 0 entirely.
      expect(result.rotation!.finalStandings[0].player.id).toBe('p1');
      expect(result.rotation!.finalStandings.slice(0, 4).map((row) => row.player.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
      expect(result.rotation!.finalStandings[4].place).toBe(5);
    });
  });
});

describe('OngoingService fullRotation config', () => {
  let service: OngoingService;
  let prisma: any;

  const CURRENT_USER = { sub: 'user-1', email: 'user1@example.com', role: 'admin', jti: 'jti-1', iat: 0, exp: 0 };

  const eventRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'event-1',
    name: 'Cup',
    // Relative to now: a fixed date silently expires into "registration closed" once it passes.
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdByUserId: 'user-1',
    config: {
      gamesPerPair: 1,
      courts: 1,
      maxTeams: null,
      scheme: 'roundRobin',
      groupCount: 1,
      qualifiersPerGroup: null,
      rotationRounds: 3,
      visibility: 'public',
      allowSoloRegistration: false,
    },
    teams: [],
    soloPlayers: [],
    games: [],
    rotationSlots: [],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      ongoingEvent: {
        findUnique: jest.fn(async () => eventRow()),
        create: jest.fn(async () => eventRow()),
      },
      ongoingEventConfig: { upsert: jest.fn(async () => ({})) },
      ongoingTeam: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn() },
      ongoingGame: { deleteMany: jest.fn(async () => ({ count: 0 })), count: jest.fn(async () => 0) },
      ongoingSoloPlayer: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      player: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn(async () => ({ playerId: 'p1' } as any)) } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  const updateWith = (extra: Record<string, unknown>) =>
    service.updateConfig(
      'event-1',
      { gamesPerPair: 1, courts: 1, scheme: 'fullRotation', ...extra } as any,
      CURRENT_USER,
    );

  it('accepts two or three groups', async () => {
    await updateWith({ groupCount: 2 });
    expect(prisma.ongoingEventConfig.upsert.mock.calls[0][0].update.groupCount).toBe(2);

    await updateWith({ groupCount: 3 });
    expect(prisma.ongoingEventConfig.upsert.mock.calls[1][0].update.groupCount).toBe(3);
  });

  it('rejects a group count the format cannot fill', async () => {
    await expect(updateWith({ groupCount: 1 })).rejects.toThrow(/needs 2 or 3 groups of 4/);
    await expect(updateWith({ groupCount: 4 })).rejects.toThrow(/needs 2 or 3 groups of 4/);
    await expect(updateWith({ groupCount: 2.5 })).rejects.toThrow(/needs 2 or 3 groups of 4/);
  });

  it('defaults to two groups and three rounds when neither is given', async () => {
    await updateWith({});

    const written = prisma.ongoingEventConfig.upsert.mock.calls[0][0].update;
    expect(written.groupCount).toBe(2);
    expect(written.rotationRounds).toBe(3);
  });

  it('rejects fewer than one round', async () => {
    await expect(updateWith({ groupCount: 2, rotationRounds: 0 })).rejects.toThrow(
      new BadRequestException('rotationRounds must be at least 1'),
    );
    await expect(updateWith({ groupCount: 2, rotationRounds: 1.5 })).rejects.toThrow(
      new BadRequestException('rotationRounds must be at least 1'),
    );
  });

  it('clears qualifiersPerGroup: there is no playoff to seed', async () => {
    await updateWith({ groupCount: 2, qualifiersPerGroup: 2 });

    expect(prisma.ongoingEventConfig.upsert.mock.calls[0][0].update.qualifiersPerGroup).toBeNull();
  });

  it('forces solo registration on, since players are the entry unit', async () => {
    await updateWith({ groupCount: 2, allowSoloRegistration: false });

    expect(prisma.ongoingEventConfig.upsert.mock.calls[0][0].update.allowSoloRegistration).toBe(true);
  });

  it('forces solo-only on too: the scheme has no pair entry path at all', async () => {
    await updateWith({ groupCount: 2, soloOnlyRegistration: false });

    expect(prisma.ongoingEventConfig.upsert.mock.calls[0][0].update.soloOnlyRegistration).toBe(true);
  });

  it('refuses to switch an event that already has pairs onto the scheme', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      eventRow({
        teams: [
          {
            id: 't1',
            player1: { id: 'p1', name: 'A', playerStats: { rank: 1000 } },
            player2: { id: 'p2', name: 'B', playerStats: { rank: 1000 } },
            groupIndex: null,
          },
        ],
      }),
    );

    await expect(updateWith({ groupCount: 2 })).rejects.toThrow(/clear the roster before switching/);
    expect(prisma.ongoingEventConfig.upsert).not.toHaveBeenCalled();
  });

  it('refuses a create that carries a team roster', async () => {
    await expect(
      service.create(
        {
          name: 'Cup',
          date: '2026-09-20T00:00:00.000Z',
          scheme: 'fullRotation',
          groupCount: 2,
          teams: [{ player1Id: 'p1', player2Id: 'p2' }],
        } as any,
        CURRENT_USER,
      ),
    ).rejects.toThrow(new BadRequestException('A fullRotation tournament registers individual players, not teams'));
    expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
  });

  it('creates with solo registration on and no maxTeams-driven roster', async () => {
    await service.create(
      {
        name: 'Cup',
        date: '2026-09-20T00:00:00.000Z',
        scheme: 'fullRotation',
        groupCount: 3,
        rotationRounds: 4,
      } as any,
      CURRENT_USER,
    );

    const config = prisma.ongoingEvent.create.mock.calls[0][0].data.config.create;
    expect(config).toMatchObject({
      scheme: 'fullRotation',
      groupCount: 3,
      rotationRounds: 4,
      qualifiersPerGroup: null,
      allowSoloRegistration: true,
    });
  });

  it('refuses setTeams on the scheme', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      eventRow({ config: { ...eventRow().config, scheme: 'fullRotation', groupCount: 2 } }),
    );

    await expect(
      service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] }, CURRENT_USER),
    ).rejects.toThrow(new BadRequestException('A fullRotation tournament registers individual players, not teams'));
  });
});

describe('OngoingService.updateGameScore on a rotation game', () => {
  let service: OngoingService;
  let prisma: any;

  const CURRENT_USER = { sub: 'user-1', email: 'user1@example.com', role: 'admin', jti: 'jti-1', iat: 0, exp: 0 };

  beforeEach(async () => {
    prisma = {
      ongoingEvent: {
        findUnique: jest.fn(async () => ({
          id: 'event-1',
          createdByUserId: 'user-1',
          config: { scheme: 'fullRotation', groupCount: 2, rotationRounds: 3 },
        })),
      },
      ongoingGame: {
        findUnique: jest.fn(async () => ({
          id: 'game-1',
          eventId: 'event-1',
          // A rotation fixture legitimately has no team rows: its sides live in ongoing_game_players.
          team1Id: null,
          team2Id: null,
          phase: 'rotation',
          bracketRound: null,
          bracketSlot: null,
        })),
        update: jest.fn(async (args: any) => ({ ...args.data, id: 'game-1', eventId: 'event-1' })),
        findFirst: jest.fn(async () => null),
        aggregate: jest.fn(async () => ({ _max: { bracketRound: null } })),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  it('records a score even though both team ids are null', async () => {
    await service.updateGameScore('game-1', { team1Points: 21, team2Points: 15 }, CURRENT_USER);

    expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
      where: { id: 'game-1' },
      data: { team1Points: 21, team2Points: 15 },
    });
  });

  it('still refuses an empty bracket slot, where null team ids mean "unknown"', async () => {
    prisma.ongoingGame.findUnique = jest.fn(async () => ({
      id: 'game-1',
      eventId: 'event-1',
      team1Id: null,
      team2Id: null,
      phase: 'playoff',
      bracketRound: 1,
      bracketSlot: 0,
    }));

    await expect(service.updateGameScore('game-1', { team1Points: 21, team2Points: 15 }, CURRENT_USER)).rejects.toThrow(
      new BadRequestException('Both teams must be known before a result can be recorded'),
    );
  });
});

describe('OngoingService player anonymity', () => {
  let service: OngoingService;
  let prisma: any;

  const player = (id: string, name: string, isAnonymous: boolean) => ({
    id,
    name,
    avatar: null,
    playerStats: { rank: 1000 },
    user: { isAnonymous },
  });

  beforeEach(async () => {
    prisma = {
      ongoingEvent: {
        findUnique: jest.fn(async () => ({
          id: 'event-1',
          name: 'Cup',
          // Relative to now: a fixed date silently expires into "registration closed" once it passes.
          date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
          createdByUserId: 'u1',
          config: { scheme: 'roundRobin', groupCount: 1, rotationRounds: 3, visibility: 'public' },
          teams: [
            {
              id: 't1',
              player1: player('p1', 'Artem Borzienkov', true),
              player2: player('p2', 'Open Player', false),
              groupIndex: null,
            },
          ],
          soloPlayers: [{ id: 's1', player: player('p3', 'Hidden Solo', true) }],
          games: [],
          rotationSlots: [],
        })),
      },
      ongoingGame: { count: jest.fn(async () => 0) },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  it('carries the flag through to team players, per player', async () => {
    const event = await service.findOne('event-1');

    expect(event.teams[0].player1).toMatchObject({ name: 'Artem Borzienkov', isAnonymous: true });
    expect(event.teams[0].player2).toMatchObject({ name: 'Open Player', isAnonymous: false });
  });

  it('carries the flag through to the solo pool', async () => {
    const event = await service.findOne('event-1');

    expect(event.soloPlayers[0].player).toMatchObject({ name: 'Hidden Solo', isAnonymous: true });
  });

  it('returns the real name regardless: masking is the client’s job, storage is untouched', async () => {
    const event = await service.findOne('event-1');

    // The API is the record; an anonymous player’s stored name still travels so a client that is
    // allowed to see it (the organiser picking a partner) can.
    expect(event.teams[0].player1.name).toBe('Artem Borzienkov');
  });

  it('treats a player with no linked account as not anonymous', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => ({
      id: 'event-1',
      name: 'Cup',
      // Relative to now: a fixed date silently expires into "registration closed" once it passes.
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
      createdByUserId: 'u1',
      config: { scheme: 'roundRobin', groupCount: 1, rotationRounds: 3, visibility: 'public' },
      teams: [],
      soloPlayers: [{ id: 's1', player: { id: 'p9', name: 'No Account', avatar: null, playerStats: null } }],
      games: [],
      rotationSlots: [],
    }));

    const event = await service.findOne('event-1');

    expect(event.soloPlayers[0].player.isAnonymous).toBe(false);
  });
});

describe('OngoingService — who may record a result', () => {
  let service: OngoingService;
  let prisma: any;
  let userService: { findById: jest.Mock };

  const ORGANISER = { sub: 'organiser-1', email: 'o@example.com', role: 'player', jti: 'j', iat: 0, exp: 0 };
  const OUTSIDER = { ...ORGANISER, sub: 'outsider-1' };
  const ADMIN = { ...ORGANISER, sub: 'admin-1', role: 'admin' };

  /** The shape assertCanRecordResult selects — rosters by id, no nested player rows. */
  const eventRow = (over: Record<string, unknown> = {}) => ({
    createdByUserId: 'organiser-1',
    teams: [],
    soloPlayers: [],
    rotationSlots: [],
    ...over,
  });

  const playedGame = { id: 'game-1', eventId: 'event-1', team1Id: 't1', team2Id: 't2', phase: 'group' };

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: userService },
      ],
    }).compile();
    return module.get<OngoingService>(OngoingService);
  };

  beforeEach(async () => {
    prisma = {
      ongoingEvent: { findUnique: jest.fn(async () => eventRow()) },
      ongoingGame: {
        findUnique: jest.fn(async () => playedGame),
        update: jest.fn(async (args: any) => ({ ...playedGame, ...args.data })),
        findFirst: jest.fn(async () => null),
        count: jest.fn(async () => 0),
        aggregate: jest.fn(async () => ({ _max: { bracketRound: null } })),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    // The outsider has a player, just not one entered in this tournament.
    userService = { findById: jest.fn(async () => ({ playerId: 'p-outsider' } as any)) };
    service = await build();
  });

  const record = (user: typeof ORGANISER) =>
    service.updateGameScore('game-1', { team1Points: 21, team2Points: 15 }, user);

  it('lets the organiser record, as before', async () => {
    await expect(record(ORGANISER)).resolves.toBeDefined();
  });

  it('lets an admin record even though they entered nothing', async () => {
    await expect(record(ADMIN)).resolves.toBeDefined();
  });

  it('lets a player on one of the teams record', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      eventRow({ teams: [{ player1Id: 'p-outsider', player2Id: 'p9' }] }),
    );

    await expect(record(OUTSIDER)).resolves.toBeDefined();
  });

  it('lets a player entered as player2 record — both sides of a pair count', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      eventRow({ teams: [{ player1Id: 'p9', player2Id: 'p-outsider' }] }),
    );

    await expect(record(OUTSIDER)).resolves.toBeDefined();
  });

  it('lets a player waiting in the solo pool record', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow({ soloPlayers: [{ playerId: 'p-outsider' }] }));

    await expect(record(OUTSIDER)).resolves.toBeDefined();
  });

  it('lets a player in a rotation group record', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow({ rotationSlots: [{ playerId: 'p-outsider' }] }));

    await expect(record(OUTSIDER)).resolves.toBeDefined();
  });

  it('lets an entrant record a game they were not on themselves', async () => {
    // The entrant is in the tournament but this fixture is between two other teams: still allowed,
    // because at a real event whoever is free walks over and enters the score.
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      eventRow({ teams: [{ player1Id: 'p-outsider', player2Id: 'p9' }] }),
    );
    prisma.ongoingGame.findUnique = jest.fn(async () => ({ ...playedGame, team1Id: 't7', team2Id: 't8' }));

    await expect(record(OUTSIDER)).resolves.toBeDefined();
  });

  it('refuses a logged-in stranger', async () => {
    await expect(record(OUTSIDER)).rejects.toThrow(ForbiddenException);
    expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
  });

  it('refuses an account with no linked player, even if that player id is somehow on a roster', async () => {
    userService.findById = jest.fn(async () => ({ playerId: null } as any));
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      eventRow({ teams: [{ player1Id: 'p-outsider', player2Id: 'p9' }] }),
    );

    await expect(record(OUTSIDER)).rejects.toThrow(ForbiddenException);
  });

  it('404s rather than 403s when the event behind the game is gone', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => null);

    await expect(record(OUTSIDER)).rejects.toThrow(NotFoundException);
  });

  it('applies the same rule to clearing a result', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow({ soloPlayers: [{ playerId: 'p-outsider' }] }));

    await expect(service.clearGameResult('game-1', OUTSIDER)).resolves.toBeDefined();

    prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow());
    await expect(service.clearGameResult('game-1', OUTSIDER)).rejects.toThrow(ForbiddenException);
  });
});

describe('OngoingService.finishTournament — fullRotation', () => {
  let service: OngoingService;
  let prisma: any;

  const ORGANISER = { sub: 'organiser-1', email: 'o@example.com', role: 'player', jti: 'j', iat: 0, exp: 0 };

  const slots = (round: number) =>
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((playerId, index) => ({
      id: `s-${round}-${playerId}`,
      playerId,
      round,
      groupIndex: index < 4 ? 0 : 1,
      player: { id: playerId, name: playerId, avatar: null, playerStats: { rank: 1000 } },
    }));

  /** Six played fixtures — the whole of one rotation round across two groups. */
  const games = (round: number) =>
    [0, 1].flatMap((groupIndex) =>
      [0, 1, 2].map((order) => ({
        id: `g-${round}-${groupIndex}-${order}`,
        eventId: 'event-1',
        team1Id: null,
        team2Id: null,
        team1Points: 21,
        team2Points: 15,
        round,
        court: order + 1,
        order,
        phase: 'rotation',
        groupIndex,
        bracketRound: null,
        bracketSlot: null,
        thirdPlace: false,
        sidePlayers: [],
      })),
    );

  const eventRow = (rotationRounds: number, roundsPlayed: number) => ({
    id: 'event-1',
    name: 'Rotation Cup',
    // Relative to now: a fixed date silently expires into "registration closed" once it passes.
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdByUserId: 'organiser-1',
    config: {
      gamesPerPair: 1,
      courts: 1,
      maxTeams: null,
      scheme: 'fullRotation',
      groupCount: 2,
      qualifiersPerGroup: null,
      rotationRounds,
      visibility: 'public',
      allowSoloRegistration: true,
    },
    teams: [],
    soloPlayers: [],
    games: Array.from({ length: roundsPlayed }, (_, i) => games(i + 1)).flat(),
    rotationSlots: Array.from({ length: roundsPlayed }, (_, i) => slots(i + 1)).flat(),
  });

  const load = (rotationRounds: number, roundsPlayed: number) => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow(rotationRounds, roundsPlayed));
  };

  beforeEach(async () => {
    prisma = {
      ongoingEvent: {
        findUnique: jest.fn(async () => eventRow(1, 1)),
        update: jest.fn(async () => ({})),
      },
      ongoingGame: { count: jest.fn(async () => 0) },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  it('finishes once the last round is complete', async () => {
    load(1, 1);

    await expect(service.finishTournament('event-1', ORGANISER)).resolves.toBeDefined();
    expect(prisma.ongoingEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { finishedAt: expect.any(Date) } }),
    );
  });

  it('refuses while rounds remain, even though every generated game is played', async () => {
    // Round 1 of 3: the old "every game has a result" check passes, but the ladder has decided
    // nothing and the placements would be empty.
    load(3, 1);

    await expect(service.finishTournament('event-1', ORGANISER)).rejects.toThrow(
      /Round 1 of 3 is played; every round must be complete/,
    );
    expect(prisma.ongoingEvent.update).not.toHaveBeenCalled();
  });

  it('finishes on the last of several rounds', async () => {
    load(3, 3);

    await expect(service.finishTournament('event-1', ORGANISER)).resolves.toBeDefined();
  });

  it('still refuses when a fixture has no result', async () => {
    const row = eventRow(1, 1);
    row.games[0].team1Points = null as never;
    prisma.ongoingEvent.findUnique = jest.fn(async () => row);

    await expect(service.finishTournament('event-1', ORGANISER)).rejects.toThrow(/Not every game has a result/);
  });
});

describe('OngoingService.create — groupsPlayoff without a bracket shape', () => {
  let service: OngoingService;
  let prisma: any;

  const CURRENT_USER = { sub: 'user-1', email: 'u@example.com', role: 'player', jti: 'j', iat: 0, exp: 0 };

  beforeEach(async () => {
    prisma = {
      ongoingEvent: { create: jest.fn(async () => ({ id: 'e1', config: {}, teams: [], soloPlayers: [], games: [] })) },
      player: { findMany: jest.fn(async (args: any) => args.where.id.in.map((id: string) => ({ id }))) },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  const create = (extra: Record<string, unknown> = {}) =>
    service.create(
      { name: 'Cup', date: '2030-01-01T00:00:00.000Z', scheme: 'groupsPlayoff', ...extra } as any,
      CURRENT_USER,
    );

  const writtenConfig = () => prisma.ongoingEvent.create.mock.calls[0][0].data.config.create;

  it('creates with no teams and no bracket numbers at all', async () => {
    // The create form offers the scheme without asking for a shape; a tournament with no entrants
    // yet has nothing to size one against, and teams register later.
    await expect(create()).resolves.toBeDefined();

    expect(writtenConfig()).toMatchObject({ scheme: 'groupsPlayoff', groupCount: 2, qualifiersPerGroup: 2 });
  });

  it('keeps a shape the organiser did choose', async () => {
    await create({ groupCount: 4, qualifiersPerGroup: 2 });

    expect(writtenConfig()).toMatchObject({ groupCount: 4, qualifiersPerGroup: 2 });
  });

  it('still rejects a qualifier count below one when given explicitly', async () => {
    await expect(create({ groupCount: 2, qualifiersPerGroup: 0 })).rejects.toThrow(
      new BadRequestException('qualifiersPerGroup must be at least 1'),
    );
  });

  it('still rejects a bracket that is not a power of two', async () => {
    await expect(create({ groupCount: 3, qualifiersPerGroup: 1 })).rejects.toThrow(/power of two/);
  });

  it('defaults to a power-of-two bracket, so the default can never be rejected later', async () => {
    await create();

    const { groupCount, qualifiersPerGroup } = writtenConfig();
    const seeds = groupCount * qualifiersPerGroup;
    expect(seeds & (seeds - 1)).toBe(0);
  });
});

describe('OngoingService.create — an initial pool of partnerless players', () => {
  let service: OngoingService;
  let prisma: any;

  const CURRENT_USER = { sub: 'user-1', email: 'u@example.com', role: 'player', jti: 'j', iat: 0, exp: 0 };

  beforeEach(async () => {
    prisma = {
      ongoingEvent: { create: jest.fn(async () => ({ id: 'e1', config: {}, teams: [], soloPlayers: [], games: [] })) },
      player: { findMany: jest.fn(async (args: any) => args.where.id.in.map((id: string) => ({ id }))) },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  const create = (extra: Record<string, unknown>) =>
    service.create({ name: 'Cup', date: '2030-01-01T00:00:00.000Z', ...extra } as any, CURRENT_USER);

  const writtenData = () => prisma.ongoingEvent.create.mock.calls[0][0].data;

  it('seeds the pool alongside a team roster', async () => {
    await create({
      allowSoloRegistration: true,
      teams: [{ player1Id: 'p1', player2Id: 'p2' }],
      soloPlayers: ['p3', 'p4'],
    });

    expect(writtenData().soloPlayers).toEqual({ create: [{ playerId: 'p3' }, { playerId: 'p4' }] });
    expect(writtenData().teams).toEqual({ create: [{ player1Id: 'p1', player2Id: 'p2' }] });
  });

  it('seeds a pool with no teams at all', async () => {
    await create({ allowSoloRegistration: true, soloPlayers: ['p1'] });

    expect(writtenData().soloPlayers).toEqual({ create: [{ playerId: 'p1' }] });
    expect(writtenData().teams).toBeUndefined();
  });

  it('checks the players exist', async () => {
    await create({ allowSoloRegistration: true, soloPlayers: ['p1', 'p2'] });

    expect(prisma.player.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['p1', 'p2'] } } }),
    );
  });

  it('refuses a pool on a tournament that does not accept partnerless entrants', async () => {
    await expect(create({ allowSoloRegistration: false, soloPlayers: ['p1'] })).rejects.toThrow(
      /does not accept registration without a partner/,
    );
    expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
  });

  it('refuses the same player twice', async () => {
    await expect(create({ allowSoloRegistration: true, soloPlayers: ['p1', 'p1'] })).rejects.toThrow(
      /listed twice without a partner/,
    );
  });

  it('refuses a player who is also in a team — one entry per player', async () => {
    await expect(
      create({ allowSoloRegistration: true, teams: [{ player1Id: 'p1', player2Id: 'p2' }], soloPlayers: ['p2'] }),
    ).rejects.toThrow(/cannot be both in a team and without a partner/);
  });

  it('accepts an omitted or empty pool', async () => {
    await expect(create({ allowSoloRegistration: true })).resolves.toBeDefined();
    expect(writtenData().soloPlayers).toBeUndefined();

    prisma.ongoingEvent.create.mockClear();
    await expect(create({ allowSoloRegistration: true, soloPlayers: [] })).resolves.toBeDefined();
    expect(writtenData().soloPlayers).toBeUndefined();
  });

  it('refuses a pool larger than the rotation seats', async () => {
    await expect(
      create({ scheme: 'fullRotation', groupCount: 2, soloPlayers: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }),
    ).rejects.toThrow(/seats 8 players, and 9 were given/);
  });

  it('accepts a pool that fills the rotation seats exactly', async () => {
    await expect(
      create({ scheme: 'fullRotation', groupCount: 2, soloPlayers: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }),
    ).resolves.toBeDefined();
  });

  it('counts the pool against maxTeams the way registration does', async () => {
    // Two partnerless entrants will become one team, so 1 team + 2 solo = 2 against a cap of 2.
    await expect(
      create({
        allowSoloRegistration: true,
        maxTeams: 2,
        teams: [{ player1Id: 'p1', player2Id: 'p2' }],
        soloPlayers: ['p3', 'p4'],
      }),
    ).resolves.toBeDefined();

    // 1 team + 4 partnerless = 1 + ceil(4/2) = 3, over a cap of 2. (A cap of 1 is rejected earlier:
    // normaliseMaxTeams requires at least 2.)
    await expect(
      create({
        allowSoloRegistration: true,
        maxTeams: 2,
        teams: [{ player1Id: 'p1', player2Id: 'p2' }],
        soloPlayers: ['p3', 'p4', 'p5', 'p6'],
      }),
    ).rejects.toThrow(/exceeds maxTeams/);
  });
});

describe('OngoingService — when each entry was made', () => {
  let service: OngoingService;
  let prisma: any;

  const TEAM_AT = new Date('2026-09-01T18:30:00.000Z');
  const SOLO_AT = new Date('2026-09-02T07:15:00.000Z');

  beforeEach(async () => {
    prisma = {
      ongoingEvent: {
        findUnique: jest.fn(async () => ({
          id: 'event-1',
          name: 'Cup',
          // Relative to now: a fixed date silently expires into "registration closed" once it passes.
          date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
          createdByUserId: 'u1',
          config: { scheme: 'roundRobin', groupCount: 1, rotationRounds: 3, visibility: 'public' },
          teams: [
            {
              id: 't1',
              createdAt: TEAM_AT,
              player1: { id: 'p1', name: 'Ann', avatar: null, playerStats: { rank: 1100 } },
              player2: { id: 'p2', name: 'Bob', avatar: null, playerStats: { rank: 1000 } },
              groupIndex: null,
            },
          ],
          soloPlayers: [
            {
              id: 's1',
              createdAt: SOLO_AT,
              player: { id: 'p3', name: 'Cid', avatar: null, playerStats: { rank: 900 } },
            },
          ],
          games: [],
          rotationSlots: [],
        })),
      },
      ongoingGame: { count: jest.fn(async () => 0) },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  it('reports when a team entered', async () => {
    const event = await service.findOne('event-1');

    expect(event.teams[0].registeredAt).toBe(TEAM_AT);
  });

  it('reports when a partnerless player entered', async () => {
    const event = await service.findOne('event-1');

    expect(event.soloPlayers[0].registeredAt).toBe(SOLO_AT);
  });

  it('keeps the two independent — they are separate entries', async () => {
    const event = await service.findOne('event-1');

    expect(event.teams[0].registeredAt).not.toEqual(event.soloPlayers[0].registeredAt);
  });
});

describe('OngoingService solo-only registration and rule toggles', () => {
  let service: OngoingService;
  let prisma: any;

  const CURRENT_USER = { sub: 'user-1', email: 'user1@example.com', role: 'admin', jti: 'jti-1', iat: 0, exp: 0 };
  const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

  const eventRow = (config: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) => ({
    id: 'event-1',
    name: 'Cup',
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    startTime: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdByUserId: 'user-1',
    finishedAt: null,
    config: {
      gamesPerPair: 1,
      courts: 1,
      maxTeams: null,
      scheme: 'roundRobin',
      groupCount: 1,
      qualifiersPerGroup: null,
      rotationRounds: 3,
      visibility: 'public',
      allowSoloRegistration: false,
      soloOnlyRegistration: false,
      hiddenRules: [],
      ...config,
    },
    teams: [],
    soloPlayers: [],
    games: [],
    rotationSlots: [],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      ongoingEvent: {
        findUnique: jest.fn(async () => eventRow()),
        create: jest.fn(async () => eventRow()),
      },
      ongoingEventConfig: { upsert: jest.fn(async () => ({})) },
      ongoingTeam: { create: jest.fn(async () => ({})), deleteMany: jest.fn(), createMany: jest.fn() },
      ongoingGame: { deleteMany: jest.fn(), count: jest.fn(async () => 0) },
      ongoingSoloPlayer: { deleteMany: jest.fn(), create: jest.fn(async () => ({})) },
      player: { findMany: jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }]) },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn(async () => ({ playerId: 'p1' } as any)) } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  const updateWith = (extra: Record<string, unknown>) =>
    service.updateConfig(
      'event-1',
      { gamesPerPair: 1, courts: 1, scheme: 'roundRobin', ...extra } as any,
      CURRENT_USER,
    );

  const written = () => prisma.ongoingEventConfig.upsert.mock.calls[0][0].update;

  describe('solo-only', () => {
    it('turns solo registration on with it — the pool is the only way in', async () => {
      await updateWith({ soloOnlyRegistration: true, allowSoloRegistration: false });

      expect(written().soloOnlyRegistration).toBe(true);
      expect(written().allowSoloRegistration).toBe(true);
    });

    it('leaves an ordinary tournament alone', async () => {
      await updateWith({ allowSoloRegistration: true });

      expect(written().soloOnlyRegistration).toBe(false);
      expect(written().allowSoloRegistration).toBe(true);
    });

    it('refuses to close the pair path while pairs are registered', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        eventRow(
          {},
          {
            teams: [
              {
                id: 't1',
                player1: { id: 'p1', name: 'A', playerStats: { rank: 1000 } },
                player2: { id: 'p2', name: 'B', playerStats: { rank: 1000 } },
                groupIndex: null,
              },
            ],
          },
        ),
      );

      await expect(updateWith({ soloOnlyRegistration: true })).rejects.toThrow(
        /clear the roster before switching it to solo-only/,
      );
      expect(prisma.ongoingEventConfig.upsert).not.toHaveBeenCalled();
    });

    it('rejects a pair registration, entrant and organiser alike', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () =>
        eventRow({ soloOnlyRegistration: true, allowSoloRegistration: true }),
      );

      for (const user of [PLAYER_USER, CURRENT_USER]) {
        await expect(service.addTeam('event-1', { player1Id: 'p1', player2Id: 'p2' }, user)).rejects.toThrow(
          'This tournament registers individual players; register without a partner instead',
        );
      }
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('rejects a create that seeds pairs', async () => {
      await expect(
        service.create(
          {
            name: 'Cup',
            date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            soloOnlyRegistration: true,
            teams: [{ player1Id: 'p1', player2Id: 'p2' }],
          } as any,
          CURRENT_USER,
        ),
      ).rejects.toThrow(/registers individual players, not teams/);
      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });

    it('stores the flag on create and opens the solo path with it', async () => {
      await service.create(
        {
          name: 'Cup',
          date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          soloOnlyRegistration: true,
        } as any,
        CURRENT_USER,
      );

      const config = prisma.ongoingEvent.create.mock.calls[0][0].data.config.create;
      expect(config.soloOnlyRegistration).toBe(true);
      expect(config.allowSoloRegistration).toBe(true);
    });
  });

  describe('hidden rules', () => {
    it('stores the keys the organiser switched off', async () => {
      await updateWith({ hiddenRules: ['roundRobin.step2', 'serving'] });

      expect(written().hiddenRules).toEqual(['roundRobin.step2', 'serving']);
    });

    it('shows every rule again for an empty list', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow({ hiddenRules: ['serving'] }));

      await updateWith({ hiddenRules: [] });

      expect(written().hiddenRules).toEqual([]);
    });

    // The config form sends the whole set; a request that omits it is from an older client, and
    // must not silently un-hide what the organiser chose.
    it('keeps what is stored when the field is absent', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow({ hiddenRules: ['serving'] }));

      await updateWith({});

      expect(written().hiddenRules).toEqual(['serving']);
    });

    it('drops duplicates so one rule is hidden once', async () => {
      await updateWith({ hiddenRules: ['serving', 'serving', 'tiebreak'] });

      expect(written().hiddenRules).toEqual(['serving', 'tiebreak']);
    });

    it('rejects a key no rule maps to', async () => {
      await expect(updateWith({ hiddenRules: ['serving', 'made.up'] })).rejects.toThrow('Unknown rule key: made.up');
      expect(prisma.ongoingEventConfig.upsert).not.toHaveBeenCalled();
    });

    it('rejects a payload that is not an array of strings', async () => {
      await expect(updateWith({ hiddenRules: 'serving' })).rejects.toThrow('hiddenRules must be an array of rule keys');
      await expect(updateWith({ hiddenRules: [1, 2] })).rejects.toThrow('hiddenRules must be an array of rule keys');
    });

    // Hiding a step of one scheme then switching scheme must not wipe the choice: switching back
    // restores it.
    it('keeps keys belonging to another scheme', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow({ hiddenRules: ['fullRotation.step4'] }));

      await updateWith({ hiddenRules: ['fullRotation.step4', 'roundRobin.step1'] });

      expect(written().hiddenRules).toEqual(['fullRotation.step4', 'roundRobin.step1']);
    });
  });
});

describe('OngoingService disbandTeams', () => {
  let service: OngoingService;
  let prisma: any;
  let calls: string[];

  const CURRENT_USER = { sub: 'user-1', email: 'user1@example.com', role: 'admin', jti: 'jti-1', iat: 0, exp: 0 };
  const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

  const ANN_BOB_AT = new Date('2026-09-10T09:00:00.000Z');
  const CID_DEE_AT = new Date('2026-09-11T18:30:00.000Z');

  const teamRow = (id: string, a: string, b: string, createdAt: Date) => ({
    id,
    player1: { id: a, name: a, playerStats: { rank: 1000 } },
    player2: { id: b, name: b, playerStats: { rank: 1000 } },
    groupIndex: null,
    createdAt,
  });

  const eventRow = (config: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) => ({
    id: 'event-1',
    name: 'Cup',
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    startTime: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdByUserId: 'user-1',
    finishedAt: null,
    config: {
      gamesPerPair: 1,
      courts: 1,
      maxTeams: null,
      scheme: 'roundRobin',
      groupCount: 1,
      qualifiersPerGroup: null,
      rotationRounds: 3,
      visibility: 'public',
      allowSoloRegistration: true,
      soloOnlyRegistration: true,
      hiddenRules: [],
      ...config,
    },
    teams: [teamRow('t1', 'ann', 'bob', ANN_BOB_AT), teamRow('t2', 'cid', 'dee', CID_DEE_AT)],
    soloPlayers: [],
    games: [],
    rotationSlots: [],
    ...overrides,
  });

  beforeEach(async () => {
    calls = [];
    prisma = {
      ongoingEvent: { findUnique: jest.fn(async () => eventRow()) },
      ongoingGame: {
        count: jest.fn(async () => 0),
        deleteMany: jest.fn(async () => {
          calls.push('deleteGames');
          return { count: 3 };
        }),
      },
      ongoingSoloPlayer: {
        createMany: jest.fn(async () => {
          calls.push('createSolo');
          return { count: 4 };
        }),
      },
      ongoingTeam: {
        deleteMany: jest.fn(async () => {
          calls.push('deleteTeams');
          return { count: 2 };
        }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: { findById: jest.fn(async () => ({ playerId: 'ann' } as any)) } },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  it('puts every paired player back in the pool and drops the teams, in one transaction', async () => {
    await service.disbandTeams('event-1', CURRENT_USER);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.ongoingSoloPlayer.createMany).toHaveBeenCalledWith({
      data: [
        { eventId: 'event-1', playerId: 'ann', createdAt: ANN_BOB_AT },
        { eventId: 'event-1', playerId: 'bob', createdAt: ANN_BOB_AT },
        { eventId: 'event-1', playerId: 'cid', createdAt: CID_DEE_AT },
        { eventId: 'event-1', playerId: 'dee', createdAt: CID_DEE_AT },
      ],
    });
    expect(prisma.ongoingTeam.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'event-1' } });
  });

  // The fixtures reference the teams, and the pool rows must exist before the teams they replace go.
  it('clears the schedule first and writes the pool before deleting the teams', async () => {
    await service.disbandTeams('event-1', CURRENT_USER);

    expect(prisma.ongoingGame.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'event-1' } });
    expect(calls).toEqual(['deleteGames', 'createSolo', 'deleteTeams']);
  });

  // Registration time is shown on the roster; "now" would claim everyone just entered.
  it('keeps each player on the pair’s registration time', async () => {
    await service.disbandTeams('event-1', CURRENT_USER);

    const rows = prisma.ongoingSoloPlayer.createMany.mock.calls[0][0].data;
    expect(rows.map((row: any) => row.createdAt)).toEqual([ANN_BOB_AT, ANN_BOB_AT, CID_DEE_AT, CID_DEE_AT]);
  });

  it('works for a tournament that merely allows solo entry, not only a solo-only one', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow({ soloOnlyRegistration: false }));

    await service.disbandTeams('event-1', CURRENT_USER);

    expect(prisma.ongoingSoloPlayer.createMany).toHaveBeenCalled();
  });

  it('refuses anyone but the organiser or an admin', async () => {
    await expect(service.disbandTeams('event-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses once a result is recorded — the roster is locked', async () => {
    prisma.ongoingGame.count = jest.fn(async () => 1);

    await expect(service.disbandTeams('event-1', CURRENT_USER)).rejects.toThrow(
      'The tournament has already started; its roster is locked',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses when there is no pool to return the players to', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      eventRow({ allowSoloRegistration: false, soloOnlyRegistration: false }),
    );

    await expect(service.disbandTeams('event-1', CURRENT_USER)).rejects.toThrow(
      /Turn on registration without a partner first/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a fullRotation tournament, which has no teams', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      eventRow({ scheme: 'fullRotation', groupCount: 2 }, { teams: [] }),
    );

    await expect(service.disbandTeams('event-1', CURRENT_USER)).rejects.toThrow(
      'A fullRotation tournament has no teams to disband',
    );
  });

  it('is a no-op when there are no teams', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => eventRow({}, { teams: [] }));

    const result = await service.disbandTeams('event-1', CURRENT_USER);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.teams).toEqual([]);
  });
});

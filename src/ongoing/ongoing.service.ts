import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { resolveDisplayName } from '../user/display-name';
import { JwtPayload } from '../auth-guards';
import { CreateOngoingEventDto } from './dto/create-ongoing-event.dto';
import { UpdateOngoingConfigDto } from './dto/update-ongoing-config.dto';
import { SetOngoingTeamsDto } from './dto/set-ongoing-teams.dto';
import { AddOngoingTeamDto } from './dto/add-ongoing-team.dto';
import { UpdateOngoingGameScoreDto } from './dto/update-ongoing-game-score.dto';
import { AddSoloPlayerDto, FormTeamsFromSoloDto } from './dto/solo-registration.dto';
import {
  applyPromotionRelegation,
  rankGroupPlayers,
  rotationFixtures,
  seedIntoGroups,
  ROTATION_GROUP_SIZE,
  ROTATION_MAX_GROUPS,
  ROTATION_MIN_GROUPS,
  type RotationGameResult,
} from './rotation';
import {
  OngoingEventListItemDto,
  OngoingEventResponseDto,
  OngoingGameResponseDto,
  OngoingOpenEventDto,
  OngoingTeamResponseDto,
  OngoingSoloPlayerDto,
  OngoingSoloPairPreviewDto,
  OngoingTeamPlayerDto,
  OngoingRotationRoundDto,
  OngoingRotationStandingDto,
  OngoingRotationStateDto,
} from './dto/ongoing-event-response.dto';
import { buildGroupPairings, shuffle, packIntoRounds } from './schedule';
import { CANCELLATION_WINDOW_MS, eventStartInstant } from './registration-window';
import { isRuleKey } from './rules';
import { effectiveTeamCount, pairByRating } from './pairing';
import { dealIntoGroups, isPowerOfTwo } from './groups';
import { buildSeedList, buildBracketGames, rankGroupTeams, Qualifier } from './bracket';

// Sign-up stopped collecting a name, so the organiser line resolves one from the linked player;
// everything resolveDisplayName can fall back to has to be selected with it.
const CREATOR_SELECT = {
  id: true,
  name: true,
  isAnonymous: true,
  telegramNickname: true,
  email: true,
  player: { select: { name: true } },
} as const;

// Anonymity is a property of the linked account, so every player read in this module pulls it.
const PLAYER_USER_SELECT = { select: { isAnonymous: true } } as const;

const EVENT_INCLUDE = {
  config: true,
  teams: {
    include: {
      player1: { include: { playerStats: true, user: PLAYER_USER_SELECT } },
      player2: { include: { playerStats: true, user: PLAYER_USER_SELECT } },
    },
    // A single setTeams transaction stamps every row in the same millisecond, so createdAt alone has
    // ties; id is the tiebreaker the frontend's roster-remount key and index-wise diff rely on.
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  soloPlayers: {
    include: { player: { include: { playerStats: true, user: PLAYER_USER_SELECT } } },
    // Same reason as teams: a bulk insert stamps one millisecond, so id is the real tiebreak.
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  games: {
    include: { sidePlayers: { include: { player: { include: { user: PLAYER_USER_SELECT } } } } },
    orderBy: [{ round: 'asc' as const }, { order: 'asc' as const }],
  },
  rotationSlots: {
    include: { player: { include: { playerStats: true, user: PLAYER_USER_SELECT } } },
    orderBy: [{ round: 'asc' as const }, { groupIndex: 'asc' as const }, { createdAt: 'asc' as const }],
  },
};

// A game "has a result" only once BOTH scores are recorded — updateGameScore always writes them
// together and clearGameResult always nulls them together. assertPlanning (DB count) and findOpen
// (in-memory scan) must agree on this exact condition, or the Calendar page could offer registration
// on a tournament that addTeam then rejects with a 409. The calendar no longer hides a started
// tournament — it lists it with hasStarted set — so the agreement is now between that flag and this
// guard rather than between an omission and this guard. Capacity and the date are likewise reported
// rather than filtered: the client disables its own registration control.
// Note: `NOT: { team1Points: null, team2Points: null }` would express "NOT (both null)", i.e. "at
// least one filled" (De Morgan's law) — not "both filled". ANDing two `{ not: null }` filters is the
// correct translation of isGamePlayed below.
const PLAYED_GAME_WHERE = { team1Points: { not: null }, team2Points: { not: null } } as const;

// Three rounds is enough for the ladder to sort a field of 8-12; the organiser can change it.
const DEFAULT_ROTATION_ROUNDS = 3;

// With the default 2 groups this is a 4-team bracket — the smallest power-of-two playoff.
const DEFAULT_QUALIFIERS_PER_GROUP = 2;

// Rule 4: undoing a playoff result — by clearing it or by editing it to a different score — while its
// successor already has a result is refused uniformly. A one-sentence rule ("undo the later round
// first") beats one with a same-winner exception, and it closes the edit path the same way the clear
// path is closed, without a caller having to reason about whether this particular edit is "safe".
const PLAYOFF_SUCCESSOR_PLAYED_MESSAGE =
  "This game's winner has already advanced into a played later round; clear that result first";

export function isGamePlayed(game: { team1Points: number | null; team2Points: number | null }): boolean {
  return game.team1Points !== null && game.team2Points !== null;
}

@Injectable()
export class OngoingService {
  constructor(private prisma: PrismaService, private userService: UserService) {}

  async findAll(): Promise<OngoingEventListItemDto[]> {
    const events = await this.prisma.ongoingEvent.findMany({
      where: { finishedAt: null },
      orderBy: { date: 'desc' },
      include: {
        // The list card names the roster and the pool, so the players (and their ratings) come along
        // rather than the page fanning out to the detail endpoint once per tournament.
        teams: {
          include: {
            player1: { include: { playerStats: true, user: PLAYER_USER_SELECT } },
            player2: { include: { playerStats: true, user: PLAYER_USER_SELECT } },
          },
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        },
        soloPlayers: {
          include: { player: { include: { playerStats: true, user: PLAYER_USER_SELECT } } },
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        },
        createdByUser: { select: CREATOR_SELECT },
        config: { select: { visibility: true } },
        games: true,
      },
    });

    return events.map((event) => ({
      id: event.id,
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      location: event.location,
      createdByUserId: event.createdByUserId,
      createdBy: event.createdByUser
        ? {
            id: event.createdByUser.id,
            name: resolveDisplayName(event.createdByUser),
            isAnonymous: event.createdByUser.isAnonymous ?? false,
          }
        : null,
      visibility: event.config?.visibility ?? 'public',
      teamsCount: event.teams.length,
      gamesCount: event.games.length,
      playedCount: event.games.filter((game) => isGamePlayed(game)).length,
      teams: event.teams.map((team) => this.mapTeam(team)),
      soloPlayers: event.soloPlayers.map((solo) => this.mapSoloPlayer(solo)),
    }));
  }

  async create(
    createOngoingEventDto: CreateOngoingEventDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    // No ValidationPipe is registered in this service, so the DTO decorators never run — validate here as the siblings do.
    if (!createOngoingEventDto) {
      throw new BadRequestException('name and date are required');
    }

    const { name, date } = createOngoingEventDto;

    if (typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('name must be a non-empty string');
    }

    const parsedDate = new Date(date);

    if (!date || Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException('date must be a valid date');
    }

    const teams = createOngoingEventDto.teams;

    if (teams !== undefined && !Array.isArray(teams)) {
      throw new BadRequestException('teams must be an array');
    }

    const maxTeams = this.normaliseMaxTeams(createOngoingEventDto.maxTeams, teams ? teams.length : 0);
    const startTime = this.normaliseStartTime(createOngoingEventDto.startTime);
    const location = this.normaliseLocation(createOngoingEventDto.location);
    const { scheme, groupCount, qualifiersPerGroup, rotationRounds } = this.normaliseScheme({
      scheme: createOngoingEventDto.scheme,
      groupCount: createOngoingEventDto.groupCount,
      qualifiersPerGroup: createOngoingEventDto.qualifiersPerGroup,
      rotationRounds: createOngoingEventDto.rotationRounds,
    });
    const visibility = this.normaliseVisibility(createOngoingEventDto.visibility);
    // fullRotation registers players, not pairs, so its entry path is the solo one — the flag is not
    // the organiser's to turn off there.
    // fullRotation has no pair entry path at all, so it is solo-only by construction.
    const soloOnlyRegistration =
      scheme === 'fullRotation'
        ? true
        : this.normaliseBooleanFlag(createOngoingEventDto.soloOnlyRegistration, 'soloOnlyRegistration');
    const allowSoloRegistration =
      scheme === 'fullRotation' || soloOnlyRegistration
        ? true
        : this.normaliseAllowSolo(createOngoingEventDto.allowSoloRegistration);

    if (scheme === 'fullRotation' && teams && teams.length) {
      throw new BadRequestException('A fullRotation tournament registers individual players, not teams');
    }

    if (soloOnlyRegistration && teams && teams.length) {
      throw new BadRequestException(
        'This tournament registers individual players, not teams — add them as solo players instead',
      );
    }

    const soloPlayerIds = this.validateInitialSoloPlayers(
      createOngoingEventDto.soloPlayers,
      teams,
      allowSoloRegistration,
    );

    // The same capacity addSoloPlayer/addTeam enforce later — creating an already-overfull
    // tournament would otherwise be a way around it.
    if (scheme === 'fullRotation') {
      const seats = groupCount * ROTATION_GROUP_SIZE;
      if (soloPlayerIds.length > seats) {
        throw new ConflictException(
          `A fullRotation tournament with ${groupCount} groups seats ${seats} players, and ${soloPlayerIds.length} were given`,
        );
      }
    } else if (maxTeams !== null && effectiveTeamCount(teams?.length ?? 0, soloPlayerIds.length) > maxTeams) {
      throw new ConflictException('The initial roster exceeds maxTeams');
    }

    if (teams && teams.length) {
      const playerIds = this.validateTeamPairs(teams);
      await this.assertPlayersExist(playerIds);
    }
    if (soloPlayerIds.length) {
      await this.assertPlayersExist(soloPlayerIds);
    }

    const data: any = {
      name,
      date: parsedDate,
      startTime,
      location,
      createdByUserId: currentUser.sub,
      config: {
        create: {
          gamesPerPair: 1,
          courts: 1,
          maxTeams,
          scheme,
          groupCount,
          qualifiersPerGroup,
          rotationRounds,
          visibility,
          allowSoloRegistration,
          soloOnlyRegistration,
        },
      },
    };

    if (teams && teams.length) {
      data.teams = {
        create: teams.map((team) => ({ player1Id: team.player1Id, player2Id: team.player2Id })),
      };
    }
    if (soloPlayerIds.length) {
      data.soloPlayers = { create: soloPlayerIds.map((playerId) => ({ playerId })) };
    }

    const event = await this.prisma.ongoingEvent.create({ data, include: EVENT_INCLUDE });

    return this.mapEvent(event);
  }

  async findOne(id: string): Promise<OngoingEventResponseDto> {
    return this.loadEvent(id);
  }

  async remove(id: string, currentUser: JwtPayload): Promise<void> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);
    await this.prisma.ongoingEvent.delete({ where: { id } });
  }

  async updateConfig(
    id: string,
    updateOngoingConfigDto: UpdateOngoingConfigDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    if (!updateOngoingConfigDto) {
      throw new BadRequestException('gamesPerPair and courts are required');
    }

    const { gamesPerPair, courts } = updateOngoingConfigDto;

    if (![1, 2, 3].includes(gamesPerPair)) {
      throw new BadRequestException('gamesPerPair must be 1, 2 or 3');
    }
    if (!Number.isInteger(courts) || courts < 1) {
      throw new BadRequestException('courts must be at least 1');
    }

    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);
    const maxTeams = this.normaliseMaxTeams(updateOngoingConfigDto.maxTeams, event.teams.length);
    const { scheme, groupCount, qualifiersPerGroup, rotationRounds } = this.normaliseScheme({
      scheme: updateOngoingConfigDto.scheme,
      groupCount: updateOngoingConfigDto.groupCount,
      qualifiersPerGroup: updateOngoingConfigDto.qualifiersPerGroup,
      rotationRounds: updateOngoingConfigDto.rotationRounds,
    });
    const visibility = this.normaliseVisibility(updateOngoingConfigDto.visibility);
    const soloOnlyRegistration =
      scheme === 'fullRotation'
        ? true
        : this.normaliseBooleanFlag(updateOngoingConfigDto.soloOnlyRegistration, 'soloOnlyRegistration');
    const allowSoloRegistration =
      scheme === 'fullRotation' || soloOnlyRegistration
        ? true
        : this.normaliseAllowSolo(updateOngoingConfigDto.allowSoloRegistration);
    const hiddenRules = this.normaliseHiddenRules(updateOngoingConfigDto.hiddenRules, event.config.hiddenRules ?? []);

    // The pairs already registered would have no way back in once the pair entry path is closed.
    if (soloOnlyRegistration && event.teams.length) {
      throw new BadRequestException(
        'This tournament has registered teams; clear the roster before switching it to solo-only registration',
      );
    }

    // Switching an event that already has pairs onto fullRotation would leave that roster unplayable.
    if (scheme === 'fullRotation' && event.teams.length) {
      throw new BadRequestException(
        'This tournament has registered teams; clear the roster before switching it to fullRotation',
      );
    }

    // Otherwise the pool's entrants are stranded behind a UI that no longer renders it.
    if (!allowSoloRegistration && event.soloPlayers.length) {
      throw new BadRequestException('Solo registration cannot be turned off while the solo pool is not empty');
    }

    await this.prisma.ongoingEventConfig.upsert({
      where: { eventId: id },
      create: {
        eventId: id,
        gamesPerPair,
        courts,
        maxTeams,
        scheme,
        groupCount,
        qualifiersPerGroup,
        rotationRounds,
        visibility,
        allowSoloRegistration,
        soloOnlyRegistration,
        hiddenRules,
      },
      update: {
        gamesPerPair,
        courts,
        maxTeams,
        scheme,
        groupCount,
        qualifiersPerGroup,
        rotationRounds,
        visibility,
        allowSoloRegistration,
        soloOnlyRegistration,
        hiddenRules,
      },
    });

    return this.loadEvent(id);
  }

  async setTeams(
    id: string,
    setOngoingTeamsDto: SetOngoingTeamsDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (!setOngoingTeamsDto || !Array.isArray(setOngoingTeamsDto.teams)) {
      throw new BadRequestException('teams must be an array');
    }

    if (event.config.scheme === 'fullRotation' && setOngoingTeamsDto.teams.length) {
      throw new BadRequestException('A fullRotation tournament registers individual players, not teams');
    }

    const teams = setOngoingTeamsDto.teams;
    const playerIds = this.validateTeamPairs(teams);

    await this.assertPlanning(id);
    await this.assertPlayersExist(playerIds);

    await this.prisma.$transaction(async (tx) => {
      // Fixtures reference teams, so they go first — replacing the roster invalidates the schedule.
      await tx.ongoingGame.deleteMany({ where: { eventId: id } });
      await tx.ongoingTeam.deleteMany({ where: { eventId: id } });

      if (teams.length) {
        await tx.ongoingTeam.createMany({
          data: teams.map((team) => ({ eventId: id, player1Id: team.player1Id, player2Id: team.player2Id })),
        });
      }

      // Anyone placed into a team leaves the pool — a player is in a team or in the pool, never both.
      const rosterPlayerIds = teams.flatMap((team) => [team.player1Id, team.player2Id]);
      if (rosterPlayerIds.length) {
        await tx.ongoingSoloPlayer.deleteMany({
          where: { eventId: id, playerId: { in: rosterPlayerIds } },
        });
      }
    });

    return this.loadEvent(id);
  }

  async addTeam(
    id: string,
    addOngoingTeamDto: AddOngoingTeamDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);

    if (!addOngoingTeamDto) {
      throw new BadRequestException('player1Id and player2Id are required');
    }

    if (event.config.scheme === 'fullRotation') {
      throw new BadRequestException(
        'A fullRotation tournament registers individual players; register without a partner instead',
      );
    }

    // Solo-only closes the pair entry path for everyone, the organiser included — they still build
    // teams from the pool through form-teams and the roster editor.
    if (event.config.soloOnlyRegistration) {
      throw new BadRequestException('This tournament registers individual players; register without a partner instead');
    }

    const { player1Id, player2Id } = addOngoingTeamDto;

    const isManager = this.canManage(event.createdByUserId, currentUser);

    if (!isManager) {
      if (event.config.visibility === 'private') {
        throw new ForbiddenException('This tournament is private; only its creator can add teams');
      }

      const currentUserRecord = await this.userService.findById(currentUser.sub);
      if (
        !currentUserRecord?.playerId ||
        (currentUserRecord.playerId !== player1Id && currentUserRecord.playerId !== player2Id)
      ) {
        throw new BadRequestException('You must register yourself as one of the two players');
      }
    }

    // Validate the newcomer against the whole roster at once, so "already in another team" covers
    // both the incoming pair and everyone registered before it.
    const existingPairs = event.teams.map((team) => ({
      player1Id: team.player1.id,
      player2Id: team.player2.id,
    }));
    this.validateTeamPairs([...existingPairs, { player1Id, player2Id }]);

    await this.assertPlanning(id);

    if (!this.isRegistrationDateOpen(event.date)) {
      throw new ConflictException('Registration for this tournament has closed');
    }

    for (const playerId of [player1Id, player2Id]) {
      if (event.soloPlayers.some((solo) => solo.player.id === playerId)) {
        throw new ConflictException(`Player ${playerId} is registered without a partner; cancel that first`);
      }
    }

    if (
      event.config.maxTeams !== null &&
      effectiveTeamCount(event.teams.length + 1, event.soloPlayers.length) > event.config.maxTeams
    ) {
      throw new ConflictException('This tournament is full');
    }

    await this.assertPlayersExist([player1Id, player2Id]);

    await this.prisma.$transaction(async (tx) => {
      await tx.ongoingTeam.create({ data: { eventId: id, player1Id, player2Id } });
      // Closes the race where a solo registration lands between the read above and this write.
      await tx.ongoingSoloPlayer.deleteMany({
        where: { eventId: id, playerId: { in: [player1Id, player2Id] } },
      });
    });

    return this.loadEvent(id);
  }

  async findOpen(): Promise<OngoingOpenEventDto[]> {
    const events = await this.prisma.ongoingEvent.findMany({
      // Everything still running. A tournament that has started, or whose date has passed, stays on
      // the calendar so anyone can follow it; only a finished one drops off. The `finishedAt` filter
      // is now load-bearing — it used to be implied by the played-game check below.
      where: { finishedAt: null },
      orderBy: { date: 'asc' },
      include: { ...EVENT_INCLUDE, createdByUser: { select: CREATOR_SELECT } },
    });

    const open: OngoingOpenEventDto[] = [];

    for (const event of events) {
      // Neither fullness nor having started filters a tournament out: the calendar lists it and the
      // client decides what to offer. hasStarted and registrationOpen travel in the payload so it can
      // say why registration is closed; addTeam/addSoloPlayer stay the enforcement point.
      const maxTeams = event.config ? event.config.maxTeams : null;

      open.push({
        id: event.id,
        name: event.name,
        date: event.date,
        startTime: event.startTime,
        location: event.location,
        maxTeams: maxTeams === undefined ? null : maxTeams,
        teamsCount: event.teams.length,
        // The calendar needs the owner to decide whether to render a Register control on a private
        // tournament, so this mirrors OngoingEventListItemDto rather than being derived client-side.
        createdByUserId: event.createdByUserId ?? null,
        createdBy: event.createdByUser
          ? {
              id: event.createdByUser.id,
              name: resolveDisplayName(event.createdByUser),
              isAnonymous: event.createdByUser.isAnonymous ?? false,
            }
          : null,
        teams: event.teams.map((team) => this.mapTeam(team)),
        visibility: event.config && event.config.visibility !== undefined ? event.config.visibility : 'public',
        allowSoloRegistration:
          event.config && event.config.allowSoloRegistration !== undefined ? event.config.allowSoloRegistration : false,
        soloOnlyRegistration:
          event.config && event.config.soloOnlyRegistration !== undefined ? event.config.soloOnlyRegistration : false,
        soloPlayers: event.soloPlayers.map((solo) => this.mapSoloPlayer(solo)),
        scheme: event.config && event.config.scheme !== undefined ? event.config.scheme : 'roundRobin',
        groupCount: event.config && event.config.groupCount !== undefined ? event.config.groupCount : 1,
        hasStarted: event.games.some((game) => isGamePlayed(game)),
        registrationOpen: this.isRegistrationDateOpen(event.date),
      });
    }

    return open;
  }

  async removeTeam(teamId: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const team = await this.prisma.ongoingTeam.findUnique({
      where: { id: teamId },
      include: { event: { select: { createdByUserId: true, date: true, startTime: true } } },
    });

    if (!team) {
      throw new NotFoundException(`Ongoing team with ID ${teamId} not found`);
    }

    // Either member may withdraw the pair up to the deadline; the manager is not bound by it.
    await this.assertOwnEntryOrManager(
      team.event.createdByUserId,
      team.event.date,
      team.event.startTime,
      [team.player1Id, team.player2Id],
      currentUser,
    );
    await this.assertPlanning(team.eventId);

    // ongoing_games -> ongoing_teams is ON DELETE CASCADE, and in planning every fixture is unplayed,
    // so the cascade cannot destroy a recorded result.
    await this.prisma.ongoingTeam.delete({ where: { id: teamId } });

    return this.loadEvent(team.eventId);
  }

  async addSoloPlayer(
    id: string,
    addSoloPlayerDto: AddSoloPlayerDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    const isManager = this.canManage(event.createdByUserId, currentUser);

    if (!isManager && event.config.visibility === 'private') {
      throw new ForbiddenException('This tournament is private; only its creator can add entrants');
    }
    if (!event.config.allowSoloRegistration) {
      throw new ConflictException('This tournament does not accept registration without a partner');
    }

    const requestedPlayerId = addSoloPlayerDto ? addSoloPlayerDto.playerId : undefined;
    let playerId: string;

    if (isManager && requestedPlayerId) {
      playerId = requestedPlayerId;
    } else {
      const currentUserRecord = await this.userService.findById(currentUser.sub);
      if (!currentUserRecord?.playerId || (requestedPlayerId && requestedPlayerId !== currentUserRecord.playerId)) {
        throw new BadRequestException('You can only register yourself without a partner');
      }
      playerId = currentUserRecord.playerId;
    }

    await this.assertPlanning(id);

    if (!this.isRegistrationDateOpen(event.date)) {
      throw new ConflictException('Registration for this tournament has closed');
    }

    // The one-entry invariant: a player is in a team or in the pool, never both.
    const onRoster = event.teams.some((team) => team.player1.id === playerId || team.player2.id === playerId);
    if (onRoster) {
      throw new ConflictException(`Player ${playerId} is already in a team in this tournament`);
    }
    if (event.soloPlayers.some((solo) => solo.player.id === playerId)) {
      throw new ConflictException(`Player ${playerId} is already registered without a partner`);
    }

    if (event.config.scheme === 'fullRotation') {
      // The groups have to fill exactly, so the roster is capped at the seats the format defines and
      // maxTeams (a pairs figure) does not apply.
      if (event.soloPlayers.length + 1 > this.rotationSeats(event.config)) {
        throw new ConflictException('This tournament is full');
      }
    } else if (
      event.config.maxTeams !== null &&
      effectiveTeamCount(event.teams.length, event.soloPlayers.length + 1) > event.config.maxTeams
    ) {
      throw new ConflictException('This tournament is full');
    }

    await this.assertPlayersExist([playerId]);
    await this.prisma.ongoingSoloPlayer.create({ data: { eventId: id, playerId } });

    return this.loadEvent(id);
  }

  async removeSoloPlayer(soloId: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const solo = await this.prisma.ongoingSoloPlayer.findUnique({
      where: { id: soloId },
      include: { event: { select: { createdByUserId: true, date: true, startTime: true } } },
    });

    if (!solo) {
      throw new NotFoundException(`Solo registration with ID ${soloId} not found`);
    }

    await this.assertOwnEntryOrManager(
      solo.event.createdByUserId,
      solo.event.date,
      solo.event.startTime,
      [solo.playerId],
      currentUser,
    );
    await this.assertPlanning(solo.eventId);

    await this.prisma.ongoingSoloPlayer.delete({ where: { id: soloId } });

    return this.loadEvent(solo.eventId);
  }

  async previewSoloPairing(id: string, currentUser: JwtPayload): Promise<OngoingSoloPairPreviewDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    const byPlayerId = new Map(event.soloPlayers.map((solo) => [solo.player.id, solo]));
    const { pairs, unpaired } = pairByRating(
      event.soloPlayers.map((solo) => ({ playerId: solo.player.id, rating: solo.rating })),
    );

    return {
      pairs: pairs.map((pair) => {
        const first = byPlayerId.get(pair.player1Id);
        const second = byPlayerId.get(pair.player2Id);
        return {
          player1: first.player,
          player2: second.player,
          rating: first.rating + second.rating,
        };
      }),
      unpaired: unpaired.map((playerId) => byPlayerId.get(playerId).player),
    };
  }

  /**
   * The reverse of formTeamsFromSolo: every pair goes back to the solo pool, ready to be paired again.
   * Each player keeps the pair's registration time rather than getting "now", so the roster still
   * shows when they actually entered.
   *
   * The unplayed schedule goes with the teams — its fixtures reference them — and the planning guard
   * keeps a recorded result from ever being part of that.
   */
  async disbandTeams(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (event.config.scheme === 'fullRotation') {
      throw new BadRequestException('A fullRotation tournament has no teams to disband');
    }
    // Otherwise the players land in a pool that nobody can register into or be paired from.
    if (!event.config.allowSoloRegistration) {
      throw new BadRequestException(
        'Turn on registration without a partner first — disbanded players wait in the solo pool',
      );
    }

    await this.assertPlanning(id);

    if (!event.teams.length) return event;

    await this.prisma.$transaction(async (tx) => {
      await tx.ongoingGame.deleteMany({ where: { eventId: id } });
      // Pool rows first, mirroring formTeamsFromSolo: a failure can never leave a player in neither place.
      await tx.ongoingSoloPlayer.createMany({
        data: event.teams.flatMap((team) =>
          [team.player1.id, team.player2.id].map((playerId) => ({
            eventId: id,
            playerId,
            createdAt: team.registeredAt,
          })),
        ),
      });
      await tx.ongoingTeam.deleteMany({ where: { eventId: id } });
    });

    return this.loadEvent(id);
  }

  async formTeamsFromSolo(
    id: string,
    formTeamsFromSoloDto: FormTeamsFromSoloDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (!formTeamsFromSoloDto || !Array.isArray(formTeamsFromSoloDto.teams)) {
      throw new BadRequestException('teams must be an array');
    }

    const teams = formTeamsFromSoloDto.teams;
    // Reuses the roster validator, so "same player twice" and "a team of one" read identically here
    // and in setTeams.
    const playerIds = this.validateTeamPairs(teams);

    await this.assertPlanning(id);

    const poolIds = new Set(event.soloPlayers.map((solo) => solo.player.id));
    for (const playerId of playerIds) {
      if (!poolIds.has(playerId)) {
        throw new BadRequestException(`Player ${playerId} is not registered without a partner in this tournament`);
      }
    }

    if (!teams.length) return this.loadEvent(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.ongoingTeam.createMany({
        data: teams.map((team) => ({ eventId: id, player1Id: team.player1Id, player2Id: team.player2Id })),
      });
      // Pool rows go second: the teams they became must exist before the pool forgets them, so a
      // failure can never leave an entrant in neither place.
      await tx.ongoingSoloPlayer.deleteMany({ where: { eventId: id, playerId: { in: playerIds } } });
    });

    return this.loadEvent(id);
  }

  // The tournament's own date is the deadline: registration stays open through the whole of that day.
  // Compared as UTC calendar dates rather than absolute instants, so a date-only input (which Date
  // parses as UTC midnight) is judged the same way regardless of the server process's local timezone.
  private isRegistrationDateOpen(date: Date): boolean {
    const eventDate = new Date(date);
    const now = new Date();

    const eventDay = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    return eventDay >= today;
  }

  // Withdrawing yourself closes 24 hours before the first ball — inside a day the organiser is
  // already building a schedule around you, and a replacement can no longer be found.
  //
  // startTime is a wall-clock "HH:MM" with no zone of its own, so it is read against the UTC midnight
  // the date is stored as. That is the only reading both this and the browser can reach the same
  // answer from; it is off by the venue's UTC offset, which is minutes-to-hours, not days.
  private isCancellationOpen(date: Date, startTime: string | null): boolean {
    const start = eventStartInstant(date, startTime);
    if (start === null) return false;

    return Date.now() < start - CANCELLATION_WINDOW_MS;
  }

  async generateSchedule(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    // fullRotation schedules one round at a time — the next round's groups are not knowable until
    // this one has been played — so its first round is built by its own path.
    if (event.config.scheme === 'fullRotation') {
      return this.writeRotationRound(id, 1, this.seedFirstRotationRound(event));
    }

    if (event.teams.length < 2) {
      throw new BadRequestException('At least two teams are required to generate a schedule');
    }

    const { scheme, groupCount, qualifiersPerGroup, gamesPerPair, courts } = event.config;
    const groups = dealIntoGroups(
      event.teams.map((team) => team.id),
      groupCount,
    );

    // Group sizes are only knowable after dealing, so this guard cannot live in config validation.
    if (scheme === 'groupsPlayoff') {
      const nonEmptySizes = groups.map((group) => group.length).filter((size) => size > 0);
      const smallestGroupSize = Math.min(...nonEmptySizes);

      if (smallestGroupSize <= qualifiersPerGroup) {
        throw new BadRequestException(
          `The smallest group has ${smallestGroupSize} team(s), which cannot produce ${qualifiersPerGroup} ` +
            'qualifier(s); the group stage would eliminate nobody',
        );
      }
    }

    const matches = packIntoRounds(shuffle(buildGroupPairings(groups, gamesPerPair)), courts);

    await this.prisma.$transaction(async (tx) => {
      await tx.ongoingGame.deleteMany({ where: { eventId: id } });
      await tx.ongoingGame.createMany({
        data: matches.map((match) => ({
          eventId: id,
          team1Id: match.team1Id,
          team2Id: match.team2Id,
          team1Points: null,
          team2Points: null,
          round: match.round,
          court: match.court,
          order: match.order,
          phase: 'group',
          bracketRound: null,
          bracketSlot: null,
        })),
      });

      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        for (const teamId of groups[groupIndex]) {
          await tx.ongoingTeam.update({ where: { id: teamId }, data: { groupIndex } });
        }
      }
    });

    return this.loadEvent(id);
  }

  /**
   * Groups for round 1, seeded by rating. The roster has to fill every group exactly: a group of
   * three or five has no three-fixture rotation, so a partial field cannot be scheduled at all.
   */
  private seedFirstRotationRound(event: any): string[][] {
    const seats = this.rotationSeats(event.config);

    if (event.soloPlayers.length !== seats) {
      throw new BadRequestException(
        `A fullRotation tournament with ${event.config.groupCount} groups needs exactly ${seats} registered ` +
          `players, and this one has ${event.soloPlayers.length}`,
      );
    }

    return seedIntoGroups(
      // `event` here is the mapped response, where mapSoloPlayer has already flattened the rating —
      // reading solo.player.playerStats would silently seed everyone at the 1000 default.
      event.soloPlayers.map((solo: any) => ({ playerId: solo.player.id, rating: solo.rating })),
      event.config.groupCount,
    );
  }

  /**
   * Replaces round `round` — its slots and its games — with the given groups. Generating a round
   * again is therefore idempotent, and earlier rounds are left untouched so their results survive.
   */
  private async writeRotationRound(
    eventId: string,
    round: number,
    groups: string[][],
  ): Promise<OngoingEventResponseDto> {
    await this.prisma.$transaction(async (tx) => {
      // Games first: ongoing_game_players cascades from the game, so deleting the games clears the
      // participants too.
      await tx.ongoingGame.deleteMany({ where: { eventId, phase: 'rotation', round } });
      await tx.ongoingRotationSlot.deleteMany({ where: { eventId, round } });

      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        for (const playerId of groups[groupIndex]) {
          await tx.ongoingRotationSlot.create({ data: { eventId, playerId, round, groupIndex } });
        }
      }

      let order = 0;
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        for (const fixture of rotationFixtures(groups[groupIndex])) {
          await tx.ongoingGame.create({
            data: {
              eventId,
              team1Id: null,
              team2Id: null,
              team1Points: null,
              team2Points: null,
              round,
              // One notional court per fixture in a round; the organiser reads them as a list.
              court: order + 1,
              order,
              phase: 'rotation',
              groupIndex,
              sidePlayers: {
                create: [
                  ...fixture.side1.map((playerId) => ({ playerId, side: 1 })),
                  ...fixture.side2.map((playerId) => ({ playerId, side: 2 })),
                ],
              },
            },
          });
          order += 1;
        }
      }
    });

    return this.loadEvent(eventId);
  }

  /**
   * Builds the next round from the current one's finishing order: top two of each group up, bottom
   * two down. Refuses while any current-round game is unplayed, and after the last round — at that
   * point the strongest group's table is the result.
   */
  async advanceRotationRound(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (event.config.scheme !== 'fullRotation') {
      throw new BadRequestException('Rounds can only be advanced in a fullRotation tournament');
    }

    const rotation = event.rotation;
    if (!rotation || !rotation.currentRound) {
      throw new ConflictException('The first round has not been generated yet');
    }

    const currentRound = rotation.currentRound;
    const roundGames = event.games.filter((game) => game.phase === 'rotation' && game.round === currentRound);
    if (roundGames.some((game) => !isGamePlayed(game))) {
      throw new ConflictException('Every game of the current round must have a result before the next round');
    }
    if (currentRound >= rotation.totalRounds) {
      throw new ConflictException(
        `Round ${currentRound} is the last one; the strongest group's table is the final result`,
      );
    }

    const table = rotation.rounds.find((round) => round.round === currentRound);
    if (!table) {
      throw new ConflictException('The current round has no group tables to advance from');
    }

    const rankedGroups = table.groups
      .slice()
      .sort((one, two) => one.groupIndex - two.groupIndex)
      .map((group) => group.standings.map((row) => row.player.id));

    return this.writeRotationRound(id, currentRound + 1, applyPromotionRelegation(rankedGroups));
  }

  private rotationSeats(config: { groupCount: number }): number {
    return config.groupCount * ROTATION_GROUP_SIZE;
  }

  /** The highest round that has slots — i.e. the round currently being played. 0 when none exists. */
  private currentRotationRound(event: any): number {
    return (event.rotationSlots || []).reduce((highest: number, slot: any) => Math.max(highest, slot.round), 0);
  }

  /** Every group of one round with its players in finishing order. */
  private rankRotationRound(
    event: any,
    round: number,
  ): Array<{ groupIndex: number; standings: ReturnType<typeof rankGroupPlayers> }> {
    const slots = (event.rotationSlots || []).filter((slot: any) => slot.round === round);
    const groupCount = slots.reduce((highest: number, slot: any) => Math.max(highest, slot.groupIndex + 1), 0);
    const games: RotationGameResult[] = (event.games || [])
      .filter((game: any) => game.phase === 'rotation' && game.round === round)
      .map((game: any) => ({
        side1PlayerIds: (game.sidePlayers || []).filter((p: any) => p.side === 1).map((p: any) => p.playerId),
        side2PlayerIds: (game.sidePlayers || []).filter((p: any) => p.side === 2).map((p: any) => p.playerId),
        side1Points: game.team1Points,
        side2Points: game.team2Points,
      }));

    const groups: Array<{ groupIndex: number; standings: ReturnType<typeof rankGroupPlayers> }> = [];
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      // The rating is part of the ordering now (equal difference favours the lower-rated player), so
      // it travels with the roster rather than being attached afterwards.
      const groupPlayers = slots
        .filter((slot: any) => slot.groupIndex === groupIndex)
        .map((slot: any) => ({ playerId: slot.playerId, rating: slot.player?.playerStats?.rank ?? 1000 }));
      groups.push({ groupIndex, standings: rankGroupPlayers(groupPlayers, games) });
    }
    return groups;
  }

  async generatePlayoff(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (event.config.scheme !== 'groupsPlayoff') {
      throw new BadRequestException('The playoff is only available for the groupsPlayoff scheme');
    }

    const hasPlayoff = event.games.some((game) => game.phase === 'playoff');
    if (hasPlayoff) {
      throw new ConflictException('The playoff already exists; delete it first before generating a new one');
    }

    const groupGames = event.games.filter((game) => game.phase === 'group');
    if (!groupGames.length) {
      throw new ConflictException('The group stage has not been scheduled yet');
    }
    if (!this.isGroupStageComplete(event.games)) {
      throw new ConflictException('Every group game must have a result before the playoff can be generated');
    }

    const { groupCount, qualifiersPerGroup } = event.config;
    const qualifiers: Qualifier[] = [];

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      const teamIds = event.teams.filter((team) => team.groupIndex === groupIndex).map((team) => team.id);
      if (!teamIds.length) continue;

      const ranked = rankGroupTeams(teamIds, groupGames);
      // Guards against a qualifiersPerGroup raised (via updateConfig) after generateSchedule already
      // validated a smaller value against this group's actual size — otherwise ranked[place] below
      // would be undefined and that undefined team id would be written straight into a bracket row.
      if (ranked.length < qualifiersPerGroup) {
        throw new BadRequestException(
          `Group ${groupIndex + 1} has ${ranked.length} ranked team(s), fewer than the ${qualifiersPerGroup} ` +
            'qualifiersPerGroup configured',
        );
      }

      for (let place = 0; place < qualifiersPerGroup; place += 1) {
        qualifiers.push({ teamId: ranked[place], groupIndex, place: place + 1 });
      }
    }

    const seedList = buildSeedList(qualifiers);
    const bracketGames = buildBracketGames(seedList);

    const rows = bracketGames.map((game, index) => ({
      eventId: id,
      team1Id: game.team1Id,
      team2Id: game.team2Id,
      team1Points: null,
      team2Points: null,
      // Bracket games are not court-scheduled in this phase.
      round: 0,
      court: 0,
      order: index,
      phase: 'playoff',
      bracketRound: game.bracketRound,
      bracketSlot: game.bracketSlot,
      thirdPlace: false,
    }));

    // A 3rd-place match needs two semifinal losers to seed it; brackets smaller than 4 teams have no
    // semifinal round to draw them from.
    if (seedList.length >= 4) {
      rows.push({
        eventId: id,
        team1Id: null,
        team2Id: null,
        team1Points: null,
        team2Points: null,
        round: 0,
        court: 0,
        order: rows.length,
        phase: 'playoff',
        bracketRound: null,
        bracketSlot: null,
        thirdPlace: true,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.ongoingGame.createMany({ data: rows });
    });

    return this.loadEvent(id);
  }

  async deletePlayoff(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);
    await this.prisma.ongoingGame.deleteMany({ where: { eventId: id, phase: 'playoff' } });

    return this.loadEvent(id);
  }

  // Marking a tournament finished only removes it from the "current tournaments" list (findAll)
  // and the calendar's open-for-registration list, both of which already exclude it once it has a
  // played game (see findOpen's hasResult check) — this never deletes or locks anything, mirroring
  // the frontend's own "Finish tournament" gate so a caller can't bypass that gate by hitting the
  // API directly.
  async finishTournament(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);
    this.assertTournamentComplete(event);

    await this.prisma.ongoingEvent.update({ where: { id }, data: { finishedAt: new Date() } });

    return this.loadEvent(id);
  }

  private assertTournamentComplete(event: OngoingEventResponseDto): void {
    if (event.config.scheme === 'groupsPlayoff') {
      const playoffGames = event.games.filter((game) => game.phase === 'playoff');
      const bracketGames = playoffGames.filter((game) => !game.thirdPlace && game.bracketRound !== null);
      const thirdPlaceGame = playoffGames.find((game) => game.thirdPlace) ?? null;

      if (!bracketGames.length) {
        throw new ConflictException('The playoff has not been generated yet; the tournament is not finished');
      }

      const maxBracketRound = Math.max(...bracketGames.map((game) => game.bracketRound as number));
      const finalGame = bracketGames.find((game) => game.bracketRound === maxBracketRound) as OngoingGameResponseDto;

      if (!isGamePlayed(finalGame)) {
        throw new ConflictException('The final has not been played yet; the tournament is not finished');
      }
      if (thirdPlaceGame && !isGamePlayed(thirdPlaceGame)) {
        throw new ConflictException('The 3rd-place match has not been played yet; the tournament is not finished');
      }
      return;
    }

    if (!event.games.length || !event.games.every((game) => isGamePlayed(game))) {
      throw new ConflictException('Not every game has a result yet; the tournament is not finished');
    }

    // fullRotation generates one round at a time, so "every game played" is satisfied by round 1 of
    // 3 while the ladder has decided nothing. Mirrors the frontend's own finish gate.
    if (event.config.scheme === 'fullRotation' && !event.rotation?.isFinished) {
      throw new ConflictException(
        `Round ${event.rotation?.currentRound ?? 0} of ${event.rotation?.totalRounds ?? 0} is played; ` +
          'every round must be complete before a fullRotation tournament is finished',
      );
    }
  }

  async updateGameScore(
    gameId: string,
    updateOngoingGameScoreDto: UpdateOngoingGameScoreDto,
    currentUser: JwtPayload,
  ): Promise<OngoingGameResponseDto> {
    const game = await this.loadGame(gameId);
    await this.assertCanRecordResult(game.eventId, currentUser);

    // Nest always delivers {} for an empty HTTP body; this guards direct service invocation only, mirroring updateConfig/setTeams.
    if (!updateOngoingGameScoreDto) {
      throw new BadRequestException('team1Points and team2Points are required');
    }

    // Rule 6: a bracket slot can be empty (playoff rounds are written ahead of the teams that will
    // fill them), and a score is meaningless until both are known. A rotation game is exempt: its
    // sides are ad-hoc pairs recorded in sidePlayers, so it legitimately has no team rows at all.
    if (game.phase !== 'rotation' && (game.team1Id === null || game.team2Id === null)) {
      throw new BadRequestException('Both teams must be known before a result can be recorded');
    }

    // Rule 3: a group result would invalidate the seeding the playoff was already generated from.
    if (game.phase === 'group') {
      await this.assertGroupResultsUnlocked(game.eventId);
    }

    const { team1Points, team2Points } = updateOngoingGameScoreDto;
    const isValidScore = (points: number) => Number.isInteger(points) && points >= 0;

    if (!isValidScore(team1Points) || !isValidScore(team2Points)) {
      throw new BadRequestException('Points must be whole numbers of 0 or more');
    }
    if (team1Points === team2Points) {
      throw new BadRequestException('A set cannot end in a draw');
    }

    // The score write and the advancement it triggers must commit together: a winner recorded
    // without being advanced (or vice versa) is a corrupt bracket with no repair but delete-and-regenerate.
    return this.prisma.$transaction(async (tx) => {
      const successors = game.phase === 'playoff' ? await this.findPlayoffSuccessors(tx, game) : [];

      // Rule 4, checked before the score is written rather than after: the later round(s) were played
      // by whoever this result sent through, so re-deciding it now would strand that score (or that
      // 3rd-place slot) against a team that never earned it. Any played successor refuses — not just
      // the first one checked.
      if (successors.some((successor) => isGamePlayed(successor.game))) {
        throw new ConflictException(PLAYOFF_SUCCESSOR_PLAYED_MESSAGE);
      }

      const updatedGame = await tx.ongoingGame.update({
        where: { id: gameId },
        data: { team1Points, team2Points },
      });

      // No stored winner/loser column: both are always derived from the score, never persisted
      // separately — free to drift otherwise.
      const winnerId = team1Points > team2Points ? game.team1Id : game.team2Id;
      const loserId = team1Points > team2Points ? game.team2Id : game.team1Id;

      for (const successor of successors) {
        // Never set points here — a slot fill must never carry a score (rule 6).
        await tx.ongoingGame.update({
          where: { id: successor.game.id },
          data: { [successor.slotField]: successor.game.thirdPlace ? loserId : winnerId },
        });
      }

      return this.mapGame(updatedGame);
    });
  }

  async clearGameResult(gameId: string, currentUser: JwtPayload): Promise<OngoingGameResponseDto> {
    const game = await this.loadGame(gameId);
    await this.assertCanRecordResult(game.eventId, currentUser);

    // Rule 3: same lock as updateGameScore — a group result cannot move once the playoff exists.
    if (game.phase === 'group') {
      await this.assertGroupResultsUnlocked(game.eventId);
    }

    return this.prisma.$transaction(async (tx) => {
      const successors = game.phase === 'playoff' ? await this.findPlayoffSuccessors(tx, game) : [];

      // Rule 4: undo later rounds (and the 3rd-place row, if fed) first — a deep cascade of clears
      // would be a surprising side effect. Any played successor refuses.
      if (successors.some((successor) => isGamePlayed(successor.game))) {
        throw new ConflictException(PLAYOFF_SUCCESSOR_PLAYED_MESSAGE);
      }

      // Empty every slot this game had filled, not just the first successor.
      for (const successor of successors) {
        await tx.ongoingGame.update({
          where: { id: successor.game.id },
          data: { [successor.slotField]: null },
        });
      }

      const updatedGame = await tx.ongoingGame.update({
        where: { id: gameId },
        data: { team1Points: null, team2Points: null },
      });

      return this.mapGame(updatedGame);
    });
  }

  // The one place the bracket's geometry is written down: the game at round r, slot s feeds round
  // r + 1, slot floor(s / 2), arriving in team1 when s is even and team2 when it is odd — and, when r
  // is the semifinal round (maxBracketRound - 1) and a 3rd-place row exists, s also feeds that row in
  // the same team1/team2 parity (an arbitrary but fixed choice, same as the normal case). Recording a
  // result, clearing one, and both rule-4 guards all need the same successors, so they all ask here.
  // Returns an empty array for a game with no successor — the final with no 3rd-place row, or
  // anything outside the bracket.
  private async findPlayoffSuccessors(
    tx: any,
    game: { eventId: string; bracketRound: number | null; bracketSlot: number | null },
  ): Promise<Array<{ game: any; slotField: 'team1Id' | 'team2Id' }>> {
    if (game.bracketRound === null || game.bracketSlot === null) return [];

    const slotField: 'team1Id' | 'team2Id' = game.bracketSlot % 2 === 0 ? 'team1Id' : 'team2Id';
    const successors: Array<{ game: any; slotField: 'team1Id' | 'team2Id' }> = [];

    const nextGame = await tx.ongoingGame.findFirst({
      where: {
        eventId: game.eventId,
        phase: 'playoff',
        bracketRound: game.bracketRound + 1,
        bracketSlot: Math.floor(game.bracketSlot / 2),
      },
    });

    // No normal successor means this is the final — nothing downstream, including no 3rd-place row.
    if (!nextGame) return successors;

    successors.push({ game: nextGame, slotField });

    const { _max } = await tx.ongoingGame.aggregate({
      where: { eventId: game.eventId, phase: 'playoff', bracketRound: { not: null } },
      _max: { bracketRound: true },
    });

    // _max.bracketRound is never actually null here: nextGame above already proved a row with a
    // non-null bracketRound exists, and this aggregate's own where-clause only considers such rows.
    // Guarded anyway since strictNullChecks is off and this arithmetic would misbehave silently.
    if (_max.bracketRound !== null && game.bracketRound === _max.bracketRound - 1) {
      const thirdPlaceGame = await tx.ongoingGame.findFirst({
        where: { eventId: game.eventId, phase: 'playoff', thirdPlace: true },
      });

      if (thirdPlaceGame) {
        successors.push({ game: thirdPlaceGame, slotField });
      }
    }

    return successors;
  }

  // Rule 3: once the playoff exists, its seeding depends on the group table as it stood at
  // generation time; editing or clearing a group result afterwards would contradict the bracket.
  private async assertGroupResultsUnlocked(eventId: string): Promise<void> {
    const playoffGamesCount = await this.prisma.ongoingGame.count({ where: { eventId, phase: 'playoff' } });

    if (playoffGamesCount) {
      throw new ConflictException(
        'Group results are locked once the playoff has been generated; delete the playoff to edit them',
      );
    }
  }

  // Rule 1: the group stage is complete only once every group-phase game carries a result; zero
  // group games is not complete either — there is nothing yet to have qualified out of.
  private isGroupStageComplete(
    games: { phase: string; team1Points: number | null; team2Points: number | null }[],
  ): boolean {
    const groupGames = games.filter((game) => game.phase === 'group');
    return groupGames.length > 0 && groupGames.every((game) => isGamePlayed(game));
  }

  // "Started" means a recorded result, not a generated fixture — an unplayed schedule is still planning.
  private async assertPlanning(eventId: string): Promise<void> {
    const played = await this.prisma.ongoingGame.count({
      where: { eventId, ...PLAYED_GAME_WHERE },
    });

    if (played) {
      throw new ConflictException('The tournament has already started; its roster is locked');
    }
  }

  private normaliseScheme(input: {
    scheme?: string | null;
    groupCount?: number | null;
    qualifiersPerGroup?: number | null;
    rotationRounds?: number | null;
  }): { scheme: string; groupCount: number; qualifiersPerGroup: number | null; rotationRounds: number } {
    const { scheme, groupCount, qualifiersPerGroup, rotationRounds } = input;
    const resolved = scheme === undefined || scheme === null ? 'roundRobin' : scheme;

    if (resolved !== 'roundRobin' && resolved !== 'groupsPlayoff' && resolved !== 'fullRotation') {
      throw new BadRequestException('scheme must be roundRobin, groupsPlayoff or fullRotation');
    }

    // Only fullRotation runs rounds; the column keeps its default for the other two so nothing has
    // to read it conditionally.
    const rounds = rotationRounds === undefined || rotationRounds === null ? DEFAULT_ROTATION_ROUNDS : rotationRounds;

    if (resolved === 'fullRotation') {
      const groups = groupCount === undefined || groupCount === null ? ROTATION_MIN_GROUPS : groupCount;

      if (!Number.isInteger(groups) || groups < ROTATION_MIN_GROUPS || groups > ROTATION_MAX_GROUPS) {
        throw new BadRequestException(
          `fullRotation needs ${ROTATION_MIN_GROUPS} or ${ROTATION_MAX_GROUPS} groups of ${ROTATION_GROUP_SIZE}`,
        );
      }
      if (!Number.isInteger(rounds) || rounds < 1) {
        throw new BadRequestException('rotationRounds must be at least 1');
      }

      // No playoff to seed: the ladder itself decides the podium.
      return { scheme: resolved, groupCount: groups, qualifiersPerGroup: null, rotationRounds: rounds };
    }

    // A flat round-robin is the one-group case, so the group fields are meaningless there.
    if (resolved === 'roundRobin') {
      return { scheme: resolved, groupCount: 1, qualifiersPerGroup: null, rotationRounds: rounds };
    }

    const groups = groupCount === undefined || groupCount === null ? 2 : groupCount;

    // A single group is legal: a field too small to split plays one round-robin table, then the
    // playoff seeds straight off it (1st vs 4th, 2nd vs 3rd, ...) — buildSeedList's place-then-
    // groupIndex sort and the standard bracket already produce that pairing with groupCount 1.
    if (!Number.isInteger(groups) || groups < 1) {
      throw new BadRequestException('groupsPlayoff needs at least 1 group');
    }
    // Defaulted, not required: the create form offers "groups + playoff" as a tournament type
    // without asking for a bracket shape up front, and a tournament with no entrants yet has
    // nothing to size one against. 2 per group pairs with the default 2 groups to give a
    // power-of-two bracket, and updateConfig can change it before the playoff is generated.
    const qualifiers =
      qualifiersPerGroup === undefined || qualifiersPerGroup === null
        ? DEFAULT_QUALIFIERS_PER_GROUP
        : qualifiersPerGroup;

    if (!Number.isInteger(qualifiers) || qualifiers < 1) {
      throw new BadRequestException('qualifiersPerGroup must be at least 1');
    }
    if (!isPowerOfTwo(groups * qualifiers)) {
      throw new BadRequestException('groupCount times qualifiersPerGroup must be a power of two');
    }

    return { scheme: resolved, groupCount: groups, qualifiersPerGroup: qualifiers, rotationRounds: rounds };
  }

  private normaliseVisibility(value: string | undefined | null): string {
    const resolved = value === undefined || value === null ? 'public' : value;

    if (resolved !== 'public' && resolved !== 'private') {
      throw new BadRequestException('visibility must be public or private');
    }

    return resolved;
  }

  /**
   * Hidden rule keys are replaced wholesale, not merged — the config form always sends the complete
   * set. Keys belonging to another scheme are kept: switching scheme and back must restore what the
   * organiser chose before, and only the UI knows which scheme is on screen.
   */
  private normaliseHiddenRules(value: unknown, current: string[]): string[] {
    if (value === undefined || value === null) return current;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new BadRequestException('hiddenRules must be an array of rule keys');
    }

    const unknownKey = value.find((entry) => !isRuleKey(entry));
    if (unknownKey !== undefined) {
      throw new BadRequestException(`Unknown rule key: ${unknownKey}`);
    }

    return [...new Set(value as string[])];
  }

  private normaliseBooleanFlag(value: boolean | undefined | null, field: string): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') {
      throw new BadRequestException(`${field} must be a boolean`);
    }

    return value;
  }

  private normaliseAllowSolo(value: boolean | undefined | null): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') {
      throw new BadRequestException('allowSoloRegistration must be a boolean');
    }

    return value;
  }

  private normaliseMaxTeams(value: number | undefined | null, currentTeamCount: number): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isInteger(value) || value < 2) {
      throw new BadRequestException('maxTeams must be at least 2');
    }
    if (value < currentTeamCount) {
      throw new BadRequestException('maxTeams cannot be lower than the number of registered teams');
    }

    return value;
  }

  // A wall-clock time at the venue, not an instant — there is no timezone to reconcile, so it is
  // stored and rendered verbatim. `date` stays UTC midnight of the calendar day.
  private normaliseStartTime(value: string | undefined | null): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new BadRequestException('startTime must be in HH:MM 24-hour format');
    }

    return value;
  }

  private normaliseLocation(value: string | undefined | null): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException('location must be a string');
    }

    return value.trim() || null;
  }

  private canManage(createdByUserId: string | null, currentUser: JwtPayload): boolean {
    const isCreator = createdByUserId !== null && createdByUserId === currentUser.sub;
    return isCreator || currentUser.role === 'admin';
  }

  private assertCanManage(createdByUserId: string | null, currentUser: JwtPayload): void {
    if (!this.canManage(createdByUserId, currentUser)) {
      throw new ForbiddenException('Only the tournament creator or an admin can do this');
    }
  }

  // A manager may withdraw anybody at any time; an entrant may withdraw only themselves, and only
  // while the cancellation window is open.
  private async assertOwnEntryOrManager(
    createdByUserId: string | null,
    eventDate: Date,
    eventStartTime: string | null,
    entryPlayerIds: string[],
    currentUser: JwtPayload,
  ): Promise<void> {
    if (this.canManage(createdByUserId, currentUser)) return;

    const currentUserRecord = await this.userService.findById(currentUser.sub);
    const playerId = currentUserRecord?.playerId;

    if (!playerId || !entryPlayerIds.includes(playerId)) {
      throw new ForbiddenException('You can only cancel your own registration');
    }
    if (!this.isCancellationOpen(eventDate, eventStartTime)) {
      throw new ForbiddenException(
        'Registration can no longer be cancelled — the deadline was 24 hours before the tournament',
      );
    }
  }

  /**
   * Recording a result is open to the tournament's own entrants, not just its organiser: at a real
   * event whoever is free walks over and enters the score. "Involved" means the caller's player is on
   * a roster, in the solo pool, or in a rotation group of this event.
   *
   * Deliberately per-event, not per-game — a rotation player changes partner every fixture, and a
   * team player is only ever on two of their group's courts.
   */
  private async assertCanRecordResult(eventId: string, currentUser: JwtPayload): Promise<void> {
    const event = await this.prisma.ongoingEvent.findUnique({
      where: { id: eventId },
      select: {
        createdByUserId: true,
        teams: { select: { player1Id: true, player2Id: true } },
        soloPlayers: { select: { playerId: true } },
        rotationSlots: { select: { playerId: true } },
      },
    });

    if (!event) {
      throw new NotFoundException(`Ongoing event with ID ${eventId} not found`);
    }
    if (this.canManage(event.createdByUserId, currentUser)) return;

    const currentUserRecord = await this.userService.findById(currentUser.sub);
    const playerId = currentUserRecord?.playerId ?? null;

    const entrants = new Set<string>([
      ...event.teams.flatMap((team) => [team.player1Id, team.player2Id]),
      ...event.soloPlayers.map((solo) => solo.playerId),
      ...event.rotationSlots.map((slot) => slot.playerId),
    ]);

    if (!playerId || !entrants.has(playerId)) {
      throw new ForbiddenException("Only this tournament's entrants and its organiser can record results");
    }
  }

  /**
   * The pool a tournament is created with. Enforces the same one-entry invariant addSoloPlayer does:
   * a player is in a team or in the pool, never both, and never twice.
   */
  private validateInitialSoloPlayers(
    soloPlayers: string[] | undefined,
    teams: Array<{ player1Id: string; player2Id: string }> | undefined,
    allowSoloRegistration: boolean,
  ): string[] {
    if (!soloPlayers) return [];
    if (!Array.isArray(soloPlayers)) {
      throw new BadRequestException('soloPlayers must be an array of player ids');
    }
    if (!soloPlayers.length) return [];

    if (!allowSoloRegistration) {
      throw new BadRequestException(
        'This tournament does not accept registration without a partner; enable it or drop soloPlayers',
      );
    }

    const seen = new Set<string>();
    for (const playerId of soloPlayers) {
      if (typeof playerId !== 'string' || !playerId) {
        throw new BadRequestException('Every soloPlayers entry must be a player id');
      }
      if (seen.has(playerId)) {
        throw new BadRequestException(`Player ${playerId} is listed twice without a partner`);
      }
      seen.add(playerId);
    }

    for (const team of teams ?? []) {
      for (const playerId of [team.player1Id, team.player2Id]) {
        if (seen.has(playerId)) {
          throw new BadRequestException(`Player ${playerId} cannot be both in a team and without a partner`);
        }
      }
    }

    return soloPlayers;
  }

  private validateTeamPairs(pairs: Array<{ player1Id: string; player2Id: string }>): string[] {
    const seen = new Set<string>();

    for (const pair of pairs) {
      if (!pair || !pair.player1Id || !pair.player2Id) {
        throw new BadRequestException('A team must include both player1Id and player2Id');
      }
      if (pair.player1Id === pair.player2Id) {
        throw new BadRequestException('A team must have two different players');
      }
      for (const playerId of [pair.player1Id, pair.player2Id]) {
        if (seen.has(playerId)) {
          throw new BadRequestException(`Player ${playerId} is already in another team`);
        }
        seen.add(playerId);
      }
    }

    return Array.from(seen);
  }

  private async assertPlayersExist(playerIds: string[]): Promise<void> {
    if (!playerIds.length) return;

    const existing = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((player) => player.id));

    for (const playerId of playerIds) {
      if (!existingIds.has(playerId)) {
        throw new NotFoundException(`Player with ID ${playerId} not found`);
      }
    }
  }

  private async loadGame(gameId: string): Promise<{
    eventId: string;
    team1Id: string | null;
    team2Id: string | null;
    phase: string;
    bracketRound: number | null;
    bracketSlot: number | null;
  }> {
    const game = await this.prisma.ongoingGame.findUnique({ where: { id: gameId } });

    if (!game) {
      throw new NotFoundException(`Ongoing game with ID ${gameId} not found`);
    }

    return game;
  }

  private async loadEvent(id: string): Promise<OngoingEventResponseDto> {
    const event = await this.prisma.ongoingEvent.findUnique({
      where: { id },
      include: EVENT_INCLUDE,
    });

    if (!event) {
      throw new NotFoundException(`Ongoing event with ID ${id} not found`);
    }

    return this.mapEvent(event);
  }

  /** The one place an ongoing payload shapes a player, so the anonymity flag cannot be missed. */
  private mapPlayer(player: any): OngoingTeamPlayerDto {
    return {
      id: player.id,
      name: player.name,
      isAnonymous: player.user?.isAnonymous ?? false,
      avatar: player.avatar,
    };
  }

  private mapSoloPlayer(solo: any): OngoingSoloPlayerDto {
    return {
      id: solo.id,
      player: this.mapPlayer(solo.player),
      rating: solo.player.playerStats?.rank ?? 1000,
      registeredAt: solo.createdAt,
    };
  }

  private mapEvent(event: any): OngoingEventResponseDto {
    return {
      id: event.id,
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      location: event.location,
      finishedAt: event.finishedAt ?? null,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      createdByUserId: event.createdByUserId ?? null,
      config: {
        gamesPerPair: event.config ? event.config.gamesPerPair : 1,
        courts: event.config ? event.config.courts : 1,
        // Column absent (not selected) and explicit null both mean "no limit" to the addTeam guard.
        maxTeams: event.config && event.config.maxTeams !== undefined ? event.config.maxTeams : null,
        scheme: event.config && event.config.scheme !== undefined ? event.config.scheme : 'roundRobin',
        groupCount: event.config && event.config.groupCount !== undefined ? event.config.groupCount : 1,
        qualifiersPerGroup:
          event.config && event.config.qualifiersPerGroup !== undefined ? event.config.qualifiersPerGroup : null,
        rotationRounds:
          event.config && event.config.rotationRounds !== undefined
            ? event.config.rotationRounds
            : DEFAULT_ROTATION_ROUNDS,
        visibility: event.config && event.config.visibility !== undefined ? event.config.visibility : 'public',
        allowSoloRegistration:
          event.config && event.config.allowSoloRegistration !== undefined ? event.config.allowSoloRegistration : false,
        soloOnlyRegistration:
          event.config && event.config.soloOnlyRegistration !== undefined ? event.config.soloOnlyRegistration : false,
        hiddenRules: event.config && event.config.hiddenRules ? event.config.hiddenRules : [],
      },
      teams: (event.teams || []).map((team) => this.mapTeam(team)),
      soloPlayers: (event.soloPlayers || []).map((solo) => this.mapSoloPlayer(solo)),
      games: (event.games || []).map((game) => this.mapGame(game)),
      rotation: this.mapRotation(event),
    };
  }

  private mapTeam(team: any): OngoingTeamResponseDto {
    return {
      id: team.id,
      player1: this.mapPlayer(team.player1),
      player2: this.mapPlayer(team.player2),
      rating: (team.player1.playerStats?.rank ?? 1000) + (team.player2.playerStats?.rank ?? 1000),
      groupIndex: team.groupIndex ?? null,
      registeredAt: team.createdAt,
    };
  }

  private mapGame(game: any): OngoingGameResponseDto {
    return {
      id: game.id,
      eventId: game.eventId,
      team1Id: game.team1Id,
      team2Id: game.team2Id,
      team1Points: game.team1Points,
      team2Points: game.team2Points,
      round: game.round,
      court: game.court,
      order: game.order,
      phase: game.phase,
      bracketRound: game.bracketRound,
      bracketSlot: game.bracketSlot,
      thirdPlace: game.thirdPlace,
      groupIndex: game.groupIndex ?? null,
      side1Players: this.mapGameSide(game, 1),
      side2Players: this.mapGameSide(game, 2),
    };
  }

  private mapGameSide(game: any, side: number): OngoingTeamPlayerDto[] {
    return (game.sidePlayers || [])
      .filter((entry: any) => entry.side === side)
      .map((entry: any) => this.mapPlayer(entry.player));
  }

  /**
   * The whole rotation ladder: every round's tables, and the final order once the last round is in.
   *
   * Computed rather than stored so a corrected score reshuffles the tables immediately — the same
   * reason the group standings are not persisted either.
   */
  private mapRotation(event: any): OngoingRotationStateDto | null {
    if (!event.config || event.config.scheme !== 'fullRotation') return null;

    const totalRounds = event.config.rotationRounds ?? DEFAULT_ROTATION_ROUNDS;
    const currentRound = this.currentRotationRound(event);
    const playerOf = new Map<string, OngoingTeamPlayerDto>(
      (event.rotationSlots || []).map((slot: any) => [slot.playerId, this.mapPlayer(slot.player)]),
    );

    const toStandingDto = (row: any, index: number): OngoingRotationStandingDto => ({
      place: index + 1,
      player: playerOf.get(row.playerId) ?? { id: row.playerId, name: row.playerId, isAnonymous: false },
      rating: row.rating,
      played: row.played,
      wins: row.wins,
      losses: row.losses,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      pointsDiff: row.pointsDiff,
    });

    const rounds: OngoingRotationRoundDto[] = [];
    for (let round = 1; round <= currentRound; round += 1) {
      const roundGames = (event.games || []).filter((game: any) => game.phase === 'rotation' && game.round === round);
      rounds.push({
        round,
        isComplete: roundGames.length > 0 && roundGames.every((game: any) => isGamePlayed(game)),
        groups: this.rankRotationRound(event, round).map((group) => ({
          groupIndex: group.groupIndex,
          standings: group.standings.map(toStandingDto),
        })),
      });
    }

    const lastRound = rounds[rounds.length - 1];
    const isFinished = currentRound >= totalRounds && Boolean(lastRound?.isComplete);

    // Strongest group first, each group in its own finishing order — so the winner of group 1 is
    // the winner of the tournament.
    const finalStandings = isFinished
      ? lastRound.groups
          .slice()
          .sort((one, two) => one.groupIndex - two.groupIndex)
          .flatMap((group) => group.standings)
          .map((row, index) => ({ ...row, place: index + 1 }))
      : [];

    return { totalRounds, currentRound, isFinished, rounds, finalStandings };
  }
}

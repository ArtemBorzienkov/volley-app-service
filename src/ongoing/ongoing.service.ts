import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { JwtPayload } from '../auth-guards';
import { CreateOngoingEventDto } from './dto/create-ongoing-event.dto';
import { UpdateOngoingConfigDto } from './dto/update-ongoing-config.dto';
import { SetOngoingTeamsDto } from './dto/set-ongoing-teams.dto';
import { AddOngoingTeamDto } from './dto/add-ongoing-team.dto';
import { UpdateOngoingGameScoreDto } from './dto/update-ongoing-game-score.dto';
import { AddSoloPlayerDto, FormTeamsFromSoloDto } from './dto/solo-registration.dto';
import {
  OngoingEventListItemDto,
  OngoingEventResponseDto,
  OngoingGameResponseDto,
  OngoingOpenEventDto,
  OngoingTeamResponseDto,
  OngoingSoloPlayerDto,
  OngoingSoloPairPreviewDto,
} from './dto/ongoing-event-response.dto';
import { buildGroupPairings, shuffle, packIntoRounds } from './schedule';
import { effectiveTeamCount, pairByRating } from './pairing';
import { dealIntoGroups, isPowerOfTwo } from './groups';
import { buildSeedList, buildBracketGames, rankGroupTeams, Qualifier } from './bracket';

const EVENT_INCLUDE = {
  config: true,
  teams: {
    include: { player1: { include: { playerStats: true } }, player2: { include: { playerStats: true } } },
    // A single setTeams transaction stamps every row in the same millisecond, so createdAt alone has
    // ties; id is the tiebreaker the frontend's roster-remount key and index-wise diff rely on.
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  soloPlayers: {
    include: { player: { include: { playerStats: true } } },
    // Same reason as teams: a bulk insert stamps one millisecond, so id is the real tiebreak.
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  games: {
    orderBy: [{ round: 'asc' as const }, { order: 'asc' as const }],
  },
};

// A game "has a result" only once BOTH scores are recorded — updateGameScore always writes them
// together and clearGameResult always nulls them together. assertPlanning (DB count) and findOpen
// (in-memory scan) must agree on this exact condition, or the Calendar page could offer registration
// on a tournament that addTeam then rejects with a 409. Capacity is deliberately NOT part of that
// agreement: a full tournament stays listed, and the client disables its registration control.
// Note: `NOT: { team1Points: null, team2Points: null }` would express "NOT (both null)", i.e. "at
// least one filled" (De Morgan's law) — not "both filled". ANDing two `{ not: null }` filters is the
// correct translation of isGamePlayed below.
const PLAYED_GAME_WHERE = { team1Points: { not: null }, team2Points: { not: null } } as const;

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
          include: { player1: { include: { playerStats: true } }, player2: { include: { playerStats: true } } },
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        },
        soloPlayers: {
          include: { player: { include: { playerStats: true } } },
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        },
        createdByUser: { select: { id: true, name: true } },
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
      createdBy: event.createdByUser ? { id: event.createdByUser.id, name: event.createdByUser.name } : null,
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
    const { scheme, groupCount, qualifiersPerGroup } = this.normaliseScheme(
      createOngoingEventDto.scheme,
      createOngoingEventDto.groupCount,
      createOngoingEventDto.qualifiersPerGroup,
    );
    const visibility = this.normaliseVisibility(createOngoingEventDto.visibility);
    const allowSoloRegistration = this.normaliseAllowSolo(createOngoingEventDto.allowSoloRegistration);

    if (teams && teams.length) {
      const playerIds = this.validateTeamPairs(teams);
      await this.assertPlayersExist(playerIds);
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
          visibility,
          allowSoloRegistration,
        },
      },
    };

    if (teams && teams.length) {
      data.teams = {
        create: teams.map((team) => ({ player1Id: team.player1Id, player2Id: team.player2Id })),
      };
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
    const { scheme, groupCount, qualifiersPerGroup } = this.normaliseScheme(
      updateOngoingConfigDto.scheme,
      updateOngoingConfigDto.groupCount,
      updateOngoingConfigDto.qualifiersPerGroup,
    );
    const visibility = this.normaliseVisibility(updateOngoingConfigDto.visibility);
    const allowSoloRegistration = this.normaliseAllowSolo(updateOngoingConfigDto.allowSoloRegistration);

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
        visibility,
        allowSoloRegistration,
      },
      update: {
        gamesPerPair,
        courts,
        maxTeams,
        scheme,
        groupCount,
        qualifiersPerGroup,
        visibility,
        allowSoloRegistration,
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
      orderBy: { date: 'asc' },
      include: EVENT_INCLUDE,
    });

    const open: OngoingOpenEventDto[] = [];

    for (const event of events) {
      const hasResult = event.games.some((game) => isGamePlayed(game));
      if (hasResult) continue;
      if (!this.isRegistrationDateOpen(event.date)) continue;

      // A full tournament is NOT filtered out: the calendar lists it with registration disabled and a
      // "no spots left" note. maxTeams, teamsCount and soloPlayers all travel in the payload so the
      // client can work out fullness itself; addTeam stays the enforcement point.
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
        teams: event.teams.map((team) => this.mapTeam(team)),
        visibility: event.config && event.config.visibility !== undefined ? event.config.visibility : 'public',
        allowSoloRegistration:
          event.config && event.config.allowSoloRegistration !== undefined ? event.config.allowSoloRegistration : false,
        soloPlayers: event.soloPlayers.map((solo) => this.mapSoloPlayer(solo)),
      });
    }

    return open;
  }

  async removeTeam(teamId: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const team = await this.prisma.ongoingTeam.findUnique({
      where: { id: teamId },
      include: { event: { select: { createdByUserId: true, date: true } } },
    });

    if (!team) {
      throw new NotFoundException(`Ongoing team with ID ${teamId} not found`);
    }

    // Either member may withdraw the pair until the day before; the manager is not bound by that.
    await this.assertOwnEntryOrManager(
      team.event.createdByUserId,
      team.event.date,
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

    if (
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
      include: { event: { select: { createdByUserId: true, date: true } } },
    });

    if (!solo) {
      throw new NotFoundException(`Solo registration with ID ${soloId} not found`);
    }

    await this.assertOwnEntryOrManager(solo.event.createdByUserId, solo.event.date, [solo.playerId], currentUser);
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

  // Withdrawing yourself closes at the end of the day BEFORE the tournament — on the day itself the
  // organiser is already building a schedule around you. Same UTC-day comparison as registration, so
  // a date-only value is judged identically regardless of the server's local timezone.
  private isCancellationOpen(date: Date): boolean {
    const eventDate = new Date(date);
    const now = new Date();

    const eventDay = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    return today < eventDay;
  }

  async generateSchedule(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

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
  }

  async updateGameScore(
    gameId: string,
    updateOngoingGameScoreDto: UpdateOngoingGameScoreDto,
    currentUser: JwtPayload,
  ): Promise<OngoingGameResponseDto> {
    const game = await this.loadGame(gameId);
    await this.assertCanManageEvent(game.eventId, currentUser);

    // Nest always delivers {} for an empty HTTP body; this guards direct service invocation only, mirroring updateConfig/setTeams.
    if (!updateOngoingGameScoreDto) {
      throw new BadRequestException('team1Points and team2Points are required');
    }

    // Rule 6: a bracket slot can be empty (playoff rounds are written ahead of the teams that will
    // fill them), and a score is meaningless until both are known.
    if (game.team1Id === null || game.team2Id === null) {
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
    await this.assertCanManageEvent(game.eventId, currentUser);

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

  private normaliseScheme(
    scheme: string | undefined,
    groupCount: number | undefined,
    qualifiersPerGroup: number | undefined | null,
  ): { scheme: string; groupCount: number; qualifiersPerGroup: number | null } {
    const resolved = scheme === undefined || scheme === null ? 'roundRobin' : scheme;

    if (resolved !== 'roundRobin' && resolved !== 'groupsPlayoff') {
      throw new BadRequestException('scheme must be roundRobin or groupsPlayoff');
    }

    // A flat round-robin is the one-group case, so the group fields are meaningless there.
    if (resolved === 'roundRobin') {
      return { scheme: resolved, groupCount: 1, qualifiersPerGroup: null };
    }

    const groups = groupCount === undefined || groupCount === null ? 2 : groupCount;

    // A single group is legal: a field too small to split plays one round-robin table, then the
    // playoff seeds straight off it (1st vs 4th, 2nd vs 3rd, ...) — buildSeedList's place-then-
    // groupIndex sort and the standard bracket already produce that pairing with groupCount 1.
    if (!Number.isInteger(groups) || groups < 1) {
      throw new BadRequestException('groupsPlayoff needs at least 1 group');
    }
    if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1) {
      throw new BadRequestException('qualifiersPerGroup must be at least 1');
    }
    if (!isPowerOfTwo(groups * qualifiersPerGroup)) {
      throw new BadRequestException('groupCount times qualifiersPerGroup must be a power of two');
    }

    return { scheme: resolved, groupCount: groups, qualifiersPerGroup };
  }

  private normaliseVisibility(value: string | undefined | null): string {
    const resolved = value === undefined || value === null ? 'public' : value;

    if (resolved !== 'public' && resolved !== 'private') {
      throw new BadRequestException('visibility must be public or private');
    }

    return resolved;
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
    entryPlayerIds: string[],
    currentUser: JwtPayload,
  ): Promise<void> {
    if (this.canManage(createdByUserId, currentUser)) return;

    const currentUserRecord = await this.userService.findById(currentUser.sub);
    const playerId = currentUserRecord?.playerId;

    if (!playerId || !entryPlayerIds.includes(playerId)) {
      throw new ForbiddenException('You can only cancel your own registration');
    }
    if (!this.isCancellationOpen(eventDate)) {
      throw new ForbiddenException('Registration can no longer be cancelled — the deadline was the day before');
    }
  }

  private async assertCanManageEvent(eventId: string, currentUser: JwtPayload): Promise<void> {
    const event = await this.prisma.ongoingEvent.findUnique({
      where: { id: eventId },
      select: { createdByUserId: true },
    });
    this.assertCanManage(event?.createdByUserId ?? null, currentUser);
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

  private mapSoloPlayer(solo: any): OngoingSoloPlayerDto {
    return {
      id: solo.id,
      player: { id: solo.player.id, name: solo.player.name, avatar: solo.player.avatar },
      rating: solo.player.playerStats?.rank ?? 1000,
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
        visibility: event.config && event.config.visibility !== undefined ? event.config.visibility : 'public',
        allowSoloRegistration:
          event.config && event.config.allowSoloRegistration !== undefined ? event.config.allowSoloRegistration : false,
      },
      teams: (event.teams || []).map((team) => this.mapTeam(team)),
      soloPlayers: (event.soloPlayers || []).map((solo) => this.mapSoloPlayer(solo)),
      games: (event.games || []).map((game) => this.mapGame(game)),
    };
  }

  private mapTeam(team: any): OngoingTeamResponseDto {
    return {
      id: team.id,
      player1: { id: team.player1.id, name: team.player1.name, avatar: team.player1.avatar },
      player2: { id: team.player2.id, name: team.player2.name, avatar: team.player2.avatar },
      rating: (team.player1.playerStats?.rank ?? 1000) + (team.player2.playerStats?.rank ?? 1000),
      groupIndex: team.groupIndex ?? null,
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
    };
  }
}

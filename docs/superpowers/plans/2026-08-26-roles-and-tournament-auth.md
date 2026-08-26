# Roles and Tournament Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `role` (`admin`/`player`) to `User`, use it plus tournament ownership to authorize creating/editing/deleting an `OngoingEvent` and registering a team into one, and make registration require every account to have a linked player (existing or newly created).

**Architecture:** Backend: `role` travels in the JWT payload; `OngoingEvent` gains a `createdByUserId` owner; every mutating `/ongoing` route is guarded and checks creator-or-admin (a shared `assertCanManage` helper) except the public self-registration route, which instead checks the caller's own player is one of the two being registered. Frontend: a real `useAuth().user.role`/`user.id` replaces the fake `localStorage` admin gate everywhere; a new tooltip primitive explains disabled buttons to logged-out users.

**Tech Stack:** NestJS 9 + Prisma 4 (backend), Next.js 16 + TanStack Query + react-hook-form + zod + Radix Tooltip (frontend).

## Global Constraints

- **Never run git commands.** Steps labeled "Commit" describe a stopping point, not an instruction to invoke git.
- Backend: explicit return types on every public method. Single quotes, trailing commas, 120-column width. Unit-test against a **mocked `PrismaService`** — no test database exists.
- Backend: no global `ValidationPipe`; validate in the service. `@UsePipes(new ValidationPipe({ whitelist: true }))` already exists on `AuthController`/`UserController` — do not add it elsewhere.
- Backend: read endpoints (`GET /ongoing`, `GET /ongoing/:id`, `GET /ongoing/open`) stay public — do not guard them.
- Backend: `JwtAuthGuard`'s transparent (sliding-session) rotation carries the OLD payload's `role` forward **unchanged** — it does not re-fetch from the database (that would require `AuthGuardsModule` to depend on `UserModule`, which already depends on `AuthGuardsModule`, a circular import). `role` only refreshes from the database on a fresh login or an explicit `POST /auth/refresh-jwt` call. This is a known, accepted limitation — document it, do not "fix" it by introducing the circular dependency.
- Frontend: **npm only**. `npx tsc --noEmit` must stay clean. Every new endpoint goes in `lib/api.ts` (none are new in this plan — same endpoints, changed request/response shapes). Every page is `'use client'`.
- Frontend: any fetch to a `/ongoing` **mutating** endpoint (not the three `GET`s) must pass `credentials: 'include'` — these routes are now guarded and need the auth cookie. Task 12 depends on the full accounting of these call sites found during planning; do not skip any of the files it lists.

---

## File Structure

**Backend (`volley-app-service`):**
```
prisma/schema.prisma                              # + User.role, + OngoingEvent.createdByUserId
src/auth-guards/jwt-payload.interface.ts          # + role field
src/auth/auth.service.ts                          # logIn/refreshJWT embed role
src/auth/auth.service.spec.ts                     # updated fixtures/assertions
src/auth-guards/jwt-auth.guard.spec.ts            # updated fixture (role passthrough)
src/user/dto/user-response.dto.ts                 # + role
src/user/dto/create-user.dto.ts                   # playerId -> playerId | newPlayer (exactly one)
src/user/dto/new-player.dto.ts                    # new
src/user/user.service.ts                          # transactional new-player creation, role passthrough
src/user/user.service.spec.ts                     # new/updated tests
src/ongoing/dto/ongoing-event-response.dto.ts     # + createdByUserId on 2 DTOs
src/ongoing/ongoing.module.ts                     # + UserModule, AuthGuardsModule
src/ongoing/ongoing.service.ts                    # authorization on every mutating method
src/ongoing/ongoing.service.spec.ts               # new auth tests + ~135 call sites updated
src/ongoing/ongoing.controller.ts                 # @UseGuards(JwtAuthGuard) + req.user passthrough
```

**Frontend (`volleyball-management-ui`):**
```
components/ui/tooltip.tsx                         # new — shadcn primitive
lib/ongoing-permissions.ts                        # new — canManageOngoingEvent() helper
lib/types.ts                                      # AuthUser +role, OngoingEvent(-ListItem) +createdByUserId
app/register/page.tsx                             # mandatory existing-or-new-player choice
components/navigation.tsx                         # real role, drop the fake isAdmin state
hooks/use-is-admin.ts                             # deleted
app/ongoing/page.tsx                              # create button always visible (disabled+tooltip); delete = creator-or-admin
app/calendar/page.tsx                              # form always rendered
components/ongoing/create-tournament-form.tsx     # submit disabled+tooltip when logged out; credentials
components/ongoing/register-team-dialog.tsx       # self-locked player1; disabled+tooltip; credentials
app/ongoing/[id]/page.tsx                         # config tab + finish action = creator-or-admin
components/ongoing/ongoing-config-tab.tsx         # credentials only
components/ongoing/ongoing-roster-section.tsx     # credentials only
components/ongoing/ongoing-matches-tab.tsx        # canEdit = creator-or-admin
components/ongoing/ongoing-match-card.tsx         # credentials
components/ongoing/ongoing-bracket-tab.tsx        # isAdmin -> creator-or-admin; credentials
```

---

### Task 1: Schema — `User.role` and `OngoingEvent.createdByUserId`

**Files:**
- Modify: `volley-app-service/prisma/schema.prisma`

**Interfaces:**
- Produces: `User.role: string` (default `'player'`), `OngoingEvent.createdByUserId: string | null` — every later backend task depends on these two columns existing in the generated Prisma client.

- [ ] **Step 1: Confirm the active database**

```bash
cd /Users/artem/Desktop/projects/volley-app-service
cat .env | grep DATABASE_URL
```

Confirm the active (uncommented) line is `127.0.0.1`/`localhost`. If not, stop and confirm with the user before migrating.

- [ ] **Step 2: Add the two fields**

In `prisma/schema.prisma`, add `role` to the `User` model (insert right after `password`):

```prisma
  role      String    @default("player") // 'admin' | 'player', enforced in application code
```

Add `createdByUserId` + its relation to `OngoingEvent` (insert right after `updatedAt`, before `config`):

```prisma
  createdByUserId String?  @map("created_by_user_id")
  createdByUser   User?    @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)
```

Add the corresponding back-reference to `User` (insert right after the existing `player Player? @relation(...)` line):

```prisma
  ongoingEventsCreated OngoingEvent[]
```

- [ ] **Step 3: Run the migration**

```bash
npm run prisma:migrate:dev -- --name add_user_role_and_ongoing_creator
```

Expected: success; `@prisma/client` regenerates with `role` on `User` and `createdByUserId`/`createdByUser` on `OngoingEvent`.

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

Stage `prisma/schema.prisma` and the new migration directory (do not run `git commit` yourself).

---

### Task 2: `role` travels through the JWT

**Files:**
- Modify: `src/auth-guards/jwt-payload.interface.ts`
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/auth.service.spec.ts`
- Modify: `src/auth-guards/jwt-auth.guard.ts`
- Modify: `src/auth-guards/jwt-auth.guard.spec.ts`
- Modify: `src/user/dto/user-response.dto.ts`
- Modify: `src/user/user.service.ts`

**Interfaces:**
- Consumes: Task 1's `User.role` column.
- Produces: `JwtPayload.role: string`; `UserResponseDto.role: string`; `AuthedRequest.user.role` available to every guarded controller from here on (Task 4's `OngoingService`/`OngoingController` depend on this).

- [ ] **Step 1: Add `role` to `JwtPayload`**

In `src/auth-guards/jwt-payload.interface.ts`:

```ts
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}
```

- [ ] **Step 2: Update `AuthService` to embed and carry `role`**

In `src/auth/auth.service.ts`, change the two `signAsync` calls in `logIn` and `refreshJWT`:

```ts
  async logIn(dto: LogInDto): Promise<{ accessToken: string }> {
    const currUser = await this.userService.findByEmail(dto.email);
    if (!currUser) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordMatches = await bcrypt.compare(dto.password, currUser.password);
    if (!isPasswordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.userService.updateLastVisit(currUser.id);

    const accessToken = await this.jwtService.signAsync(
      { sub: currUser.id, email: currUser.email, role: currUser.role },
      { jwtid: randomUUID() },
    );

    return { accessToken };
  }

  /**
   * Rotate a valid token: confirm the user still exists, revoke the old token so it can't be
   * reused, and issue a fresh one with a new TTL.
   */
  async refreshJWT(payload: JwtPayload): Promise<{ accessToken: string }> {
    const user = await this.userService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { jwtid: randomUUID() },
    );

    this.tokenBlocklist.revoke(payload.jti);

    return { accessToken };
  }
```

`logOut` is unchanged.

- [ ] **Step 3: Add `role` to `UserRecord` and `UserResponseDto`**

In `src/user/user.service.ts`, add `role: string;` to the `UserRecord` interface (right after `password: string;`), and add `role: user.role,` to `toResponseDto`'s returned object (right after `name: user.name,`).

In `src/user/dto/user-response.dto.ts`:

```ts
export class UserResponseDto {
  id: string;
  email: string;
  name: string;
  role: string;
  playerId: string | null;
  createdAt: Date;
}
```

- [ ] **Step 4: Update `auth.service.spec.ts`**

In `src/auth/auth.service.spec.ts`:

Change the `logIn` describe block's `user` fixture and assertion:

```ts
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
```

(The other two `logIn` tests are unchanged — they reject before reaching `signAsync`.)

Change the `refreshJWT` describe block:

```ts
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
```

(Using a different role — `'admin'` — in the fetched user than the incoming payload's `'player'` deliberately demonstrates the refresh picks up the CURRENT role, not the old one. The `logOut` describe block is unchanged.)

- [ ] **Step 5: Update `jwt-auth.guard.spec.ts`'s rotation test**

In `src/auth-guards/jwt-auth.guard.spec.ts`, the rotation test needs `role` added to both payloads and the `signAsync` assertion. Replace:

```ts
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
      { sub: 'user-1', email: 'jane@example.com' },
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
```

Only the `oldPayload`/`newPayload` fixtures gained `role: 'player'` — the `signAsync` assertion is unchanged (the guard's re-sign still only carries `sub`/`email`, per the Global Constraints note: it does NOT re-embed role on transparent rotation, it relies on `jwtService.verifyAsync` decoding whatever `role` claim the reissued token happens to carry, which is none — **wait, re-check this against the actual guard code you're about to write in the next task**). The other four tests in this file need `role` added to their inline payload literals too, purely so `JwtPayload`-typed values match the interface shape consistently (`{sub, email, role, jti, iat, exp}`) — add `role: 'player',` to each of the three payload/`oldPayload` object literals at lines with `jti: 'jti-1'` (two of them) in the "revoked" and "attaches the payload" tests.

- [ ] **Step 6: Run the affected tests**

```bash
npx jest src/auth/auth.service.spec.ts src/auth-guards/jwt-auth.guard.spec.ts
```

Expected: all PASS.

- [ ] **Step 7: Run the full suite and build**

```bash
npm run test
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

---

### Task 3: Registration requires an existing or a brand-new player

**Files:**
- Create: `src/user/dto/new-player.dto.ts`
- Modify: `src/user/dto/create-user.dto.ts`
- Modify: `src/user/user.service.ts`
- Modify: `src/user/user.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, existing `Player` model.
- Produces: `CreateUserDto { email, name, password, playerId?, newPlayer?: NewPlayerDto }` where exactly one of `playerId`/`newPlayer` is required; `NewPlayerDto { name: string; gender: 'male' | 'female' }`. Task 8 (frontend register page) sends this shape.

- [ ] **Step 1: Write the failing tests**

Create `src/user/dto/new-player.dto.ts`:

```ts
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class NewPlayerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['male', 'female'])
  gender: string;
}
```

Modify `src/user/dto/create-user.dto.ts`:

```ts
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NewPlayerDto } from './new-player.dto';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewPlayerDto)
  newPlayer?: NewPlayerDto;
}
```

Add these new `describe` blocks to `src/user/user.service.spec.ts`, inside `describe('createUser', ...)`, alongside the existing cases (the existing 5 `it(...)` cases and the shared `dto`/mock setup stay exactly as they are — these are additions):

```ts
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
        data: { name: 'Jane', gender: 'female', active: true, playerStats: { create: { totalGames: 0, totalWins: 0, totalLosses: 0 } } },
      });
      expect(tx.user.create).toHaveBeenCalledWith({
        data: { email: 'jane@example.com', name: 'Jane', password: 'hashed-password', playerId: 'player-new' },
      });
      expect(result.playerId).toBe('player-new');
    });
```

Add `prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));` to the outer `beforeEach`'s `prisma` mock object (as a new key alongside `user`/`player`) so the earlier, unmodified tests (which never call `$transaction`) are unaffected, and add `BadRequestException` to the existing `import { ConflictException, NotFoundException } from '@nestjs/common';` line, making it `import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';`.

- [ ] **Step 2: Run the tests to confirm the three new ones fail**

```bash
npx jest src/user/user.service.spec.ts
```

Expected: FAIL — `BadRequestException`/`newPlayer` don't exist yet / `createUser` doesn't check the exactly-one-of rule.

- [ ] **Step 3: Implement**

In `src/user/user.service.ts`, replace `createUser` with:

```ts
  async createUser(dto: CreateUserDto): Promise<UserResponseDto> {
    if (!!dto.playerId === !!dto.newPlayer) {
      throw new BadRequestException('Provide exactly one of playerId or newPlayer');
    }

    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    if (dto.newPlayer) {
      const user = await this.prisma.$transaction(async (tx) => {
        const player = await tx.player.create({
          data: {
            name: dto.newPlayer.name,
            gender: dto.newPlayer.gender,
            active: true,
            playerStats: { create: { totalGames: 0, totalWins: 0, totalLosses: 0 } },
          },
        });

        return tx.user.create({
          data: { email: dto.email, name: dto.name, password: passwordHash, playerId: player.id },
        });
      });

      return this.toResponseDto(user);
    }

    const player = await this.prisma.player.findUnique({ where: { id: dto.playerId } });
    if (!player) {
      throw new NotFoundException(`Player with ID ${dto.playerId} not found`);
    }

    const existingLink = await this.prisma.user.findUnique({ where: { playerId: dto.playerId } });
    if (existingLink) {
      throw new ConflictException('This player is already linked to another account');
    }

    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, password: passwordHash, playerId: dto.playerId },
    });

    return this.toResponseDto(user);
  }
```

Add `BadRequestException` to the `@nestjs/common` import at the top of the file.

- [ ] **Step 4: Run the tests again to confirm they pass**

```bash
npx jest src/user/user.service.spec.ts
```

Expected: PASS (13 tests: the original 10 plus the 3 new ones).

- [ ] **Step 5: Run the full suite and build**

```bash
npm run test
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

---

### Task 4: `OngoingService` authorization — creator-or-admin + self-registration (TDD)

This is the largest task. It touches every mutating method in `OngoingService`, adds ~15 new focused tests, and mechanically updates roughly 135 pre-existing call sites in `ongoing.service.spec.ts` so the whole suite compiles and passes again against the new required parameter.

**Files:**
- Modify: `src/ongoing/dto/ongoing-event-response.dto.ts`
- Modify: `src/ongoing/ongoing.module.ts`
- Modify: `src/ongoing/ongoing.service.ts`
- Modify: `src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `JwtPayload` (Task 2, now has `role`) from `../auth-guards`; `UserService.findById` (Task 3) from `../user/user.service`.
- Produces: every `OngoingService` mutating method now takes a final `currentUser: JwtPayload` parameter; `OngoingEventResponseDto`/`OngoingEventListItemDto` gain `createdByUserId: string | null`. Task 5 (controller) passes `req.user` into these.

- [ ] **Step 1: Add `createdByUserId` to the two response DTOs**

In `src/ongoing/dto/ongoing-event-response.dto.ts`, add `createdByUserId: string | null;` to `OngoingEventResponseDto` (right after `updatedAt: Date;`) and to `OngoingEventListItemDto` (right after `location: string | null;`).

- [ ] **Step 2: Wire `UserModule` and `AuthGuardsModule` into `OngoingModule`**

Replace `src/ongoing/ongoing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OngoingService } from './ongoing.service';
import { OngoingController } from './ongoing.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { AuthGuardsModule } from '../auth-guards';

@Module({
  imports: [PrismaModule, UserModule, AuthGuardsModule],
  controllers: [OngoingController],
  providers: [OngoingService],
  exports: [OngoingService],
})
export class OngoingModule {}
```

- [ ] **Step 3: Write the new failing tests**

Add these to `src/ongoing/ongoing.service.spec.ts`. First, add a `UserService` mock and a shared `CURRENT_USER` fixture. In the outer `beforeEach` (around line 59-68), change:

```ts
  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [OngoingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });
```

to:

```ts
  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    userService = { findById: jest.fn(async () => ({ playerId: 'p3' }) as any) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OngoingService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });
```

Add `let userService: { findById: jest.Mock };` next to the existing `let prisma: ...;` declaration, and add these two imports at the top of the file: `import { UserService } from '../user/user.service';` and (extend the existing `@nestjs/common` import) add `ForbiddenException` to it.

Right after the outer `describe('OngoingService', ...)`'s opening (before the nested `describe('OngoingService.create', ...)`), add the shared fixture:

```ts
  const CURRENT_USER = { sub: 'user-1', email: 'user1@example.com', role: 'admin', jti: 'jti-1', iat: 0, exp: 0 };
```

Now add new test blocks. Add this new `describe`, placed right after the existing `describe('OngoingService.addTeam', ...)` block closes (after its final `});` — do not put it inside):

```ts
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
      await expect(
        service.updateConfig('event-1', { gamesPerPair: 1, courts: 1 }, NON_CREATOR_USER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('setTeams() refuses a non-creator, non-admin user', async () => {
      await expect(service.setTeams('event-1', { teams: [] }, NON_CREATOR_USER)).rejects.toThrow(
        ForbiddenException,
      );
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

    it('updateGameScore() refuses a non-creator, non-admin user', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => ({ eventId: 'event-1', team1Id: 't1', team2Id: 't2', phase: 'group' }) as any,
      );

      await expect(
        service.updateGameScore('game-1', { team1Points: 21, team2Points: 15 }, NON_CREATOR_USER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('clearGameResult() refuses a non-creator, non-admin user', async () => {
      prisma.ongoingGame.findUnique = jest.fn(
        async () => ({ eventId: 'event-1', team1Id: 't1', team2Id: 't2', phase: 'group' }) as any,
      );

      await expect(service.clearGameResult('game-1', NON_CREATOR_USER)).rejects.toThrow(ForbiddenException);
    });

    it('removeTeam() refuses a non-creator, non-admin user', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => ({ id: 't1', eventId: 'event-1' }) as any);
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

    it('refuses when neither player is the current user', async () => {
      userService.findById.mockResolvedValue({ playerId: 'p5' } as any);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER)).rejects.toThrow(
        new BadRequestException('You must register yourself as one of the two players'),
      );
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('refuses when the current user has no linked player', async () => {
      userService.findById.mockResolvedValue({ playerId: null } as any);

      await expect(
        service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER),
      ).rejects.toThrow(new BadRequestException('You must register yourself as one of the two players'));
    });
  });
```

- [ ] **Step 4: Run the new tests to confirm they fail**

```bash
npx jest src/ongoing/ongoing.service.spec.ts -t "authorization"
npx jest src/ongoing/ongoing.service.spec.ts -t "self-registration"
```

Expected: FAIL (methods don't take a `currentUser` param yet / don't check anything).

- [ ] **Step 5: Implement authorization in `OngoingService`**

In `src/ongoing/ongoing.service.ts`:

Add to the imports: `ForbiddenException` (extend the existing `@nestjs/common` import), `UserService` (`import { UserService } from '../user/user.service';`), and `JwtPayload` (`import { JwtPayload } from '../auth-guards';`).

Change the constructor:

```ts
  constructor(
    private prisma: PrismaService,
    private userService: UserService,
  ) {}
```

Add these two private helpers (anywhere among the other private helpers, e.g. right before `private validateTeamPairs`):

```ts
  private assertCanManage(createdByUserId: string | null, currentUser: JwtPayload): void {
    const isCreator = createdByUserId !== null && createdByUserId === currentUser.sub;
    const isAdmin = currentUser.role === 'admin';
    if (!isCreator && !isAdmin) {
      throw new ForbiddenException('Only the tournament creator or an admin can do this');
    }
  }

  private async assertCanManageEvent(eventId: string, currentUser: JwtPayload): Promise<void> {
    const event = await this.prisma.ongoingEvent.findUnique({
      where: { id: eventId },
      select: { createdByUserId: true },
    });
    this.assertCanManage(event?.createdByUserId ?? null, currentUser);
  }
```

Now change each method's signature and body. Every changed method keeps its existing logic exactly as-is except for the additions shown:

`create` — add the parameter and one field to `data`:
```ts
  async create(createOngoingEventDto: CreateOngoingEventDto, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
```
and in the `data: any = {...}` object literal, add `createdByUserId: currentUser.sub,` right after `location,`.

`remove`:
```ts
  async remove(id: string, currentUser: JwtPayload): Promise<void> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);
    await this.prisma.ongoingEvent.delete({ where: { id } });
  }
```

`updateConfig` — add the parameter, and insert the check right after `const event = await this.loadEvent(id);`:
```ts
  async updateConfig(
    id: string,
    updateOngoingConfigDto: UpdateOngoingConfigDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
```
```ts
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);
    const maxTeams = this.normaliseMaxTeams(updateOngoingConfigDto.maxTeams, event.teams.length);
```

`setTeams` — add the parameter, capture `loadEvent`'s result (it was previously discarded), and check:
```ts
  async setTeams(
    id: string,
    setOngoingTeamsDto: SetOngoingTeamsDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (!setOngoingTeamsDto || !Array.isArray(setOngoingTeamsDto.teams)) {
```

`addTeam` — add the parameter and the self-registration check, right after the `{ player1Id, player2Id } = addOngoingTeamDto;` line and before the existing `validateTeamPairs` call:
```ts
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

    const currentUserRecord = await this.userService.findById(currentUser.sub);
    if (
      !currentUserRecord?.playerId ||
      (currentUserRecord.playerId !== player1Id && currentUserRecord.playerId !== player2Id)
    ) {
      throw new BadRequestException('You must register yourself as one of the two players');
    }

    // ...unchanged: existingPairs / validateTeamPairs / assertPlanning / isRegistrationDateOpen /
    // maxTeams / assertPlayersExist / ongoingTeam.create / return this.loadEvent(id)...
```

`generateSchedule` — add the parameter and check right after `const event = await this.loadEvent(id);`:
```ts
  async generateSchedule(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (event.teams.length < 2) {
```

`generatePlayoff` — same pattern:
```ts
  async generatePlayoff(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (event.config.scheme !== 'groupsPlayoff') {
```

`deletePlayoff` — capture `loadEvent`'s result (previously discarded) and check:
```ts
  async deletePlayoff(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);
    await this.prisma.ongoingGame.deleteMany({ where: { eventId: id, phase: 'playoff' } });

    return this.loadEvent(id);
  }
```

`finishTournament`:
```ts
  async finishTournament(id: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);
    this.assertTournamentComplete(event);

    await this.prisma.ongoingEvent.update({ where: { id }, data: { finishedAt: new Date() } });

    return this.loadEvent(id);
  }
```

`updateGameScore` — add the parameter and check right after `const game = await this.loadGame(gameId);`:
```ts
  async updateGameScore(
    gameId: string,
    updateOngoingGameScoreDto: UpdateOngoingGameScoreDto,
    currentUser: JwtPayload,
  ): Promise<OngoingGameResponseDto> {
    const game = await this.loadGame(gameId);
    await this.assertCanManageEvent(game.eventId, currentUser);

    // Nest always delivers {} for an empty HTTP body; this guards direct service invocation only, mirroring updateConfig/setTeams.
    if (!updateOngoingGameScoreDto) {
```

`clearGameResult` — same pattern:
```ts
  async clearGameResult(gameId: string, currentUser: JwtPayload): Promise<OngoingGameResponseDto> {
    const game = await this.loadGame(gameId);
    await this.assertCanManageEvent(game.eventId, currentUser);

    // Rule 3: same lock as updateGameScore — a group result cannot move once the playoff exists.
    if (game.phase === 'group') {
```

`removeTeam` — add the parameter and check right after the existing "team not found" guard:
```ts
  async removeTeam(teamId: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const team = await this.prisma.ongoingTeam.findUnique({ where: { id: teamId } });

    if (!team) {
      throw new NotFoundException(`Ongoing team with ID ${teamId} not found`);
    }

    await this.assertCanManageEvent(team.eventId, currentUser);
    await this.assertPlanning(team.eventId);

    // ongoing_games -> ongoing_teams is ON DELETE CASCADE, and in planning every fixture is unplayed,
    // so the cascade cannot destroy a recorded result.
    await this.prisma.ongoingTeam.delete({ where: { id: teamId } });

    return this.loadEvent(team.eventId);
  }
```

`mapEvent` — add `createdByUserId` to its returned object, right after `updatedAt: event.updatedAt,`:
```ts
      createdByUserId: event.createdByUserId ?? null,
```

`findAll` — add `createdByUserId: event.createdByUserId,` to the object it pushes/maps into `OngoingEventListItemDto` (in the `events.map((event) => ({...}))` call), right after `location: event.location,`.

- [ ] **Step 6: Fix the ~135 pre-existing call sites so the file compiles and passes again**

Every one of these methods now requires a `currentUser` argument: `create`, `addTeam`, `setTeams`, `updateConfig`, `remove`, `generateSchedule`, `updateGameScore`, `clearGameResult`, `generatePlayoff`, `deletePlayoff`, `finishTournament`, `removeTeam`. Every pre-existing call to one of them in `ongoing.service.spec.ts` (not the new tests you just added, which already pass a user) needs `, CURRENT_USER` appended as its final argument.

This is mechanical and self-verifying: run the build, and TypeScript reports "Expected N arguments, but got N-1" at the exact line of every call site still missing the argument.

```bash
npm run build 2>&1 | head -60
```

Work through the errors: for each reported `src/ongoing/ongoing.service.spec.ts:<line>` location, open that line and append `, CURRENT_USER` inside the call's closing parenthesis (e.g. `service.setTeams('event-1', { teams: [] })` becomes `service.setTeams('event-1', { teams: [] }, CURRENT_USER)`). Repeat `npm run build` until it reports zero errors in this file. (`CURRENT_USER` has `role: 'admin'`, so every creator-or-admin check trivially passes regardless of the mocked event's `createdByUserId`, which the pre-existing fixtures never set.)

Once the build is clean, run the tests:

```bash
npm run test 2>&1 | grep -A 15 "●.*OngoingService"
```

Fix any remaining failures. There is exactly one known pre-existing assertion that needs its expected literal updated, not just its call site: in `describe('OngoingService.create', ...)`, the test `'creates the event together with a default config row'` asserts `prisma.ongoingEvent.create` was called with a fully-spelled `data: {...}` object. Add `createdByUserId: 'user-1',` to that expected object, right after `location: null,`:

```ts
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
            },
          },
        },
        include: expect.anything(),
      });
```

(and make sure that test's call is `await service.create({ name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z' }, CURRENT_USER);`, per Step 6's mechanical fix above). No other `ongoingEvent.create`/`update`/`delete`/etc. assertion in this file spells out a full literal that a new field would land inside — the mechanical argument-append is the only other change needed.

- [ ] **Step 7: Run the full suite and build to confirm everything is green**

```bash
npm run test
npm run build
```

Expected: PASS, 0 failures, 0 build errors.

- [ ] **Step 8: Commit**

---

### Task 5: `OngoingController` — wire the guard and pass `req.user` through

**Files:**
- Modify: `src/ongoing/ongoing.controller.ts`

**Interfaces:**
- Consumes: `OngoingService`'s new method signatures (Task 4); `JwtAuthGuard`, `AuthedRequest` from `../auth-guards`.
- Produces: a bootable server where every mutating `/ongoing` route requires auth. Task 6 verifies this manually.

- [ ] **Step 1: Replace the controller**

Replace the full contents of `src/ongoing/ongoing.controller.ts`:

```ts
import { Controller, Get, Post, Put, Patch, Body, Param, Delete, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { OngoingService } from './ongoing.service';
import { CreateOngoingEventDto } from './dto/create-ongoing-event.dto';
import { UpdateOngoingConfigDto } from './dto/update-ongoing-config.dto';
import { SetOngoingTeamsDto } from './dto/set-ongoing-teams.dto';
import { AddOngoingTeamDto } from './dto/add-ongoing-team.dto';
import { UpdateOngoingGameScoreDto } from './dto/update-ongoing-game-score.dto';
import {
  OngoingEventListItemDto,
  OngoingEventResponseDto,
  OngoingGameResponseDto,
  OngoingOpenEventDto,
} from './dto/ongoing-event-response.dto';
import { JwtAuthGuard } from '../auth-guards';
import type { AuthedRequest } from '../auth-guards';

@Controller('ongoing')
export class OngoingController {
  constructor(private readonly ongoingService: OngoingService) {}

  @Get()
  async findAll(): Promise<OngoingEventListItemDto[]> {
    return this.ongoingService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async create(
    @Body() createOngoingEventDto: CreateOngoingEventDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.create(createOngoingEventDto, req.user);
  }

  @Put(':id/config')
  @UseGuards(JwtAuthGuard)
  async updateConfig(
    @Param('id') id: string,
    @Body() updateOngoingConfigDto: UpdateOngoingConfigDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.updateConfig(id, updateOngoingConfigDto, req.user);
  }

  @Put(':id/teams')
  @UseGuards(JwtAuthGuard)
  async setTeams(
    @Param('id') id: string,
    @Body() setOngoingTeamsDto: SetOngoingTeamsDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.setTeams(id, setOngoingTeamsDto, req.user);
  }

  @Post(':id/schedule')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async generateSchedule(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.generateSchedule(id, req.user);
  }

  @Patch('games/:gameId')
  @UseGuards(JwtAuthGuard)
  async updateGameScore(
    @Param('gameId') gameId: string,
    @Body() updateOngoingGameScoreDto: UpdateOngoingGameScoreDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingGameResponseDto> {
    return this.ongoingService.updateGameScore(gameId, updateOngoingGameScoreDto, req.user);
  }

  @Delete('games/:gameId/result')
  @UseGuards(JwtAuthGuard)
  async clearGameResult(@Param('gameId') gameId: string, @Req() req: AuthedRequest): Promise<OngoingGameResponseDto> {
    return this.ongoingService.clearGameResult(gameId, req.user);
  }

  @Post(':id/teams')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async addTeam(
    @Param('id') id: string,
    @Body() addOngoingTeamDto: AddOngoingTeamDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.addTeam(id, addOngoingTeamDto, req.user);
  }

  @Delete('teams/:teamId')
  @UseGuards(JwtAuthGuard)
  async removeTeam(@Param('teamId') teamId: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.removeTeam(teamId, req.user);
  }

  @Get('open')
  async findOpen(): Promise<OngoingOpenEventDto[]> {
    return this.ongoingService.findOpen();
  }

  @Post(':id/playoff')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async generatePlayoff(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.generatePlayoff(id, req.user);
  }

  @Delete(':id/playoff')
  @UseGuards(JwtAuthGuard)
  async deletePlayoff(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.deletePlayoff(id, req.user);
  }

  @Patch(':id/finish')
  @UseGuards(JwtAuthGuard)
  async finishTournament(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.finishTournament(id, req.user);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req: AuthedRequest): Promise<void> {
    return this.ongoingService.remove(id, req.user);
  }
}
```

- [ ] **Step 2: Run the full suite and build**

```bash
npm run test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

---

### Task 6: Backend manual verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: confidence the whole authorization surface works end to end before frontend work begins.

- [ ] **Step 1: Start the server**

```bash
cd /Users/artem/Desktop/projects/volley-app-service
npm run start:dev
```

- [ ] **Step 2: Register two accounts and grant one admin manually**

```bash
curl -s -X POST http://localhost:3000/user -H 'Content-Type: application/json' \
  -d '{"email":"creator@example.com","name":"Creator","password":"password123","newPlayer":{"name":"Creator Player","gender":"male"}}'

curl -s -X POST http://localhost:3000/user -H 'Content-Type: application/json' \
  -d '{"email":"outsider@example.com","name":"Outsider","password":"password123","newPlayer":{"name":"Outsider Player","gender":"female"}}'
```

Expected: both `201`, each response includes `"role":"player"` and a non-null `playerId`. Note the two `playerId`s from the responses for later steps.

Promote `outsider@example.com` to admin directly in Postgres (adjust connection details to match `.env`'s active `DATABASE_URL`):

```bash
psql "postgresql://postgres:mysecretpassword@127.0.0.1:5432/postgres" -c \
  "UPDATE users SET role = 'admin' WHERE email = 'outsider@example.com';"
```

- [ ] **Step 3: Log in as the creator, create a tournament**

```bash
curl -s -c /tmp/creator.txt -X POST http://localhost:3000/auth/log-in \
  -H 'Content-Type: application/json' -d '{"email":"creator@example.com","password":"password123"}'

curl -s -b /tmp/creator.txt -X POST http://localhost:3000/ongoing \
  -H 'Content-Type: application/json' -d '{"name":"Auth Test Cup","date":"2030-01-01T10:00:00.000Z"}'
```

Expected: `201`, response includes `"createdByUserId"` equal to the creator's own user id (decode the JWT cookie or just trust it matches — the important check is the NEXT two steps). Note the returned tournament `id`.

- [ ] **Step 4: Confirm a plain logged-in user cannot manage it, but the creator and an admin can**

```bash
curl -s -c /tmp/outsider.txt -X POST http://localhost:3000/auth/log-in \
  -H 'Content-Type: application/json' -d '{"email":"outsider@example.com","password":"password123"}'

# Outsider (now admin, per Step 2) tries to update config — should succeed (admin bypass)
curl -s -b /tmp/outsider.txt -X PUT http://localhost:3000/ongoing/<id>/config \
  -H 'Content-Type: application/json' -d '{"gamesPerPair":1,"courts":2}'

# Creator tries the same — should also succeed
curl -s -b /tmp/creator.txt -X PUT http://localhost:3000/ongoing/<id>/config \
  -H 'Content-Type: application/json' -d '{"gamesPerPair":1,"courts":2}'
```

Expected: both `200`. Register a THIRD, non-admin account, log in as them, and confirm the same request returns `403` with `"Only the tournament creator or an admin can do this"`.

- [ ] **Step 5: Confirm team self-registration**

Using the creator's tournament `id` and the `playerId`s noted in Step 2:

```bash
# Outsider registers themselves + creator's player as a team — should succeed (outsider's own playerId is one of the two)
curl -s -b /tmp/outsider.txt -X POST http://localhost:3000/ongoing/<id>/teams \
  -H 'Content-Type: application/json' -d '{"player1Id":"<outsider playerId>","player2Id":"<creator playerId>"}'
```

Expected: `201`. Then, still logged in as outsider, try registering a team of two players NEITHER of which is outsider's own:

```bash
curl -s -b /tmp/outsider.txt -X POST http://localhost:3000/ongoing/<id>/teams \
  -H 'Content-Type: application/json' -d '{"player1Id":"<creator playerId>","player2Id":"<creator playerId>"}'
```

Expected: `400` with `"You must register yourself as one of the two players"` (this also happens to violate "two different players", but since self-inclusion is checked first, confirm the message is the self-inclusion one).

- [ ] **Step 6: Stop the server**

```bash
pkill -f "nest start --watch"
```

- [ ] **Step 7: Commit**

Nothing to stage (verification only) — just record in your report that all checks passed.

---

### Task 7: Frontend foundations — tooltip primitive, permission helper, types

**Files:**
- Create: `volleyball-management-ui/components/ui/tooltip.tsx`
- Create: `volleyball-management-ui/lib/ongoing-permissions.ts`
- Modify: `volleyball-management-ui/lib/types.ts`

**Interfaces:**
- Produces: `Tooltip`, `TooltipTrigger`, `TooltipContent` components; `canManageOngoingEvent(user: { id: string; role: string } | null, createdByUserId: string | null): boolean`; `AuthUser.role: string`; `OngoingEvent.createdByUserId` and `OngoingEventListItem.createdByUserId: string | null`. Every later frontend task (8-14) depends on these.

- [ ] **Step 1: Add the tooltip primitive**

Create `components/ui/tooltip.tsx`:

```tsx
'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
```

- [ ] **Step 2: Add the shared permission helper**

Create `lib/ongoing-permissions.ts`:

```ts
export function canManageOngoingEvent(
  user: { id: string; role: string } | null,
  createdByUserId: string | null,
): boolean {
  if (!user) return false
  return user.role === 'admin' || user.id === createdByUserId
}
```

- [ ] **Step 3: Update `lib/types.ts`**

Add `role: string;` to `AuthUser` (right after `name: string;`):

```ts
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  playerId: string | null;
}
```

Add `createdByUserId: string | null;` to `OngoingEventListItem` (right after `location: string | null;`) and to `OngoingEvent` (right after `updatedAt: string;`).

- [ ] **Step 4: Typecheck**

```bash
cd /Users/artem/Desktop/projects/volleyball-management-ui
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

---

### Task 8: Register page — mandatory existing-or-new player

**Files:**
- Modify: `app/register/page.tsx`

**Interfaces:**
- Consumes: `API.REGISTER` (unchanged URL, new body shape from Task 3).
- Produces: the `/register` page now always sends either `{ playerId }` or `{ newPlayer: { name, gender } }`.

- [ ] **Step 1: Replace the player-selection section**

Replace the whole file's schema and player-selection JSX. The `NO_PLAYER_VALUE` sentinel becomes `NEW_PLAYER_VALUE`, meaning "create a new player" instead of "no player":

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import Link from 'next/link'
import { Navigation } from '@/components/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/components/providers/auth-provider'
import API from '@/lib/api'
import type { Player } from '@/lib/types'

const NEW_PLAYER_VALUE = 'new'

const registerSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
    playerId: z.string().min(1, 'Choose a player or create a new one'),
    newPlayerName: z.string(),
    newPlayerGender: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.playerId !== NEW_PLAYER_VALUE || data.newPlayerName.trim().length > 0, {
    message: 'Player name is required',
    path: ['newPlayerName'],
  })
  .refine((data) => data.playerId !== NEW_PLAYER_VALUE || ['male', 'female'].includes(data.newPlayerGender), {
    message: 'Choose a gender',
    path: ['newPlayerGender'],
  })

type RegisterFormData = z.infer<typeof registerSchema>

export default function RegisterPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: ['players'],
    queryFn: () => fetch(API.GET_ALL_PLAYERS).then((res) => res.json()),
  })

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      playerId: '',
      newPlayerName: '',
      newPlayerGender: '',
    },
  })

  const playerId = watch('playerId')
  const isCreatingNewPlayer = playerId === NEW_PLAYER_VALUE

  const onSubmit = async (data: RegisterFormData) => {
    setFormError(null)
    const res = await fetch(API.REGISTER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        password: data.password,
        ...(data.playerId === NEW_PLAYER_VALUE
          ? { newPlayer: { name: data.newPlayerName.trim(), gender: data.newPlayerGender } }
          : { playerId: data.playerId }),
      }),
    })

    if (!res.ok) {
      if (res.status === 409) {
        const body = await res.json().catch(() => null)
        setFormError(body?.message ?? 'This email or player is already in use')
      } else {
        setFormError('Something went wrong')
      }
      return
    }

    try {
      await login(data.email, data.password)
      router.push('/')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong')
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Register</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Name
                </label>
                <Input id="name" {...register('name')} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input id="email" type="email" {...register('email')} />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Input id="password" type="password" {...register('password')} />
                {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium">
                  Confirm password
                </label>
                <Input id="confirmPassword" type="password" {...register('confirmPassword')} />
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Your player</label>
                <Controller
                  control={control}
                  name="playerId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a player" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NEW_PLAYER_VALUE}>＋ Create new player</SelectItem>
                        {players.map((player) => (
                          <SelectItem key={player.id} value={player.id}>
                            {player.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.playerId && <p className="text-sm text-destructive">{errors.playerId.message}</p>}
              </div>
              {isCreatingNewPlayer && (
                <div className="flex flex-col gap-4 rounded-md border border-input p-3">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="newPlayerName" className="text-sm font-medium">
                      Player name
                    </label>
                    <Input id="newPlayerName" {...register('newPlayerName')} />
                    {errors.newPlayerName && (
                      <p className="text-sm text-destructive">{errors.newPlayerName.message}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Gender</label>
                    <Controller
                      control={control}
                      name="newPlayerGender"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.newPlayerGender && (
                      <p className="text-sm text-destructive">{errors.newPlayerGender.message}</p>
                    )}
                  </div>
                </div>
              )}
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Registering...' : 'Register'}
              </Button>
              <p className="text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link href="/login" className="underline">
                  Log in
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Manually verify in the browser**

Open `/register`. Confirm: submitting with the player select untouched shows "Choose a player or create a new one"; picking "＋ Create new player" reveals name/gender fields and requires both; picking an existing player hides those fields and registers with `playerId` as before; a successful registration (either path) logs in and redirects to `/`.

- [ ] **Step 4: Commit**

---

### Task 9: Navigation — real role, retire the fake admin gate

**Files:**
- Modify: `components/navigation.tsx`
- Delete: `hooks/use-is-admin.ts`

**Interfaces:**
- Consumes: `useAuth().user.role` (Task 7's `AuthUser.role`).
- Produces: `navigation.tsx` no longer reads `NEXT_PUBLIC_ADMIN_PASSWORD`/`localStorage`. Tasks 10-14 each replace their own `useIsAdmin()` call site with `canManageOngoingEvent`/`user?.role === 'admin'` — this task only fixes `navigation.tsx` itself, since it's the one site using a bare `isAdmin` boolean unrelated to any single tournament.

- [ ] **Step 1: Replace the admin-detection logic**

In `components/navigation.tsx`, remove the `useState`/`useEffect` admin-detection block:

```tsx
  const [isAdmin, setIsAdmin] = useState(false)
```
```tsx
  useEffect(() => {
    const hasAccess = [process.env.NEXT_PUBLIC_ADMIN_PASSWORD, process.env.NEXT_PUBLIC_MODERATOR_PASSWORD]
      .includes(localStorage.getItem('ADMIN_PASSWORD') || '')
    setIsAdmin(hasAccess)
  }, [])
```

and replace both with nothing — `user` (already destructured from `useAuth()` a few lines below as `const { user, logout } = useAuth()`) now carries `role`. Move that `useAuth()` call up above the nav-items filter (it currently sits after the `hasTournamentToday` block); the filter needs `user` in scope:

```tsx
export function Navigation() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { t } = useTranslation()
  const router = useRouter()
  const { user, logout } = useAuth()

  // Non-admins only need this tab on a day a tournament is actually happening; admins always see
  // it (config/roster work happens well before or after the day itself). Shares its cache with the
  // /ongoing list page's identical query, so this costs nothing extra there.
  const { data: ongoingEvents = [] } = useQuery<OngoingEventListItem[]>({
    queryKey: ['ongoing-events'],
    queryFn: async () => {
      const response = await fetch(API.GET_ONGOING_EVENTS)
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      return response.json()
    },
  })
  const hasTournamentToday = ongoingEvents.some((event) => isEventToday(event.date))

  const handleLogout = async () => {
    await logout()
    router.push('/')
  }

  // Filter nav items based on admin status
  const navItems = allNavItems.filter((item) => {
    // Always show overview
    if (item.href === '/') return true
    // Show add-results only if admin
    if (item.href === '/add-results') return user?.role === 'admin'
    // Ongoing tournaments: admins always, everyone else only on the day one is happening
    if (item.href === '/ongoing') return user?.role === 'admin' || hasTournamentToday
    // Show other items (when uncommented)
    return true
  })
```

Remove the now-unused `useEffect` import if `useState`/`useEffect` was the only remaining use of `useEffect` (check the top-of-file import: `import { useState, useEffect } from 'react'` becomes `import { useState } from 'react'` — `useState` is still used for `mobileMenuOpen`).

- [ ] **Step 2: Delete the fake admin hook**

```bash
rm /Users/artem/Desktop/projects/volleyball-management-ui/hooks/use-is-admin.ts
```

(Its call sites in `app/ongoing/page.tsx`, `app/calendar/page.tsx`, `app/ongoing/[id]/page.tsx`, `components/ongoing/ongoing-matches-tab.tsx`, `components/ongoing/ongoing-bracket-tab.tsx` are replaced in Tasks 10-14 — until those tasks run, this repo will not build. That's expected mid-plan; do not treat it as this task's failure.)

- [ ] **Step 3: Commit**

Do not run `npx tsc --noEmit` yet — it will fail until Tasks 10-14 remove the other `useIsAdmin` call sites. Note this in your report so the reviewer doesn't treat it as a defect.

---

### Task 10: Create-tournament flow — always available, gated by login not role

**Files:**
- Modify: `app/ongoing/page.tsx`
- Modify: `app/calendar/page.tsx`
- Modify: `components/ongoing/create-tournament-form.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 7/9's pattern), `Tooltip`/`TooltipTrigger`/`TooltipContent` (Task 7).
- Produces: any logged-in user can create a tournament; a logged-out user sees a disabled button with an explanatory tooltip.

- [ ] **Step 1: `app/ongoing/page.tsx` — the "new tournament" entry point**

Replace the `useIsAdmin` import and usage. Change:
```tsx
import { useIsAdmin } from "@/hooks/use-is-admin";
```
to:
```tsx
import { useAuth } from "@/components/providers/auth-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

Change:
```tsx
  const isAdmin = useIsAdmin();
```
to:
```tsx
  const { user } = useAuth();
```

Replace the create-button block:
```tsx
        {isAdmin && (
          <div className="mt-6">
            <Link href="/calendar">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                <span suppressHydrationWarning>{t("ongoing.newTournament")}</span>
              </Button>
            </Link>
          </div>
        )}
```
with:
```tsx
        <div className="mt-6">
          {user ? (
            <Link href="/calendar">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                <span suppressHydrationWarning>{t("ongoing.newTournament")}</span>
              </Button>
            </Link>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-block">
                  <Button disabled>
                    <Plus className="mr-2 h-4 w-4" />
                    <span suppressHydrationWarning>{t("ongoing.newTournament")}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Щоб створити турнір, потрібно бути залогіненим</TooltipContent>
            </Tooltip>
          )}
        </div>
```

Change the per-event delete button's gate from `isAdmin` to per-event creator-or-admin. Add the import `import { canManageOngoingEvent } from "@/lib/ongoing-permissions";`, and change:
```tsx
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("ongoing.delete")}
                    onClick={() => {
                      if (window.confirm(t("ongoing.deleteConfirm"))) deleteMutation.mutate(event.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
```
to:
```tsx
                {canManageOngoingEvent(user, event.createdByUserId) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("ongoing.delete")}
                    onClick={() => {
                      if (window.confirm(t("ongoing.deleteConfirm"))) deleteMutation.mutate(event.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
```

Finally, add `credentials: "include"` to the delete mutation's fetch:
```tsx
      const response = await fetch(API.DELETE_ONGOING_EVENT(id), { method: "DELETE", credentials: "include" });
```

- [ ] **Step 2: `app/calendar/page.tsx` — always render the create form**

Replace the `useIsAdmin` import/usage:
```tsx
import { useIsAdmin } from "@/hooks/use-is-admin";
```
becomes (delete this line entirely — this page no longer needs any auth check itself; the form's own submit button is the gate, per Task 10 Step 3).

```tsx
  const isAdmin = useIsAdmin();
```
delete this line entirely.

Replace:
```tsx
        {isAdmin && (
          <div className="mt-6">
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                <span suppressHydrationWarning>{t("calendar.newTournament")}</span>
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle suppressHydrationWarning>{t("calendar.newTournamentTitle")}</DialogTitle>
                </DialogHeader>
                <CreateTournamentForm onCreated={() => setIsCreateOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        )}
```
with (the `{isAdmin && ( ... )}` wrapper is dropped; the inner content is unchanged):
```tsx
        <div className="mt-6">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              <span suppressHydrationWarning>{t("calendar.newTournament")}</span>
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle suppressHydrationWarning>{t("calendar.newTournamentTitle")}</DialogTitle>
              </DialogHeader>
              <CreateTournamentForm onCreated={() => setIsCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
```

- [ ] **Step 3: `create-tournament-form.tsx` — disabled submit + tooltip + credentials**

Add imports: `import { useAuth } from "@/components/providers/auth-provider";` and `import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";`.

Inside `export function CreateTournamentForm({ onCreated }: CreateTournamentFormProps) {`, add right after the existing `const queryClient = useQueryClient();` line:
```tsx
  const { user } = useAuth();
```

Add `credentials: "include"` to the create mutation's fetch:
```tsx
      const response = await fetch(API.CREATE_ONGOING_EVENT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
```

Replace the submit button:
```tsx
        <Button
          className="self-start"
          onClick={() => createMutation.mutate()}
          disabled={!name.trim() || hasIncompleteTeam || createMutation.isPending}
        >
          <span suppressHydrationWarning>{t("ongoing.create.submit")}</span>
        </Button>
```
with:
```tsx
        {user ? (
          <Button
            className="self-start"
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || hasIncompleteTeam || createMutation.isPending}
          >
            <span suppressHydrationWarning>{t("ongoing.create.submit")}</span>
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-block self-start">
                <Button disabled>
                  <span suppressHydrationWarning>{t("ongoing.create.submit")}</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Щоб створити турнір, потрібно бути залогіненим</TooltipContent>
          </Tooltip>
        )}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

---

### Task 11: Register-team flow — self-locked player, disabled + tooltip when logged out

**Files:**
- Modify: `components/ongoing/register-team-dialog.tsx`

**Interfaces:**
- Consumes: `useAuth()`.
- Produces: when logged in, "player1" is fixed to the current user's own player and read-only; only the partner is freely chosen. When logged out, the trigger button is disabled with a tooltip.

- [ ] **Step 1: Replace the component**

Add imports: `import { useAuth } from "@/components/providers/auth-provider";` and `import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";`.

Inside `export function RegisterTeamDialog({ event, players }: RegisterTeamDialogProps) {`, add right after `const { t } = useTranslation();`:
```tsx
  const { user } = useAuth();
```

Change the `registerMutation`'s fetch to send credentials and to always use the current user's own `playerId` as `player1Id`:
```tsx
  const registerMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API.ADD_ONGOING_TEAM(event.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ player1Id: user?.playerId, player2Id: player2Id }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ongoing-open"] });
      queryClient.invalidateQueries({ queryKey: ["ongoing-events"] });
      // Registering then clicking through to the detail page must not show a roster without the new team.
      queryClient.invalidateQueries({ queryKey: ["ongoing-event", event.id] });
      // Not a user-driven dismissal, so onOpenChange never fires — go through the same reset
      // path a manual close uses, or the inline create-player row survives into the next open.
      resetAndSetOpen(false);
    },
  });
```

Remove the `player1Id`/`setPlayer1Id` state entirely — it's no longer user-editable (`const [player1Id, setPlayer1Id] = useState("");` is deleted). Everywhere `player1Id` was read for the "self" slot now reads `user?.playerId ?? ""` instead. Specifically:

- `canRegister` becomes:
```tsx
  const canRegister = Boolean(user?.playerId) && Boolean(player2Id) && user?.playerId !== player2Id;
```
- `resetAndSetOpen` no longer resets `player1Id` (delete `setPlayer1Id("");` from inside it).
- The "player1" `renderNewPlayerRow`/`openNewPlayerRow` flow (creating a brand-new player inline for slot "player1") is removed — since player1 is always the logged-in user's own existing player, there is nothing to create for that slot. Change `type PlayerSlot = "player1" | "player2";` to `type PlayerSlot = "player2";`, and `openNewPlayerRow`/`clearNewPlayerRow`'s callers that could pass `"player1"` no longer exist once the JSX below is replaced.

Replace the two `renderPlayerField(...)` calls and the surrounding "no players left" check inside the dialog's body:
```tsx
        <div className="flex flex-col gap-4">
          {availablePlayers.length === 0 && (
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>
              {t("calendar.noPlayersLeft")}
            </p>
          )}

          {renderPlayerField("player1", t("calendar.player1"), player1Id, setPlayer1Id, player2Id)}

          {renderPlayerField("player2", t("calendar.player2"), player2Id, setPlayer2Id, player1Id)}

          {registerMutation.isError && (
            <p className="text-sm text-destructive">{(registerMutation.error as Error).message}</p>
          )}
        </div>
```
with:
```tsx
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground" suppressHydrationWarning>
              {t("calendar.player1")}
            </span>
            <p className="text-sm font-medium">
              {players.find((player) => player.id === user?.playerId)?.name ?? user?.name}
            </p>
          </label>

          {renderPlayerField("player2", t("calendar.player2"), player2Id, setPlayer2Id, user?.playerId ?? "")}

          {registerMutation.isError && (
            <p className="text-sm text-destructive">{(registerMutation.error as Error).message}</p>
          )}
        </div>
```

Finally, replace the dialog trigger so it's disabled with a tooltip when logged out:
```tsx
  return (
    <Dialog open={open} onOpenChange={resetAndSetOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <span suppressHydrationWarning>{t("calendar.register")}</span>
        </Button>
      </DialogTrigger>
```
becomes:
```tsx
  if (!user) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-block">
            <Button size="sm" disabled>
              <span suppressHydrationWarning>{t("calendar.register")}</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Щоб зареєструватися в турнір, потрібно бути залогіненим</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Dialog open={open} onOpenChange={resetAndSetOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <span suppressHydrationWarning>{t("calendar.register")}</span>
        </Button>
      </DialogTrigger>
```

(The early `if (!user) return (...)` is placed after all the hooks — `useState`, `useMutation`, `useQueryClient` calls stay unconditional above it, only the returned JSX branches. This is safe: no hook is called conditionally, only the render output is.)

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

---

### Task 12: Tournament-detail page — config tab and finish action gated by creator-or-admin

**Files:**
- Modify: `app/ongoing/[id]/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `canManageOngoingEvent` (Task 7).

- [ ] **Step 1: Replace the admin check**

Change the import:
```tsx
import { useIsAdmin } from "@/hooks/use-is-admin";
```
to:
```tsx
import { useAuth } from "@/components/providers/auth-provider";
import { canManageOngoingEvent } from "@/lib/ongoing-permissions";
```

Change:
```tsx
  const isAdmin = useIsAdmin();
```
to:
```tsx
  const { user } = useAuth();
```

Every remaining use of the bare `isAdmin` boolean in this file needs the event in scope, so each becomes a computed check against `event`. Change:
```tsx
  const hasPlayoffScheme = event?.config?.scheme === "groupsPlayoff";
  const visibleTabs = TABS.filter((item) => {
    if (item.key === "config") return isAdmin;
    if (item.key === "bracket") return hasPlayoffScheme;
    return true;
  });
```
to:
```tsx
  const canManage = event ? canManageOngoingEvent(user, event.createdByUserId) : false;
  const hasPlayoffScheme = event?.config?.scheme === "groupsPlayoff";
  const visibleTabs = TABS.filter((item) => {
    if (item.key === "config") return canManage;
    if (item.key === "bracket") return hasPlayoffScheme;
    return true;
  });
```

Change:
```tsx
            {isAdmin && finishGate && !event.finishedAt ? (
```
to:
```tsx
            {canManage && finishGate && !event.finishedAt ? (
```

Change:
```tsx
              {activeTab === "config" && isAdmin && <OngoingConfigTab event={event} />}
```
to:
```tsx
              {activeTab === "config" && canManage && <OngoingConfigTab event={event} />}
```

Add `credentials: "include"` to the finish mutation's fetch:
```tsx
      const response = await fetch(API.FINISH_ONGOING_TOURNAMENT(id), { method: "PATCH", credentials: "include" });
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

---

### Task 13: Config-tab plumbing — credentials on every mutation

**Files:**
- Modify: `components/ongoing/ongoing-config-tab.tsx`
- Modify: `components/ongoing/ongoing-roster-section.tsx`

**Interfaces:**
- No auth-gating changes in these two files — both are only ever rendered when Task 12's `canManage` already gated the whole tab. They only need `credentials: 'include'` so their requests actually authenticate.

- [ ] **Step 1: `ongoing-config-tab.tsx`**

Change the shared `putJson` helper:
```ts
async function putJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}
```

- [ ] **Step 2: `ongoing-roster-section.tsx`**

Change its own copy of the shared `putJson` helper the same way (add `credentials: "include",` to the `fetch` options object).

Add `credentials: "include"` to `removeTeamMutation`'s fetch:
```tsx
      const response = await fetch(API.REMOVE_ONGOING_TEAM(teamId), { method: "DELETE", credentials: "include" });
```

Add `credentials: "include"` to `generateMutation`'s fetch:
```tsx
      const response = await fetch(API.GENERATE_ONGOING_SCHEDULE(event.id), { method: "POST", credentials: "include" });
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

---

### Task 14: Matches and bracket tabs — creator-or-admin + credentials

**Files:**
- Modify: `components/ongoing/ongoing-matches-tab.tsx`
- Modify: `components/ongoing/ongoing-match-card.tsx`
- Modify: `components/ongoing/ongoing-bracket-tab.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `canManageOngoingEvent` (Task 7).

- [ ] **Step 1: `ongoing-matches-tab.tsx`**

Change the import:
```tsx
import { useIsAdmin } from "@/hooks/use-is-admin";
```
to:
```tsx
import { useAuth } from "@/components/providers/auth-provider";
import { canManageOngoingEvent } from "@/lib/ongoing-permissions";
```

Change:
```tsx
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
```
to:
```tsx
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = canManageOngoingEvent(user, event.createdByUserId);
```

Change the one remaining use, inside `renderGame`:
```tsx
    return <OngoingMatchCard key={game.id} game={game} team1={team1} team2={team2} canEdit={isAdmin} />;
```
to:
```tsx
    return <OngoingMatchCard key={game.id} game={game} team1={team1} team2={team2} canEdit={canManage} />;
```

- [ ] **Step 2: `ongoing-match-card.tsx` — credentials only (no auth-gating change; `canEdit` is already a prop)**

Add `credentials: "include"` to both fetches:
```tsx
      const response = await fetch(API.UPDATE_ONGOING_GAME(game.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ team1Points: Number(points1), team2Points: Number(points2) }),
      });
```
```tsx
      const response = await fetch(API.CLEAR_ONGOING_GAME_RESULT(game.id), { method: "DELETE", credentials: "include" });
```

- [ ] **Step 3: `ongoing-bracket-tab.tsx`**

Change the import:
```tsx
import { useIsAdmin } from "@/hooks/use-is-admin";
```
to:
```tsx
import { useAuth } from "@/components/providers/auth-provider";
import { canManageOngoingEvent } from "@/lib/ongoing-permissions";
```

Change:
```tsx
export function OngoingBracketTab({ event }: OngoingBracketTabProps) {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
```
to:
```tsx
export function OngoingBracketTab({ event }: OngoingBracketTabProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = canManageOngoingEvent(user, event.createdByUserId);
```

Replace each of the four remaining `isAdmin` uses with `canManage`:
```tsx
          {isAdmin && hasPlayoff ? (
```
→
```tsx
          {canManage && hasPlayoff ? (
```
```tsx
          {isAdmin && !hasPlayoff && isGroupStageComplete ? (
```
→
```tsx
          {canManage && !hasPlayoff && isGroupStageComplete ? (
```
```tsx
                            canEdit={isAdmin}
                            onEdit={() => setEditingGameId(game.id)}
```
(inside the round-column loop)
→
```tsx
                            canEdit={canManage}
                            onEdit={() => setEditingGameId(game.id)}
```
```tsx
                      canEdit={isAdmin}
                      onEdit={() => setEditingGameId(thirdPlaceGame.id)}
```
(the 3rd-place box)
→
```tsx
                      canEdit={canManage}
                      onEdit={() => setEditingGameId(thirdPlaceGame.id)}
```

Add `credentials: "include"` to the shared `requestJson` helper at the top of the file:
```ts
async function requestJson(url: string, method: string, fallbackMessage: string): Promise<unknown> {
  const response = await fetch(url, { method, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: fallbackMessage }));
    throw new Error(body.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}
```

Add `credentials: "include"` to `BracketResultDialog`'s `saveMutation` fetch:
```tsx
      const response = await fetch(API.UPDATE_ONGOING_GAME(game.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ team1Points: Number(points1), team2Points: Number(points2) }),
      });
```

(`clearMutation` inside `BracketResultDialog` already goes through `requestJson`, so it picks up credentials automatically.)

- [ ] **Step 4: Typecheck, lint, build**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all PASS — this is the task where the last `useIsAdmin` call site disappears, so the build should be clean for the first time since Task 9.

- [ ] **Step 5: Commit**

---

### Task 15: Full end-to-end manual verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-14.

- [ ] **Step 1: Start both servers**

Backend: `npm run start:dev` in `volley-app-service`. Frontend: the `volley-ui` dev server on :3001 (via the existing `.claude/launch.json` config, or `npm run dev -- -p 3001`).

- [ ] **Step 2: Register two accounts through the UI**

At `/register`: create "Creator" choosing "＋ Create new player" with a name and gender. Create a second account "Outsider" the same way. Promote "Outsider" to `admin` directly in Postgres (same `UPDATE users SET role = 'admin' WHERE email = '...'` as Task 6).

- [ ] **Step 3: Logged out — confirm disabled buttons and tooltips**

Log out. On `/ongoing`, hover the "new tournament" button — it's disabled and shows the Ukrainian "must be logged in" tooltip. On `/calendar`, open the create dialog (still reachable) and confirm its submit button is disabled with the same tooltip. On `/calendar`, hover a "Register" button on an open tournament — disabled with the registration-specific tooltip text.

- [ ] **Step 4: Logged in as Creator — create and manage**

Log in as Creator. Create a tournament from `/calendar`. Confirm the config tab, finish action, and delete button (on `/ongoing`) are all visible for this tournament.

- [ ] **Step 5: Logged in as a third, non-admin, non-creator user — confirm blocked**

Register a third account. Visit the Creator's tournament detail page — confirm the config tab and finish action are NOT visible, and (via the Network tab or a direct API call) confirm `PUT /ongoing/:id/config` returns `403`.

- [ ] **Step 6: Logged in as Outsider (admin) — confirm bypass**

Log in as Outsider. Visit the Creator's tournament — confirm the config tab, finish action, and delete button ARE visible despite not being the creator.

- [ ] **Step 7: Team self-registration**

As the third non-admin user, open the register-team dialog on the Creator's tournament — confirm "player1" shows that user's own name/player, read-only, and only the partner is selectable. Register a team; confirm it appears in the roster with that user's player as one of the two.

- [ ] **Step 8: Stop both servers**

- [ ] **Step 9: Commit**

Nothing to stage (verification only).

# User auth (volley-app-service + volleyball-management-ui)

## Problem

`volley-app-service` has no authentication layer today — every endpoint is unauthenticated (see
`CLAUDE.md`). We want a `users` table backed by real accounts (email + password), optionally linked
to an existing `Player`, plus a login/register flow in `volleyball-management-ui`. This is
infrastructure only: no existing endpoint (players/events/games/...) is guarded as part of this work.

## Non-goals

- Guarding any existing controller/route with the new auth guard.
- Password reset / email verification / social login.
- Role-based authorization (admin vs regular user) — only "logged in or not" exists after this.
- A new frontend test runner. `volleyball-management-ui` has none today (explicit project decision,
  per its `CLAUDE.md`); introducing one is a separate decision, not bundled into this change.
- Fixing the cookie's cross-site limitation in production (see "Known limitation" below).

## Data model

New Prisma model in `volley-app-service/prisma/schema.prisma`:

```prisma
model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String
  password  String
  playerId  String?   @unique @map("player_id")
  lastVisit DateTime? @map("last_visit")
  createdAt DateTime  @default(now()) @map("created_at")

  player Player? @relation(fields: [playerId], references: [id], onDelete: SetNull)

  @@map("users")
}
```

`Player` gets the corresponding back-reference field `user User?`.

- The link is **1:1 and optional**: `playerId` is a nullable, unique FK. Postgres treats multiple
  `NULL`s as distinct under a unique index, so any number of accounts can exist with no player
  attached.
- `onDelete: SetNull` — deleting a `Player` nulls out the linked user's `playerId` rather than
  deleting the account or blocking the player deletion.
- `password` stores a bcrypt hash, never plaintext.

**Migration caveat:** per `CLAUDE.md`, `volley-app-service` has no test database and `.env`'s
`DATABASE_URL` may point at a shared/remote Postgres instance rather than local. Before running
`prisma migrate dev`, confirm which database is active — do not apply an untested migration to a
shared database without checking first.

## Backend architecture

Three new modules, adapted from `/Users/artem/Desktop/projects/fm/fm-api/src` (`auth`, `auth-guards`,
`user`) — same shape and JWT/cookie logic, rewritten from TypeORM to this project's Prisma
conventions (`PrismaService`, `@Injectable()` classes, explicit return types, `class-validator` DTOs
under each module's `dto/`).

### `user/`

- `UserService` (`PrismaService`-backed):
  - `createUser(dto: CreateUserDto): Promise<User>` — hashes the password with bcrypt
    (`SALT_ROUNDS = 10`, matching fm-api). Throws `ConflictException` if the email is already taken.
    If `dto.playerId` is provided: throws `NotFoundException` if no such player exists, and
    `ConflictException` if that player is already linked to another user.
  - `findByEmail(email: string): Promise<User | null>`
  - `findById(id: string): Promise<User | null>`
  - `updateLastVisit(id: string): Promise<void>`
  - `getCurrentUser(id: string): Promise<Omit<User, 'password'>>` — 404 if missing; strips the
    password field before returning (via a Prisma `select`, not a runtime destructure, since we
    control the query).
- `UserController`:
  - `POST /user` — public, registration. Returns `{ id, email, name, playerId }` (no password).
  - `GET /user/me` — guarded (`JwtAuthGuard`), returns the current user.
- `CreateUserDto`: `email` (`@IsEmail`), `name` (`@IsString @IsNotEmpty`), `password`
  (`@IsString @MinLength(8)`), `playerId` (`@IsOptional @IsUUID`).

`removeUser` (`DELETE /user/me` in fm-api) is **not** ported — nothing in this task's scope calls it,
and there's no FE flow for account deletion. Add it later if a real use case shows up.

### `auth/`

- `AuthService`: `logIn`, `refreshJWT`, `logOut` — logic copied from fm-api's `AuthService` verbatim
  (bcrypt compare, `jwtService.signAsync` with a `jti`, blocklist revocation on refresh/logout),
  calling the Prisma-backed `UserService` instead of a TypeORM repository.
- `AuthController`:
  - `POST /auth/log-in` — body `LogInDto` (`email`, `password`), sets the access-token cookie,
    returns `{ success: true }`.
  - `POST /auth/refresh-jwt` — guarded, rotates the token, resets the cookie.
  - `POST /auth/log-out` — clears the cookie; revokes the token's `jti` if one was present and still
    valid (idempotent, matching fm-api).
- `LogInDto`: `email` (`@IsEmail`), `password` (`@IsString @IsNotEmpty`).

### `auth-guards/`

Copied near-verbatim from fm-api:

- `JwtAuthGuard` — reads the access-token cookie, verifies the JWT, checks the blocklist, and
  transparently rotates the cookie when the token is within
  `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` of expiring (sliding session).
- `TokenBlocklistService` — in-memory `Map<jti, revokedAt>` with a daily cleanup interval.
- `JwtPayload` interface (`sub`, `email`, `jti`, `iat`, `exp`).
- Barrel `index.ts` re-exporting all of the above plus `AuthedRequest`.

JWT/cookie constants (`ACCESS_TOKEN_COOKIE`, TTLs, `accessTokenCookieOptions`, `handleJwtOptions`)
live in a new `auth-guards/jwt.config.ts`, not the existing `src/utils/types.ts` — that file is
already documented as dead/unrelated leftovers in `CLAUDE.md`, and the project's convention is types
live beside the module that uses them.

### Wiring

- `AppModule` imports: `ConfigModule.forRoot({ isGlobal: true })` (new — not used anywhere in this
  project yet), `UserModule`, `AuthModule` (which imports `UserModule` + `AuthGuardsModule`).
- `main.ts` adds `app.use(cookieParser())`. CORS already has `credentials: true` and an explicit
  origin allow-list — no change needed there.
- New dependencies: `@nestjs/jwt`, `@nestjs/config`, `bcrypt`, `cookie-parser` (+ `@types/bcrypt`,
  `@types/cookie-parser` as dev deps).
- `.env` gains `JWT_SECRET` (dev default `dev-secret-change-me`, matching fm-api's fallback pattern).

### Scope guard

No existing controller (`players`, `events`, `games`, `event-members`, `rankings`, `ongoing`) is
touched — `JwtAuthGuard` is applied only to the two new routes that need it (`GET /user/me`,
`POST /auth/refresh-jwt`).

### Known limitation (documented, not fixed here)

The cookie is `httpOnly`, `sameSite: 'strict'`, `secure: isProduction` — copied as-is from fm-api.
Locally, `localhost:3001` (FE) and `localhost:3000` (BE) are same-site (same host, different port),
so this works. In production, the FE is served from a domain and the API from a bare HTTP IP
(`64.227.120.106`) — that's cross-site, and a `secure` cookie can't even be set over plain HTTP. Login
in production will not work correctly until the API has a real domain and HTTPS. This is called out
as a follow-up, not addressed in this change.

## Frontend architecture (`volleyball-management-ui`)

- `lib/api.ts`: add `REGISTER`, `LOG_IN`, `LOG_OUT`, `GET_CURRENT_USER` URL entries, following the
  existing `${NEXT_PUBLIC_HOST_URL}/...` pattern.
- `lib/types.ts`: add `AuthUser = { id: string; email: string; name: string; playerId: string | null }`.
- `components/providers/auth-provider.tsx` (new): `AuthContext` + `useAuth()` hook.
  - `useQuery(['me'], ...)` against `GET_CURRENT_USER` with `credentials: 'include'`. A `401`
    response resolves to `null` (logged out is not an error state); any other non-OK status throws.
  - `login(email, password)` — `useMutation` posting to `LOG_IN` with `credentials: 'include'`, then
    invalidates `['me']`.
  - `logout()` — `useMutation` posting to `LOG_OUT`, then invalidates `['me']`.
  - Mounted inside `QueryProvider` in `app/layout.tsx` (needs the query client).
- `app/login/page.tsx` (new): `'use client'`, react-hook-form + zod (`email`, `password`). On submit,
  calls `useAuth().login`; on `401` shows an inline error ("Invalid email or password"); on success
  redirects to `/` via `useRouter().push('/')`. If already authenticated, redirects to `/` on mount.
- `app/register/page.tsx` (new): same form patterns, fields `name`, `email`, `password`,
  `confirmPassword` (zod `refine` for match), and a `Select` (from `components/ui/select.tsx`)
  populated from `useQuery(['players'], ...)` against `API.GET_ALL_PLAYERS`, with a "None" option
  mapping to `undefined`. Submits to `REGISTER`, then logs in automatically and redirects to `/`. A
  `409` on email shows "Email already in use"; a `409` on player shows "This player is already linked
  to another account".
- `components/navigation.tsx`: when `useAuth().user` is set, show the user's name and a "Logout"
  button; otherwise a "Login" link. No other page or route is gated — per scope, this is visibility
  only, not access control (consistent with the existing "Auth is cosmetic" note in `CLAUDE.md`, which
  should be updated once real protected routes exist).

No new shadcn primitives are needed — `input`, `button`, `card`, and `select` are already vendored.

## Testing

### Backend (TDD, red→green)

`volley-app-service` has no test database (per `CLAUDE.md`); all new unit tests mock `PrismaService`,
following the existing pattern in `src/events/events.service.spec.ts`.

- `user/user.service.spec.ts`: `createUser` (hashes + persists; 409 on duplicate email; 404 when
  `playerId` doesn't exist; 409 when `playerId` is already linked), `findByEmail`, `findById`,
  `updateLastVisit`, `getCurrentUser` (strips password; 404 when missing).
- `auth/auth.service.spec.ts`: `logIn` (success issues a token and bumps `lastVisit`; 401 on unknown
  email; 401 on wrong password), `refreshJWT` (success; 401 when the user no longer exists; revokes
  the old `jti`), `logOut` (revokes the `jti`).
- `auth-guards/jwt-auth.guard.spec.ts`: 401 with no cookie; 401 on an invalid/expired token; 401 on a
  revoked `jti`; attaches `request.user` and returns `true` on a valid token; rotates the cookie when
  the token is within the refresh threshold, leaves it alone otherwise.
- `auth-guards/token-blocklist.service.spec.ts`: `revoke` + `isRevoked` round-trip; an unrevoked `jti`
  reports `false`.

`npm run build` (typecheck) and `npm run test` both need to pass.

### Frontend

No test runner exists and none is introduced here. Verification is `npx tsc --noEmit`, `npm run
lint`, `npm run build`, and manually exercising register → login → see name in nav → logout in the
browser preview, including the error paths (wrong password, duplicate email, duplicate player).

## Rollout

1. Prisma schema change + migration (against the confirmed-correct database).
2. Backend modules, TDD per the test list above.
3. Frontend: API entries, `AuthProvider`, `/login`, `/register`, nav update.
4. Manual end-to-end verification in the browser preview.

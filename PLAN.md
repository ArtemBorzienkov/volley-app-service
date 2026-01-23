---
name: Beach Volleyball Backend Service
overview: Build a NestJS backend service for managing beach volleyball tournaments, games, players, and rankings with simplified player management and core statistics.
todos:
  - id: schema-design
    content: Design and implement Prisma schema for Player, Game, and Event models with proper relations and indexes
    status: pending
  - id: players-module
    content: Create Players module with POST (create) and GET endpoints (list, by id), DTOs, and service logic
    status: pending
  - id: events-module
    content: Create Events module with CRUD endpoints, DTOs, and service logic
    status: pending
  - id: games-module
    content: Create Games module with CRUD endpoints, team validation, and auto-statistics updates
    status: pending
  - id: player-statistics
    content: Implement Player Statistics Service for calculating win rates and sets (without updatePlayerStats and getPlayerPointsDifference)
    status: pending
  - id: rankings-service
    content: Create Rankings Service and Controller with multiple ranking criteria (wins, win rate, sets, tournaments, etc.)
    status: pending
  - id: dto-validation
    content: Create DTOs with class-validator decorators and implement global validation pipe
    status: pending
  - id: error-handling
    content: Set up exception filters, custom exceptions, and response interceptors
    status: pending
  - id: module-integration
    content: Integrate all modules in AppModule and configure main.ts with validation, CORS, and interceptors
    status: pending
  - id: testing
    content: Write unit tests for services and integration tests for API endpoints
    status: pending
isProject: false
---

# Backend Service Implementation Plan

## Phase 1: Database Schema Design

### 1.1 Prisma Schema Updates

- **Update `prisma/schema.prisma`** with new models:
  - **Player model**: id, tg_id, name, avatar (optional), gender (optional), active, totalGames, totalWins, totalLosses, createdAt, updatedAt
  - **Game model**: id, eventId, team1Player1Id, team1Player2Id, team2Player1Id, team2Player2Id, team1Sets, team2Sets, team1Points, team2Points, date, location, createdAt, updatedAt
  - **Event model**: id, name, startDate, endDate, location, createdAt, updatedAt
  - **Relations**: Event → Games (one-to-many), Player → Games (many-to-many through team memberships)
- **Migration strategy**: Create new schema, remove old models (User, Training, etc.) or keep separate if needed
- **Indexes**: Add indexes on frequently queried fields (player tg_id, game date, event dates)

### 1.2 Database Migrations

- Generate Prisma migration: `npx prisma migrate dev --name init_beach_volleyball`
- Update Prisma client: `npx prisma generate`

## Phase 2: Core Entity Modules

### 2.1 Players Module (`src/players/`)

- **Module structure**:
  - `players.module.ts` - NestJS module
  - `players.controller.ts` - REST endpoints
  - `players.service.ts` - Business logic
  - `dto/` folder:
    - `create-player.dto.ts` - Validation for creating players
    - `player-response.dto.ts` - Response DTOs
  - `entities/player.entity.ts` - Type definitions
- **Endpoints**:
  - `GET /players` - List all players (with pagination, filters)
  - `GET /players/:id` - Get player by ID
  - `POST /players` - Create new player
- **Service methods**: Create player, get all players, get player by ID

### 2.2 Events Module (`src/events/`)

- **Module structure**: Similar to players module
- **Endpoints**:
  - `GET /events` - List all events (with date range filters)
  - `GET /events/:id` - Get event with games
  - `POST /events` - Create new event
  - `PATCH /events/:id` - Update event
  - `DELETE /events/:id` - Delete event
- **Service methods**: CRUD, event validation (startDate < endDate)

### 2.3 Games Module (`src/games/`)

- **Module structure**: Similar to players module
- **Endpoints**:
  - `GET /games` - List games (with filters: eventId, playerId, date range)
  - `GET /games/:id` - Get game details
  - `POST /games` - Create new game (validate teams, players exist)
  - `PATCH /games/:id` - Update game score/results
  - `DELETE /games/:id` - Delete game
- **Service methods**:
  - CRUD operations
  - Team validation (ensure 2 players per team, no duplicate players)
  - Score validation
  - Auto-update player statistics on game create/update/delete

## Phase 3: Statistics & Analytics Services

### 3.1 Player Statistics Service (`src/statistics/player-statistics.service.ts`)

- **Methods**:
  - `getPlayerStats(playerId: string, dateRange?: { start: Date, end: Date })` - Calculate all player stats
  - `getPlayerWinRate(playerId: string)` - Calculate win rate percentage
  - `getPlayerSetsWon(playerId: string)` - Total sets won

### 3.2 Rankings Service (`src/rankings/rankings.service.ts`)

- **Methods**:
  - `getTopPlayersByWins(limit: number, filters?: RankingFilters)` - Top players by total wins
  - `getTopPlayersByWinRate(limit: number, filters?: RankingFilters)` - Top players by win rate %
  - `getTopPlayersBySetsWon(limit: number, filters?: RankingFilters)` - Top players by sets won
  - `getTopPlayersByTournamentsWon(limit: number, filters?: RankingFilters)` - Tournament winners
  - `getTopPlayersByLowestLosses(limit: number, filters?: RankingFilters)` - Fewest losses
  - `getTopPlayersByPointsDifference(limit: number, filters?: RankingFilters)` - Highest points difference
- **Rankings Controller** (`src/rankings/rankings.controller.ts`):
  - `GET /rankings/wins` - Top by wins
  - `GET /rankings/win-rate` - Top by win rate
  - `GET /rankings/sets` - Top by sets won
  - `GET /rankings/tournaments` - Top by tournaments won
  - `GET /rankings/lowest-losses` - Top by lowest losses
  - `GET /rankings/points-difference` - Top by points difference
  - All endpoints support query params: `limit`, `startDate`, `endDate`, `eventId`

## Phase 4: DTOs & Validation

### 4.1 Common DTOs (`src/common/dto/`)

- `pagination.dto.ts` - Pagination query params (page, limit)
- `date-range.dto.ts` - Date range filters (startDate, endDate)
- `ranking-filters.dto.ts` - Combined filters for rankings

### 4.2 Validation Pipes

- Use `class-validator` and `class-transformer` packages
- Add global validation pipe in `main.ts`
- Create custom validators for:
  - Team validation (exactly 2 players, no duplicates)
  - Score validation (positive integers)
  - Date range validation

## Phase 5: Error Handling & Response Formatting

### 5.1 Exception Filters (`src/common/filters/`)

- `http-exception.filter.ts` - Global exception filter
- Custom exceptions:
  - `PlayerNotFoundException`
  - `GameNotFoundException`
  - `EventNotFoundException`
  - `InvalidTeamException`
  - `InvalidScoreException`

### 5.2 Response Interceptors (`src/common/interceptors/`)

- `transform.interceptor.ts` - Standardize API responses
- Format: `{ success: boolean, data: any, message?: string }`

## Phase 6: Module Integration

### 6.1 Update App Module (`src/app.module.ts`)

- Import all modules: PlayersModule, EventsModule, GamesModule, RankingsModule
- Import PrismaModule (already global)
- Configure CORS if needed

### 6.2 Main Application Setup (`src/main.ts`)

- Add global validation pipe
- Add global exception filter
- Add response interceptor
- Configure CORS for frontend
- Add Swagger/OpenAPI documentation (optional but recommended)

## Phase 7: Data Integrity & Triggers

### 7.1 Statistics Auto-Update

- **On Game Create**: Update all 4 players' statistics (totalGames, wins/losses)
- **On Game Update**: Recalculate affected players' statistics
- **On Game Delete**: Revert statistics changes
- **On Event Update**: Recalculate tournament-related stats if dates change

### 7.2 Database Constraints

- Ensure player cannot be on both teams in same game
- Ensure event dates are valid (startDate < endDate)
- Ensure game date is within event date range

## Phase 8: Testing & Documentation

### 8.1 Unit Tests

- Test all service methods
- Test DTO validation
- Test statistics calculations

### 8.2 Integration Tests

- Test API endpoints
- Test database operations
- Test statistics accuracy

### 8.3 API Documentation

- Add Swagger/OpenAPI decorators
- Document all endpoints, DTOs, responses
- Include example requests/responses

## Phase 9: Performance Optimization

### 9.1 Database Optimization

- Add database indexes on foreign keys and frequently queried fields
- Consider materialized views for complex analytics queries
- Implement query optimization for statistics calculations

### 9.2 Caching Strategy (Future)

- Cache rankings (TTL: 5-15 minutes)
- Cache player statistics
- Cache tournament leaderboards

## Phase 10: Additional Features

### 10.1 Search & Filtering

- Full-text search for players by name
- Advanced filtering for games (by players, date, location, event)
- Filter active/inactive players

### 10.2 Data Export

- Export player statistics to CSV/JSON
- Export tournament results
- Export rankings tables

## File Structure Overview

```
src/
├── app.module.ts
├── main.ts
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── players/
│   ├── players.module.ts
│   ├── players.controller.ts
│   ├── players.service.ts
│   ├── dto/
│   │   ├── create-player.dto.ts
│   │   └── player-response.dto.ts
│   └── entities/
│       └── player.entity.ts
├── events/
│   ├── events.module.ts
│   ├── events.controller.ts
│   ├── events.service.ts
│   └── dto/
├── games/
│   ├── games.module.ts
│   ├── games.controller.ts
│   ├── games.service.ts
│   └── dto/
├── rankings/
│   ├── rankings.module.ts
│   ├── rankings.controller.ts
│   └── rankings.service.ts
├── statistics/
│   └── player-statistics.service.ts
└── common/
    ├── dto/
    ├── filters/
    ├── interceptors/
    └── exceptions/
```

## Key Implementation Notes

1. **Statistics Calculation**: Consider using database views or computed columns for frequently accessed statistics to improve performance
2. **Transaction Management**: Use Prisma transactions for game creation/updates to ensure data consistency when updating player statistics
3. **Validation**: Validate team composition (2 unique players per team) and prevent players from being on both teams
4. **Date Handling**: Use proper Date types in Prisma schema, handle timezone considerations
5. **Soft Deletes**: Consider soft deletes for players (active flag) to preserve historical data
6. **API Versioning**: Consider adding `/api/v1` prefix for future API versioning

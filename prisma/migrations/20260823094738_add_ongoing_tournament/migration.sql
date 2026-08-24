-- CreateTable
CREATE TABLE "ongoing_events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ongoing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ongoing_event_config" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "games_per_pair" INTEGER NOT NULL DEFAULT 1,
    "courts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ongoing_event_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ongoing_teams" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "player1_id" TEXT NOT NULL,
    "player2_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ongoing_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ongoing_games" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "team1_id" TEXT NOT NULL,
    "team2_id" TEXT NOT NULL,
    "team1_points" INTEGER,
    "team2_points" INTEGER,
    "round" INTEGER NOT NULL,
    "court" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ongoing_games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ongoing_events_date_idx" ON "ongoing_events"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ongoing_event_config_event_id_key" ON "ongoing_event_config"("event_id");

-- CreateIndex
CREATE INDEX "ongoing_teams_event_id_idx" ON "ongoing_teams"("event_id");

-- CreateIndex
CREATE INDEX "ongoing_games_event_id_idx" ON "ongoing_games"("event_id");

-- AddForeignKey
ALTER TABLE "ongoing_event_config" ADD CONSTRAINT "ongoing_event_config_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ongoing_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_teams" ADD CONSTRAINT "ongoing_teams_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ongoing_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_teams" ADD CONSTRAINT "ongoing_teams_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_teams" ADD CONSTRAINT "ongoing_teams_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_games" ADD CONSTRAINT "ongoing_games_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ongoing_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_games" ADD CONSTRAINT "ongoing_games_team1_id_fkey" FOREIGN KEY ("team1_id") REFERENCES "ongoing_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_games" ADD CONSTRAINT "ongoing_games_team2_id_fkey" FOREIGN KEY ("team2_id") REFERENCES "ongoing_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "tg_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "gender" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "total_games" INTEGER NOT NULL DEFAULT 0,
    "total_wins" INTEGER NOT NULL DEFAULT 0,
    "total_losses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "team1_player1_id" TEXT NOT NULL,
    "team1_player2_id" TEXT NOT NULL,
    "team2_player1_id" TEXT NOT NULL,
    "team2_player2_id" TEXT NOT NULL,
    "team1_sets" INTEGER NOT NULL DEFAULT 0,
    "team2_sets" INTEGER NOT NULL DEFAULT 0,
    "team1_points" INTEGER NOT NULL DEFAULT 0,
    "team2_points" INTEGER NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "players_tg_id_key" ON "players"("tg_id");

-- CreateIndex
CREATE INDEX "players_tg_id_idx" ON "players"("tg_id");

-- CreateIndex
CREATE INDEX "events_start_date_idx" ON "events"("start_date");

-- CreateIndex
CREATE INDEX "events_end_date_idx" ON "events"("end_date");

-- CreateIndex
CREATE INDEX "games_event_id_idx" ON "games"("event_id");

-- CreateIndex
CREATE INDEX "games_date_idx" ON "games"("date");

-- CreateIndex
CREATE INDEX "games_team1_player1_id_idx" ON "games"("team1_player1_id");

-- CreateIndex
CREATE INDEX "games_team1_player2_id_idx" ON "games"("team1_player2_id");

-- CreateIndex
CREATE INDEX "games_team2_player1_id_idx" ON "games"("team2_player1_id");

-- CreateIndex
CREATE INDEX "games_team2_player2_id_idx" ON "games"("team2_player2_id");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_team1_player1_id_fkey" FOREIGN KEY ("team1_player1_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_team1_player2_id_fkey" FOREIGN KEY ("team1_player2_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_team2_player1_id_fkey" FOREIGN KEY ("team2_player1_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_team2_player2_id_fkey" FOREIGN KEY ("team2_player2_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

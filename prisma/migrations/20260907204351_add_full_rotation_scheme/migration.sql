-- AlterTable
ALTER TABLE "ongoing_event_config" ADD COLUMN     "rotation_rounds" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "ongoing_games" ADD COLUMN     "group_index" INTEGER;

-- CreateTable
CREATE TABLE "ongoing_game_players" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "side" INTEGER NOT NULL,

    CONSTRAINT "ongoing_game_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ongoing_rotation_slots" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "group_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ongoing_rotation_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ongoing_game_players_game_id_idx" ON "ongoing_game_players"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "ongoing_game_players_game_id_player_id_key" ON "ongoing_game_players"("game_id", "player_id");

-- CreateIndex
CREATE INDEX "ongoing_rotation_slots_event_id_round_idx" ON "ongoing_rotation_slots"("event_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ongoing_rotation_slots_event_id_round_player_id_key" ON "ongoing_rotation_slots"("event_id", "round", "player_id");

-- AddForeignKey
ALTER TABLE "ongoing_game_players" ADD CONSTRAINT "ongoing_game_players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "ongoing_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_game_players" ADD CONSTRAINT "ongoing_game_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_rotation_slots" ADD CONSTRAINT "ongoing_rotation_slots_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ongoing_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_rotation_slots" ADD CONSTRAINT "ongoing_rotation_slots_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

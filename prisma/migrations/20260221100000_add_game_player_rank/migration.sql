-- CreateTable
CREATE TABLE "game_player_rank" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "rank_change" INTEGER NOT NULL,

    CONSTRAINT "game_player_rank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_player_rank_game_id_idx" ON "game_player_rank"("game_id");

-- CreateIndex
CREATE INDEX "game_player_rank_player_id_idx" ON "game_player_rank"("player_id");

-- AddForeignKey
ALTER TABLE "game_player_rank" ADD CONSTRAINT "game_player_rank_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_player_rank" ADD CONSTRAINT "game_player_rank_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

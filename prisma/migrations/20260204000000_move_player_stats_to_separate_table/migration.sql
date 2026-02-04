-- CreateTable
CREATE TABLE "player_stats" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "total_games" INTEGER NOT NULL DEFAULT 0,
    "total_wins" INTEGER NOT NULL DEFAULT 0,
    "total_losses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_stats_pkey" PRIMARY KEY ("id")
);

-- Migrate existing data from players table to player_stats table
INSERT INTO "player_stats" ("id", "player_id", "total_games", "total_wins", "total_losses", "created_at", "updated_at")
SELECT 
    gen_random_uuid()::text,
    "id",
    COALESCE("total_games", 0),
    COALESCE("total_wins", 0),
    COALESCE("total_losses", 0),
    "created_at",
    COALESCE("updated_at", CURRENT_TIMESTAMP)
FROM "players";

-- CreateIndex
CREATE UNIQUE INDEX "player_stats_player_id_key" ON "player_stats"("player_id");

-- AddForeignKey
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "players" DROP COLUMN "total_games",
DROP COLUMN "total_wins",
DROP COLUMN "total_losses",
DROP COLUMN "updated_at";

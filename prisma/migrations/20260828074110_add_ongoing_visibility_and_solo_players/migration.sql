-- AlterTable
ALTER TABLE "ongoing_event_config" ADD COLUMN     "allow_solo_registration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE "ongoing_solo_players" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ongoing_solo_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ongoing_solo_players_event_id_idx" ON "ongoing_solo_players"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ongoing_solo_players_event_id_player_id_key" ON "ongoing_solo_players"("event_id", "player_id");

-- AddForeignKey
ALTER TABLE "ongoing_solo_players" ADD CONSTRAINT "ongoing_solo_players_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ongoing_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongoing_solo_players" ADD CONSTRAINT "ongoing_solo_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

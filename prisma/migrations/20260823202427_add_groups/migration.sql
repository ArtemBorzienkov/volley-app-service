-- AlterTable
ALTER TABLE "ongoing_event_config" ADD COLUMN     "group_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "qualifiers_per_group" INTEGER,
ADD COLUMN     "scheme" TEXT NOT NULL DEFAULT 'roundRobin';

-- AlterTable
ALTER TABLE "ongoing_teams" ADD COLUMN     "group_index" INTEGER;

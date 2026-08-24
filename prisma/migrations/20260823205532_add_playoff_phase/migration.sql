-- AlterTable
ALTER TABLE "ongoing_games" ADD COLUMN     "bracket_round" INTEGER,
ADD COLUMN     "bracket_slot" INTEGER,
ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'group',
ALTER COLUMN "team1_id" DROP NOT NULL,
ALTER COLUMN "team2_id" DROP NOT NULL;

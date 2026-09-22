-- AlterTable
ALTER TABLE "ongoing_event_config" ADD COLUMN     "hidden_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "solo_only_registration" BOOLEAN NOT NULL DEFAULT false;

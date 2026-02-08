-- AlterTable
-- Add rank column (if not already added by previous migration)
ALTER TABLE "player_stats" ADD COLUMN IF NOT EXISTS "rank" INTEGER NOT NULL DEFAULT 1000;

-- Drop updated_at column if it exists
ALTER TABLE "player_stats" DROP COLUMN IF EXISTS "updated_at";

-- AlterTable
ALTER TABLE "ongoing_events" ADD COLUMN     "created_by_user_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'player';

-- AddForeignKey
ALTER TABLE "ongoing_events" ADD CONSTRAINT "ongoing_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

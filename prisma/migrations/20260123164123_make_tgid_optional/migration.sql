/*
  Warnings:

  - You are about to drop the column `end_date` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `start_date` on the `events` table. All the data in the column will be lost.
  - Added the required column `created_by` to the `events` table without a default value. This is not possible if the table is not empty.
  - Added the required column `date` to the `events` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "events_end_date_idx";

-- DropIndex
DROP INDEX "events_start_date_idx";

-- AlterTable
ALTER TABLE "events" DROP COLUMN "end_date",
DROP COLUMN "start_date",
ADD COLUMN     "created_by" TEXT NOT NULL,
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "events_date_idx" ON "events"("date");

-- CreateIndex
CREATE INDEX "events_created_by_idx" ON "events"("created_by");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

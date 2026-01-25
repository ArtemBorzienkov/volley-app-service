/*
  Warnings:

  - You are about to drop the column `team1_sets` on the `games` table. All the data in the column will be lost.
  - You are about to drop the column `team2_sets` on the `games` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "games" DROP COLUMN "team1_sets",
DROP COLUMN "team2_sets";

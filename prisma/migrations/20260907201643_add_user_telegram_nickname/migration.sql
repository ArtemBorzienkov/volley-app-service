-- AlterTable
ALTER TABLE "users" ADD COLUMN     "telegram_nickname" TEXT,
ALTER COLUMN "name" DROP NOT NULL;

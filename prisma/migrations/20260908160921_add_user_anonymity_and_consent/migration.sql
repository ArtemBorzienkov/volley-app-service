-- AlterTable
ALTER TABLE "users" ADD COLUMN     "data_consent_at" TIMESTAMP(3),
ADD COLUMN     "is_anonymous" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ongoing_courts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "from_round" INTEGER NOT NULL DEFAULT 1,
    "to_round" INTEGER,

    CONSTRAINT "ongoing_courts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ongoing_courts_event_id_position_key" ON "ongoing_courts"("event_id", "position");

-- AddForeignKey
ALTER TABLE "ongoing_courts" ADD CONSTRAINT "ongoing_courts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ongoing_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every existing tournament over unchanged: `courts = N` becomes courts "1".."N", each available
-- all day. The id is derived from (event, position) so it is unique without relying on an extension.
INSERT INTO "ongoing_courts" ("id", "event_id", "position", "label", "from_round", "to_round")
SELECT md5(c."event_id" || ':' || n)::uuid::text, c."event_id", n, n::text, 1, NULL
FROM "ongoing_event_config" c
CROSS JOIN LATERAL generate_series(1, GREATEST(c."courts", 1)) AS n;

-- Events created before configs existed have no config row; they get the single court the API
-- always defaulted them to.
INSERT INTO "ongoing_courts" ("id", "event_id", "position", "label", "from_round", "to_round")
SELECT md5(e."id" || ':1')::uuid::text, e."id", 1, '1', 1, NULL
FROM "ongoing_events" e
WHERE NOT EXISTS (SELECT 1 FROM "ongoing_courts" oc WHERE oc."event_id" = e."id");

-- AlterTable
ALTER TABLE "ongoing_event_config" DROP COLUMN "courts";

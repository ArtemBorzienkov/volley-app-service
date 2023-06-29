-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT DEFAULT '',
    "userName" TEXT DEFAULT '',
    "email" TEXT DEFAULT '',
    "isPremium" BOOLEAN DEFAULT false
);

-- CreateTable
CREATE TABLE "trainings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "msg" INTEGER,
    "maxMembers" INTEGER
);

-- CreateTable
CREATE TABLE "configs" (
    "chat_id" INTEGER NOT NULL,
    "coach_id" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "max" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "isForum" BOOLEAN,
    "publish_day" TEXT NOT NULL,
    "topic_id" INTEGER
);

-- CreateTable
CREATE TABLE "_TrainingToUser" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_TrainingToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "trainings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TrainingToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "configs_chat_id_key" ON "configs"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "_TrainingToUser_AB_unique" ON "_TrainingToUser"("A", "B");

-- CreateIndex
CREATE INDEX "_TrainingToUser_B_index" ON "_TrainingToUser"("B");

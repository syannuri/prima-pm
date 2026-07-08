-- CreateEnum
CREATE TYPE "KickoffActionStatus" AS ENUM ('OPEN', 'DONE');

-- CreateTable
CREATE TABLE "KickoffMeeting" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3),
    "location" TEXT,
    "facilitator" TEXT,
    "agenda" TEXT,
    "objectives" TEXT,
    "decisions" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KickoffMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KickoffAttendee" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KickoffAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KickoffActionItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "KickoffActionStatus" NOT NULL DEFAULT 'OPEN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KickoffActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KickoffMeeting_projectId_key" ON "KickoffMeeting"("projectId");

-- CreateIndex
CREATE INDEX "KickoffAttendee_meetingId_idx" ON "KickoffAttendee"("meetingId");

-- CreateIndex
CREATE INDEX "KickoffActionItem_meetingId_idx" ON "KickoffActionItem"("meetingId");

-- AddForeignKey
ALTER TABLE "KickoffMeeting" ADD CONSTRAINT "KickoffMeeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KickoffAttendee" ADD CONSTRAINT "KickoffAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "KickoffMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KickoffActionItem" ADD CONSTRAINT "KickoffActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "KickoffMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

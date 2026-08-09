-- Personal iCal calendar feed token (T4.2). Nullable; unique.
ALTER TABLE "User" ADD COLUMN "calendarFeedToken" TEXT;
CREATE UNIQUE INDEX "User_calendarFeedToken_key" ON "User"("calendarFeedToken");

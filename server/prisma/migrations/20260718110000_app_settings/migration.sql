-- Runtime app settings (single "singleton" row) so an ADMIN can toggle the open sign-up paths
-- (guest email+password signup, Google sign-in) from the UI without an env change + restart.
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "guestSignupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "googleLoginEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

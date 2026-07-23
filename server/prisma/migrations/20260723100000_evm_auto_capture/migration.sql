-- Weekly EVM auto-capture: opt-in scheduler config on the singleton AppSetting row.
-- evmAutoCaptureWeekday: 0=Sunday .. 6=Saturday (default 1 = Monday). lastRunAt is
-- scheduler-managed (stamped after each successful weekly run) so restarts don't double-run.
ALTER TABLE "AppSetting" ADD COLUMN "evmAutoCaptureEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSetting" ADD COLUMN "evmAutoCaptureWeekday" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AppSetting" ADD COLUMN "evmAutoCaptureLastRunAt" TIMESTAMP(3);

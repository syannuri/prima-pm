-- Project archive: a reversible hide (distinct from soft-delete). Archived projects drop out of
-- the corporate list, dashboard and portfolio, and live only in the Project Database Archive tab.
-- Additive nullable columns on Project; NULL = a live (non-archived) project.
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "archivedById" TEXT;

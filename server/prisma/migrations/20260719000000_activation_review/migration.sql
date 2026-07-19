-- PMO activation-review outcome (Scope/Budget/Schedule review with Approve/Reject/Revision).
-- Additive nullable columns on Project; NULL = in the activation queue.
ALTER TABLE "Project" ADD COLUMN "activationReviewStatus" TEXT;
ALTER TABLE "Project" ADD COLUMN "activationReviewNote" TEXT;
ALTER TABLE "Project" ADD COLUMN "activationReviewAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "activationReviewById" TEXT;

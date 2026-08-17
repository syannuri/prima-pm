-- AlterEnum
-- Gate the Cost baseline UNLOCK through its own approval workflow (the riskier change-control
-- action). Independent of COST_BASELINE so existing lock workflows are untouched.
ALTER TYPE "ApprovalAppliesTo" ADD VALUE 'BASELINE_UNLOCK';

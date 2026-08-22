// One-time backfill runner: `npm run backfill:baseline-versions` (tsx). Idempotent — safe to re-run.
import { backfillBaselineVersions } from '../src/modules/projects/baseline.backfill.js';

const res = await backfillBaselineVersions();
console.log(`[backfill] baseline versions — created=${res.created} skipped=${res.skipped}`);
process.exit(0);

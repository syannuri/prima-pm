// Bake the deployed commit into dist/version.json at build time so the /version endpoint can report
// it at runtime WITHOUT shelling out to git (dist may run where git/.git isn't reachable). Both
// prods build on the box right after `git pull`, so this captures the just-deployed SHA. dist/ is
// gitignored, so this file is never committed — it is a per-build artefact. Non-fatal: if git isn't
// available (e.g. a tarball build), we still emit a file with sha 'unknown' so the endpoint works.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const out = resolve(repo, 'dist/version.json');

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const sha = process.env.APP_RELEASE || git('rev-parse HEAD') || 'unknown';
const shortSha = sha === 'unknown' ? 'unknown' : sha.slice(0, 7);
const branch = git('rev-parse --abbrev-ref HEAD') || '';
const builtAt = new Date().toISOString();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sha, shortSha, branch, builtAt }, null, 2) + '\n');
console.log(`[gen-version] ${shortSha} (${branch || 'no-branch'}) @ ${builtAt}`);

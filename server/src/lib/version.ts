import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deploy identity for the /version endpoint. Read from dist/version.json (baked at build time by
// scripts/gen-version.mjs) so a backend-only deploy can be verified remotely without SSH. Cached
// after the first read. Falls back gracefully when the file is absent (dev via tsx, or an unbuilt
// checkout): APP_RELEASE if set, else 'dev'.
export interface VersionInfo {
  sha: string;
  shortSha: string;
  branch: string;
  builtAt: string | null;
}

let cached: VersionInfo | undefined;

export function version(): VersionInfo {
  if (cached) return cached;
  // This module compiles to dist/lib/version.js, so dist/version.json is one level up.
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = readFileSync(resolve(here, '../version.json'), 'utf8');
    cached = JSON.parse(raw) as VersionInfo;
  } catch {
    const sha = process.env.APP_RELEASE || 'dev';
    cached = { sha, shortSha: sha.slice(0, 7), branch: '', builtAt: null };
  }
  return cached;
}

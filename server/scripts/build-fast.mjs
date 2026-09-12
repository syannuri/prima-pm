// Fast, low-memory server build for constrained boxes (e.g. the 1.6 GB LAN prod where
// `tsc` OOMs / swap-thrashes for >10 min). esbuild transpiles each .ts → .js per file
// (bundle:false) preserving the source tree + the explicit `.js` ESM import specifiers, so
// the output is a drop-in for the tsc-emitted dist. This does NOT type-check — run
// `npm run typecheck` (tsc --noEmit) separately (CI / a beefier box) for that gate.
import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');

// Mirror tsconfig.build.json "exclude": test/itest files never ship to dist.
const isExcluded = (p) =>
  /\.(test|itest)\.ts$/.test(p) ||
  /(^|\/)(__tests__|__itests__)(\/|$)/.test(p) ||
  /(^|\/)test(\/|$)/.test(relative(srcDir, p));

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts') && !isExcluded(full)) out.push(full);
  }
  return out;
}

const entryPoints = collect(srcDir);
const t0 = Date.now();

await build({
  entryPoints,
  outdir: join(root, 'dist'),
  outbase: srcDir,
  bundle: false, // transpile each file in place; keep imports (they already carry .js)
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
});

console.log(`[build-fast] transpiled ${entryPoints.length} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

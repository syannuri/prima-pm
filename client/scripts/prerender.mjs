// Browser-free prerender of the public landing page. Runs after `vite build`:
//   1. builds a tiny SSR bundle of src/prerender.tsx into a temp dir (.prerender/),
//   2. imports it and renders the landing to a static HTML string,
//   3. injects that into dist/index.html's <div id="root"></div>.
//
// No headless browser needed — pure react-dom/server — so it works in any Node build env
// (incl. the VPS, which has no Chromium). Deliberately NON-FATAL: any failure logs a warning
// and leaves the normal SPA index.html untouched, so a prerender hiccup can never break a build.
import { build } from 'vite';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.cwd();
const tmp = path.join(root, '.prerender');
const indexPath = path.join(root, 'dist', 'index.html');
const PLACEHOLDER = '<div id="root"></div>';

try {
  await build({
    root,
    logLevel: 'warn',
    build: {
      ssr: 'src/prerender.tsx',
      outDir: '.prerender',
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'prerender.mjs' } },
    },
  });

  const mod = await import(pathToFileURL(path.join(tmp, 'prerender.mjs')).href);
  const appHtml = mod.render();
  if (!appHtml || appHtml.length < 500) throw new Error(`render() returned suspiciously little (${appHtml?.length ?? 0} bytes)`);

  // This prerendered landing markup lives in the ONE index.html the SPA serves for EVERY route
  // (client-side routing). It's only correct for "/"; on any other route (e.g. a hard reload of
  // /dashboard) it would paint before React mounts → a flash of the landing page. So follow it
  // with a synchronous (non-deferred) guard that strips #root on non-landing paths — it runs
  // during parse, before the deferred module script and before first paint. SEO for "/" is intact.
  const guard =
    `<script>(function(){var p=location.pathname;` +
    `if(p!=='/'&&p!=='/index.html'){var r=document.getElementById('root');if(r)r.innerHTML='';}})();</script>`;

  const html = readFileSync(indexPath, 'utf8');
  if (!html.includes(PLACEHOLDER)) throw new Error('root placeholder not found in dist/index.html');
  writeFileSync(indexPath, html.replace(PLACEHOLDER, `<div id="root">${appHtml}</div>${guard}`));
  console.log(`✓ prerendered dist/index.html (${appHtml.length} bytes of landing markup into #root)`);
} catch (err) {
  console.warn('⚠ prerender skipped — falling back to client-only SPA:', err?.message || err);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

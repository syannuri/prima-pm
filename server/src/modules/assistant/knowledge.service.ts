import { prisma } from '../../lib/prisma.js';
import { embeddingsEnabled, getEmbedder, cosine } from '../../lib/embeddings.js';
import { buildProjectChunks } from './chunking.service.js';
import { reindexProject } from './chunkIndex.service.js';

// RAG v2 — chunk retrieval. Returns the most relevant CHUNKS (charter section / risk / CR / lesson /
// issue / task / cost line) across the caller's accessible projects, each carrying the metadata to
// cite its exact row via [[cite:CODE|SOURCE|id]]. Mode-aware, mirroring searchProjectsDetailed:
//   - semantic (Voyage armed): lazily (re)index accessible projects, then cosine-rank cached vectors.
//   - fts (dormant / Voyage error): lexical rank over LIVE chunk text — no DB vectors, no network.

export interface ChunkHit {
  code: string;
  source: string;     // citation SOURCE (Overview|Risk|ChangeRequest|Schedule|Cost)
  entityType: string;
  entityId: string;   // for [[cite:CODE|SOURCE|entityId]] row-level deep-links
  text: string;
  score: number;
}
export type RetrieveMode = 'semantic' | 'fts';

const DEFAULT_K = 8;
const MIN_SCORE = Number(process.env.SEMANTIC_MIN_SCORE) || 0.35;
const REINDEX_CONCURRENCY = 6; // bound the per-search reindex fan-out (matches getPortfolioActualCosts)

// Run an async fn over items with bounded concurrency (small helper; avoids a serial await-loop over
// many projects while not hammering the DB/embedder).
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Public entry point. `projectIds` is the caller's already-tenant-scoped accessible set.
export async function retrieveChunks(query: string, projectIds: string[], opts?: { k?: number }): Promise<{ mode: RetrieveMode; hits: ChunkHit[] }> {
  const q = query.trim().slice(0, 500);
  const k = Math.max(1, Math.min(20, opts?.k ?? DEFAULT_K));
  if (!q || projectIds.length === 0) return { mode: embeddingsEnabled() ? 'semantic' : 'fts', hits: [] };

  if (embeddingsEnabled()) {
    try {
      return { mode: 'semantic', hits: await semanticRetrieve(q, projectIds, k) };
    } catch {
      // Voyage outage / bad response → fall through to lexical over live text.
    }
  }
  return { mode: 'fts', hits: await lexicalRetrieve(q, projectIds, k) };
}

async function semanticRetrieve(q: string, projectIds: string[], k: number): Promise<ChunkHit[]> {
  // Freshen each accessible project's chunks (re-embeds only changed chunks; cheap when warm).
  await mapLimit(projectIds, REINDEX_CONCURRENCY, (pid) => reindexProject(pid));

  const rows = await prisma.chunkEmbedding.findMany({
    where: { projectId: { in: projectIds } },
    select: { code: true, source: true, entityType: true, entityId: true, text: true, vector: true },
  });
  if (rows.length === 0) return [];

  const [qVec] = await getEmbedder().embed([q]);
  return rows
    .map((r) => ({ r, score: cosine(qVec, (r.vector as unknown as number[]) ?? []) }))
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => ({ code: s.r.code, source: s.r.source, entityType: s.r.entityType, entityId: s.r.entityId, text: s.r.text, score: s.score }));
}

// Dormant fallback: no cached vectors (reindex never ran without a key), so rank the LIVE chunks by a
// simple term-overlap score. Deterministic, no network — keeps retrieval useful before Voyage is armed.
async function lexicalRetrieve(q: string, projectIds: string[], k: number): Promise<ChunkHit[]> {
  const terms = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  if (terms.length === 0) return [];
  const chunkLists = await mapLimit(projectIds, REINDEX_CONCURRENCY, (pid) => buildProjectChunks(pid));
  const hits: ChunkHit[] = [];
  for (const chunks of chunkLists) {
    for (const c of chunks) {
      const hay = c.text.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 1;
      if (score > 0) hits.push({ code: c.code, source: c.source, entityType: c.entityType, entityId: c.entityId, text: c.text, score: score / terms.length });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}

// Cached-chunk count for the tenant (status probe). Tenant-scoped by the Prisma extension.
export async function countTenantChunks(): Promise<number> {
  return prisma.chunkEmbedding.count();
}

// ---- Auto-grounding (RAG v2 Phase 3) ----

// Gate for injecting retrieved chunks into every Anett turn. Dormant by default; needs the Voyage key
// too (we only auto-ground on high-quality semantic hits, not the lexical fallback).
export function ragGroundingEnabled(): boolean {
  return process.env.AI_RAG_GROUNDING === '1' || process.env.AI_RAG_GROUNDING === 'true';
}

const RAG_BLOCK_K = 6;
const RAG_CHUNK_CLIP = 400;

// Build a "Relevant knowledge" system segment: retrieve the top chunks for the question and format them
// with the exact citation marker so the model grounds on + cites them WITHOUT a tool round-trip. Returns
// '' when disabled, not armed, errored, or nothing relevant — the caller then omits the segment (zero
// behaviour change). Bounded (k + per-chunk clip) to keep tokens/cost low.
export async function buildRagGroundingBlock(query: string, projectIds: string[], en: boolean): Promise<string> {
  if (!ragGroundingEnabled() || !embeddingsEnabled()) return '';
  let hits: ChunkHit[] = [];
  try { hits = (await retrieveChunks(query, projectIds, { k: RAG_BLOCK_K })).hits; } catch { return ''; }
  if (hits.length === 0) return '';
  const lines = hits.map((h) => {
    // charter/lesson/issue → project-level Overview citation (2 parts); the rest deep-link the row.
    const cite = h.source === 'Overview' ? `[[cite:${h.code}|Overview]]` : `[[cite:${h.code}|${h.source}|${h.entityId}]]`;
    return `- (${h.code} · ${h.source}) ${h.text.slice(0, RAG_CHUNK_CLIP)} ${cite}`;
  });
  const header = en
    ? 'Relevant knowledge retrieved for this question — ground your answer on these and cite the row with the marker shown (do not invent beyond them):'
    : 'Pengetahuan relevan untuk pertanyaan ini — jadikan dasar jawaban dan sitir barisnya dengan penanda yang tertera (jangan mengarang di luar ini):';
  return `${header}\n${lines.join('\n')}`;
}

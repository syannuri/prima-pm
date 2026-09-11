import { createHash } from 'crypto';
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Forbidden } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { embeddingsEnabled, embeddingModel, getEmbedder, cosine } from '../../lib/embeddings.js';
import { canWriteTenantScope } from './memory.service.js';

// Cross-project full-text search (the "semantic search v1" — lexical, no embeddings). Builds a per-
// project searchable document from the project's text (name, client, charter narrative, risk / change-
// request / lesson / issue titles + descriptions) and runs Postgres FTS with websearch_to_tsquery +
// ts_rank, returning the top matches with a highlighted snippet. Anett calls this for open-ended
// "which projects mention / are about X" questions, then summarises the hits.
//
// The 'simple' text-search config (tokenise + lowercase, no language stemming) is used deliberately:
// the content is bilingual (ID/EN) and Postgres has no built-in Indonesian dictionary, so 'english'
// stemming would mangle Indonesian. Raw SQL bypasses the Prisma tenant-extension, so the tenant is
// filtered by hand (defense-in-depth on top of the already-tenant-scoped projectIds).

export interface SearchHit {
  code: string;
  name: string;
  rank: number;
  snippet: string;
}

const MAX_RESULTS = 8;
// Below this cosine similarity a semantic "match" is just noise — drop it rather than surface a
// weakly-related project. Tunable without a code change.
const SEMANTIC_MIN_SCORE = Number(process.env.SEMANTIC_MIN_SCORE) || 0.35;

// Which engine actually served a search — the pilot's key observability signal (#4). `semantic` means
// Voyage embeddings ranked the hits; `fts` means the lexical fallback ran (Voyage disabled OR errored).
export type SearchMode = 'semantic' | 'fts';

// Public entry point (mode-aware). Uses embeddings (semantic, meaning-based) when Voyage is armed;
// otherwise — and on any embedding error — falls back to the lexical FTS below, so search never breaks.
// The returned `mode` reflects what ACTUALLY ran (semantic success vs FTS fallback), so a pilot can see
// whether the Voyage key is really being exercised without changing behavior.
export async function searchProjectsDetailed(query: string, projectIds: string[]): Promise<{ mode: SearchMode; hits: SearchHit[] }> {
  if (embeddingsEnabled()) {
    try {
      return { mode: 'semantic', hits: await semanticSearchProjects(query, projectIds) };
    } catch {
      // Voyage outage / rate-limit / bad response → degrade to lexical search (mode falls to 'fts').
    }
  }
  return { mode: 'fts', hits: await ftsSearchProjects(query, projectIds) };
}

// Back-compat thin wrapper: callers that only want the hits (e.g. existing tests) keep working.
export async function searchProjects(query: string, projectIds: string[]): Promise<SearchHit[]> {
  return (await searchProjectsDetailed(query, projectIds)).hits;
}

// Pilot status probe (#4): is semantic search armed, on which model, and how many project vectors are
// already cached for this tenant? ADMIN/PMO only (reuses the governance-role rule). Lets an operator
// confirm arming worked (enabled:true) and watch the cache warm up, without spending on a search.
export async function getSearchStatus(caller: { role: Role }): Promise<{ enabled: boolean; model: string; cachedVectors: number }> {
  if (!canWriteTenantScope(caller.role)) throw Forbidden('Hanya admin/PMO yang dapat melihat status pencarian.');
  // projectEmbedding is a tenant-scoped model → count is auto-filtered to the caller's tenant.
  const cachedVectors = await prisma.projectEmbedding.count();
  return { enabled: embeddingsEnabled(), model: embeddingModel(), cachedVectors };
}

async function ftsSearchProjects(query: string, projectIds: string[]): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 200);
  if (!q || projectIds.length === 0) return [];
  const tenantId = getTenantStore()?.tenantId;
  const tenantFilter = tenantId ? Prisma.sql`AND p."tenantId" = ${tenantId}` : Prisma.empty;

  // One searchable document per accessible project (charter/risk/CR/lesson/issue text aggregated).
  const rows = await prisma.$queryRaw<Array<{ code: string; name: string; rank: number; snippet: string }>>(Prisma.sql`
    WITH tsq AS (SELECT websearch_to_tsquery('simple', ${q}) AS query),
    docs AS (
      SELECT p.code, p.name, (
        coalesce(p.name,'') || ' ' || coalesce(p."clientName",'') || ' ' ||
        coalesce((SELECT string_agg(coalesce(c.description,'')||' '||coalesce(c.goals,'')||' '||coalesce(c."hiScope",'')||' '||coalesce(c."hiDeliverables",''),' ') FROM "ProjectCharter" c WHERE c."projectId" = p.id),'') || ' ' ||
        coalesce((SELECT string_agg(coalesce(r.title,'')||' '||coalesce(r.description,''),' ') FROM "Risk" r WHERE r."projectId" = p.id),'') || ' ' ||
        coalesce((SELECT string_agg(coalesce(cr.title,'')||' '||coalesce(cr.description,''),' ') FROM "ChangeRequest" cr WHERE cr."projectId" = p.id),'') || ' ' ||
        coalesce((SELECT string_agg(coalesce(l.title,'')||' '||coalesce(l.description,''),' ') FROM "LessonLearned" l WHERE l."projectId" = p.id),'') || ' ' ||
        coalesce((SELECT string_agg(coalesce(i.title,'')||' '||coalesce(i.description,''),' ') FROM "Issue" i WHERE i."projectId" = p.id),'')
      ) AS doc
      FROM "Project" p
      WHERE p.id::text = ANY(${projectIds}) ${tenantFilter}
    )
    SELECT d.code, d.name,
      ts_rank(to_tsvector('simple', d.doc), tsq.query) AS rank,
      ts_headline('simple', d.doc, tsq.query, 'MaxWords=22, MinWords=8, ShortWord=2, MaxFragments=1') AS snippet
    FROM docs d, tsq
    WHERE to_tsvector('simple', d.doc) @@ tsq.query
    ORDER BY rank DESC
    LIMIT ${MAX_RESULTS}
  `);

  return rows.map((r) => ({ code: r.code, name: r.name, rank: Number(r.rank), snippet: (r.snippet ?? '').trim() }));
}

// The same searchable-document expression as the FTS path, but returning the RAW text (to embed).
// Raw SQL bypasses the tenant extension → filter the tenant by hand (defense-in-depth).
async function fetchProjectDocs(projectIds: string[], tenantId?: string): Promise<Array<{ id: string; code: string; name: string; doc: string }>> {
  const tenantFilter = tenantId ? Prisma.sql`AND p."tenantId" = ${tenantId}` : Prisma.empty;
  return prisma.$queryRaw<Array<{ id: string; code: string; name: string; doc: string }>>(Prisma.sql`
    SELECT p.id, p.code, p.name, (
      coalesce(p.name,'') || ' ' || coalesce(p."clientName",'') || ' ' ||
      coalesce((SELECT string_agg(coalesce(c.description,'')||' '||coalesce(c.goals,'')||' '||coalesce(c."hiScope",'')||' '||coalesce(c."hiDeliverables",''),' ') FROM "ProjectCharter" c WHERE c."projectId" = p.id),'') || ' ' ||
      coalesce((SELECT string_agg(coalesce(r.title,'')||' '||coalesce(r.description,''),' ') FROM "Risk" r WHERE r."projectId" = p.id),'') || ' ' ||
      coalesce((SELECT string_agg(coalesce(cr.title,'')||' '||coalesce(cr.description,''),' ') FROM "ChangeRequest" cr WHERE cr."projectId" = p.id),'') || ' ' ||
      coalesce((SELECT string_agg(coalesce(l.title,'')||' '||coalesce(l.description,''),' ') FROM "LessonLearned" l WHERE l."projectId" = p.id),'') || ' ' ||
      coalesce((SELECT string_agg(coalesce(i.title,'')||' '||coalesce(i.description,''),' ') FROM "Issue" i WHERE i."projectId" = p.id),'')
    ) AS doc
    FROM "Project" p
    WHERE p.id::text = ANY(${projectIds}) ${tenantFilter}
  `);
}

// Semantic search (v2): rank accessible projects by cosine similarity between the query embedding and
// each project's cached doc embedding. Re-embeds only projects whose doc changed (docHash) or that
// were embedded with a different model, so a repeat search costs one query embed. Falls back to FTS
// (via the caller) on any error; returns [] with no strong match rather than surfacing noise.
async function semanticSearchProjects(query: string, projectIds: string[]): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 500);
  if (!q || projectIds.length === 0) return [];
  const tenantId = getTenantStore()?.tenantId;

  const docs = (await fetchProjectDocs(projectIds, tenantId))
    .map((d) => ({ ...d, doc: (d.doc ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((d) => d.doc.length > 0);
  if (docs.length === 0) return [];

  const model = embeddingModel();
  const hashOf = (doc: string) => createHash('sha256').update(`${model}\n${doc}`).digest('hex');

  const cached = await prisma.projectEmbedding.findMany({ where: { projectId: { in: docs.map((d) => d.id) } } });
  const byProject = new Map(cached.map((c) => [c.projectId, c]));

  const vecOf = new Map<string, number[]>();
  const stale: typeof docs = [];
  for (const d of docs) {
    const c = byProject.get(d.id);
    if (c && c.model === model && c.docHash === hashOf(d.doc)) {
      vecOf.set(d.id, (c.vector as unknown as number[]) ?? []);
    } else {
      stale.push(d);
    }
  }

  if (stale.length > 0) {
    const vectors = await getEmbedder().embed(stale.map((d) => d.doc));
    for (let i = 0; i < stale.length; i++) {
      const d = stale[i];
      const vector = vectors[i];
      const docHash = hashOf(d.doc);
      await prisma.projectEmbedding.upsert({
        where: { projectId: d.id },
        // tenantId is required by the generated create type; the tenant extension also stamps it
        // (same value) at runtime. We only reach here with a tenant in context (the findMany above
        // fail-closes otherwise), so the assertion is safe.
        create: { projectId: d.id, tenantId: tenantId!, model, docHash, vector },
        update: { model, docHash, vector },
      });
      vecOf.set(d.id, vector);
    }
  }

  const [qVec] = await getEmbedder().embed([q]);
  return docs
    .map((d) => ({ d, score: cosine(qVec, vecOf.get(d.id) ?? []) }))
    .filter((s) => s.score >= SEMANTIC_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((s) => ({ code: s.d.code, name: s.d.name, rank: s.score, snippet: s.d.doc.slice(0, 180).trim() }));
}

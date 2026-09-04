import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getTenantStore } from '../../lib/tenant/context.js';

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

export async function searchProjects(query: string, projectIds: string[]): Promise<SearchHit[]> {
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

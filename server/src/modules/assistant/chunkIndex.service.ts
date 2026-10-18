import { createHash } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { embeddingModel, getEmbedder } from '../../lib/embeddings.js';
import { buildProjectChunks } from './chunking.service.js';

// RAG v2 — chunk indexing. Keeps a project's ChunkEmbedding rows in sync with its live content:
// (re)embed only new/changed chunks (docHash, like the per-project cache), and delete chunks whose
// source entity is gone. Lazy — callers (retrieval) reindex a project just-in-time when its chunks
// are stale, mirroring search.service's re-embed-on-search. NOT gated on embeddingsEnabled() here;
// the caller only invokes this when embeddings are armed (else it would hit Voyage with no key). Tests
// inject a deterministic embedder via __setEmbedder, so this runs with no key / no network.

const keyOf = (entityType: string, entityId: string): string => `${entityType}\n${entityId}`;

export interface ReindexResult { indexed: number; deleted: number; total: number }

// Reindex one project's chunks. Returns counts: how many were (re)embedded, deleted, and the live total.
export async function reindexProject(projectId: string): Promise<ReindexResult> {
  const tenantId = getTenantStore()?.tenantId ?? null;
  const model = embeddingModel();
  const hashOf = (text: string): string => createHash('sha256').update(`${model}\n${text}`).digest('hex');

  const chunks = await buildProjectChunks(projectId);
  const existing = await prisma.chunkEmbedding.findMany({
    where: { projectId },
    select: { id: true, entityType: true, entityId: true, model: true, docHash: true },
  });
  const byKey = new Map(existing.map((e) => [keyOf(e.entityType, e.entityId), e]));

  // Delete chunks whose source entity no longer exists (risk removed, task deleted, …).
  const liveKeys = new Set(chunks.map((c) => keyOf(c.entityType, c.entityId)));
  const toDelete = existing.filter((e) => !liveKeys.has(keyOf(e.entityType, e.entityId)));
  if (toDelete.length > 0) await prisma.chunkEmbedding.deleteMany({ where: { id: { in: toDelete.map((d) => d.id) } } });

  // Embed only new chunks, those whose text changed, or those from a different embedding model.
  const stale = chunks.filter((c) => {
    const e = byKey.get(keyOf(c.entityType, c.entityId));
    return !e || e.model !== model || e.docHash !== hashOf(c.text);
  });

  if (stale.length > 0) {
    const vectors = await getEmbedder().embed(stale.map((c) => c.text));
    for (let i = 0; i < stale.length; i++) {
      const c = stale[i];
      const vector = vectors[i];
      const docHash = hashOf(c.text);
      await prisma.chunkEmbedding.upsert({
        where: { projectId_entityType_entityId: { projectId, entityType: c.entityType, entityId: c.entityId } },
        // tenantId is required by the generated create type; the extension stamps the same value under
        // context. We only reach here inside a tenant context, so the assertion is safe.
        create: { projectId, tenantId: tenantId!, entityType: c.entityType, entityId: c.entityId, source: c.source, code: c.code, text: c.text, model, docHash, vector },
        update: { source: c.source, code: c.code, text: c.text, model, docHash, vector },
      });
    }
  }

  return { indexed: stale.length, deleted: toDelete.length, total: chunks.length };
}

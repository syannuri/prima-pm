// Embeddings port (round-3 #1: semantic search v2). Turns text into vectors via Voyage AI so
// cross-project search can match by MEANING, not just shared words — the lexical FTS (v1) misses
// synonyms and cross-lingual phrasing ("scope creep" vs "ruang lingkup melebar"). DORMANT by default:
// with no VOYAGE_API_KEY the search service falls back to FTS, so nothing changes until a key is set.
//
// Config is read LIVE from process.env (like aiConfig) so ops can arm it without a rebuild. A narrow
// port + `__setEmbedder` seam lets integration tests inject deterministic vectors (no network, no key).

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

export function embeddingModel(): string {
  return process.env.VOYAGE_MODEL || 'voyage-3';
}

export interface Embedder {
  // Batch-embed texts → one vector each (same order). Throws on transport/API error; callers fall
  // back to FTS so a Voyage outage never breaks search.
  embed(texts: string[]): Promise<number[][]>;
}

let injected: Embedder | null = null;
export function __setEmbedder(e: Embedder | null): void { injected = e; }

function liveEmbedder(): Embedder {
  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      const key = process.env.VOYAGE_API_KEY ?? '';
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ input: texts, model: embeddingModel() }),
      });
      if (!res.ok) throw new Error(`voyage embeddings ${res.status}`);
      const json = (await res.json()) as { data?: { embedding: number[] }[] };
      const data = json.data ?? [];
      if (data.length !== texts.length) throw new Error('voyage embeddings: count mismatch');
      return data.map((d) => d.embedding);
    },
  };
}

export function getEmbedder(): Embedder {
  return injected ?? liveEmbedder();
}

// Cosine similarity in [-1, 1] (1 = identical direction). Brute-force in Node is fine here: a tenant
// has at most tens–low-hundreds of projects, so ranking is a handful of dot products — no pgvector
// or ANN index needed, which also keeps the storage a plain JSON column and the migration trivial.
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

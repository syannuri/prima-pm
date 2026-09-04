// Per-model price table for ESTIMATING AI spend from captured token counts (see lib/aiUsage.ts).
// USD per 1M tokens. Tokens are the source of truth; cost is computed at READ time from this table
// so a price correction never needs a data migration. Defaults are Anthropic's published Claude
// pricing (input/output) with the standard prompt-cache multipliers: a 5-minute cache WRITE costs
// 1.25x input, a cache READ costs 0.1x input. Override any of it via AI_PRICE_JSON (a JSON object
// keyed by model id) without a code change — an estimate, not a bill.
export interface ModelPrice {
  input: number;        // $/MTok, uncached input
  output: number;       // $/MTok, output
  cacheWrite: number;   // $/MTok, prompt-cache write (5-minute ephemeral) = 1.25x input
  cacheRead: number;    // $/MTok, prompt-cache read = 0.1x input
}

// Derive the two cache rates from the base input price (the standard 1.25x / 0.1x multipliers).
function withCache(input: number, output: number): ModelPrice {
  return { input, output, cacheWrite: input * 1.25, cacheRead: input * 0.1 };
}

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-8': withCache(5, 25),
  'claude-opus-4-7': withCache(5, 25),
  'claude-opus-4-6': withCache(5, 25),
  'claude-sonnet-4-6': withCache(3, 15),
  'claude-haiku-4-5': withCache(1, 5),
  'claude-fable-5': withCache(10, 50),
};

// Unknown models estimate at the Opus tier (conservative — never under-reports spend).
const FALLBACK: ModelPrice = withCache(5, 25);

let cached: Record<string, ModelPrice> | undefined;
function prices(): Record<string, ModelPrice> {
  if (cached) return cached;
  cached = { ...DEFAULT_PRICES };
  const raw = process.env.AI_PRICE_JSON;
  if (raw) {
    try {
      const override = JSON.parse(raw) as Record<string, Partial<ModelPrice>>;
      for (const [model, p] of Object.entries(override)) {
        cached[model] = { ...(cached[model] ?? FALLBACK), ...p } as ModelPrice;
      }
    } catch {
      // Malformed override → ignore and use defaults (never break cost display on a typo).
    }
  }
  return cached;
}

export function priceFor(model: string): ModelPrice {
  return prices()[model] ?? FALLBACK;
}

// Estimated USD for one usage row. Micro-dollars would over-engineer this — plain float dollars are
// fine for a cost DASHBOARD (not an invoice).
export function estimateCostUsd(tokens: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): number {
  const p = priceFor(tokens.model);
  return (
    (tokens.inputTokens * p.input +
      tokens.outputTokens * p.output +
      tokens.cacheCreationTokens * p.cacheWrite +
      tokens.cacheReadTokens * p.cacheRead) /
    1_000_000
  );
}

// Test seam — reset the memoised table after mutating env in a test.
export function __resetAiPriceCache(): void {
  cached = undefined;
}

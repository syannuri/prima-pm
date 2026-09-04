// Redaction guard (round-3 #2): a privacy layer that scrubs high-confidence SECRETS and PII out of
// every payload sent to Anthropic, then restores the originals in the answer. Reversible tokenisation
// preserves Anett's ability to *refer* to a value ("assigned to «PII_EMAIL_1»") while the raw value
// never leaves the box. DORMANT by default (env AI_REDACT) — when off, redact/restore are identity, so
// there is zero behaviour change on the existing AI paths.
//
// SCOPE (deliberately conservative): only things Anett never needs to reason over AND that are
// unambiguously sensitive — email addresses, API keys/tokens, JWTs, private-key blocks. It does NOT
// touch bare numbers, currency, or budgets: those ARE the data the AI must analyse (EVM/cost), and
// redacting them would break the product. Phone/national-ID patterns are intentionally left for a
// future opt-in — too many false positives against financial figures to enable by default.

export function redactionEnabled(): boolean {
  const v = process.env.AI_REDACT;
  return v === '1' || v === 'true';
}

// Order matters: broad/greedy patterns first so a key block isn't partially consumed by a later rule.
// Each entry tokenises its matches to «PII_<LABEL>_<n>».
const PATTERNS: { label: string; re: RegExp }[] = [
  // PEM private-key blocks (multi-line) — most sensitive, match whole block.
  { label: 'KEY', re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g },
  // JWTs (three base64url segments) — often bearer/session tokens.
  { label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/g },
  // Provider credentials: Anthropic sk-ant-, generic sk-, the app's own pk_ API keys, AWS AKIA,
  // GitHub ghp_, Slack xox*-.
  { label: 'SECRET', re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|pk_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g },
  // Email addresses.
  { label: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

// A per-call redactor. Same original ⇒ same token (dedupe), so restore is unambiguous and the model
// sees a stable reference across the payload. When redaction is off, both methods are identity.
export interface Redactor {
  redact(text: string): string;
  restore(text: string): string;
  readonly size: number; // number of distinct values tokenised (for tests/telemetry)
}

export function createRedactor(): Redactor {
  if (!redactionEnabled()) {
    return { redact: (t) => t, restore: (t) => t, size: 0 };
  }
  const tokenOf = new Map<string, string>(); // original -> token (dedupe)
  const originalOf = new Map<string, string>(); // token -> original (restore)
  const counters: Record<string, number> = {};

  const redact = (text: string): string => {
    if (!text) return text;
    let out = text;
    for (const { label, re } of PATTERNS) {
      // Fresh lastIndex each pass (global regex is stateful).
      re.lastIndex = 0;
      out = out.replace(re, (m) => {
        let token = tokenOf.get(m);
        if (!token) {
          counters[label] = (counters[label] ?? 0) + 1;
          token = `«PII_${label}_${counters[label]}»`;
          tokenOf.set(m, token);
          originalOf.set(token, m);
        }
        return token;
      });
    }
    return out;
  };

  const restore = (text: string): string => {
    if (!text) return text;
    let out = text;
    // Plain split/join avoids having to regex-escape the original (safe for any content).
    for (const [token, original] of originalOf) out = out.split(token).join(original);
    return out;
  };

  return {
    redact,
    restore,
    get size() { return originalOf.size; },
  };
}

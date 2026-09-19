import { Fragment, type ReactNode } from 'react';

// Markdown-lite: a tiny, safe subset for charter narrative fields (Description, Goals,
// Scope of Work, Deliverables). Renders straight to React elements — no HTML string is ever
// built or injected, so there is no XSS surface (unlike react-markdown/marked + dangerouslySetInnerHTML).
//
// Supported syntax:
//   # / ## / ###  headings
//   - or *        bullet list
//   1.            numbered list
//   **bold**      bold        *italic* / _italic_   italic
//   `code`        inline monospace (e.g. project codes like `AI-1`)
//   [text](url)   link (http/https/mailto only — others render as plain text)
//   blank line    paragraph break;  single newline inside a paragraph → <br/>
//
// Anything else renders as plain text (the raw markers show), so old plain-text charters and
// unknown syntax degrade gracefully.

// Only http(s)/mailto links are rendered as anchors — everything else (notably javascript:
// and data: URLs) falls back to plain text, so a link can never become a script vector.
export function safeUrl(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

// Optional hook (used by the Anett assistant) to turn a [[cite:CODE|SOURCE|FOCUS]] marker into a
// clickable citation chip. FOCUS is an optional entity id (e.g. a risk id) so the chip can deep-link
// to the exact row, not just the tab. When not supplied (e.g. charter fields), the marker degrades to
// readable plain text.
export type RenderCitation = (code: string, source: string | undefined, raw: string, focus?: string) => ReactNode;
// group 2 = everything after the first '|' (may itself contain a '|' → SOURCE|FOCUS), split below.
const CITE_RE = /^\[\[cite:([^|\]]+?)(?:\|([^\]]+))?\]\]$/;

// --- inline: [[cite:…]], `code`, [text](url), **bold**, *italic*, _italic_ ---
// citation is FIRST (a whole-token match), then `code` so its contents are never re-parsed.
const INLINE_RE = /(\[\[cite:[^\]]+\]\]|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;

function renderInline(text: string, renderCitation?: RenderCitation): ReactNode {
  // Split on the markers, keeping the delimiters so we can pair them up.
  const tokens = text.split(INLINE_RE).filter((t) => t !== '');
  return tokens.map((tok, i) => {
    const cite = CITE_RE.exec(tok);
    if (cite) {
      const code = cite[1].trim();
      // Second group is "SOURCE" or "SOURCE|FOCUS" — split so the entity id becomes the deep-link focus.
      const [source, focus] = (cite[2] ?? '').split('|').map((s) => s.trim());
      if (renderCitation) return <Fragment key={i}>{renderCitation(code, source || undefined, tok, focus || undefined)}</Fragment>;
      return <Fragment key={i}>{source ? `${code} · ${source}` : code}</Fragment>; // graceful plain text
    }
    const link = LINK_RE.exec(tok);
    if (link) {
      const href = safeUrl(link[2]);
      return href
        ? <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-700 dark:text-brand-400">{link[1]}</a>
        : <Fragment key={i}>{tok}</Fragment>; // unsafe URL → show the raw markdown, never a live link
    }
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2)
      return <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-700 dark:bg-slate-800 dark:text-slate-200">{tok.slice(1, -1)}</code>;
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4)
      return <strong key={i}>{tok.slice(2, -2)}</strong>;
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2)
      return <em key={i}>{tok.slice(1, -1)}</em>;
    if (tok.startsWith('_') && tok.endsWith('_') && tok.length > 2)
      return <em key={i}>{tok.slice(1, -1)}</em>;
    return <Fragment key={i}>{tok}</Fragment>;
  });
}

type Block =
  | { type: 'h'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'p'; lines: string[] };

// A pipe table row: "| a | b |" → ['a','b'] (outer pipes optional; empty edge cells dropped).
const isTableRow = (line: string) => /\|/.test(line) && /^\s*\|?.*\|.*$/.test(line.trim());
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
// Separator row under the header: each cell is only dashes/colons, e.g. "--- | :--:".
const isTableSeparator = (line: string) =>
  isTableRow(line) && splitRow(line).every((c) => /^:?-{1,}:?$/.test(c));

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', lines: para }); para = []; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    // A table = a header row immediately followed by a separator row, then zero+ body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && isTableRow(lines[j]) && lines[j].trim() !== ''; j++) {
        const cells = splitRow(lines[j]);
        // Pad/truncate to the header width so the grid stays rectangular.
        rows.push(Array.from({ length: header.length }, (_, k) => cells[k] ?? ''));
      }
      blocks.push({ type: 'table', header, rows });
      i = j - 1;
      continue;
    }
    if (line.trim() === '') { flushPara(); continue; }
    if (heading) {
      flushPara();
      blocks.push({ type: 'h', level: heading[1].length, text: heading[2] });
    } else if (bullet) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'ul') last.items.push(bullet[1]);
      else blocks.push({ type: 'ul', items: [bullet[1]] });
    } else if (ordered) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'ol') last.items.push(ordered[1]);
      else blocks.push({ type: 'ol', items: [ordered[1]] });
    } else {
      para.push(line);
    }
  }
  flushPara();
  return blocks;
}

/** Render markdown-lite text to safe React nodes. Empty/blank input renders nothing. */
export function Markdown({ text, className, renderCitation }: { text: string; className?: string; renderCitation?: RenderCitation }) {
  if (!text || text.trim() === '') return null;
  const blocks = parseBlocks(text);
  const ri = (t: string) => renderInline(t, renderCitation);
  return (
    <div className={`md-body space-y-2 ${className ?? ''}`}>
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          const size = b.level === 1 ? 'text-base' : b.level === 2 ? 'text-sm' : 'text-sm';
          return <div key={i} className={`font-semibold text-slate-800 dark:text-slate-100 ${size}`}>{ri(b.text)}</div>;
        }
        if (b.type === 'ul')
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {b.items.map((it, j) => <li key={j}>{ri(it)}</li>)}
            </ul>
          );
        if (b.type === 'ol')
          return (
            <ol key={i} className="list-decimal space-y-0.5 pl-5">
              {b.items.map((it, j) => <li key={j}>{ri(it)}</li>)}
            </ol>
          );
        if (b.type === 'table')
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {b.header.map((h, j) => (
                      <th key={j} className="border border-slate-300 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{ri(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => <td key={k} className="border border-slate-300 px-2 py-1 align-top dark:border-slate-700">{ri(c)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return (
          <p key={i} className="leading-relaxed">
            {b.lines.map((ln, j) => (
              <Fragment key={j}>{ri(ln)}{j < b.lines.length - 1 && <br />}</Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

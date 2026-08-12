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

// --- inline: [text](url), **bold**, *italic*, _italic_ ---
const INLINE_RE = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;

function renderInline(text: string): ReactNode {
  // Split on the markers, keeping the delimiters so we can pair them up.
  const tokens = text.split(INLINE_RE).filter((t) => t !== '');
  return tokens.map((tok, i) => {
    const link = LINK_RE.exec(tok);
    if (link) {
      const href = safeUrl(link[2]);
      return href
        ? <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-700 dark:text-brand-400">{link[1]}</a>
        : <Fragment key={i}>{tok}</Fragment>; // unsafe URL → show the raw markdown, never a live link
    }
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
  | { type: 'p'; lines: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', lines: para }); para = []; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
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
export function Markdown({ text, className }: { text: string; className?: string }) {
  if (!text || text.trim() === '') return null;
  const blocks = parseBlocks(text);
  return (
    <div className={`md-body space-y-2 ${className ?? ''}`}>
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          const size = b.level === 1 ? 'text-base' : b.level === 2 ? 'text-sm' : 'text-sm';
          return <div key={i} className={`font-semibold text-slate-800 dark:text-slate-100 ${size}`}>{renderInline(b.text)}</div>;
        }
        if (b.type === 'ul')
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ul>
          );
        if (b.type === 'ol')
          return (
            <ol key={i} className="list-decimal space-y-0.5 pl-5">
              {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ol>
          );
        return (
          <p key={i} className="leading-relaxed">
            {b.lines.map((ln, j) => (
              <Fragment key={j}>{renderInline(ln)}{j < b.lines.length - 1 && <br />}</Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

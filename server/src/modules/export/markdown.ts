// Charter narrative fields are stored as markdown-lite (see client/src/lib/markdown.tsx).
// PDF (pdfkit) and Excel render them as plain text, so strip the markers to clean, readable
// prose: bullets become "• ", numbered lists keep their "1." prefix, headings/emphasis markers
// are removed. Plain-text charters (no markers) pass through unchanged.
export function mdToPlain(src: string | null | undefined): string {
  if (!src) return '';
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      let s = line.replace(/^(#{1,3})\s+/, '');          // drop heading markers
      s = s.replace(/^(\s*)[-*]\s+/, '$1• ');            // bullets → •
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)'); // [text](url) → text (url)
      s = s.replace(/\*\*([^*]+)\*\*/g, '$1');           // **bold**
      s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1$2');     // *italic* (not part of **)
      s = s.replace(/\b_([^_]+)_\b/g, '$1');             // _italic_
      return s;
    })
    .join('\n');
}

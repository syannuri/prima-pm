import { useRef, useState, type KeyboardEvent } from 'react';
import type { InputState } from './ui';
import { Markdown } from '../lib/markdown';
import { useLang } from '../context/LanguageContext';

// Markdown-lite editor: a plain <textarea> (value stays plain markdown text — no schema/API
// change) with a toolbar that inserts markdown syntax, keyboard shortcuts, smart list
// continuation, a Write/Preview toggle and a word/char counter. Rendering is done by
// <Markdown> which emits React elements (no HTML injection → no XSS).

const inputBase =
  'w-full rounded-b-lg border border-t-0 bg-white px-3 py-2 text-base sm:text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-1 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500';
const border: Record<InputState, string> = {
  none: 'border-slate-300 focus:border-brand-500 focus:ring-brand-500 dark:border-slate-700',
  valid: 'border-green-500 focus:border-green-500 focus:ring-green-500 dark:border-green-600',
  invalid: 'border-red-400 focus:border-red-400 focus:ring-red-400 dark:border-red-500',
};
const barBorder: Record<InputState, string> = {
  none: 'border-slate-300 dark:border-slate-700',
  valid: 'border-green-500 dark:border-green-600',
  invalid: 'border-red-400 dark:border-red-500',
};

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  state = 'none',
  rows = 4,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  state?: InputState;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [active, setActive] = useState({ bold: false, italic: false });
  const { lang } = useLang();
  const t = (id: string, en: string) => (lang === 'id' ? id : en);

  // Re-apply selection after a programmatic edit so the caret stays where the user expects.
  const apply = (next: string, selStart: number, selEnd: number) => {
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) { el.focus(); el.setSelectionRange(selStart, selEnd); refreshActive(); }
    });
  };

  // Reflect whether the current selection is already wrapped in bold/italic, for a pressed
  // toolbar state. A lightweight boundary check — good enough as a cue, not a full parser.
  const refreshActive = () => {
    const el = ref.current;
    if (!el) return setActive({ bold: false, italic: false });
    const s = el.selectionStart, e = el.selectionEnd;
    const b = value.slice(s - 1, s), a = value.slice(e, e + 1);
    setActive({
      bold: value.slice(s - 2, s) === '**' && value.slice(e, e + 2) === '**',
      italic: (b === '*' && a === '*') || (b === '_' && a === '_'),
    });
  };

  // Wrap the current selection with a marker (bold/italic). With no selection, drops the
  // markers in place and puts the caret between them.
  const wrap = (marker: string) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = value.slice(s, e);
    const next = value.slice(0, s) + marker + sel + marker + value.slice(e);
    apply(next, s + marker.length, e + marker.length);
  };

  // Prefix each line spanned by the selection. `ordered` numbers them 1., 2., …
  const prefixLines = (prefix: string, ordered = false) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = value.indexOf('\n', e);
    if (lineEnd === -1) lineEnd = value.length;
    const segment = value.slice(lineStart, lineEnd);
    const lines = segment.split('\n');
    const out = lines.map((ln, i) => (ordered ? `${i + 1}. ` : prefix) + ln).join('\n');
    const next = value.slice(0, lineStart) + out + value.slice(lineEnd);
    apply(next, lineStart, lineStart + out.length);
  };

  // Insert a [text](url) link around the selection (or a placeholder), caret landing in the URL.
  const insertLink = () => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const label = value.slice(s, e) || t('teks', 'text');
    const url = 'https://';
    const snippet = `[${label}](${url})`;
    const next = value.slice(0, s) + snippet + value.slice(e);
    const urlStart = s + 1 + label.length + 2; // "[" + label + "]("
    apply(next, urlStart, urlStart + url.length);
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = ref.current;
    if (!el) return;
    const meta = ev.ctrlKey || ev.metaKey;
    if (meta && (ev.key === 'b' || ev.key === 'B')) { ev.preventDefault(); return wrap('**'); }
    if (meta && (ev.key === 'i' || ev.key === 'I')) { ev.preventDefault(); return wrap('*'); }
    if (meta && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); return insertLink(); }

    // Smart list continuation: Enter on a list item carries the marker to the next line;
    // Enter on an empty item exits the list (removes the dangling marker).
    if (ev.key === 'Enter' && !ev.shiftKey && el.selectionStart === el.selectionEnd) {
      const s = el.selectionStart;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const line = value.slice(lineStart, s);
      const bullet = /^(\s*)([-*])\s+(.*)$/.exec(line);
      const ordered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
      if (bullet || ordered) {
        ev.preventDefault();
        const rest = (bullet ? bullet[3] : ordered![3]);
        if (rest.trim() === '') {
          // empty item → drop the marker, exit the list
          const next = value.slice(0, lineStart) + value.slice(s);
          return apply(next, lineStart, lineStart);
        }
        const ins = bullet
          ? `\n${bullet[1]}${bullet[2]} `
          : `\n${ordered![1]}${Number(ordered![2]) + 1}. `;
        const next = value.slice(0, s) + ins + value.slice(el.selectionEnd);
        return apply(next, s + ins.length, s + ins.length);
      }
    }
  };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  const Btn = ({ onClick, label, active: on, children }: { onClick: () => void; label: string; active?: boolean; children: React.ReactNode }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onMouseDown={(ev) => ev.preventDefault() /* keep textarea focus/selection */}
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-xs font-medium hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-slate-100 ${on ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/25 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}`}
    >
      {children}
    </button>
  );

  return (
    <div>
      <div className={`flex items-center gap-0.5 rounded-t-lg border bg-slate-50 px-1.5 py-1 dark:bg-slate-900/40 ${barBorder[state]}`}>
        <Btn onClick={() => wrap('**')} label={`${t('Tebal', 'Bold')} (Ctrl+B)`} active={active.bold}><span className="font-bold">B</span></Btn>
        <Btn onClick={() => wrap('*')} label={`${t('Miring', 'Italic')} (Ctrl+I)`} active={active.italic}><span className="italic">I</span></Btn>
        <span className="mx-0.5 h-4 w-px bg-slate-300 dark:bg-slate-700" />
        <Btn onClick={() => prefixLines('- ')} label={t('Poin', 'Bullet list')}>• List</Btn>
        <Btn onClick={() => prefixLines('', true)} label={t('Bernomor', 'Numbered list')}>1. List</Btn>
        <Btn onClick={() => prefixLines('## ')} label={t('Judul', 'Heading')}>H</Btn>
        <Btn onClick={insertLink} label={`${t('Tautan', 'Link')} (Ctrl+K)`}>🔗</Btn>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="ml-auto rounded px-2 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
        >
          {preview ? t('Tulis', 'Write') : t('Pratinjau', 'Preview')}
        </button>
      </div>
      {preview ? (
        <div className={`min-h-[5.5rem] rounded-b-lg border border-t-0 bg-white px-3 py-2 text-sm dark:bg-slate-800 ${border[state]}`}>
          {value.trim()
            ? <Markdown text={value} className="text-slate-700 dark:text-slate-200" />
            : <span className="text-slate-400">{t('Belum ada isi', 'Nothing to preview')}</span>}
        </div>
      ) : (
        <textarea
          ref={ref}
          rows={rows}
          spellCheck
          className={`${inputBase} ${border[state]}`}
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onSelect={refreshActive}
          onClick={refreshActive}
          placeholder={placeholder}
        />
      )}
      <div className="mt-1 flex justify-end gap-3 pr-1 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
        <span>{words} {t('kata', words === 1 ? 'word' : 'words')}</span>
        <span>{value.length} {t('karakter', 'chars')}</span>
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import { Modal, Button, Field, Select } from './ui';
import { api } from '../api/client';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import type { DashboardView } from '../api/types';
import { DEFAULT_WIDGET_ORDER, WIDGET_BY_KEY } from './dashboardWidgets';

// Customize the desktop portfolio dashboard: toggle widgets on/off, drag to reorder, and pick the
// default landing view. Saves to PATCH /auth/preferences and reflects instantly via patchUser.
// Drag-and-drop uses the native HTML5 API (no dependency) — desktop-only, matching the feature scope.
interface Item { key: string; enabled: boolean }

const VIEWS: { value: DashboardView; en: string; id: string }[] = [
  { value: 'portfolio', en: 'Portfolio', id: 'Portfolio' },
  { value: 'forecast', en: 'Forecast', id: 'Forecast' },
  { value: 'resources', en: 'Utilization', id: 'Utilisasi' },
  { value: 'cards', en: 'Project Cards', id: 'Kartu Proyek' },
];

// Reconstruct the editable list from the saved layout: enabled widgets first (in saved order), then
// any remaining widgets as disabled. A null/empty layout → everything enabled in the default order.
function buildItems(layout: string[] | null | undefined): Item[] {
  const enabledOrder = layout && layout.length ? layout.filter((k) => k in WIDGET_BY_KEY) : DEFAULT_WIDGET_ORDER;
  const missing = DEFAULT_WIDGET_ORDER.filter((k) => !enabledOrder.includes(k));
  return [
    ...enabledOrder.map((k) => ({ key: k, enabled: true })),
    ...missing.map((k) => ({ key: k, enabled: !layout || layout.length === 0 })),
  ];
}

export default function CustomizeDashboardModal({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const { user, patchUser } = useAuth();
  const [items, setItems] = useState<Item[]>(() => buildItems(user?.dashboardLayout));
  const [defaultView, setDefaultView] = useState<DashboardView>(user?.dashboardDefaultView ?? 'portfolio');
  const [busy, setBusy] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const move = (from: number, to: number) =>
    setItems((prev) => {
      if (from === to || to < 0 || to >= prev.length) return prev;
      const a = [...prev];
      const [x] = a.splice(from, 1);
      a.splice(to, 0, x);
      return a;
    });
  const toggle = (key: string) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, enabled: !it.enabled } : it)));
  const reset = () => { setItems(DEFAULT_WIDGET_ORDER.map((k) => ({ key: k, enabled: true }))); setDefaultView('portfolio'); };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dashboardLayout = items.filter((it) => it.enabled).map((it) => it.key);
      await api.patch('/auth/preferences', { dashboardLayout, dashboardDefaultView: defaultView });
      patchUser({ dashboardLayout, dashboardDefaultView: defaultView });
      toast.success(id ? 'Dashboard tersimpan.' : 'Dashboard saved.');
      onClose();
    } catch {
      toast.error(id ? 'Gagal menyimpan. Coba lagi.' : "Couldn't save — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={id ? 'Sesuaikan dashboard' : 'Customize dashboard'} size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {id
            ? 'Pilih widget yang tampil dan seret untuk mengurutkan. Hanya berlaku di tampilan desktop.'
            : 'Choose which widgets show and drag to reorder. Applies to the desktop view.'}
        </p>

        <ul className="space-y-1.5">
          {items.map((it, i) => {
            const w = WIDGET_BY_KEY[it.key];
            if (!w) return null;
            return (
              <li
                key={it.key}
                draggable
                onDragStart={() => { dragIndex.current = i; setDragging(i); }}
                onDragOver={(e) => { e.preventDefault(); if (dragIndex.current !== null && dragIndex.current !== i) { move(dragIndex.current, i); dragIndex.current = i; } }}
                onDragEnd={() => { dragIndex.current = null; setDragging(null); }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition ${
                  dragging === i ? 'border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-900/30' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                } ${it.enabled ? '' : 'opacity-60'}`}
              >
                <span className="cursor-grab select-none text-slate-400 active:cursor-grabbing" aria-hidden title={id ? 'Seret untuk mengurutkan' : 'Drag to reorder'}>⠿</span>
                <span className={`min-w-0 flex-1 truncate text-sm ${it.enabled ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through dark:text-slate-500'}`}>
                  {id ? w.id : w.en}
                </span>
                {/* Show/hide toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={it.enabled}
                  aria-label={(id ? 'Tampilkan ' : 'Show ') + (id ? w.id : w.en)}
                  onClick={() => toggle(it.key)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${it.enabled ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${it.enabled ? 'left-[1.125rem]' : 'left-0.5'}`} />
                </button>
              </li>
            );
          })}
        </ul>

        <Field label={id ? 'Tampilan awal' : 'Default view'}>
          <Select value={defaultView} onChange={(e) => setDefaultView(e.target.value as DashboardView)}>
            {VIEWS.map((v) => <option key={v.value} value={v.value}>{id ? v.id : v.en}</option>)}
          </Select>
        </Field>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={reset} disabled={busy}>{id ? 'Setel ulang' : 'Reset'}</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>{id ? 'Batal' : 'Cancel'}</Button>
            <Button onClick={save} disabled={busy}>{busy ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Simpan' : 'Save')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from './ui';

// Promise-based confirm dialog built on the accessible Modal primitive.
// Usage:
//   const confirm = useConfirm();
//   if (!(await confirm({ title, message, confirmLabel, danger: true }))) return;
//   del.mutate(id);

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  // Stable resolver ref so concurrent calls don't strand a promise.
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending({ ...opts, resolve });
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setPending(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal onClose={() => settle(false)} title={pending.title} size="sm">
          <div className="text-sm text-slate-600 dark:text-slate-300">{pending.message}</div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => settle(false)}>
              {pending.cancelLabel ?? 'Cancel'}
            </Button>
            <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
              {pending.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}

import type { ReactNode } from 'react';

// The login-page background canvas — soft blue radial-gradient mesh + floating aurora blobs on a
// full-height centered stage. Reused by the forgot/reset-password pages so the whole auth flow looks
// consistent. (LoginPage keeps its own inline copy to avoid churn on the primary page.)
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-slate-50 px-6 py-6 text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-200">
      {/* Soft blue mesh — layered radial gradients (light mode). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 dark:hidden"
        style={{
          background:
            'radial-gradient(60rem 60rem at 12% 8%, rgba(59,130,246,0.13), transparent 60%),' +
            'radial-gradient(52rem 52rem at 92% 12%, rgba(37,99,235,0.11), transparent 55%),' +
            'radial-gradient(58rem 58rem at 82% 96%, rgba(96,165,250,0.16), transparent 60%),' +
            'radial-gradient(46rem 46rem at 6% 92%, rgba(37,99,235,0.09), transparent 55%)',
        }}
      />
      {/* Floating aurora blobs (both themes; softer in dark). */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-blue-400/20 blur-3xl dark:bg-blue-500/10" />
      <div className="pointer-events-none absolute -bottom-24 left-1/4 h-[30rem] w-[30rem] rounded-full bg-blue-500/15 blur-3xl dark:bg-blue-600/10" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-indigo-300/20 blur-3xl dark:bg-indigo-500/10" />

      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  );
}

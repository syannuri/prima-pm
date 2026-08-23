import { Link } from 'react-router-dom';

// The Prismatix wordmark lockup used on the login page — a bordered box + brand accent dot, centered
// and linking home. Reused on the forgot/reset-password pages for consistent branding.
export default function BrandMark() {
  return (
    <div className="mb-5 flex justify-center">
      <Link to="/" aria-label="Prismatix — home" className="inline-block rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand-400">
        <span className="relative inline-block border-[3px] border-slate-900 px-3.5 py-1.5 font-brand text-xl font-bold tracking-wide text-slate-800 dark:border-white dark:text-slate-100">
          PRISMATIX
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-500" />
        </span>
      </Link>
    </div>
  );
}

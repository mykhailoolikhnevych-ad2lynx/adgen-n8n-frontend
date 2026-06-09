import { useEffect, useState } from 'react';
import { User, BookOpen } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { Column1 } from './columns/Column1';
import { Column2 } from './columns/Column2';
import { Column3 } from './columns/Column3';
import { Column4 } from './columns/Column4';
import { KeywordsPage } from './pages/KeywordsPage';
import { ArticlePage } from './pages/ArticlePage';
import { AnglesPage } from './pages/AnglesPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocsPage } from './pages/DocsPage';
import { TooltipProvider } from './ui/tooltip';
import { getAuthEmail } from '@/lib/identity';

type Page = 'keywords' | 'angles' | 'article' | 'creatives' | 'dashboard' | 'docs';

// Admin Google emails that get the Dashboard tab. Sourced from PUBLIC_ADMIN_EMAILS
// (comma-separated) — value lives in local .env for dev and in Vercel's env vars
// for prod. Never commit real emails to the repo.
const ADMIN_EMAILS: Set<string> = new Set(
  String(import.meta.env.PUBLIC_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@')),
);

const BASE_NAV: { value: Page; label: string }[] = [
  { value: 'keywords', label: 'Keywords' },
  { value: 'angles', label: 'Angles' },
  { value: 'article', label: 'Article' },
  { value: 'creatives', label: 'Creatives' },
];

const ADMIN_NAV: { value: Page; label: string }[] = [
  { value: 'dashboard', label: 'Dashboard' },
];

const formatErrorArg = (a: unknown): string => {
  if (a instanceof Error) return a.message;
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
};

const CreativesPage = () => (
  <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
    <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
      <Column1 />
    </div>
    <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
      <Column2 />
    </div>
    <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
      <Column3 />
    </div>
    <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
      <Column4 />
    </div>
  </div>
);

export default function MainApp() {
  const errorBanner = useAppStore((s) => s.errorBanner);
  const dismissError = useAppStore((s) => s.dismissError);
  const noticeBanner = useAppStore((s) => s.noticeBanner);

  const [page, setPage] = useState<Page>('keywords');

  // Resolve the signed-in email once (Cloudflare Access in prod, PUBLIC_DEV_AUTH_EMAIL locally).
  // Used only to decide whether to render the admin Dashboard tab. Identity lookup is async,
  // so the tab appears once it resolves; non-admins never see it.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    (async () => {
      const ident = await getAuthEmail();
      if (ident?.email && ADMIN_EMAILS.has(ident.email.toLowerCase())) setIsAdmin(true);
    })();
  }, []);

  const NAV_ITEMS = isAdmin ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV;

  useEffect(() => {
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      originalError.apply(console, args as []);
      const message = args.map(formatErrorArg).join(' ').trim();
      if (message) useAppStore.getState().showError(message);
    };

    const onError = (e: ErrorEvent) => {
      useAppStore.getState().showError(e.message || 'Uncaught error');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : formatErrorArg(e.reason);
      useAppStore.getState().showError(`Unhandled promise rejection: ${reason}`);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      console.error = originalError;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return (
    <TooltipProvider>
      <div className="fixed top-0 inset-x-0 z-50 flex flex-col">
        {errorBanner && (
          <div
            role="alert"
            className="bg-red-600 text-white px-4 py-2 shadow-lg flex items-center gap-3"
          >
            <span className="font-semibold shrink-0">Error:</span>
            <span className="flex-1 truncate text-sm">{errorBanner.message}</span>
            {errorBanner.count > 1 && (
              <span className="bg-red-800 rounded px-2 py-0.5 text-xs font-mono shrink-0">
                ×{errorBanner.count}
              </span>
            )}
            <button
              type="button"
              onClick={dismissError}
              aria-label="Dismiss error"
              className="text-white/90 hover:text-white text-2xl leading-none px-2 shrink-0"
            >
              ×
            </button>
          </div>
        )}
        {noticeBanner && (
          <div
            role="status"
            className="bg-orange-500 text-white px-4 py-2 shadow-lg flex items-center gap-3"
          >
            <span className="font-semibold shrink-0">Warning:</span>
            <span className="flex-1 truncate text-sm">{noticeBanner.message}</span>
          </div>
        )}
      </div>

      <div className="flex h-screen w-full flex-col bg-slate-100">
        <header className="flex h-12 shrink-0 items-center justify-between bg-black px-4 text-white">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-7 w-7" aria-hidden="true" />
            <span className="text-base font-bold tracking-wide">MEGATOOL - Make Advertising Great Again</span>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = page === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setPage(item.value)}
                    className={`rounded px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-white text-black'
                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div className="mx-2 h-6 w-px bg-white/30" aria-hidden="true" />

            <button
              type="button"
              aria-label="Profile"
              className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <User size={20} weight="regular" />
            </button>
            <button
              type="button"
              aria-label="Docs"
              aria-current={page === 'docs' ? 'page' : undefined}
              onClick={() => setPage('docs')}
              className={`rounded p-1.5 transition-colors ${
                page === 'docs'
                  ? 'bg-white text-black'
                  : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              <BookOpen size={20} weight="regular" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden">
          {page === 'creatives' && <CreativesPage />}
          {page === 'keywords' && <KeywordsPage />}
          {page === 'angles' && <AnglesPage />}
          {page === 'article' && <ArticlePage />}
          {page === 'dashboard' && isAdmin && <DashboardPage />}
          {page === 'docs' && <DocsPage isAdmin={isAdmin} />}
        </main>
      </div>
    </TooltipProvider>
  );
}

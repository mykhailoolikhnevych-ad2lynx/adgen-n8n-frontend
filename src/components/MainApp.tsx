import { useEffect, useState } from 'react';
import { User, BookOpen, Lightning } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { Column1 } from './columns/Column1';
import { Column2 } from './columns/Column2';
import { Column3 } from './columns/Column3';
import { Column4 } from './columns/Column4';
import { KeywordsPage } from './pages/KeywordsPage';
import { ArticlePage } from './pages/ArticlePage';
import { OfferArticlePage } from './pages/OfferArticlePage';
import { AnglesPage } from './pages/AnglesPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocsPage } from './pages/DocsPage';
import { CreativeGenPage } from './pages/CreativeGenPage';
import { CreativeEditPage } from './pages/CreativeEditPage';
import { MegatoolFBCampaignPage } from './pages/MegatoolFBCampaignPage';
import { MegatoolCreateBinomOfferPage } from './pages/MegatoolCreateBinomOfferPage';
import { TooltipProvider } from './ui/tooltip';
import { getAuthEmail } from '@/lib/identity';

type Page = 'creative-gen' | 'creative-edit' | 'keywords' | 'angles' | 'article' | 'offer-article' | 'creatives' | 'dashboard' | 'docs';

// MEGATOOL — single-tool mode. Each entry is a self-contained "megatool" page;
// when megatool mode is ON we hide the regular pipeline nav and render the
// active megatool here. Adding a second tool = append to this list.
type MegatoolPage = 'fb-campaign-reader' | 'create-binom-offer';
const MEGATOOL_NAV: { value: MegatoolPage; label: string }[] = [
  { value: 'fb-campaign-reader', label: 'FB Campaign Reader' },
];

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
  // "Offer Article" tab is only visible after the operator presses "Create Offer
  // Article" on the Article tab — keeps the nav clean until they actually need it.
  const offerArticleOpen = useAppStore((s) => s.offerArticleOpen);
  const openOfferArticle = useAppStore((s) => s.openOfferArticle);
  const closeOfferArticle = useAppStore((s) => s.closeOfferArticle);
  // MEGATOOL — Create Binom Offer sub-tab visibility. Same nav pattern as
  // Offer Article: hidden until the operator picks an ad and clicks the
  // "→ Create Binom Offer" button in FB Campaign Reader.
  const binomOfferOpen = useAppStore((s) => s.binomOfferOpen);
  const openBinomOffer = useAppStore((s) => s.openBinomOffer);
  const closeBinomOffer = useAppStore((s) => s.closeBinomOffer);
  const selectedFbAd = useAppStore((s) => s.selectedFbAd);

  const [page, setPage] = useState<Page>('keywords');
  // Megatool mode is toggled by clicking the brand text in the header. It
  // owns its own nav and page state; we never touch the regular `page` state
  // while it's on, so toggling back restores exactly where the operator was.
  const [megatool, setMegatool] = useState(false);
  const [megatoolPage, setMegatoolPage] = useState<MegatoolPage>('fb-campaign-reader');

  // If the operator closes the Offer Article tab while it's the active page,
  // bounce them back to the Article tab so we don't render an empty page.
  useEffect(() => {
    if (page === 'offer-article' && !offerArticleOpen) setPage('article');
  }, [page, offerArticleOpen]);

  const handleCreateOffer = () => {
    openOfferArticle();
    setPage('offer-article');
  };

  const handleCloseOffer = () => {
    closeOfferArticle();
    setPage('article');
  };

  // MEGATOOL — Binom sub-tab handlers. Mirrors the Offer Article pattern but in
  // the megatool nav: open jumps to the new sub-tab, close bounces back to FB
  // Campaign Reader so we don't render an empty page.
  const handleOpenBinomOffer = () => {
    openBinomOffer();
    setMegatoolPage('create-binom-offer');
  };
  const handleCloseBinomOffer = () => {
    closeBinomOffer();
    setMegatoolPage('fb-campaign-reader');
  };

  // Auto-close the Binom sub-tab when the selected ad is cleared — mirrors the
  // Offer Article auto-bounce above so the operator never lands on a sub-tab
  // whose data dependency has gone away.
  useEffect(() => {
    if (binomOfferOpen && !selectedFbAd) {
      closeBinomOffer();
      if (megatoolPage === 'create-binom-offer') setMegatoolPage('fb-campaign-reader');
    }
  }, [binomOfferOpen, selectedFbAd, megatoolPage, closeBinomOffer]);

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
          <button
            type="button"
            onClick={() => setMegatool((v) => !v)}
            aria-pressed={megatool}
            title={megatool ? 'Exit Megatool mode' : 'Enter Megatool mode'}
            className="flex items-center gap-2 rounded hover:bg-white/5 px-1 -mx-1 transition-colors"
          >
            <img src="/favicon.svg" alt="" className="h-7 w-7" aria-hidden="true" />
            <span className={`text-base font-bold tracking-wide ${megatool ? 'text-amber-400' : ''}`}>
              MEGATOOL - Make Advertising Great Again
            </span>
            {megatool && <Lightning size={16} weight="fill" className="text-amber-400" aria-hidden="true" />}
          </button>
          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1">
              {megatool ? (
                <>
                  {MEGATOOL_NAV.map((item) => {
                    const isActive = megatoolPage === item.value;
                    const button = (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setMegatoolPage(item.value)}
                        className={`rounded px-3 py-1.5 text-sm transition-colors ${
                          isActive
                            ? 'bg-amber-400 text-black'
                            : 'text-white/80 hover:bg-white/10 hover:text-white'
                        }`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {item.label}
                      </button>
                    );
                    // Inject the dynamic "Create Binom Offer" sub-tab right
                    // after FB Campaign Reader — only appears once the operator
                    // clicked "→ Create Binom Offer" on a selected ad. Has an
                    // inline close (×) that bounces back to the parent tab.
                    if (item.value === 'fb-campaign-reader' && binomOfferOpen) {
                      const isBinomActive = megatoolPage === 'create-binom-offer';
                      return (
                        <span key="fb-with-binom" className="flex items-center">
                          {button}
                          <span
                            className={`ml-1 flex items-center rounded text-sm transition-colors ${
                              isBinomActive
                                ? 'bg-amber-400 text-black'
                                : 'text-white/80 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setMegatoolPage('create-binom-offer')}
                              className="pl-3 pr-1 py-1.5"
                              aria-current={isBinomActive ? 'page' : undefined}
                            >
                              Create Binom Offer
                            </button>
                            <button
                              type="button"
                              onClick={handleCloseBinomOffer}
                              aria-label="Close Create Binom Offer tab"
                              className="pr-2 pl-1 py-1.5 text-xs opacity-70 hover:opacity-100"
                            >
                              ×
                            </button>
                          </span>
                        </span>
                      );
                    }
                    return button;
                  })}
                </>
              ) : (
                <>
              {/* Creative Gen — standalone creative generation, set slightly apart
                  from the pipeline tabs (Keywords → … → Creatives) by a divider. */}
              <button
                type="button"
                onClick={() => setPage('creative-gen')}
                className={`rounded px-3 py-1.5 text-sm transition-colors ${
                  page === 'creative-gen'
                    ? 'bg-white text-black'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
                aria-current={page === 'creative-gen' ? 'page' : undefined}
              >
                Creative Gen
              </button>
              <button
                type="button"
                onClick={() => setPage('creative-edit')}
                className={`rounded px-3 py-1.5 text-sm transition-colors ${
                  page === 'creative-edit'
                    ? 'bg-white text-black'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
                aria-current={page === 'creative-edit' ? 'page' : undefined}
              >
                Creative Edit
              </button>
              <div className="mx-2 h-6 w-px bg-white/30" aria-hidden="true" />
              {NAV_ITEMS.map((item) => {
                const isActive = page === item.value;
                const button = (
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
                // Inject the dynamic "Offer Article" tab right after Article — only
                // appears once openOfferArticle() has fired, has an inline close (×).
                if (item.value === 'article' && offerArticleOpen) {
                  const isOfferActive = page === 'offer-article';
                  return (
                    <span key="article-with-offer" className="flex items-center">
                      {button}
                      <span
                        className={`ml-1 flex items-center rounded text-sm transition-colors ${
                          isOfferActive
                            ? 'bg-white text-black'
                            : 'text-white/80 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setPage('offer-article')}
                          className="pl-3 pr-1 py-1.5"
                          aria-current={isOfferActive ? 'page' : undefined}
                        >
                          Offer Article
                        </button>
                        <button
                          type="button"
                          onClick={handleCloseOffer}
                          aria-label="Close Offer Article tab"
                          className="pr-2 pl-1 py-1.5 text-xs opacity-70 hover:opacity-100"
                        >
                          ×
                        </button>
                      </span>
                    </span>
                  );
                }
                return button;
              })}
                </>
              )}
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
          {megatool ? (
            // Docs icon stays visible in megatool mode, so it can override the
            // megatool page. Otherwise render whichever megatool the operator picked.
            page === 'docs' ? <DocsPage isAdmin={isAdmin} /> : (
              <>
                {megatoolPage === 'fb-campaign-reader' && (
                  <MegatoolFBCampaignPage onOpenBinomOffer={handleOpenBinomOffer} />
                )}
                {megatoolPage === 'create-binom-offer' && binomOfferOpen && (
                  <MegatoolCreateBinomOfferPage onClose={handleCloseBinomOffer} />
                )}
              </>
            )
          ) : (
            <>
              {page === 'creative-gen' && <CreativeGenPage />}
              {page === 'creative-edit' && <CreativeEditPage />}
              {page === 'creatives' && <CreativesPage />}
              {page === 'keywords' && <KeywordsPage />}
              {page === 'angles' && <AnglesPage />}
              {page === 'article' && <ArticlePage onCreateOffer={handleCreateOffer} />}
              {page === 'offer-article' && offerArticleOpen && <OfferArticlePage onClose={handleCloseOffer} />}
              {page === 'dashboard' && isAdmin && <DashboardPage />}
              {page === 'docs' && <DocsPage isAdmin={isAdmin} />}
            </>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

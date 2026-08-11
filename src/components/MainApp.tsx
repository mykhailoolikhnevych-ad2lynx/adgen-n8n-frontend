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
import { MegatoolCreateNbCampaignPage } from './pages/MegatoolCreateNbCampaignPage';
import { TooltipProvider } from './ui/tooltip';
import { getAuthEmail } from '@/lib/identity';

type Page = 'creative-gen' | 'creative-edit' | 'keywords' | 'angles' | 'article' | 'offer-article' | 'creatives' | 'dashboard' | 'docs';

// MEGATOOL — single-tool mode. Each entry is a self-contained "megatool" page;
// when megatool mode is ON we hide the regular pipeline nav and render the
// active megatool here. Adding a second tool = append to this list.
type MegatoolPage = 'fb-campaign-reader' | 'create-binom-offer' | 'create-nb-campaign';
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

// Every page keeps at least part of the operator's work in local component state
// (typed inputs, picked rows, uploaded image, generated batches). Unmounting a
// page on a tab switch throws all of that away, so instead we mount a page the
// first time it's opened and never unmount it — inactive pages are just hidden.
// Nothing renders before its first visit, so app start stays as cheap as before.
const KeepAlive = ({ active, children }: { active: boolean; children: React.ReactNode }) => {
  // "Adjust state during render" — the React-blessed way to derive state from
  // props without an extra render pass.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!visited) return null;
  return <div className={active ? 'h-full' : 'hidden'}>{children}</div>;
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

// Dev-only: expose the Zustand store on window so we can seed state from
// devtools or automated tests. Removed in production builds via Vite's
// import.meta.env.DEV dead-code elimination.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__appStore = useAppStore;
}

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
  const binomOfferResult = useAppStore((s) => s.binomOfferResult);
  // MEGATOOL — Create NB Campaign sub-tab (third sub-tab, gated on binomOfferResult).
  const nbCampaignOpen = useAppStore((s) => s.nbCampaignOpen);
  const openNbCampaign = useAppStore((s) => s.openNbCampaign);
  const closeNbCampaign = useAppStore((s) => s.closeNbCampaign);

  const [page, setPage] = useState<Page>('keywords');
  // Megatool mode is toggled by clicking the brand text in the header. It
  // owns its own nav and page state; we never touch the regular `page` state
  // while it's on, so toggling back restores exactly where the operator was.
  const [megatool, setMegatool] = useState(false);
  const [megatoolPage, setMegatoolPage] = useState<MegatoolPage>('fb-campaign-reader');

  // Selecting a megatool tab must also clear a lingering `page === 'docs'`,
  // otherwise the Docs override in the main render keeps showing after the
  // operator navigates away from Docs via the megatool nav.
  const selectMegatoolPage = (mp: MegatoolPage) => {
    setMegatoolPage(mp);
    if (page === 'docs') setPage('keywords');
  };

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
    closeNbCampaign();
    setMegatoolPage('fb-campaign-reader');
  };

  // MEGATOOL — NB Campaign sub-tab handlers.
  const handleOpenNbCampaign = () => {
    openNbCampaign();
    setMegatoolPage('create-nb-campaign');
  };
  const handleCloseNbCampaign = () => {
    closeNbCampaign();
    setMegatoolPage('create-binom-offer');
  };

  // Auto-close the Binom and NB sub-tabs when their data dependencies disappear.
  // Mirrors the Offer Article auto-bounce so the operator never lands on a tab
  // whose prerequisite is gone.
  useEffect(() => {
    if (nbCampaignOpen && (!selectedFbAd || !binomOfferResult)) {
      closeNbCampaign();
      if (megatoolPage === 'create-nb-campaign') {
        setMegatoolPage(binomOfferOpen ? 'create-binom-offer' : 'fb-campaign-reader');
      }
    }
  }, [nbCampaignOpen, selectedFbAd, binomOfferResult, binomOfferOpen, megatoolPage, closeNbCampaign]);

  useEffect(() => {
    if (binomOfferOpen && !selectedFbAd) {
      closeBinomOffer();
      closeNbCampaign();
      if (megatoolPage === 'create-binom-offer' || megatoolPage === 'create-nb-campaign') {
        setMegatoolPage('fb-campaign-reader');
      }
    }
  }, [binomOfferOpen, selectedFbAd, megatoolPage, closeBinomOffer, closeNbCampaign]);

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

  // The shared prompt library used to be re-fetched by ImageGenSettings on every
  // mount, so a prompt saved in Docs showed up without a hard refresh. Its two
  // hosts (Creative Gen, Creatives) are now kept mounted, so mounting happens once
  // — pull the library on tab entry instead, which keeps the old behaviour.
  useEffect(() => {
    if (megatool) return;
    if (page !== 'creative-gen' && page !== 'creatives') return;
    void useAppStore.getState().loadSavedPrompts();
  }, [page, megatool]);

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
                        onClick={() => selectMegatoolPage(item.value)}
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
                    // Inject dynamic sub-tabs after FB Campaign Reader:
                    // "Create Binom Offer" appears once the operator clicked "→ Create Binom Offer".
                    // "Create NB Campaign" appears after a successful Binom result.
                    if (item.value === 'fb-campaign-reader' && binomOfferOpen) {
                      const isBinomActive = megatoolPage === 'create-binom-offer';
                      const isNbActive = megatoolPage === 'create-nb-campaign';
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
                              onClick={() => selectMegatoolPage('create-binom-offer')}
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
                          {/* Create NB Campaign is now embedded inside the
                              Create Binom Offer tab (rendered inline once the
                              Binom offer succeeds), so no separate nav item. */}
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

        {/* Every page below is wrapped in KeepAlive: it stays mounted once visited,
            so switching tabs (and toggling megatool mode) never discards what the
            operator typed, picked or generated. The `active` expression for each
            page is exactly the condition that used to gate its rendering. */}
        <main className="flex-1 overflow-hidden">
          {/* Docs overrides both modes — the icon stays visible in megatool mode. */}
          <KeepAlive active={page === 'docs'}>
            <DocsPage isAdmin={isAdmin} />
          </KeepAlive>

          {/* Megatool mode */}
          <KeepAlive active={megatool && page !== 'docs' && megatoolPage === 'fb-campaign-reader'}>
            <MegatoolFBCampaignPage onOpenBinomOffer={handleOpenBinomOffer} />
          </KeepAlive>
          {/* Closing the Binom sub-tab (×) means "discard this offer draft", so it
              stays gated on binomOfferOpen — closing still resets the form. */}
          {binomOfferOpen && (
            <KeepAlive
              active={
                megatool && page !== 'docs' &&
                (megatoolPage === 'create-binom-offer' || megatoolPage === 'create-nb-campaign')
              }
            >
              <MegatoolCreateBinomOfferPage onClose={handleCloseBinomOffer} />
            </KeepAlive>
          )}

          {/* Pipeline mode */}
          <KeepAlive active={!megatool && page === 'creative-gen'}>
            <CreativeGenPage />
          </KeepAlive>
          <KeepAlive active={!megatool && page === 'creative-edit'}>
            <CreativeEditPage />
          </KeepAlive>
          <KeepAlive active={!megatool && page === 'creatives'}>
            <CreativesPage />
          </KeepAlive>
          <KeepAlive active={!megatool && page === 'keywords'}>
            <KeywordsPage />
          </KeepAlive>
          <KeepAlive active={!megatool && page === 'angles'}>
            <AnglesPage />
          </KeepAlive>
          <KeepAlive active={!megatool && page === 'article'}>
            <ArticlePage onCreateOffer={handleCreateOffer} />
          </KeepAlive>
          {/* Same as Binom above: the × on the Offer Article tab discards the draft,
              so a new article starts from a form freshly derived from its content. */}
          {offerArticleOpen && (
            <KeepAlive active={!megatool && page === 'offer-article'}>
              <OfferArticlePage onClose={handleCloseOffer} />
            </KeepAlive>
          )}
          {isAdmin && (
            <KeepAlive active={!megatool && page === 'dashboard'}>
              {/* Read-only analytics: filters and sub-tab survive, but the rows are
                  re-fetched on re-entry so the view is never stale. */}
              <DashboardPage active={!megatool && page === 'dashboard'} />
            </KeepAlive>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

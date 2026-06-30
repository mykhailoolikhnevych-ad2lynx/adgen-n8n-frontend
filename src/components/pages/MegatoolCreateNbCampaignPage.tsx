import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { useAppStore, type ArticleStatus, type SelectedFbAd } from '@/store/useAppStore';
import { splitIntoAdsets } from '@/lib/splitIntoAdsets';

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Creating NB Campaign…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

const START_DATE_OPTIONS = [
  { label: 'Now', value: 'now' },
  { label: 'Tomorrow', value: 'tomorrow' },
  { label: 'Tomorrow +1', value: 'tomorrow+1' },
  { label: 'Tomorrow +2', value: 'tomorrow+2' },
] as const;

type StartDate = 'now' | 'tomorrow' | 'tomorrow+1' | 'tomorrow+2';

// NB ad-creation field constraints. brandName 2-25 is confirmed by NB error
// `creative.brandName length must be between 2 and 25`. Other limits are
// conservative defaults — tighten as NB surfaces more validation messages.
const NB_LIMITS = {
  campaignName: { min: 1, max: 200 },
  brandName: { min: 2, max: 25 },
  headline: { min: 1, max: 80 },
  description: { min: 1, max: 150 },
} as const;
type NbLimitKey = keyof typeof NB_LIMITS;

const NB_CTA_OPTIONS = [
  'Learn More', 'Sign Up', 'Shop Now', 'Download', 'Get Quote',
  'Apply Now', 'See More', 'Get Offer', 'Subscribe', 'Contact Us',
  'Book Now', 'Watch More',
] as const;

function lengthError(key: NbLimitKey, value: string): string | null {
  const { min, max } = NB_LIMITS[key];
  const n = value.trim().length;
  if (n < min) return `Min ${min} chars (have ${n})`;
  if (n > max) return `Max ${max} chars (have ${n})`;
  return null;
}

// Pull the human-readable name out of a Binom campaign name like
// "ROAS | Housing Help 2 | US | EN | FB | MarianaTu | ... MEGATOOL 30.06.2026"
// → "Housing Help 2". Drops the leading "ROAS |" if present, then takes the
// first pipe-segment.
function extractBinomCampaignBase(name: string | null | undefined): string {
  if (!name) return '';
  const noRoas = name.replace(/^\s*ROAS\s*\|\s*/i, '');
  const seg = noRoas.match(/^([^|]+)/);
  return (seg ? seg[1] : noRoas).trim();
}

interface Props {
  onClose: () => void;
}

interface AdFormState {
  adId: string;
  headline: string;
  description: string;
}

const CopyableCard = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — ignore
    }
  };
  return (
    <div className="border rounded-lg bg-white p-3 shadow-sm flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-slate-900 break-all flex-1 min-w-0">{value || '—'}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopy}
          disabled={!value}
          className="shrink-0 h-7 text-[11px]"
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
    </div>
  );
};

// Build initial per-ad state from selected FB ads. Headline default = FB
// creativeTitle, description default = FB creativeBody.
function buildInitialAdStates(ads: SelectedFbAd[]): AdFormState[] {
  return ads.map((ad) => ({
    adId: ad.adId,
    headline: ad.creativeTitle ?? '',
    description: ad.creativeBody ?? '',
  }));
}

export const MegatoolCreateNbCampaignPage = ({ onClose }: Props) => {
  const selectedFbAds = useAppStore((s) => s.selectedFbAds);
  const selectedFbAd = selectedFbAds[0] ?? null;
  const binomOfferResult = useAppStore((s) => s.binomOfferResult);
  const status = useAppStore((s) => s.nbCampaignStatus);
  const result = useAppStore((s) => s.nbCampaignResult);
  const error = useAppStore((s) => s.nbCampaignError);
  const createNbCampaign = useAppStore((s) => s.createNbCampaign);
  const resetNbCampaign = useAppStore((s) => s.resetNbCampaign);
  const nbAccountsList = useAppStore((s) => s.nbAccountsList);
  const nbAccountsStatus = useAppStore((s) => s.nbAccountsStatus);
  const nbAccountsError = useAppStore((s) => s.nbAccountsError);
  const fetchNbAccounts = useAppStore((s) => s.fetchNbAccounts);

  useEffect(() => {
    if (nbAccountsStatus === 'idle') void fetchNbAccounts();
  }, [nbAccountsStatus, fetchNbAccounts]);

  const nbAccountNames = useMemo(() => nbAccountsList.map((a) => a.name), [nbAccountsList]);

  const binomCampaignBase = useMemo(
    () => extractBinomCampaignBase(binomOfferResult?.binomCampaignName),
    [binomOfferResult?.binomCampaignName],
  );
  const defaultCampaignName = useMemo(
    () => binomCampaignBase || selectedFbAd?.creativeTitle || selectedFbAd?.adName || '',
    [binomCampaignBase, selectedFbAd],
  );
  const defaultBrandName = useMemo(() => {
    const base = binomCampaignBase || selectedFbAd?.adName || '';
    return `Search | ${base}`.slice(0, NB_LIMITS.brandName.max);
  }, [binomCampaignBase, selectedFbAd]);
  const defaultAdStates = useMemo(() => buildInitialAdStates(selectedFbAds), [selectedFbAds]);

  const [selectedAccountName, setSelectedAccountName] = useState('');
  const [campaignName, setCampaignName] = useState(defaultCampaignName);
  const [brandName, setBrandName] = useState(defaultBrandName);
  const [callToAction, setCallToAction] = useState<string>('Learn More');
  const [budget, setBudget] = useState(10);
  const [startDate, setStartDate] = useState<StartDate>('now');
  const [showRaw, setShowRaw] = useState(false);
  const [adStates, setAdStates] = useState<AdFormState[]>(defaultAdStates);

  // Resync per-ad state if the selection changes after mount (e.g. user added
  // or removed an ad in the FB picker and came back). Keeps already-edited
  // headlines/descriptions for ads still in the selection, fills new entries
  // from their FB creative.
  useEffect(() => {
    setAdStates((prev) => {
      const byId = new Map(prev.map((a) => [a.adId, a]));
      return selectedFbAds.map((ad) => byId.get(ad.adId) ?? {
        adId: ad.adId,
        headline: ad.creativeTitle ?? '',
        description: ad.creativeBody ?? '',
      });
    });
  }, [selectedFbAds]);

  const updateAdField = (adId: string, field: 'headline' | 'description', value: string) => {
    setAdStates((prev) => prev.map((a) => (a.adId === adId ? { ...a, [field]: value } : a)));
  };

  const sharedFieldErrors = {
    campaignName: lengthError('campaignName', campaignName),
    brandName: lengthError('brandName', brandName),
  };
  const perAdErrors: Record<string, { headline: string | null; description: string | null }> = {};
  for (const a of adStates) {
    perAdErrors[a.adId] = {
      headline: lengthError('headline', a.headline),
      description: lengthError('description', a.description),
    };
  }
  const hasSharedErrors = Object.values(sharedFieldErrors).some(Boolean);
  const hasAnyAdError = Object.values(perAdErrors).some(
    (e) => e.headline !== null || e.description !== null,
  );
  const hasFieldErrors = hasSharedErrors || hasAnyAdError;

  const adsetSizes = useMemo(() => splitIntoAdsets(selectedFbAds.length), [selectedFbAds.length]);

  const isLoading = status === 'loading';

  if (!selectedFbAd || !binomOfferResult) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-xl border p-6 shadow-sm text-slate-600 text-sm max-w-md text-center">
          Please complete Create Binom Offer first.
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={onClose}>← Back</Button>
          </div>
        </div>
      </div>
    );
  }

  const selectedAccount = nbAccountsList.find((a) => a.name === selectedAccountName);
  const canSubmit = !isLoading
    && !!selectedAccount
    && !hasFieldErrors
    && budget >= 1
    && selectedFbAds.length >= 1;

  const handleSubmit = () => {
    if (!selectedAccount) return;
    // Pair adStates with selectedFbAds (same order, same length thanks to the
    // resync effect above) to pull each ad's assetUrl.
    const ads = adStates.map((a, i) => ({
      headline: a.headline.trim(),
      body: a.description.trim(),
      assetUrl: selectedFbAds[i]?.thumbnailUrl ?? '',
    }));
    void createNbCampaign({
      nbAccountId: selectedAccount.id,
      campaignName: campaignName.trim(),
      callToAction,
      brandName: brandName.trim(),
      clickThroughUrl: binomOfferResult.binomCampaignUrl,
      budget,
      startDate,
      ads,
      adsetSizes,
    });
  };

  const handleReset = () => {
    resetNbCampaign();
    setSelectedAccountName('');
    setCampaignName(defaultCampaignName);
    setBrandName(defaultBrandName);
    setCallToAction('Learn More');
    setBudget(10);
    setStartDate('now');
    setAdStates(defaultAdStates);
    setShowRaw(false);
  };

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* LEFT — form */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-xl">→ Create NB Campaign</h2>
          <Button variant="outline" size="sm" onClick={onClose}>← Back</Button>
        </div>

        {/* Adset split preview */}
        <section className="mb-5 border rounded-lg bg-blue-50 p-3 text-xs">
          <div className="font-semibold text-blue-900 mb-1">
            {selectedFbAds.length} ad{selectedFbAds.length === 1 ? '' : 's'} → {adsetSizes.length} adset{adsetSizes.length === 1 ? '' : 's'}
          </div>
          <div className="text-blue-800/80 flex flex-wrap gap-1">
            {adsetSizes.map((n, i) => (
              <span key={i} className="bg-white border border-blue-200 rounded px-2 py-0.5">
                Adset {i + 1}: {n} ad{n === 1 ? '' : 's'}
              </span>
            ))}
          </div>
          <div className="text-[10px] text-blue-700/70 mt-1">
            Rule: max 4 ads per adset, balanced. Total spend = budget × {adsetSizes.length}.
          </div>
        </section>

        {/* Shared campaign fields */}
        <section className="space-y-4">
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              NB Account *
              {nbAccountsStatus === 'loading' && <span className="ml-2 text-[10px] text-blue-600 normal-case">loading accounts…</span>}
              {nbAccountsStatus === 'success' && <span className="ml-2 text-[10px] text-slate-400 normal-case">({nbAccountsList.length})</span>}
            </label>
            <Combobox
              value={selectedAccountName}
              onChange={setSelectedAccountName}
              options={nbAccountNames}
              placeholder={nbAccountsStatus === 'loading' ? 'Loading NB accounts…' : 'Type to search 428+ accounts…'}
              inputClassName="text-sm rounded-md bg-white px-2"
              minSearchChars={1}
            />
            {nbAccountsStatus === 'error' && (
              <div className="mt-1 flex items-center gap-2 text-[10px] text-red-600">
                <span>Failed to load NB accounts: {nbAccountsError ?? 'unknown'}</span>
                <button
                  type="button"
                  onClick={() => void fetchNbAccounts()}
                  className="underline hover:no-underline"
                >
                  retry
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
              <span>Campaign Name *</span>
              <span className={`text-[10px] normal-case ${sharedFieldErrors.campaignName ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                {campaignName.trim().length}/{NB_LIMITS.campaignName.max}
              </span>
            </label>
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Campaign name"
              className={sharedFieldErrors.campaignName ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {sharedFieldErrors.campaignName && (
              <div className="mt-1 text-[10px] text-red-600">{sharedFieldErrors.campaignName}</div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
              <span>Brand Name *</span>
              <span className={`text-[10px] normal-case ${sharedFieldErrors.brandName ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                {brandName.trim().length}/{NB_LIMITS.brandName.max} (min {NB_LIMITS.brandName.min})
              </span>
            </label>
            <Input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Brand / advertiser name"
              className={sharedFieldErrors.brandName ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {sharedFieldErrors.brandName && (
              <div className="mt-1 text-[10px] text-red-600">{sharedFieldErrors.brandName}</div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Call To Action *</label>
            <select
              value={callToAction}
              onChange={(e) => setCallToAction(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {NB_CTA_OPTIONS.map((cta) => (
                <option key={cta} value={cta}>{cta}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Budget (USD/day, per adset) *</label>
            <Input
              type="number"
              min={1}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              placeholder="10"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Each of the {adsetSizes.length} adset{adsetSizes.length === 1 ? '' : 's'} gets ${budget}/day → total ${budget * adsetSizes.length}/day.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Start Date</label>
            <select
              value={startDate}
              onChange={(e) => setStartDate(e.target.value as StartDate)}
              className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {START_DATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </section>

        {/* Per-ad cards */}
        <section className="mt-6 space-y-3">
          <h3 className="font-bold text-sm uppercase tracking-wide text-slate-700">
            Ads ({adStates.length})
          </h3>
          {adStates.map((adState, i) => {
            const fbAd = selectedFbAds[i];
            const adsetNum = (() => {
              let consumed = 0;
              for (let j = 0; j < adsetSizes.length; j++) {
                consumed += adsetSizes[j];
                if (i < consumed) return j + 1;
              }
              return adsetSizes.length;
            })();
            const errs = perAdErrors[adState.adId] ?? { headline: null, description: null };
            return (
              <div key={adState.adId} className="border rounded-lg bg-slate-50 p-3 space-y-2">
                <header className="flex items-center gap-2 text-xs">
                  <span className="bg-blue-100 text-blue-800 font-bold rounded px-1.5 py-0.5 shrink-0">
                    #{i + 1}
                  </span>
                  <span className="bg-slate-200 text-slate-700 rounded px-1.5 py-0.5 shrink-0">
                    Adset {adsetNum}
                  </span>
                  {fbAd?.thumbnailUrl && (
                    <img src={fbAd.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                  )}
                  <span className="text-slate-700 font-medium truncate flex-1 min-w-0" title={fbAd?.adName}>
                    {fbAd?.adName ?? '(removed)'}
                  </span>
                </header>

                <div>
                  <label className="text-[10px] font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
                    <span>Headline *</span>
                    <span className={`normal-case ${errs.headline ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                      {adState.headline.trim().length}/{NB_LIMITS.headline.max}
                    </span>
                  </label>
                  <Input
                    value={adState.headline}
                    onChange={(e) => updateAdField(adState.adId, 'headline', e.target.value)}
                    placeholder="Ad headline"
                    className={errs.headline ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  />
                  {errs.headline && <div className="mt-1 text-[10px] text-red-600">{errs.headline}</div>}
                </div>

                <div>
                  <label className="text-[10px] font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
                    <span>Description *</span>
                    <span className={`normal-case ${errs.description ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                      {adState.description.trim().length}/{NB_LIMITS.description.max}
                    </span>
                  </label>
                  <textarea
                    value={adState.description}
                    onChange={(e) => updateAdField(adState.adId, 'description', e.target.value)}
                    rows={2}
                    placeholder="Ad description / body text"
                    className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none ${errs.description ? 'border-red-500 focus:ring-red-500' : 'border-input'}`}
                  />
                  {errs.description && <div className="mt-1 text-[10px] text-red-600">{errs.description}</div>}
                </div>
              </div>
            );
          })}
        </section>

        <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
          <Button onClick={handleSubmit} disabled={!canSubmit} className="flex-1">
            {isLoading ? 'Creating…' : `Create NB Campaign (${adsetSizes.length} adset${adsetSizes.length === 1 ? '' : 's'}, ${adStates.length} ad${adStates.length === 1 ? '' : 's'})`}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={isLoading}>
            Reset
          </Button>
        </div>
      </div>

      {/* RIGHT — status + results */}
      <div className="w-[28rem] shrink-0 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <h2 className="font-bold text-xl mb-2 shrink-0">Result</h2>

        <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center justify-between shrink-0">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Status:</span>
            {isLoading && (
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"
              />
            )}
            <span className={`font-medium ${STATUS_COLOR[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto mt-3 space-y-3">
          {status === 'idle' && (
            <div className="text-slate-400 italic text-sm">
              Fill the form and press Create NB Campaign. Results appear here.
            </div>
          )}
          {status === 'loading' && (
            <div className="text-slate-600 text-sm">Creating NB campaign — usually 10–60s.</div>
          )}
          {status === 'error' && (
            <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md whitespace-pre-wrap">
              <div className="font-semibold mb-1">Error</div>
              {error ?? 'Unknown error'}
            </div>
          )}
          {status === 'success' && result && (
            <>
              <CopyableCard label="NB Account ID" value={result.nbAccountId} />
              <CopyableCard label="Campaign ID" value={result.campaignId} />
              {result.adsetIds.length > 0 && (
                <CopyableCard
                  label={`Adset ID${result.adsetIds.length > 1 ? 's' : ''} (${result.adsetIds.length})`}
                  value={result.adsetIds.join(', ')}
                />
              )}
              {result.adIds.length > 0 && (
                <CopyableCard
                  label={`Ad ID${result.adIds.length > 1 ? 's' : ''} (${result.adIds.length})`}
                  value={result.adIds.join(', ')}
                />
              )}
              {result.campaignName && (
                <CopyableCard label="Campaign Name" value={result.campaignName} />
              )}

              <div className="border rounded-lg bg-slate-50">
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center justify-between"
                >
                  <span>Raw response</span>
                  <span className="text-slate-400">{showRaw ? '▾' : '▸'}</span>
                </button>
                {showRaw && (
                  <pre className="px-3 pb-3 text-[10px] font-mono whitespace-pre-wrap break-all text-slate-700">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

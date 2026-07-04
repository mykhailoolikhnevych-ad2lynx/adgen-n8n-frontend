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
  { label: 'Зараз', value: 'now' },
  { label: 'Завтра', value: 'tomorrow' },
  { label: 'Післязавтра', value: 'tomorrow+1' },
  { label: 'Через 3 дні', value: 'tomorrow+2' },
] as const;

type StartDate = 'now' | 'tomorrow' | 'tomorrow+1' | 'tomorrow+2';
type StartTimezone = 'PDT' | 'EEST';

// Flip to true when the n8n workflow supports body.startTimezone again. The
// dropdown + payload field are ready to go — this flag just gates visibility
// and whether we ship the field over the wire.
const TIMEZONE_PICKER_ENABLED = true;

const TIMEZONE_OPTIONS: Array<{ value: StartTimezone; label: string }> = [
  { value: 'PDT', label: 'PDT (Los Angeles, UTC-7)' },
  { value: 'EEST', label: 'EEST (Kyiv, UTC+3)' },
];

// NB ad-creation field constraints. brandName 2-25 is confirmed by NB error
// `creative.brandName length must be between 2 and 25`. Other limits are
// conservative defaults — tighten as NB surfaces more validation messages.
const NB_LIMITS = {
  campaignName: { min: 1, max: 200 },
  brandName: { min: 2, max: 25 },
  headline: { min: 1, max: 90 },
  description: { min: 1, max: 90 },
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
  /** When true, render only the form + result columns (no outer bg-slate-100
   *  wrapper, no back button, no h2). Used when the Binom page embeds this
   *  page inline so the operator sees both flows on one screen. */
  embedded?: boolean;
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

export const MegatoolCreateNbCampaignPage = ({ onClose, embedded = false }: Props) => {
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
  const nbEvents = useAppStore((s) => s.nbEvents);
  const nbEventsStatus = useAppStore((s) => s.nbEventsStatus);
  const nbEventsError = useAppStore((s) => s.nbEventsError);
  const nbEventsAccountId = useAppStore((s) => s.nbEventsAccountId);
  const fetchNbEvents = useAppStore((s) => s.fetchNbEvents);

  useEffect(() => {
    if (nbAccountsStatus === 'idle') void fetchNbAccounts();
  }, [nbAccountsStatus, fetchNbAccounts]);

  // ROAS is chosen upstream on the Binom Offer page; we detect it from the
  // "ROAS |" prefix that the Binom workflow prepends to the campaign name.
  // Determines which conversion event to auto-pick for trackingId.
  const isRoas = binomOfferResult?.binomCampaignName?.startsWith('ROAS |') ?? false;
  const wantedEventType = isRoas ? 'complete_payment' : 'click_button';

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

  // Form state hoisted to the store so tab-switches don't wipe user picks.
  // Empty-string campaignName/brandName means "not yet touched" — we fall
  // back to the derived defaults below at render time and seed on first mount.
  const nbForm = useAppStore((s) => s.megatoolNbForm);
  const setNbForm = useAppStore((s) => s.setNbForm);
  const resetNbForm = useAppStore((s) => s.resetNbForm);
  const selectedAccountName = nbForm.selectedAccountName;
  const campaignName = nbForm.campaignName || defaultCampaignName;
  const brandName = nbForm.brandName || defaultBrandName;
  const callToAction = nbForm.callToAction;
  const budget = nbForm.budget;
  const roasPercent = nbForm.roasPercent;
  const bidType = nbForm.bidType;
  const targetCpaDollars = nbForm.targetCpaDollars;
  const manualEventId = nbForm.manualEventId;
  const startDate = nbForm.startDate;
  const startTimezone = nbForm.startTimezone;
  const adStates = nbForm.adStates;
  const setSelectedAccountName = (v: string) => setNbForm({ selectedAccountName: v });
  const setCampaignName = (v: string) => setNbForm({ campaignName: v });
  const setBrandName = (v: string) => setNbForm({ brandName: v });
  const setCallToAction = (v: string) => setNbForm({ callToAction: v });
  const setBudget = (v: number) => setNbForm({ budget: v });
  const setRoasPercent = (v: number) => setNbForm({ roasPercent: v });
  const setBidType = (v: 'MAX_CONVERSION' | 'TARGET_CPA' | 'TARGET_ROAS') => setNbForm({ bidType: v });
  const setTargetCpaDollars = (v: number) => setNbForm({ targetCpaDollars: v });
  const setManualEventId = (v: string | null) => setNbForm({ manualEventId: v });
  const setStartDate = (v: StartDate) => setNbForm({ startDate: v });
  const setStartTimezone = (v: StartTimezone) => setNbForm({ startTimezone: v });
  const setAdStates = (
    updater: AdFormState[] | ((prev: AdFormState[]) => AdFormState[]),
  ) => setNbForm({
    adStates: typeof updater === 'function'
      ? (updater as (p: AdFormState[]) => AdFormState[])(nbForm.adStates)
      : updater,
  });
  const [showRaw, setShowRaw] = useState(false);

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
    // In embedded mode the parent Binom page already handles the "no result
    // yet" case (it hides this component until binomOfferResult exists), so
    // we render nothing to avoid a duplicate empty-state card.
    if (embedded) return null;
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-xl border p-6 shadow-sm text-slate-600 text-sm max-w-md text-center">
          Спочатку заверши Create Binom Offer.
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={onClose}>← Назад</Button>
          </div>
        </div>
      </div>
    );
  }

  const selectedAccount = nbAccountsList.find((a) => a.name === selectedAccountName);

  // When the operator picks an account, pull that account's conversion
  // events so we can auto-select the right trackingId (click_button vs
  // complete_payment) based on ROAS. Fires only when the id actually changes.
  useEffect(() => {
    if (selectedAccount?.id && selectedAccount.id !== nbEventsAccountId) {
      void fetchNbEvents(selectedAccount.id);
      // New account → drop any manual override so the auto-pick takes over.
      setManualEventId(null);
    }
  }, [selectedAccount?.id, nbEventsAccountId, fetchNbEvents]);

  // Pick the event whose eventType matches the ROAS/non-ROAS choice.
  // Fallback: first event returned by NB.
  const autoPickedEvent = useMemo(() => {
    if (!nbEvents || nbEvents.length === 0) return null;
    const match = nbEvents.find((e) => e.eventType === wantedEventType);
    return match ?? nbEvents[0] ?? null;
  }, [nbEvents, wantedEventType]);

  // Effective event = manual override if set (and still valid), else auto.
  const pickedEvent = useMemo(() => {
    if (manualEventId && nbEvents) {
      const found = nbEvents.find((e) => e.id === manualEventId);
      if (found) return found;
    }
    return autoPickedEvent;
  }, [manualEventId, nbEvents, autoPickedEvent]);
  const isManualOverride = !!manualEventId && pickedEvent?.id === manualEventId
    && pickedEvent.id !== autoPickedEvent?.id;

  // Bid type ↔ event coupling. TARGET_ROAS is only valid when the picked event
  // supports revenue signals (complete_payment). If the operator switches to a
  // click-only event while TARGET_ROAS was selected, downgrade to MAX_CONVERSION
  // rather than silently sending an invalid combination to NB.
  const pickedEventSupportsRoas = pickedEvent?.eventType === 'complete_payment';
  useEffect(() => {
    if (!pickedEventSupportsRoas && bidType === 'TARGET_ROAS') {
      setBidType('MAX_CONVERSION');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedEventSupportsRoas]);

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
      adName: selectedFbAds[i]?.adName || '',
      headline: a.headline.trim(),
      body: a.description.trim(),
      // Use the resolved asset URL (video .mp4 when source ad is a video,
      // otherwise the thumbnail). NB's getCreativeType auto-detects VIDEO.
      assetUrl: selectedFbAds[i]?.assetUrl || selectedFbAds[i]?.thumbnailUrl || '',
    }));
    void createNbCampaign({
      nbAccountId: selectedAccount.id,
      campaignName: campaignName.trim(),
      callToAction,
      brandName: brandName.trim(),
      clickThroughUrl: binomOfferResult.binomCampaignUrl,
      budget,
      startDate,
      // Only include when the picker is enabled — old n8n workflow doesn't
      // read this field and shouldn't get a spurious default.
      ...(TIMEZONE_PICKER_ENABLED ? { startTimezone } : {}),
      // Conversion event resolved from the account; workflow falls back to
      // DEFAULT_TRACKING_ID when this is missing.
      ...(pickedEvent?.id ? { trackingId: pickedEvent.id } : {}),
      // Bid strategy is now driven entirely by the local bidType picker (no
      // more Binom-side isRoas coupling). Workflow priority: TARGET_ROAS if
      // roas > 0, else TARGET_CPA if bidRate > 0, else MAX_CONVERSION.
      bidType,
      ...(bidType === 'TARGET_ROAS' && roasPercent > 0
        ? { roas: roasPercent / 100 }
        : {}),
      ...(bidType === 'TARGET_CPA' && targetCpaDollars > 0
        ? { bidRate: Math.round(targetCpaDollars * 100) }
        : {}),
      ads,
      adsetSizes,
    });
  };

  const handleReset = () => {
    resetNbCampaign();
    resetNbForm();
    // Re-seed the per-ad rows from the current FB selection so the form is
    // immediately usable after reset.
    setNbForm({ adStates: defaultAdStates });
    setShowRaw(false);
  };

  return (
    <div className={embedded
      ? 'flex w-full gap-4'
      : 'flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden'}
    >
      {/* LEFT — form */}
      <div className={embedded
        ? 'flex-1 bg-white rounded-xl border p-4 shadow-sm'
        : 'flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm'}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-xl">→ Create NB Campaign</h2>
          {!embedded && (
            <Button variant="outline" size="sm" onClick={onClose}>← Назад</Button>
          )}
        </div>

        {/* Adset split preview */}
        <section className="mb-5 border rounded-lg bg-blue-50 p-3 text-sm">
          <div className="font-semibold text-blue-900 mb-1">
            {selectedFbAds.length} ad{selectedFbAds.length === 1 ? '' : 's'} → {adsetSizes.length} adset{adsetSizes.length === 1 ? '' : 's'}
          </div>
          <div className="text-blue-800/80 flex flex-wrap gap-1">
            {adsetSizes.map((n, i) => (
              <span key={i} className="bg-white border border-blue-200 rounded px-2 py-0.5 text-xs">
                Adset {i + 1}: {n} ad{n === 1 ? '' : 's'}
              </span>
            ))}
          </div>
          <div className="text-xs text-blue-800 mt-1">
            Максимум 4 оголошення на адсет — розподіляються рівномірно.
            Загальний денний бюджет = budget × {adsetSizes.length}.
          </div>
        </section>

        {/* Shared campaign fields */}
        <section className="space-y-4">
          {!embedded && (
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              NB Account *
              {nbAccountsStatus === 'loading' && <span className="ml-2 text-xs text-blue-600 normal-case">loading accounts…</span>}
              {nbAccountsStatus === 'success' && <span className="ml-2 text-xs text-slate-400 normal-case">({nbAccountsList.length})</span>}
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
              <div className="mt-1 flex items-center gap-2 text-xs text-red-600">
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

            {selectedAccount && (
              <div className="mt-2 border rounded-md bg-slate-50 p-2 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold uppercase tracking-wide text-slate-500">
                    Tracking event
                  </span>
                  <span className="flex items-center gap-1">
                    {isManualOverride && (
                      <span className="text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 bg-amber-100 text-amber-800">
                        Manual
                      </span>
                    )}
                    <span className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 ${isRoas ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                      {isRoas ? 'ROAS → complete_payment' : 'click_button'}
                    </span>
                  </span>
                </div>
                {nbEventsStatus === 'loading' && (
                  <div className="text-slate-500 italic">Завантажую події акаунту…</div>
                )}
                {nbEventsStatus === 'error' && (
                  <div className="text-red-600">
                    Не вдалося завантажити події: {nbEventsError ?? 'unknown'}{' '}
                    <button
                      type="button"
                      onClick={() => void fetchNbEvents(selectedAccount.id)}
                      className="underline hover:no-underline"
                    >
                      повторити
                    </button>
                  </div>
                )}
                {nbEventsStatus === 'success' && (!nbEvents || nbEvents.length === 0) && (
                  <div className="text-amber-700">
                    В акаунті немає подій — використаю fallback trackingId на сервері.
                  </div>
                )}
                {nbEventsStatus === 'success' && nbEvents && nbEvents.length > 0 && (
                  <div className="space-y-1">
                    <select
                      value={pickedEvent?.id ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        // If they picked the auto-pick again, clear the manual
                        // override so the badge goes back to blue/purple.
                        setManualEventId(val === autoPickedEvent?.id ? null : val);
                      }}
                      className="w-full rounded-md border border-input bg-white px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {nbEvents.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                          {e.eventType ? ` · ${e.eventType}` : ''}
                          {e.id === autoPickedEvent?.id ? ' (auto)' : ''}
                        </option>
                      ))}
                    </select>
                    {pickedEvent && (
                      <div className="font-mono text-[11px] text-slate-500 break-all">
                        id: {pickedEvent.id}
                        {pickedEvent.eventType && (
                          <> · type: <code>{pickedEvent.eventType}</code></>
                        )}
                      </div>
                    )}
                    {pickedEvent && autoPickedEvent
                      && pickedEvent.id === autoPickedEvent.id
                      && autoPickedEvent.eventType !== wantedEventType && (
                      <div className="text-[10px] text-amber-700">
                        Fallback: в акаунті немає події з <code>{wantedEventType}</code>,
                        обрано першу доступну.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          )}

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
              placeholder="Назва кампанії"
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
              placeholder="Назва бренду / рекламодавця"
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
            <p className="text-xs text-slate-600 mt-1">
              Кожен з {adsetSizes.length} адсет{adsetSizes.length === 1 ? 'а' : 'ів'} отримує ${budget}/день → разом ${budget * adsetSizes.length}/день.
            </p>
          </div>

          {!embedded && (
          <div>
            <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
              <span>Bid Type *</span>
              {!pickedEventSupportsRoas && (
                <span className="text-[10px] normal-case text-slate-400">
                  TARGET_ROAS доступний лише для <code>complete_payment</code>
                </span>
              )}
            </label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setBidType('MAX_CONVERSION')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                  bidType === 'MAX_CONVERSION'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                    : 'border-input bg-white hover:bg-slate-50'
                }`}
              >
                Max Conversions
              </button>
              <button
                type="button"
                onClick={() => setBidType('TARGET_CPA')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                  bidType === 'TARGET_CPA'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                    : 'border-input bg-white hover:bg-slate-50'
                }`}
              >
                Target CPA
              </button>
              {pickedEventSupportsRoas && (
                <button
                  type="button"
                  onClick={() => setBidType('TARGET_ROAS')}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                    bidType === 'TARGET_ROAS'
                      ? 'border-purple-600 bg-purple-50 text-purple-900 font-semibold'
                      : 'border-input bg-white hover:bg-slate-50'
                  }`}
                >
                  Target ROAS
                </button>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              <code>MAX_CONVERSION</code> — NB сам обирає ставку.{' '}
              <code>TARGET_CPA</code> — задаєш ціну за конверсію.{' '}
              {pickedEventSupportsRoas && <><code>TARGET_ROAS</code> — задаєш цільовий ROAS у %.</>}
            </p>
          </div>
          )}

          {!embedded && bidType === 'TARGET_CPA' && (
            <div>
              <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
                <span>Bid Rate (Target CPA, USD) *</span>
                <span className="text-[10px] normal-case text-blue-700 font-semibold">
                  NB отримає bidRate у центах
                </span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">$</span>
                <Input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={targetCpaDollars}
                  onChange={(e) => setTargetCpaDollars(Number(e.target.value))}
                  placeholder="5"
                  className="pl-6"
                />
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Цільова ціна за одну конверсію. Напр. <strong>$5.00</strong> → NB отримає{' '}
                <code>bidRate={Math.round(targetCpaDollars * 100)}</code> (центи).
              </p>
            </div>
          )}

          {!embedded && bidType === 'TARGET_ROAS' && (
            <div>
              <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
                <span>ROAS Target (%) *</span>
                <span className="text-[10px] normal-case text-purple-700 font-semibold">
                  bidType: TARGET_ROAS
                </span>
              </label>
              <div className="relative">
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={roasPercent}
                  onChange={(e) => setRoasPercent(Number(e.target.value))}
                  placeholder="120"
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Цільовий ROAS у відсотках → NB отримає <code>roas={(roasPercent / 100).toFixed(2)}</code>.
                Напр. <strong>120%</strong> = повертати $1.20 за кожен $1 витрати.
              </p>
            </div>
          )}

          <div className={TIMEZONE_PICKER_ENABLED ? 'flex gap-2' : ''}>
            <div className={TIMEZONE_PICKER_ENABLED ? 'flex-1' : ''}>
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
            {TIMEZONE_PICKER_ENABLED && (
              <div className="flex-1">
                <label className="text-xs font-medium uppercase text-slate-500">Timezone</label>
                <select
                  value={startTimezone}
                  onChange={(e) => setStartTimezone(e.target.value as StartTimezone)}
                  disabled={startDate === 'now'}
                  className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {TIMEZONE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {startDate !== 'now' && (
                  <p className="text-xs text-slate-600 mt-1">
                    {startTimezone === 'PDT' ? (
                      <>Старт о <strong>00:00 PDT</strong> обраного дня (≈ 10:00 Kyiv того ж дня).</>
                    ) : (
                      <>Старт о <strong>14:00 PDT</strong> обраного дня (≈ 00:00 Kyiv наступного дня).</>
                    )}
                  </p>
                )}
              </div>
            )}
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
                  {fbAd?.mediaKind === 'video' && (
                    <span className="bg-purple-600 text-white text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0">▶ Video</span>
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
                    placeholder="Заголовок оголошення"
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
                    placeholder="Опис оголошення"
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

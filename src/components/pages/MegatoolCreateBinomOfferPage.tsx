import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { useAppStore, type ArticleStatus } from '@/store/useAppStore';
import {
  BINOM_AMO_DOMAINS,
  BINOM_TRACKERS,
  DEFAULT_BINOM_TRACKER,
  getGroupNamesForTracker,
  getTrackerFromTrackingUrl,
} from '@/lib/binomGroups';
import { MegatoolCreateNbCampaignPage } from './MegatoolCreateNbCampaignPage';
import { MegatoolCreateTtCampaignPage } from './MegatoolCreateTtCampaignPage';

// Kept in sync with the NB page's own constant list. When the two pages merge
// fully these will consolidate; for now duplicated so the pre-Binom bid-type
// picker knows the labels without importing from the NB page.
type NbBidType = 'MAX_CONVERSION' | 'TARGET_CPA' | 'TARGET_ROAS';

const TT_PIXELS = [
  { name: 'GenOst', code: 'D7G9EPRC77U62Q87BP70' },
];

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Creating Binom offer…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

interface MegatoolCreateBinomOfferPageProps {
  onClose: () => void;
  /** Legacy prop from the old nav-based two-tab flow. Retained as optional so
   *  older call sites still compile; the merged page renders the NB flow
   *  inline once binomOfferResult is available. */
  onOpenNbCampaign?: () => void;
}

const CopyableCard = ({ label, value, isLink }: { label: string; value: string; isLink?: boolean }) => {
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
        {isLink && value ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-blue-600 hover:underline break-all flex-1 min-w-0"
            title={value}
          >
            {value}
          </a>
        ) : (
          <span className="font-mono text-xs text-slate-900 break-all flex-1 min-w-0">{value || '—'}</span>
        )}
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

export const MegatoolCreateBinomOfferPage = ({ onClose, onOpenNbCampaign }: MegatoolCreateBinomOfferPageProps) => {
  const selectedFbAd = useAppStore((s) => s.selectedFbAd);
  const status = useAppStore((s) => s.binomOfferStatus);
  const result = useAppStore((s) => s.binomOfferResult);
  const error = useAppStore((s) => s.binomOfferError);
  const createBinomOffer = useAppStore((s) => s.createBinomOffer);
  const resetBinomOffer = useAppStore((s) => s.resetBinomOffer);

  const detectedTracker = useMemo(
    () => getTrackerFromTrackingUrl(selectedFbAd?.trackingUrl),
    [selectedFbAd?.trackingUrl],
  );
  // Form state is stored globally so switching tabs mid-flow doesn't wipe
  // the operator's group / channel / tracker / etc. picks.
  const form = useAppStore((s) => s.megatoolBinomForm);
  const setBinomForm = useAppStore((s) => s.setBinomForm);
  const resetBinomForm = useAppStore((s) => s.resetBinomForm);
  const { tracker, trackerAutoSet, newAmoDomain, newAmoChannel, newBinomGroup, isRoas, binomCampaignName, destination, ttPixelCode } = form;
  const setTracker = (v: string) => setBinomForm({ tracker: v });
  const setTrackerAutoSet = (v: boolean) => setBinomForm({ trackerAutoSet: v });
  const setNewAmoDomain = (v: string) => setBinomForm({ newAmoDomain: v });
  const setNewAmoChannel = (v: string) => setBinomForm({ newAmoChannel: v });
  const setNewBinomGroup = (v: string) => setBinomForm({ newBinomGroup: v });
  const setIsRoas = (v: boolean) => setBinomForm({ isRoas: v });
  const setBinomCampaignName = (v: string) => setBinomForm({ binomCampaignName: v });
  const setTtPixelCode = (v: string) => setBinomForm({ ttPixelCode: v.trim() });

  // Seed tracker from auto-detect on first mount if nothing's been set.
  useEffect(() => {
    if (!trackerAutoSet && !tracker) {
      setBinomForm({ tracker: detectedTracker ?? DEFAULT_BINOM_TRACKER });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (destination === 'TT' && !ttPixelCode) {
      setBinomForm({ ttPixelCode: TT_PIXELS[0].code });
    }
  }, [destination, ttPixelCode, setBinomForm]);

  const [showRaw, setShowRaw] = useState(false);

  // When the source ad changes (and the URL maps cleanly to a tracker), snap
  // the dropdown to that tracker and reset the group. User can still override.
  useEffect(() => {
    if (detectedTracker && detectedTracker !== tracker) {
      setTracker(detectedTracker);
      setTrackerAutoSet(true);
      setNewBinomGroup('same');
    }
  }, [detectedTracker]);

  const binomGroupOptions = useMemo(() => getGroupNamesForTracker(tracker), [tracker]);

  // ── NB pre-Binom state (Account + Tracking Event + Bid Type + CPA + ROAS)
  // Lives in the shared store so the NB embedded section below reads the same
  // values without duplication. bidType being TARGET_ROAS is the new single
  // source of truth for "this is a ROAS run" — no more Binom checkbox.
  const nbForm = useAppStore((s) => s.megatoolNbForm);
  const setNbForm = useAppStore((s) => s.setNbForm);
  const nbAccountsList = useAppStore((s) => s.nbAccountsList);
  const nbAccountsStatus = useAppStore((s) => s.nbAccountsStatus);
  const nbAccountsError = useAppStore((s) => s.nbAccountsError);
  const fetchNbAccounts = useAppStore((s) => s.fetchNbAccounts);
  const nbEvents = useAppStore((s) => s.nbEvents);
  const nbEventsStatus = useAppStore((s) => s.nbEventsStatus);
  const nbEventsError = useAppStore((s) => s.nbEventsError);
  const nbEventsAccountId = useAppStore((s) => s.nbEventsAccountId);
  const fetchNbEvents = useAppStore((s) => s.fetchNbEvents);
  const {
    selectedAccountName,
    bidType,
    targetCpaDollars,
    roasPercent,
    manualEventId,
  } = nbForm;
  const setSelectedAccountName = (v: string) => setNbForm({ selectedAccountName: v });
  const setBidType = (v: NbBidType) => setNbForm({ bidType: v });
  const setTargetCpaDollars = (v: number) => setNbForm({ targetCpaDollars: v });
  const setRoasPercent = (v: number) => setNbForm({ roasPercent: v });
  const setManualEventId = (v: string | null) => setNbForm({ manualEventId: v });

  // Local text state for CPA/ROAS so operators can type both "." and ","
  // as decimal separators. HTML type="number" rejects commas, so these
  // inputs use type="text" + inputMode="decimal"; the string is normalized
  // to a dot before parsing to the store's number.
  const [cpaText, setCpaText] = useState<string>(String(targetCpaDollars));
  const [roasText, setRoasText] = useState<string>(
    roasPercent === 0 ? '' : String(roasPercent),
  );
  // Re-sync local text when the store changes from outside (e.g. form reset).
  useEffect(() => {
    if (Number((cpaText || '0').replace(',', '.')) !== targetCpaDollars) {
      setCpaText(String(targetCpaDollars));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCpaDollars]);
  useEffect(() => {
    if (Number((roasText || '0').replace(',', '.')) !== roasPercent) {
      setRoasText(roasPercent === 0 ? '' : String(roasPercent));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roasPercent]);

  const nbAccountNames = useMemo(() => nbAccountsList.map((a) => a.name), [nbAccountsList]);
  const selectedAccount = nbAccountsList.find((a) => a.name === selectedAccountName);

  useEffect(() => {
    if (nbAccountsStatus === 'idle') void fetchNbAccounts();
  }, [nbAccountsStatus, fetchNbAccounts]);

  // Fetch events for the chosen account; drop any manual override so the
  // auto-pick kicks in for the new account.
  useEffect(() => {
    if (selectedAccount?.id && selectedAccount.id !== nbEventsAccountId) {
      void fetchNbEvents(selectedAccount.id);
      setNbForm({ manualEventId: null });
    }
  }, [selectedAccount?.id, nbEventsAccountId, fetchNbEvents]);

  // Initial default: click_button (lightweight event) if the account exposes
  // one, else the first event. Only used until the operator (or the ROAS
  // effect below) sets a manual override.
  const autoPickedEvent = useMemo(() => {
    if (!nbEvents || nbEvents.length === 0) return null;
    const match = nbEvents.find((e) => e.eventType === 'click_button');
    return match ?? nbEvents[0] ?? null;
  }, [nbEvents]);
  const pickedEvent = useMemo(() => {
    if (manualEventId && nbEvents) {
      const found = nbEvents.find((e) => e.id === manualEventId);
      if (found) return found;
    }
    return autoPickedEvent;
  }, [manualEventId, nbEvents, autoPickedEvent]);
  const pickedEventSupportsRoas = pickedEvent?.eventType === 'complete_payment';

  // TARGET_ROAS requires complete_payment by workflow. Force it via a manual
  // override so the pick sticks when the operator later switches bid types.
  // TARGET_CPA and MAX_CONVERSION intentionally do NOT touch the event —
  // whatever's picked stays until the operator changes it themselves.
  useEffect(() => {
    if (bidType !== 'TARGET_ROAS') return;
    if (!nbEvents || nbEvents.length === 0) return;
    const cp = nbEvents.find((e) => e.eventType === 'complete_payment');
    if (cp && manualEventId !== cp.id) {
      setNbForm({ manualEventId: cp.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidType, nbEvents]);

  // Downgrade to MAX_CONVERSION if the picked event no longer supports ROAS.
  useEffect(() => {
    if (!pickedEventSupportsRoas && bidType === 'TARGET_ROAS') {
      setNbForm({ bidType: 'MAX_CONVERSION' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedEventSupportsRoas]);

  // Derived: ROAS run iff bid type is TARGET_ROAS. Replaces the old checkbox.
  const derivedIsRoas = bidType === 'TARGET_ROAS';

  // Auto-prefill for the editable Binom campaign name field.
  // Format: "[ROAS | ]<base> | NB | <NB account> | MEGATOOL | DD.MM.YYYY".
  //  - ROAS prefix only when the bid type is TARGET_ROAS.
  //  - Base name = NB campaign name (if filled) else the source FB creative
  //    title / ad name.
  //  - "| NB |" marker sits between base and the account so tracker listings
  //    stay self-describing even for cross-account operators.
  const binomCampaignNameDefault = useMemo(() => {
    // Prefer the source FB campaign name (e.g. "Amo | Centrelink Home Buying
    // Programs | AU | 25.06 AddToCart") — that's what operators recognize in
    // Binom listings. Fall back through NB campaign name → creative headline
    // → ad name only if the FB campaign name is empty.
    const fbCampaign = selectedFbAd?.campaignName?.trim() || '';
    const nbName = nbForm.campaignName.trim();
    const fbFallback = selectedFbAd?.creativeTitle || selectedFbAd?.adName || '';
    const base = fbCampaign || nbName || fbFallback;
    if (!base) return '';
    const roasPrefix = derivedIsRoas ? 'ROAS | ' : '';
    const acctPart = destination === 'TT'
      ? ' | US | TT'
      : (selectedAccountName ? ` | US | NB | ${selectedAccountName}` : ' | US | NB');
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const datePart = `${dd}.${mm}.${now.getFullYear()}`;
    return `${roasPrefix}${base}${acctPart} | MEGATOOL | ${datePart}`;
  }, [nbForm.campaignName, selectedFbAd, selectedAccountName, derivedIsRoas, destination]);
  const binomCampaignNameEffective = binomCampaignName || binomCampaignNameDefault;

  const isLoading = status === 'loading';

  if (!selectedFbAd) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-xl border p-6 shadow-sm text-slate-600 text-sm max-w-md text-center">
          Спочатку обери оголошення у FB Campaign Reader.
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={onClose}>← Назад до FB Campaign Reader</Button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    if (!selectedFbAd.trackingUrl) return;
    if (destination === 'TT' && !(ttPixelCode ?? '').trim()) return;
    void createBinomOffer({
      trackingUrl: selectedFbAd.trackingUrl,
      newAmoDomain,
      newAmoChannel: newAmoChannel.trim() || 'same',
      newBinomGroup,
      tracker,
      // isRoas now derives from the bid-type picker in the pre-Binom section
      // above. TARGET_ROAS → true, everything else → false. The old checkbox
      // is gone; the workflow keeps its existing isRoas-driven URL logic.
      isRoas: derivedIsRoas,
      // Send the effective name (user override or auto-derived MEGATOOL prefix).
      // Empty string only if there's no FB context yet, which shouldn't happen.
      binomCampaignName: binomCampaignNameEffective,
      // Tracking event picked above drives the click URL's `event=` param.
      // Independent from isRoas so complete_payment + MAX_CONVERSION works.
      ...(pickedEvent?.eventType ? { nbEventType: pickedEvent.eventType } : {}),
    });
  };

  const handleReset = () => {
    resetBinomOffer();
    resetBinomForm();
    // Preserve auto-detect on reset — trackers should re-derive from the ad.
    if (detectedTracker) {
      setBinomForm({ tracker: detectedTracker, trackerAutoSet: true });
    }
    setShowRaw(false);
  };

  return (
    <div className="flex flex-col h-full w-full gap-4 p-4 bg-slate-100 overflow-y-auto">
      <div className="flex w-full gap-4">
      {/* LEFT — form */}
      <div className="flex-1 bg-white rounded-xl border p-3 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-lg">→ Create Binom Offer</h2>
          <Button variant="outline" size="sm" onClick={onClose}>← Назад</Button>
        </div>

        {/* Selected ad summary — compact single row */}
        <section className="mb-3 border rounded-lg bg-slate-50 p-2 flex gap-2 items-center">
          {selectedFbAd.thumbnailUrl ? (
            <img
              src={selectedFbAd.thumbnailUrl}
              alt=""
              className="h-10 w-10 rounded object-cover shrink-0"
            />
          ) : (
            <div className="h-10 w-10 rounded bg-slate-200 shrink-0 flex items-center justify-center text-[10px] text-slate-500">
              no img
            </div>
          )}
          <div className="flex-1 min-w-0 text-xs">
            <div className="font-semibold text-slate-800 truncate" title={selectedFbAd.adName}>
              {selectedFbAd.adName}
            </div>
            <div className="text-slate-500 truncate">
              <span className="text-slate-400">Adset:</span> {selectedFbAd.adsetName} · <span className="text-slate-400">Campaign:</span> {selectedFbAd.campaignName}
            </div>
            <a
              href={selectedFbAd.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline truncate block font-mono text-[10px]"
              title={selectedFbAd.trackingUrl}
            >
              {selectedFbAd.trackingUrl
                ? selectedFbAd.trackingUrl.split('&')[0]
                : '(no tracking URL)'}
            </a>
          </div>
        </section>

        {/* Form */}
        <section className="space-y-2">
          {/* ── Pre-Binom NB choices — Account → Event → Bid Type. The bid
              type here drives whether the resulting Binom URL is a ROAS URL
              (event=complete_payment + _roas suffix). No more Binom checkbox. */}
          {destination !== 'TT' && (
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
                  <span className="font-semibold uppercase tracking-wide text-slate-500">Tracking event</span>
                  <span className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 ${pickedEventSupportsRoas ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                    {pickedEvent?.eventType ?? '—'}
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
                        setManualEventId(val === autoPickedEvent?.id ? null : val);
                      }}
                      className="w-full rounded-md border border-input bg-white px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {nbEvents.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}{e.eventType ? ` · ${e.eventType}` : ''}{e.id === autoPickedEvent?.id ? ' (auto)' : ''}
                        </option>
                      ))}
                    </select>
                    {pickedEvent && (
                      <div className="font-mono text-[11px] text-slate-500 break-all">
                        id: {pickedEvent.id}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {destination !== 'TT' && (
          <>
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
                className={`rounded-md border px-4 py-1.5 text-sm transition min-w-[7rem] ${
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
                className={`rounded-md border px-4 py-1.5 text-sm transition min-w-[7rem] ${
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
                  className={`rounded-md border px-4 py-1.5 text-sm transition min-w-[7rem] ${
                    bidType === 'TARGET_ROAS'
                      ? 'border-purple-600 bg-purple-50 text-purple-900 font-semibold'
                      : 'border-input bg-white hover:bg-slate-50'
                  }`}
                >
                  Target ROAS
                </button>
              )}
            </div>
          </div>

          {bidType === 'TARGET_CPA' && (
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Bid Rate (Target CPA, USD) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">$</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={cpaText}
                  onChange={(e) => {
                    const raw = e.target.value.replace(',', '.');
                    if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                    setCpaText(raw);
                    const num = raw === '' || raw === '.' ? 0 : Number(raw);
                    setTargetCpaDollars(Number.isFinite(num) ? num : 0);
                  }}
                  placeholder="5"
                  className="pl-6"
                />
              </div>
            </div>
          )}

          {bidType === 'TARGET_ROAS' && (
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">ROAS Target (%) *</label>
              <div className="relative">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={roasText}
                  onChange={(e) => {
                    const raw = e.target.value.replace(',', '.');
                    if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                    setRoasText(raw);
                    const num = raw === '' || raw === '.' ? 0 : Number(raw);
                    setRoasPercent(Number.isFinite(num) ? num : 0);
                  }}
                  placeholder="120"
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
              </div>
            </div>
          )}
          </>
          )}

          <div>
            <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
              <span>Binom Tracker *</span>
              {trackerAutoSet && detectedTracker === tracker && (
                <span className="text-xs normal-case text-green-700 font-semibold">
                  визначено автоматично
                </span>
              )}
            </label>
            <select
              value={tracker}
              onChange={(e) => {
                setTracker(e.target.value);
                setTrackerAutoSet(false);
                setNewBinomGroup('same');
              }}
              className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {BINOM_TRACKERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {!detectedTracker && (
              <p className="text-xs text-amber-700 mt-1">AMO-домен не знайдено — обери вручну.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">New AMO Domain *</label>
              <Combobox
                value={newAmoDomain}
                onChange={setNewAmoDomain}
                options={[...BINOM_AMO_DOMAINS]}
                placeholder="Клікни або введи…"
                inputClassName="text-sm rounded-md bg-white px-2"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">New AMO Channel *</label>
              <Input
                value={newAmoChannel}
                onChange={(e) => setNewAmoChannel(e.target.value)}
                placeholder="напр. ch12345 або 'same'"
              />
            </div>
            <p className="text-xs text-slate-600 col-span-2 -mt-1">
              <code>same</code> залишає AMO-домен / channel як в оригінальному оголошенні.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
              <span>New Binom Group *</span>
              <span className="text-xs normal-case text-slate-500">
                {binomGroupOptions.length - 1} на <code>{tracker}</code>
              </span>
            </label>
            <Combobox
              value={newBinomGroup}
              onChange={setNewBinomGroup}
              options={binomGroupOptions}
              placeholder="Клікни, щоб обрати, або введи…"
              inputClassName="text-sm rounded-md bg-white px-2"
            />
          </div>

          {destination === 'TT' && (
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                TikTok Pixel <span className="text-red-600">*</span>
              </label>
              <select
                value={ttPixelCode || TT_PIXELS[0].code}
                onChange={(e) => setTtPixelCode(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              >
                {TT_PIXELS.map((p) => (
                  <option key={p.code} value={p.code}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
              <span>Binom Campaign Name</span>
              {!binomCampaignName && (
                <span className="text-[10px] normal-case text-slate-400">
                  auto: <code>MEGATOOL | …</code>
                </span>
              )}
            </label>
            <Input
              value={binomCampaignNameEffective}
              onChange={(e) => setBinomCampaignName(e.target.value)}
              placeholder="MEGATOOL | Housing Help 2"
            />
          </div>

          {/* ROAS is derived from the Bid Type picker above (TARGET_ROAS).
              A read-only indicator here mirrors that so operators see the
              same context next to the submit button. */}
          {derivedIsRoas && (
            <div className="text-xs font-semibold uppercase tracking-wide rounded px-2 py-1 bg-purple-100 text-purple-800 inline-block">
              ROAS run (Binom URL матиме _roas + event=complete_payment)
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !selectedFbAd.trackingUrl || (destination === 'TT' && !(ttPixelCode ?? '').trim())}
              className="flex-1"
            >
              {isLoading ? 'Creating…' : 'Create Binom Offer'}
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isLoading}
            >
              Reset
            </Button>
          </div>
        </section>
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
              Fill the form and press Create Binom Offer. Results appear here.
            </div>
          )}
          {status === 'loading' && (
            <div className="text-slate-600 text-sm">Creating Binom offer &amp; campaign — usually 5–30s.</div>
          )}
          {status === 'error' && (
            <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md whitespace-pre-wrap">
              <div className="font-semibold mb-1">Error</div>
              {error ?? 'Unknown error'}
            </div>
          )}
          {status === 'success' && result && (
            <>
              <CopyableCard
                label="Binom Offer ID(s)"
                value={(result.binomOfferIds ?? []).join(', ')}
              />
              <CopyableCard label="Binom Campaign ID" value={result.binomCampaignId ?? ''} />
              <CopyableCard label="Binom Campaign URL" value={result.binomCampaignUrl ?? ''} isLink />
              {result.binomCampaignName && (
                <CopyableCard label="Binom Campaign Name" value={result.binomCampaignName} />
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

      {/* Embedded NB Campaign flow — appears below the Binom section once the
          Binom offer has been created. Shares the same store-backed form state,
          so this is a single continuous workflow across two ordered actions. */}
      {result && destination !== 'TT' && (
        <MegatoolCreateNbCampaignPage
          embedded
          onClose={onClose}
        />
      )}
      {result && destination === 'TT' && (
        <MegatoolCreateTtCampaignPage
          embedded
          onClose={onClose}
        />
      )}
    </div>
  );
};

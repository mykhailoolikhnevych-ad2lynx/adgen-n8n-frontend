import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { useAppStore, type NbCopierAdset, type NbCopierAd } from '@/store/useAppStore';
import {
  BINOM_AMO_DOMAINS,
  BINOM_TRACKERS,
  getGroupNamesForTracker,
  getTrackerFromTrackingUrl,
} from '@/lib/binomGroups';
import { CopyableCard } from './MegatoolCreateBinomOfferPage';
import {
  START_DATE_OPTIONS,
  TIMEZONE_OPTIONS,
  RELATIVE_START_DATES,
  type StartDate,
  type StartTimezone,
} from './MegatoolCreateNbCampaignPage';

type NbCopierBidType = 'SAME' | 'MAX_CONVERSION' | 'TARGET_CPA' | 'TARGET_ROAS';

// Mirrors rewriteOfferName() in the "MEGATOOL Create Binom Offer" n8n node, so
// the prefilled offer names match what Binom would get with the field left alone.
const KNOWN_AMO_DOMAIN_BASES = [
  'perabianco', 'pancettafuns', 'walletilo', 'contranoche', 'contradia',
  'healthquix', 'geeksstory', 'finomira', 'fintreat', 'healquix',
];
const rewriteOfferName = (originalName: string, newAmoDomain: string, newAmoChannel: string): string => {
  let offerName = originalName;
  if (newAmoChannel && newAmoChannel !== 'same') {
    offerName = offerName.replace(/\s*\|\s*ch\s+\S+/gi, '');
    offerName = offerName.trimEnd() + ` New CH = ${newAmoChannel}`;
  }
  if (newAmoDomain && newAmoDomain !== 'same') {
    const newDomainBase = String(newAmoDomain).trim().replace(/\.(?:com|net|org|io)$/i, '');
    for (const known of KNOWN_AMO_DOMAIN_BASES) {
      const re = new RegExp(`(\\|)\\s*${known}\\s*(?=\\|)`, 'gi');
      if (re.test(offerName)) {
        offerName = offerName.replace(re, '$1');
        break;
      }
    }
    const newDomainLabel = `| New AMO ${newDomainBase.charAt(0).toUpperCase() + newDomainBase.slice(1)} `;
    if (offerName.includes('New CH =')) {
      offerName = offerName.replace(/\s*New CH =/, ` ${newDomainLabel}| New CH =`);
    } else {
      offerName = offerName.trimEnd() + ` ${newDomainLabel.trim()}`;
    }
  }
  return offerName;
};

const kyivDateStr = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
};

const isActiveStatus = (status: string | undefined) => {
  const s = (status ?? '').toUpperCase();
  return s === 'ACTIVE' || s === 'ON';
};

const StatusBadge = ({ status }: { status: string | undefined }) => (
  <span
    className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 shrink-0 ${
      isActiveStatus(status) ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'
    }`}
  >
    {status || '—'}
  </span>
);

const formatBidType = (as: NbCopierAdset): string => {
  if (as.bidType === 'TARGET_CPA' && as.bidRate != null) return `Target CPA · $${(as.bidRate / 100).toFixed(2)}`;
  if (as.bidType === 'TARGET_ROAS' && as.roas != null) return `Target ROAS · ${Math.round(as.roas * 100)}%`;
  return as.bidType || 'Max Conversions';
};

const AdRow = ({ ad }: { ad: NbCopierAd }) => (
  <div className="flex items-center gap-2 border-t border-slate-200 pt-1">
    {ad.type === 'IMAGE' || ad.type === 'GIF' ? (
      ad.assetUrl ? (
        <img src={ad.assetUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
      ) : (
        <div className="h-8 w-8 rounded bg-slate-200 shrink-0" />
      )
    ) : (
      <span className="h-8 w-8 rounded bg-purple-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
        VIDEO
      </span>
    )}
    <div className="flex-1 min-w-0">
      <div className="truncate font-medium text-slate-800" title={ad.name}>{ad.name}</div>
      {ad.headline && <div className="truncate text-slate-500" title={ad.headline}>{ad.headline}</div>}
    </div>
    <StatusBadge status={ad.status} />
  </div>
);

const AdsetCard = ({ as }: { as: NbCopierAdset }) => (
  <div className="border rounded-lg bg-slate-50 p-2 text-xs space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold text-slate-800 truncate" title={as.name}>{as.name}</span>
      <StatusBadge status={as.status} />
    </div>
    <div className="text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
      <span>${as.budget}/day</span>
      <span>{formatBidType(as)}</span>
      <span>{as.trackingEvent ? `${as.trackingEvent.name}${as.trackingEvent.eventType ? ` · ${as.trackingEvent.eventType}` : ''}` : 'no tracking event'}</span>
      <span>{as.ads.length} ad{as.ads.length === 1 ? '' : 's'}</span>
    </div>
    <div className="space-y-1">
      {as.ads.map((ad) => <AdRow key={ad.id} ad={ad} />)}
    </div>
  </div>
);

export const MegatoolNbCopierPage = () => {
  const nbAccountsList = useAppStore((s) => s.nbAccountsList);
  const nbAccountsStatus = useAppStore((s) => s.nbAccountsStatus);
  const nbAccountsError = useAppStore((s) => s.nbAccountsError);
  const fetchNbAccounts = useAppStore((s) => s.fetchNbAccounts);
  const copierEvents = useAppStore((s) => s.nbCopierEvents);
  const nbEvents = copierEvents.events;
  const nbEventsStatus = copierEvents.status;
  const nbEventsError = copierEvents.error;
  const nbEventsAccountId = copierEvents.accountId;
  const fetchNbEvents = useAppStore((s) => s.fetchNbCopierEvents);

  const form = useAppStore((s) => s.nbCopierForm);
  const setForm = useAppStore((s) => s.setNbCopierForm);
  const read = useAppStore((s) => s.nbCopierRead);
  const copy = useAppStore((s) => s.nbCopierCopy);
  const binomCache = useAppStore((s) => s.nbCopierBinom);
  const readNbCopierSource = useAppStore((s) => s.readNbCopierSource);
  const runNbCopier = useAppStore((s) => s.runNbCopier);

  const {
    sourceAccountName, sourceCampaignId, targetAccountName, campaignName, budget,
    startDate, startTimezone, trackingEventId, bidType, targetCpaDollars, roasPercent,
    tracker, trackerAutoSet, newAmoDomain, newAmoChannel, newBinomGroup,
    binomCampaignName, binomOfferNames,
  } = form;

  useEffect(() => {
    if (nbAccountsStatus === 'idle') void fetchNbAccounts();
  }, [nbAccountsStatus, fetchNbAccounts]);

  const nbAccountNames = useMemo(() => nbAccountsList.map((a) => a.name), [nbAccountsList]);
  const targetAccount = nbAccountsList.find((a) => a.name === targetAccountName);

  // Fetch the target account's conversion events; drop any manual override so
  // the auto-match effect below re-runs for the new account.
  useEffect(() => {
    if (targetAccount?.id && targetAccount.id !== nbEventsAccountId) {
      void fetchNbEvents(targetAccount.id);
      setForm({ trackingEventId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAccount?.id]);

  const sourceEvent = read.result?.adsets?.[0]?.trackingEvent ?? null;

  // Auto-match priority: same name → same type+eventType → same eventType →
  // first click_button → first event.
  const autoMatchedEvent = useMemo(() => {
    if (!nbEvents || nbEvents.length === 0) return null;
    if (sourceEvent) {
      const byName = nbEvents.find((e) => e.name === sourceEvent.name);
      if (byName) return byName;
      const byTypeAndEventType = nbEvents.find((e) => e.type === sourceEvent.type && e.eventType === sourceEvent.eventType);
      if (byTypeAndEventType) return byTypeAndEventType;
      const byEventType = nbEvents.find((e) => e.eventType === sourceEvent.eventType);
      if (byEventType) return byEventType;
    }
    const clickButton = nbEvents.find((e) => e.eventType === 'click_button');
    return clickButton ?? nbEvents[0] ?? null;
  }, [nbEvents, sourceEvent]);

  const pickedEvent = useMemo(() => {
    if (trackingEventId && nbEvents) {
      const found = nbEvents.find((e) => e.id === trackingEventId);
      if (found) return found;
    }
    return autoMatchedEvent;
  }, [trackingEventId, nbEvents, autoMatchedEvent]);

  const pickedEventSupportsRoas = pickedEvent?.eventType === 'complete_payment';

  // Downgrade to SAME if the picked event no longer supports ROAS.
  useEffect(() => {
    if (nbEventsStatus === 'success' && bidType === 'TARGET_ROAS' && !pickedEventSupportsRoas) {
      setForm({ bidType: 'SAME' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nbEventsStatus, pickedEventSupportsRoas]);

  const isAutoMatch = !trackingEventId;
  const matchesSourceByName = !!sourceEvent && !!pickedEvent && pickedEvent.name === sourceEvent.name;

  // Local text state for CPA/ROAS — same "." and "," decimal handling as the
  // Binom Offer page.
  const [cpaText, setCpaText] = useState<string>(String(targetCpaDollars));
  const [roasText, setRoasText] = useState<string>(roasPercent === 0 ? '' : String(roasPercent));
  useEffect(() => {
    if (Number((cpaText || '0').replace(',', '.')) !== targetCpaDollars) setCpaText(String(targetCpaDollars));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCpaDollars]);
  useEffect(() => {
    if (Number((roasText || '0').replace(',', '.')) !== roasPercent) setRoasText(roasPercent === 0 ? '' : String(roasPercent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roasPercent]);

  const sourceBidSummary = useMemo(() => {
    if (!read.result) return '';
    const counts = new Map<string, number>();
    for (const as of read.result.adsets) {
      const label = formatBidType(as);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, n]) => `${label} ×${n}`).join(', ');
  }, [read.result]);

  const binomGroupOptions = useMemo(() => getGroupNamesForTracker(tracker), [tracker]);
  const detectedTracker = useMemo(
    () => getTrackerFromTrackingUrl(read.result?.trackingUrl),
    [read.result?.trackingUrl],
  );

  const norm = (v: string) => (v ?? '').trim().toLowerCase();
  const allSame = ['same', ''].includes(norm(newAmoDomain))
    && ['same', ''].includes(norm(newAmoChannel))
    && ['same', ''].includes(norm(newBinomGroup));

  // Prefills for the Binom name fields — same defaults the Binom workflow
  // would apply; an operator edit (stored in the form) takes precedence.
  const sourceBinom = read.result?.binom && !read.result.binom.error ? read.result.binom : null;
  const effectiveIsRoas = bidType === 'TARGET_ROAS' || (bidType === 'SAME' && !!read.result?.isRoas);
  const defaultBinomCampaignName = sourceBinom?.campaignName
    ? `${effectiveIsRoas ? 'ROAS | ' : ''}${sourceBinom.campaignName} MEGATOOL ${kyivDateStr()}`
    : '';
  const sourceOffers = sourceBinom?.offers ?? [];
  const shownBinomCampaignName = binomCampaignName || defaultBinomCampaignName;
  const shownOfferName = (o: { id: string; name: string }) =>
    binomOfferNames[o.id] ?? rewriteOfferName(o.name, newAmoDomain, newAmoChannel);

  const isReading = read.status === 'loading';
  const isCopying = copy.status === 'loading';

  const handleRead = () => {
    if (!sourceAccountName || !sourceCampaignId.trim()) return;
    void readNbCopierSource();
  };

  const canCopy = read.status === 'success'
    && !!read.result
    && !isCopying
    && !!targetAccount
    && !!pickedEvent
    && budget > 0
    && (bidType !== 'TARGET_CPA' || targetCpaDollars > 0)
    && (bidType !== 'TARGET_ROAS' || roasPercent > 0);

  const handleCopy = () => {
    if (!canCopy || !pickedEvent) return;
    const offerNames: Record<string, string> = {};
    for (const o of sourceOffers) {
      const n = shownOfferName(o).trim();
      if (n) offerNames[o.id] = n;
    }
    void runNbCopier({
      trackingId: pickedEvent.id,
      eventType: pickedEvent.eventType ?? '',
      binomCampaignName: shownBinomCampaignName.trim(),
      binomOfferNames: offerNames,
    });
  };

  const STATUS_LABEL: Record<string, string> = {
    idle: 'Idle',
    loading: copy.step === 'binom' ? 'Creating Binom campaign…' : 'Copying to NewsBreak…',
    success: 'Done',
    error: 'Error',
  };
  const STATUS_COLOR: Record<string, string> = {
    idle: 'text-slate-600',
    loading: 'text-blue-600',
    success: 'text-green-600',
    error: 'text-red-600',
  };

  return (
    <div className="flex flex-col h-full w-full gap-4 p-4 bg-slate-100 overflow-y-auto">
      <div className="flex w-full gap-4">
        {/* LEFT — form */}
        <div className="flex-1 bg-white rounded-xl border p-3 shadow-sm space-y-4">
          <h2 className="font-bold text-lg">Newsbreak Copier</h2>

          {/* 1. Source */}
          <section className="space-y-2">
            <h3 className="font-bold text-sm uppercase tracking-wide text-slate-700">1. Source</h3>
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                Source NB Account *
                {nbAccountsStatus === 'loading' && <span className="ml-2 text-xs text-blue-600 normal-case">loading accounts…</span>}
                {nbAccountsStatus === 'success' && <span className="ml-2 text-xs text-slate-400 normal-case">({nbAccountsList.length})</span>}
              </label>
              <Combobox
                value={sourceAccountName}
                onChange={(v) => setForm({ sourceAccountName: v })}
                options={nbAccountNames}
                placeholder={nbAccountsStatus === 'loading' ? 'Loading NB accounts…' : 'Type to search 428+ accounts…'}
                inputClassName="text-sm rounded-md bg-white px-2"
                minSearchChars={1}
              />
              {nbAccountsStatus === 'error' && (
                <div className="mt-1 flex items-center gap-2 text-xs text-red-600">
                  <span>Failed to load NB accounts: {nbAccountsError ?? 'unknown'}</span>
                  <button type="button" onClick={() => void fetchNbAccounts()} className="underline hover:no-underline">retry</button>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Source Campaign ID *</label>
              <Input
                value={sourceCampaignId}
                onChange={(e) => setForm({ sourceCampaignId: e.target.value })}
                placeholder="1234567890123"
                onKeyDown={(e) => { if (e.key === 'Enter') handleRead(); }}
              />
            </div>

            <Button
              onClick={handleRead}
              disabled={isReading || !sourceAccountName || !sourceCampaignId.trim()}
            >
              {isReading && (
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin mr-2"
                />
              )}
              {isReading ? 'Reading…' : 'Read campaign'}
            </Button>

            {read.status === 'error' && (
              <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md whitespace-pre-wrap">
                <div className="font-semibold mb-1">Error</div>
                {read.error ?? 'Unknown error'}
              </div>
            )}

            {read.status === 'success' && read.result && (
              <div className="space-y-2">
                <div className="border rounded-lg bg-blue-50 p-2 text-sm">
                  <div className="font-semibold text-blue-900 flex items-center gap-2">
                    {read.result.campaign.name}
                    <StatusBadge status={read.result.campaign.status} />
                  </div>
                  <div className="text-xs text-blue-800/80 mt-0.5">
                    {read.result.totalAds} ad{read.result.totalAds === 1 ? '' : 's'} across {read.result.adsets.length} ad set{read.result.adsets.length === 1 ? '' : 's'}
                  </div>
                </div>

                {read.result.binomKeys.length > 1 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    <span>⚠</span>
                    <span>
                      Ads use {read.result.binomKeys.length} different Binom keys — a new Binom campaign will be cloned from the first ad's key only.
                    </span>
                  </div>
                )}

                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {read.result.adsets.map((as) => <AdsetCard key={as.id} as={as} />)}
                </div>
              </div>
            )}
          </section>

          {/* 2. Target — only after a successful read */}
          {read.status === 'success' && read.result && (
            <section className="space-y-2 border-t pt-4">
              <h3 className="font-bold text-sm uppercase tracking-wide text-slate-700">2. Target</h3>

              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Target NB Account *</label>
                <Combobox
                  value={targetAccountName}
                  onChange={(v) => setForm({ targetAccountName: v })}
                  options={nbAccountNames}
                  placeholder="Type to search…"
                  inputClassName="text-sm rounded-md bg-white px-2"
                  minSearchChars={1}
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Campaign Name *</label>
                <Input
                  value={campaignName}
                  onChange={(e) => setForm({ campaignName: e.target.value })}
                  placeholder="Campaign name"
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Daily budget per ad set ($)</label>
                <Input
                  type="number"
                  min={1}
                  value={budget}
                  onChange={(e) => setForm({ budget: Number(e.target.value) })}
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium uppercase text-slate-500">Start Date</label>
                  <select
                    value={startDate}
                    onChange={(e) => setForm({ startDate: e.target.value as StartDate })}
                    className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {START_DATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium uppercase text-slate-500">Timezone</label>
                  <select
                    value={startTimezone}
                    onChange={(e) => setForm({ startTimezone: e.target.value as StartTimezone })}
                    disabled={RELATIVE_START_DATES.includes(startDate)}
                    className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {TIMEZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {targetAccount && (
                <div className="border rounded-md bg-slate-50 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold uppercase tracking-wide text-slate-500">Tracking event</span>
                    {pickedEvent?.eventType && (
                      <span className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 ${pickedEventSupportsRoas ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                        {pickedEvent.eventType}
                      </span>
                    )}
                  </div>
                  {nbEventsStatus === 'loading' && <div className="text-slate-500 italic">Завантажую події акаунту…</div>}
                  {nbEventsStatus === 'error' && (
                    <div className="text-red-600">
                      Не вдалося завантажити події: {nbEventsError ?? 'unknown'}{' '}
                      <button type="button" onClick={() => void fetchNbEvents(targetAccount.id)} className="underline hover:no-underline">повторити</button>
                    </div>
                  )}
                  {nbEventsStatus === 'success' && (!nbEvents || nbEvents.length === 0) && (
                    <div className="text-amber-700">В акаунті немає подій.</div>
                  )}
                  {nbEventsStatus === 'success' && nbEvents && nbEvents.length > 0 && (
                    <div className="space-y-1">
                      <select
                        value={pickedEvent?.id ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setForm({ trackingEventId: val === autoMatchedEvent?.id ? null : val });
                        }}
                        className="w-full rounded-md border border-input bg-white px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {nbEvents.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}{e.eventType ? ` · ${e.eventType}` : ''}{e.id === autoMatchedEvent?.id ? ' (auto)' : ''}
                          </option>
                        ))}
                      </select>
                      {isAutoMatch && sourceEvent && matchesSourceByName && (
                        <div className="text-[10px] text-green-700">matches source: {sourceEvent.name}</div>
                      )}
                      {isAutoMatch && sourceEvent && !matchesSourceByName && (
                        <div className="text-[10px] text-amber-700">
                          source event '{sourceEvent.name}{sourceEvent.eventType ? ` · ${sourceEvent.eventType}` : ''}' not found in target account — pick one
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
                  <span>Bid Type *</span>
                  {!pickedEventSupportsRoas && (
                    <span className="text-[10px] normal-case text-slate-400">
                      Target ROAS доступний лише для <code>complete_payment</code>
                    </span>
                  )}
                </label>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {(['SAME', 'MAX_CONVERSION', 'TARGET_CPA'] as NbCopierBidType[]).map((bt) => (
                    <button
                      key={bt}
                      type="button"
                      onClick={() => setForm({ bidType: bt })}
                      className={`rounded-md border px-3 py-1.5 text-sm transition min-w-[7rem] ${
                        bidType === bt
                          ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                          : 'border-input bg-white hover:bg-slate-50'
                      }`}
                    >
                      {bt === 'SAME' ? 'Same as source' : bt === 'MAX_CONVERSION' ? 'Max Conversions' : 'Target CPA'}
                    </button>
                  ))}
                  {pickedEventSupportsRoas && (
                    <button
                      type="button"
                      onClick={() => setForm({ bidType: 'TARGET_ROAS' })}
                      className={`rounded-md border px-3 py-1.5 text-sm transition min-w-[7rem] ${
                        bidType === 'TARGET_ROAS'
                          ? 'border-purple-600 bg-purple-50 text-purple-900 font-semibold'
                          : 'border-input bg-white hover:bg-slate-50'
                      }`}
                    >
                      Target ROAS
                    </button>
                  )}
                </div>
                {bidType === 'SAME' && sourceBidSummary && (
                  <p className="text-xs text-slate-600 mt-1">Source: {sourceBidSummary}</p>
                )}
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
                        setForm({ targetCpaDollars: Number.isFinite(num) ? num : 0 });
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
                        setForm({ roasPercent: Number.isFinite(num) ? num : 0 });
                      }}
                      placeholder="120"
                      className="pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 3. Binom — only after a successful read */}
          {read.status === 'success' && read.result && (
            <section className="space-y-2 border-t pt-4">
              <h3 className="font-bold text-sm uppercase tracking-wide text-slate-700">3. Binom</h3>

              <div>
                <label className="text-xs font-medium uppercase text-slate-500 flex items-center justify-between gap-2">
                  <span>Binom Tracker *</span>
                  {trackerAutoSet && detectedTracker === tracker && (
                    <span className="text-xs normal-case text-green-700 font-semibold">визначено автоматично</span>
                  )}
                </label>
                <select
                  value={tracker}
                  onChange={(e) => setForm({ tracker: e.target.value, trackerAutoSet: false, newBinomGroup: 'same' })}
                  className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {BINOM_TRACKERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium uppercase text-slate-500">New AMO Domain *</label>
                  <Combobox
                    value={newAmoDomain}
                    onChange={(v) => setForm({ newAmoDomain: v })}
                    options={[...BINOM_AMO_DOMAINS]}
                    placeholder="Клікни або введи…"
                    inputClassName="text-sm rounded-md bg-white px-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase text-slate-500">New AMO Channel *</label>
                  <Combobox
                    value={newAmoChannel}
                    onChange={(v) => setForm({ newAmoChannel: v })}
                    options={['same', 'auto']}
                    placeholder="Клікни або введи…"
                    inputClassName="text-sm rounded-md bg-white px-2"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium uppercase text-slate-500">New Binom Group *</label>
                <Combobox
                  value={newBinomGroup}
                  onChange={(v) => setForm({ newBinomGroup: v })}
                  options={binomGroupOptions}
                  placeholder="Клікни, щоб обрати, або введи…"
                  inputClassName="text-sm rounded-md bg-white px-2"
                />
              </div>

              {allSame ? (
                <p className="text-xs text-slate-600">
                  Binom is not touched: the source ads' click URLs are reused (only <code>event=</code> is updated).
                </p>
              ) : (
                <>
                  {read.result.binom?.error && (
                    <p className="text-xs text-amber-700">
                      Не вдалося прочитати кампанію в Binom ({read.result.binom.error}) — назви будуть за замовчуванням.
                    </p>
                  )}
                  <div>
                    <label className="text-xs font-medium uppercase text-slate-500">Binom Campaign Name</label>
                    <Input
                      value={shownBinomCampaignName}
                      onChange={(e) => setForm({ binomCampaignName: e.target.value })}
                      placeholder="<назва кампанії> MEGATOOL дд.мм.рррр"
                    />
                    {sourceBinom?.campaignName && (
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={sourceBinom.campaignName}>
                        Оригінал ({sourceBinom.campaignId}): {sourceBinom.campaignName}
                      </div>
                    )}
                  </div>
                  {sourceOffers.map((o, i) => (
                    <div key={o.id}>
                      <label className="text-xs font-medium uppercase text-slate-500">
                        Binom Offer Name{sourceOffers.length > 1 ? ` #${i + 1}` : ''}
                      </label>
                      <Input
                        value={shownOfferName(o)}
                        onChange={(e) => setForm({ binomOfferNames: { ...binomOfferNames, [o.id]: e.target.value } })}
                      />
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={o.name}>
                        Оригінал ({o.id}): {o.name}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </section>
          )}

          {read.status === 'success' && read.result && (
            <div className="pt-2">
              <Button onClick={handleCopy} disabled={!canCopy} className="w-full">
                {isCopying
                  ? (copy.step === 'binom' ? 'Creating Binom campaign…' : 'Copying to NewsBreak…')
                  : 'Copy'}
              </Button>
            </div>
          )}
        </div>

        {/* RIGHT — status + results */}
        <div className="w-[28rem] shrink-0 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
          <h2 className="font-bold text-xl mb-2 shrink-0">Result</h2>

          <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center justify-between shrink-0">
            <span className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Status:</span>
              {isCopying && (
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"
                />
              )}
              <span className={`font-medium ${STATUS_COLOR[copy.status]}`}>{STATUS_LABEL[copy.status]}</span>
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto mt-3 space-y-3">
            {copy.status === 'idle' && (
              <div className="text-slate-400 italic text-sm">
                Read a source campaign, fill in the target, and press Copy. Results appear here.
              </div>
            )}
            {copy.status === 'error' && (
              <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md whitespace-pre-wrap">
                <div className="font-semibold mb-1">Error{copy.step ? ` (step: ${copy.step})` : ''}</div>
                {copy.error ?? 'Unknown error'}
              </div>
            )}
            {copy.status === 'success' && copy.result && (
              <>
                {!allSame && binomCache?.result && (
                  <>
                    <CopyableCard label="Binom Campaign URL" value={binomCache.result.binomCampaignUrl ?? ''} isLink />
                    {binomCache.result.binomCampaignName && (
                      <CopyableCard label="Binom Campaign Name" value={binomCache.result.binomCampaignName} />
                    )}
                  </>
                )}
                <CopyableCard label="NB Campaign ID" value={copy.result.campaignId} />
                <CopyableCard label="NB Campaign Name" value={copy.result.campaignName} />
                <div className="text-sm text-slate-700">
                  {copy.result.adsCreated}/{copy.result.totalAds} ads in {copy.result.adsetsCreated} ad set{copy.result.adsetsCreated === 1 ? '' : 's'}
                </div>
                <div className="space-y-1">
                  {copy.result.adsets.map((as) => (
                    <div key={as.adsetId || as.sourceAdsetId} className="border rounded-md bg-slate-50 p-2 text-xs flex items-center justify-between gap-2">
                      <span className="truncate" title={as.name}>{as.name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={as.status} />
                        <span className="text-slate-500">{as.ads.length} ad{as.ads.length === 1 ? '' : 's'}</span>
                      </span>
                    </div>
                  ))}
                </div>
                {copy.result.errors.length > 0 && (
                  <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md space-y-1">
                    <div className="font-semibold">Partial errors</div>
                    {copy.result.errors.map((err, i) => <div key={i}>{err}</div>)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

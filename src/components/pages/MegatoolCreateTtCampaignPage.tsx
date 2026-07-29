import { useState, useEffect, useMemo, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { TT_COUNTRY_OPTIONS, TT_LOCATION_ID_BY_LABEL } from '@/data/ttCountries';
import { useAppStore, type ArticleStatus } from '@/store/useAppStore';

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Creating TT Campaign…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

// TT constants — these live server-side too (hardcoded in the n8n workflow).
// Surfaced here read-only so the operator can eyeball what's being posted.
const TT_INFO = [
  { label: 'Campaign type', value: 'Upgraded Smart+ (auto-optimized)' },
  { label: 'Optimization', value: 'CONVERT / BUTTON' },
  { label: 'Objective', value: 'LEAD_GENERATION' },
  { label: 'Ad format', value: 'Native Photo (image) / Video — TT auto-renders' },
] as const;

// "now" in the ad account tz (Kyiv / UTC+2) as "YYYY-MM-DDTHH:MM".
const nowKyivIso = (): string => new Date(Date.now() + 120 * 60000).toISOString().slice(0, 16);
// "YYYY-MM-DD" -> "dd.mm.yyyy"
const isoToDmy = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
};
// Kyiv (UTC+2) "YYYY-MM-DDTHH:MM" -> account-tz wall clock "dd.mm.yyyy HH:MM" (preview).
const kyivToAccountWall = (startAt: string, tz: string): string => {
  const m = startAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m || !tz) return '';
  const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 120 * 60000);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(utc);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${g('day')}.${g('month')}.${g('year')} ${g('hour')}:${g('minute')}`;
  } catch { return ''; }
};
// Friendly UTC-offset label for a tz, e.g. "UTC-7".
const tzOffsetLabel = (tz: string): string => {
  if (!tz) return '';
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || '';
    return s.replace('GMT', 'UTC') || tz;
  } catch { return tz; }
};
// today (+n days) in Kyiv as "dd.mm.yyyy"
const dmyPlusDays = (n: number): string =>
  isoToDmy(new Date(Date.now() + 120 * 60000 + n * 86400000).toISOString().slice(0, 10));
// "dd.mm.yyyy" -> "YYYY-MM-DD" ('' if invalid)
const dmyToIso = (dmy: string): string => {
  const m = dmy.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return '';
  const d = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// TikTok ad primary-text hard limit.
const TT_AD_TEXT_MAX = 100;

// Rewrite (or append) the &funnel= param of a Binom click URL so it carries the
// selected TikTok pixel's code — keeps TT optimization and Binom conversion
// attribution pointed at the same pixel.
function setFunnelParam(url: string, code: string): string {
  if (!url || !code) return url;
  if (/([?&])funnel=[^&#]*/i.test(url)) {
    return url.replace(/([?&])funnel=[^&#]*/i, `$1funnel=${encodeURIComponent(code)}`);
  }
  return url + (url.includes('?') ? '&' : '?') + 'funnel=' + encodeURIComponent(code);
}

interface Props {
  onClose: () => void;
  /** When true, render only the form + result columns (no bg-slate-100
   *  wrapper, no back button, no h2). Used when the Binom page embeds
   *  this page inline so the operator sees both flows on one screen. */
  embedded?: boolean;
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

export const MegatoolCreateTtCampaignPage = ({ onClose, embedded = false }: Props) => {
  const selectedFbAd = useAppStore((s) => s.selectedFbAd);
  const selectedFbAds = useAppStore((s) => s.selectedFbAds);
  const binomOfferResult = useAppStore((s) => s.binomOfferResult);
  const status = useAppStore((s) => s.ttCampaignStatus);
  const result = useAppStore((s) => s.ttCampaignResult);
  const error = useAppStore((s) => s.ttCampaignError);
  const createTtCampaign = useAppStore((s) => s.createTtCampaign);
  const resetTtCampaign = useAppStore((s) => s.resetTtCampaign);
  const ttForm = useAppStore((s) => s.megatoolTtForm);
  const setTtForm = useAppStore((s) => s.setTtForm);
  const resetTtForm = useAppStore((s) => s.resetTtForm);
  const ttAccountsList = useAppStore((s) => s.ttAccountsList);
  const ttAccountsStatus = useAppStore((s) => s.ttAccountsStatus);
  const fetchTtAccounts = useAppStore((s) => s.fetchTtAccounts);
  const ttAccountContext = useAppStore((s) => s.ttAccountContext);
  const ttContextStatus = useAppStore((s) => s.ttContextStatus);
  const fetchTtAccountContext = useAppStore((s) => s.fetchTtAccountContext);

  const [showRaw, setShowRaw] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const isLoading = status === 'loading';

  // ── Account → Identity + Pixel selection ───────────────────────────────────
  // These hooks must run before the early return below, so they're declared
  // here with null-safe access to binom data.
  useEffect(() => { void fetchTtAccounts(); }, [fetchTtAccounts]);

  const accountOptions = useMemo(
    () => ttAccountsList.map((a) => `${a.name} (${a.id})`),
    [ttAccountsList],
  );
  const accountIdByLabel = useMemo(
    () => Object.fromEntries(ttAccountsList.map((a) => [`${a.name} (${a.id})`, a.id])),
    [ttAccountsList],
  );
  const accountLabel = ttForm.accountLabel ?? '';
  const advertiserId = accountIdByLabel[accountLabel] ?? '';

  // Default the account once the list loads (prefer the legacy hardcoded one).
  useEffect(() => {
    if (ttForm.accountLabel || ttAccountsList.length === 0) return;
    const preferred = ttAccountsList.find((a) => a.id === '7654600970270867474') ?? ttAccountsList[0];
    setTtForm({ accountLabel: `${preferred.name} (${preferred.id})` });
  }, [ttAccountsList]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the selected account's identities + pixels when it changes.
  useEffect(() => {
    if (/^\d+$/.test(advertiserId)) void fetchTtAccountContext(advertiserId);
  }, [advertiserId, fetchTtAccountContext]);

  const identityLabelOf = (i: { name: string; type: string }) => `${i.name || '(no name)'} — ${i.type}`;
  const pixelLabelOf = (p: { code: string; name: string }) => (p.name ? `${p.name} (${p.code})` : p.code);
  // Only trust context that matches the currently-selected account.
  const ctxMatches = ttAccountContext?.advertiserId === advertiserId;
  const identities = ctxMatches ? ttAccountContext!.identities : [];
  const pixels = ctxMatches ? ttAccountContext!.pixels : [];
  const accountTz = ctxMatches ? (ttAccountContext!.timezone || '') : '';
  const identityOptions = useMemo(() => identities.map(identityLabelOf), [identities]);
  const pixelOptions = useMemo(() => pixels.map(pixelLabelOf), [pixels]);

  // funnel pixel_code baked into the Binom landing URL — used to default + to
  // warn if the chosen TT pixel doesn't match it (tracking would drift).
  const funnelCode = (binomOfferResult?.binomCampaignUrl ?? '').match(/[?&]funnel=([^&]+)/i)?.[1] ?? '';

  // Default identity (prefer real BC_AUTH_TT) + pixel (prefer funnel match).
  useEffect(() => {
    if (identities.length && !ttForm.identityLabel) {
      const pref = identities.find((i) => i.type === 'BC_AUTH_TT') ?? identities[0];
      setTtForm({ identityLabel: identityLabelOf(pref) });
    }
  }, [identities]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pixels.length && !ttForm.pixelLabel) {
      const pref = pixels.find((p) => p.code === funnelCode)
        ?? pixels.find((p) => p.status === 'ACTIVE')
        ?? pixels[0];
      setTtForm({ pixelLabel: pixelLabelOf(pref) });
    }
  }, [pixels, funnelCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const selIdentity = identities.find((i) => identityLabelOf(i) === (ttForm.identityLabel ?? ''));
  const selPixel = pixels.find((p) => pixelLabelOf(p) === (ttForm.pixelLabel ?? ''));

  if (!selectedFbAd || !binomOfferResult) {
    // In embedded mode the parent Binom page hides this component until
    // binomOfferResult exists, so render nothing to avoid a duplicate
    // empty-state card.
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

  // Accept "." or "," as decimal separator — matches the CPA/ROAS inputs on
  // the Binom Offer page. Store raw string; parse to number at submit time.
  const cpaText = ttForm.conversionBidPrice;
  const parsedCpa = Number((cpaText || '0').replace(',', '.'));
  const budgetLevel = ttForm.budgetLevel;
  const bidStrategy = ttForm.bidStrategy;
  // CPA only applies to Target CPA; Maximum results has no bid cap.
  const cpaNeeded = bidStrategy === 'target_cpa';
  const cpaValid = !cpaNeeded || (cpaText.trim() !== '' && Number.isFinite(parsedCpa) && parsedCpa > 0);

  const budgetText = ttForm.dailyBudget;
  const parsedBudget = Number((budgetText || '0').replace(',', '.'));
  const budgetValid = budgetText.trim() !== '' && Number.isFinite(parsedBudget) && parsedBudget > 0;

  // Campaign name defaults to the Binom name until the operator edits it.
  const binomCampaignName = binomOfferResult.binomCampaignName ?? '';
  const campaignName = ttForm.campaignName !== undefined ? ttForm.campaignName : binomCampaignName;
  // Ad group + ad name follow the campaign name until individually overridden.
  const adgroupName = ttForm.adgroupName !== undefined ? ttForm.adgroupName : campaignName;
  const adName = ttForm.adName !== undefined ? ttForm.adName : campaignName;
  // Base URL from Binom, with funnel= rewritten to the selected pixel's code.
  const baseLandingUrl = binomOfferResult.binomCampaignUrl ?? '';
  const landingPageUrl = selPixel?.code ? setFunnelParam(baseLandingUrl, selPixel.code) : baseLandingUrl;
  // All selected FB creatives → separated into images and videos.
  //  • every image goes into ONE ad (each image a Smart+ variation)
  //  • every video becomes its own ad
  const allCreatives = (selectedFbAds.length ? selectedFbAds : [selectedFbAd])
    .map((a) => ({ mediaKind: a.mediaKind, url: a.assetUrl || a.thumbnailUrl || '', name: a.adName || '' }))
    .filter((c) => c.url);
  const imageUrls = allCreatives.filter((c) => c.mediaKind === 'image').map((c) => c.url);
  const videoUrls = allCreatives.filter((c) => c.mediaKind === 'video').map((c) => c.url);
  // FB names → the TT creative's file_name (what TT shows as the creative name).
  const imageNames = allCreatives.filter((c) => c.mediaKind === 'image').map((c) => c.name);
  const videoNames = allCreatives.filter((c) => c.mediaKind === 'video').map((c) => c.name);
  const creativeCount = imageUrls.length + videoUrls.length;
  const adCount = (imageUrls.length ? 1 : 0) + (videoUrls.length ? 1 : 0);

  // Start date/time in account tz (Kyiv). Fields default to "now" when untouched.
  const [nowDateIso, nowTimeStr] = nowKyivIso().split('T');
  const dateStr = ttForm.startDateStr || isoToDmy(nowDateIso); // "dd.mm.yyyy"
  const timeStr = ttForm.startTimeStr || nowTimeStr;           // "HH:MM"
  const dateIso = dmyToIso(dateStr);
  const timeValid = /^([01]?\d|2[0-3]):[0-5]\d$/.test(timeStr.trim());
  const startValid = !!dateIso && timeValid;
  const startAt = startValid ? `${dateIso}T${timeStr.trim()}` : '';

  // Target country → TikTok location_id. geoLabel is a "Name (CODE)" string;
  // it only resolves to an id once it exactly matches a known country (the
  // Combobox lets the user type freely, so mid-typing it won't resolve).
  const geoLabel = ttForm.geoLabel;
  const locationId = TT_LOCATION_ID_BY_LABEL[geoLabel];
  const geoValid = !!locationId;

  // Ad text defaults to the FB ad's own copy until the operator edits it
  // (undefined = untouched). Smart+ rejects empty text; the node also falls
  // back to campaignName as a last resort.
  const defaultAdText = (selectedFbAd.creativeBody || selectedFbAd.creativeTitle || '').slice(0, TT_AD_TEXT_MAX);
  const adText = ttForm.adText !== undefined ? ttForm.adText : defaultAdText;
  const adTextValid = adText.trim().length > 0 && adText.length <= TT_AD_TEXT_MAX;

  const accountValid = /^\d+$/.test(advertiserId);
  const identityValid = !!selIdentity;
  const pixelValid = !!selPixel;

  const canSubmit = !isLoading && cpaValid && budgetValid && adTextValid && geoValid
    && accountValid && identityValid && pixelValid
    && !!campaignName && !!adgroupName.trim() && !!adName.trim()
    && startValid && !!landingPageUrl && creativeCount > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void createTtCampaign({
      campaignName,
      adgroupName,
      adName,
      conversionBidPrice: parsedCpa,
      budgetLevel,
      bidStrategy,
      landingPageUrl,
      imageUrls,
      videoUrls,
      imageNames,
      videoNames,
      adText,
      dailyBudget: parsedBudget,
      startAt,
      accountTimezone: accountTz,
      locationId,
      advertiserId,
      identityId: selIdentity?.id,
      identityType: selIdentity?.type,
      identityBcId: selIdentity?.bc_id || undefined,
      pixelId: selPixel?.id,
    });
  };

  const handleReset = () => {
    resetTtCampaign();
    resetTtForm();
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
          <h2 className="font-bold text-xl">→ Create TT Campaign</h2>
          {!embedded && (
            <Button variant="outline" size="sm" onClick={onClose}>← Назад</Button>
          )}
        </div>

        {/* Info panel */}
        <section className="mb-4 border rounded-lg bg-emerald-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 mb-1">
            Smart+ native feed ad
          </div>
          <div className="text-xs text-emerald-900">
            Image creatives publish as native TikTok “Photo” posts — TT auto-adds music and renders them to a feed video. Campaigns are created <strong>paused</strong>; review in TT Ads Manager, then enable.
          </div>
        </section>
        <section className="mb-4 border rounded-lg bg-slate-100 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            TikTok Ads — fixed settings
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {TT_INFO.map((row) => (
              <div key={row.label} className="flex flex-col">
                <dt className="text-slate-500">{row.label}</dt>
                <dd className="font-mono text-slate-800 break-all">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-4">
          {/* TikTok account → identity + pixel, all loaded live from the account */}
          <div className="space-y-3 border rounded-lg bg-slate-50 p-3">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                TikTok account <span className="text-red-600">*</span>
              </label>
              <Combobox
                value={accountLabel}
                onChange={(v) => setTtForm({ accountLabel: v, identityLabel: undefined, pixelLabel: undefined })}
                options={accountOptions}
                placeholder={ttAccountsStatus === 'loading' ? 'Loading accounts…' : 'Search account…'}
                error={!accountValid}
                minSearchChars={2}
              />
              {ttAccountsStatus === 'error' && (
                <p className="text-xs text-red-600 mt-1">Couldn’t load accounts — check the tt_accounts list webhook.</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                Identity (TikTok account) <span className="text-red-600">*</span>
              </label>
              <Combobox
                value={ttForm.identityLabel ?? ''}
                onChange={(v) => setTtForm({ identityLabel: v })}
                options={identityOptions}
                placeholder={ttContextStatus === 'loading' ? 'Loading identities…' : 'Select identity…'}
                error={accountValid && !identityValid}
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                Pixel / funnel <span className="text-red-600">*</span>
              </label>
              <Combobox
                value={ttForm.pixelLabel ?? ''}
                onChange={(v) => setTtForm({ pixelLabel: v })}
                options={pixelOptions}
                placeholder={ttContextStatus === 'loading' ? 'Loading pixels…' : 'Select pixel…'}
                error={accountValid && !pixelValid}
              />
              {pixelValid && (
                <p className="text-xs mt-1 text-slate-600">
                  Landing URL <code>funnel=</code> set to <strong>{selPixel?.code}</strong> — TikTok optimizes and Binom attributes to the same pixel.
                </p>
              )}
              {ttContextStatus === 'error' && (
                <p className="text-xs text-red-600 mt-1">Couldn’t load this account’s identities/pixels.</p>
              )}
            </div>
          </div>

          {/* Bid strategy — pill toggle (same design as Destination) */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Bid strategy</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setTtForm({ bidStrategy: 'target_cpa' })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                  bidStrategy === 'target_cpa'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                    : 'border-input bg-white hover:bg-slate-50'
                }`}
              >
                Target CPA
              </button>
              <button
                type="button"
                onClick={() => setTtForm({ bidStrategy: 'max_results' })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                  bidStrategy === 'max_results'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                    : 'border-input bg-white hover:bg-slate-50'
                }`}
              >
                Maximum results
              </button>
            </div>
          </div>

          {/* Target CPA (Target-CPA strategy only) + Daily budget + budget level */}
          <div className="flex gap-2">
            {cpaNeeded && (
              <div className="flex-1">
                <label className="text-xs font-medium uppercase text-slate-500">
                  Target cost / result (USD) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">$</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={cpaText}
                    onChange={(e) => {
                      const raw = e.target.value.replace(',', '.');
                      if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                      setTtForm({ conversionBidPrice: raw });
                    }}
                    placeholder="0.50"
                    className={`pl-6 no-spinner ${cpaValid ? '' : 'border-red-400'}`}
                  />
                </div>
              </div>
            )}
            <div className="flex-1">
              <label className="text-xs font-medium uppercase text-slate-500">
                Daily budget (USD) <span className="text-red-600">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">$</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={budgetText}
                  onChange={(e) => {
                    const raw = e.target.value.replace(',', '.');
                    if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                    setTtForm({ dailyBudget: raw });
                  }}
                  placeholder="20"
                  className={`pl-6 no-spinner ${budgetValid ? '' : 'border-red-400'}`}
                />
              </div>
            </div>
          </div>

          {/* Budget level — pill toggle (same design as Destination) */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Budget level</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setTtForm({ budgetLevel: 'adgroup' })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                  budgetLevel === 'adgroup'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                    : 'border-input bg-white hover:bg-slate-50'
                }`}
              >
                Ad group budget
              </button>
              <button
                type="button"
                onClick={() => setTtForm({ budgetLevel: 'campaign' })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                  budgetLevel === 'campaign'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                    : 'border-input bg-white hover:bg-slate-50'
                }`}
              >
                Campaign budget
              </button>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {cpaNeeded ? 'Target CPA (BUTTON) bid. ' : 'Maximum results (no bid cap). '}Daily {budgetLevel === 'campaign' ? 'campaign' : 'ad group'} budget.
            </p>
          </div>

          {/* Schedule — presets + date (dd.mm.yyyy w/ calendar) + time (Kyiv, UTC+2) */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Start</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {[{ label: 'Today', n: 0 }, { label: 'Tomorrow', n: 1 }, { label: 'In 2 days', n: 2 }].map((p) => {
                const active = dateStr === dmyPlusDays(p.n);
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setTtForm({ startDateStr: dmyPlusDays(p.n) })}
                    className={`rounded-md border px-2.5 py-1.5 text-xs transition ${
                      active ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold' : 'border-input bg-white hover:bg-slate-50'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
              {/* date text (dd.mm.yyyy) + calendar-picker icon */}
              <div className="relative">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={dateStr}
                  onChange={(e) => setTtForm({ startDateStr: e.target.value })}
                  placeholder="dd.mm.yyyy"
                  className={`w-32 pr-8 ${dateIso ? '' : 'border-red-400'}`}
                />
                <button
                  type="button"
                  aria-label="Open calendar"
                  onClick={() => {
                    const el = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
                    if (el) { try { el.showPicker ? el.showPicker() : el.focus(); } catch { el.focus(); } }
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
                >
                  📅
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={dateIso}
                  onChange={(e) => setTtForm({ startDateStr: e.target.value ? isoToDmy(e.target.value) : '' })}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="absolute inset-0 h-0 w-0 opacity-0 pointer-events-none"
                />
              </div>
              <Input
                type="time"
                value={timeStr}
                onChange={(e) => setTtForm({ startTimeStr: e.target.value })}
                className={`w-28 ${timeValid ? '' : 'border-red-400'}`}
              />
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Entered in <strong>Kyiv time</strong> (UTC+2), <code>dd.mm.yyyy</code>. Defaults to now.
              {accountTz && startValid && tzOffsetLabel(accountTz) !== 'UTC+2' && (
                <> This account is <strong>{tzOffsetLabel(accountTz)}</strong> → delivers at <strong>{kyivToAccountWall(startAt, accountTz)}</strong> account time.</>
              )}
            </p>
          </div>

          {/* GEO — target country (searchable; maps to a TikTok location_id) */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              GEO — target country <span className="text-red-600">*</span>
            </label>
            <Combobox
              value={geoLabel}
              onChange={(v) => setTtForm({ geoLabel: v })}
              options={TT_COUNTRY_OPTIONS}
              placeholder="Type a country or ISO code…"
              error={!geoValid}
            />
            <p className="text-xs text-slate-600 mt-1">
              {geoValid
                ? `TikTok location_id ${locationId}`
                : 'Pick a country from the list.'}
            </p>
          </div>

          {/* Campaign Name — editable, defaults to the Binom name */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              Campaign Name <span className="text-red-600">*</span>
            </label>
            <Input
              type="text"
              value={campaignName}
              onChange={(e) => setTtForm({ campaignName: e.target.value })}
              placeholder="TT campaign name"
              className={campaignName.trim() ? '' : 'border-red-400'}
            />
            {ttForm.campaignName !== undefined && ttForm.campaignName !== binomCampaignName && (
              <button
                type="button"
                onClick={() => setTtForm({ campaignName: undefined })}
                className="text-xs text-blue-600 mt-1 hover:underline"
              >
                ↺ Reset to Binom name
              </button>
            )}
          </div>

          {/* Ad group name — follows the campaign name unless overridden */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Ad group name</label>
            <Input
              type="text"
              value={adgroupName}
              onChange={(e) => setTtForm({ adgroupName: e.target.value })}
              placeholder="follows campaign name"
              className={adgroupName.trim() ? '' : 'border-red-400'}
            />
            {ttForm.adgroupName !== undefined && (
              <button type="button" onClick={() => setTtForm({ adgroupName: undefined })} className="text-xs text-blue-600 mt-1 hover:underline">↺ Follow campaign name</button>
            )}
          </div>

          {/* Ad name — own row, follows the campaign name unless overridden */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Ad name</label>
            <Input
              type="text"
              value={adName}
              onChange={(e) => setTtForm({ adName: e.target.value })}
              placeholder="follows campaign name"
              className={adName.trim() ? '' : 'border-red-400'}
            />
            {ttForm.adName !== undefined && (
              <button type="button" onClick={() => setTtForm({ adName: undefined })} className="text-xs text-blue-600 mt-1 hover:underline">↺ Follow campaign name</button>
            )}
          </div>

          {/* Landing Page URL (read-only from Binom result) */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              Landing Page URL (Binom click URL)
            </label>
            <CopyableCard label="Landing Page URL" value={landingPageUrl} />
          </div>

          {/* Ad primary text — prefilled from the FB ad's own copy, editable */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              Ad text <span className="text-red-600">*</span>
            </label>
            <textarea
              value={adText}
              onChange={(e) => setTtForm({ adText: e.target.value.slice(0, TT_AD_TEXT_MAX) })}
              rows={3}
              placeholder="Primary text shown above the creative on the TikTok feed…"
              className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y ${adTextValid ? 'border-input' : 'border-red-400'}`}
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-slate-500">
                Prefilled from the FB ad — edit as needed.
              </p>
              <span className={`text-xs ${adText.length >= TT_AD_TEXT_MAX ? 'text-red-600' : 'text-slate-400'}`}>
                {adText.length}/{TT_AD_TEXT_MAX}
              </span>
            </div>
          </div>

          {/* Selected creatives → how they'll be grouped into ads */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              Creatives ({creativeCount}) → {adCount} ad{adCount === 1 ? '' : 's'}
            </label>
            <div className="mt-1 border rounded-lg bg-slate-50 p-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                {(selectedFbAds.length ? selectedFbAds : [selectedFbAd]).map((a, i) => (
                  <div key={a.adId || i} className="relative" title={a.adName}>
                    {a.thumbnailUrl ? (
                      <img src={a.thumbnailUrl} alt="" className="h-14 w-14 rounded object-cover border" />
                    ) : (
                      <div className="h-14 w-14 rounded bg-slate-200 flex items-center justify-center text-[9px] text-slate-500">no thumb</div>
                    )}
                    <span className={`absolute -top-1 -right-1 rounded px-1 text-[9px] font-semibold text-white ${a.mediaKind === 'video' ? 'bg-purple-600' : 'bg-emerald-600'}`}>
                      {a.mediaKind === 'video' ? 'V' : 'IMG'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-600">
                {imageUrls.length > 0 && <>{imageUrls.length} image{imageUrls.length === 1 ? '' : 's'} → 1 combined Photo ad. </>}
                {videoUrls.length > 0 && <>{videoUrls.length} video{videoUrls.length === 1 ? '' : 's'} → 1 combined ad.</>}
              </p>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSubmit} disabled={!canSubmit} className="flex-1">
              {isLoading ? 'Creating…' : 'Create TT Campaign'}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={isLoading}>
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
              Fill the form and press Create TT Campaign. Results appear here.
            </div>
          )}
          {status === 'loading' && (
            <div className="text-slate-600 text-sm">Creating TT campaign — usually 10–60s (image upload + 3 API calls).</div>
          )}
          {status === 'error' && (
            <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md whitespace-pre-wrap">
              <div className="font-semibold mb-1">Error</div>
              {error ?? 'Unknown error'}
            </div>
          )}
          {status === 'success' && result && (
            <>
              <CopyableCard label="TT Campaign ID" value={result.campaign_id} />
              <CopyableCard label="TT Adgroup ID" value={result.adgroup_id} />
              <CopyableCard label="TT Ad ID" value={result.ad_id} />
              {result.video_id && (
                <CopyableCard label="TT Video ID" value={result.video_id} />
              )}
              {result.cover_image_id && (
                <CopyableCard label="TT Cover Image ID" value={result.cover_image_id} />
              )}
              {result.identity_id && (
                <CopyableCard label="TT Identity ID" value={result.identity_id} />
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

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  { label: 'Advertiser', value: '7654600970270867474' },
  { label: 'Identity', value: 'personalguide333 (BC_AUTH_TT)' },
  { label: 'Pixel', value: 'GenOst (D7G9EPRC77U62Q87BP70)' },
  { label: 'Campaign type', value: 'Upgraded Smart+ (auto-optimized)' },
  { label: 'Optimization', value: 'CONVERT / BUTTON' },
  { label: 'Objective', value: 'LEAD_GENERATION' },
  { label: 'Ad format', value: 'Native Photo (image) / Video — TT auto-renders' },
  { label: 'Account timezone', value: 'UTC+2 (Europe/Kiev)' },
] as const;

type TtStartDate = 'now' | 'tomorrow' | 'tomorrow+1' | 'tomorrow+2';

const TT_START_DATE_OPTIONS: Array<{ value: TtStartDate; label: string }> = [
  { value: 'now', label: 'Now' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'tomorrow+1', label: 'In 2 days' },
  { value: 'tomorrow+2', label: 'In 3 days' },
];

// value = UTC offset in minutes (string). n8n converts the chosen start day to
// the ad account timezone using this.
const TT_TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '120', label: '(UTC+02:00) Central European Summer Time (Austria)' },
  { value: '180', label: '(UTC+03:00) Kyiv (EEST)' },
  { value: '0', label: '(UTC±00:00) UTC' },
  { value: '-420', label: '(UTC-07:00) Los Angeles (PDT)' },
];

// TikTok ad primary-text hard limit.
const TT_AD_TEXT_MAX = 100;

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
  const binomOfferResult = useAppStore((s) => s.binomOfferResult);
  const status = useAppStore((s) => s.ttCampaignStatus);
  const result = useAppStore((s) => s.ttCampaignResult);
  const error = useAppStore((s) => s.ttCampaignError);
  const createTtCampaign = useAppStore((s) => s.createTtCampaign);
  const resetTtCampaign = useAppStore((s) => s.resetTtCampaign);
  const ttForm = useAppStore((s) => s.megatoolTtForm);
  const setTtForm = useAppStore((s) => s.setTtForm);
  const resetTtForm = useAppStore((s) => s.resetTtForm);

  const [showRaw, setShowRaw] = useState(false);

  const isLoading = status === 'loading';

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
  const cpaValid = cpaText.trim() !== '' && Number.isFinite(parsedCpa) && parsedCpa > 0;

  const budgetText = ttForm.dailyBudget;
  const parsedBudget = Number((budgetText || '0').replace(',', '.'));
  const budgetValid = budgetText.trim() !== '' && Number.isFinite(parsedBudget) && parsedBudget > 0;

  // Campaign name defaults to the Binom name until the operator edits it.
  const binomCampaignName = binomOfferResult.binomCampaignName ?? '';
  const campaignName = ttForm.campaignName !== undefined ? ttForm.campaignName : binomCampaignName;
  const landingPageUrl = binomOfferResult.binomCampaignUrl ?? '';
  const isVideo = selectedFbAd.mediaKind === 'video';
  const creativeUrl = selectedFbAd.assetUrl || selectedFbAd.thumbnailUrl || '';

  const startDate = ttForm.startDate;
  const startTimezone = ttForm.startTimezone;

  // Ad text defaults to the FB ad's own copy until the operator edits it
  // (undefined = untouched). Smart+ rejects empty text; the node also falls
  // back to campaignName as a last resort.
  const defaultAdText = (selectedFbAd.creativeBody || selectedFbAd.creativeTitle || '').slice(0, TT_AD_TEXT_MAX);
  const adText = ttForm.adText !== undefined ? ttForm.adText : defaultAdText;
  const adTextValid = adText.trim().length > 0 && adText.length <= TT_AD_TEXT_MAX;

  const canSubmit = !isLoading && cpaValid && budgetValid && adTextValid
    && !!campaignName && !!landingPageUrl && !!creativeUrl;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void createTtCampaign({
      campaignName,
      conversionBidPrice: parsedCpa,
      landingPageUrl,
      ...(isVideo ? { videoUrl: creativeUrl } : { imageUrl: creativeUrl }),
      adText,
      dailyBudget: parsedBudget,
      startDate,
      startTimezone,
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
          {/* Bid strategy — Target CPA is the only option today */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Bid Strategy</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                disabled
                className="rounded-md border border-blue-600 bg-blue-50 text-blue-900 font-semibold px-4 py-1.5 text-sm min-w-[7rem] cursor-default"
              >
                Target CPA
              </button>
              <span className="text-[10px] text-slate-400 self-center">
                more options in later iteration
              </span>
            </div>
          </div>

          {/* Target cost per result + Daily budget */}
          <div className="flex gap-2">
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
                  placeholder="1.50"
                  className={`pl-6 no-spinner ${cpaValid ? '' : 'border-red-400'}`}
                />
              </div>
            </div>
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
          <p className="text-xs text-slate-600 -mt-2">
            Target CPA (BUTTON) & campaign daily budget. Comma or dot separator.
          </p>

          {/* Schedule — start day + timezone (TT interprets in the ad account tz) */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium uppercase text-slate-500">Start</label>
              <select
                value={startDate}
                onChange={(e) => setTtForm({ startDate: e.target.value as TtStartDate })}
                className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {TT_START_DATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium uppercase text-slate-500">Timezone</label>
              <select
                value={startTimezone}
                onChange={(e) => setTtForm({ startTimezone: e.target.value })}
                disabled={startDate === 'now'}
                className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-slate-100 disabled:text-slate-400"
              >
                {TT_TIMEZONE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-600 -mt-2">
            {startDate === 'now'
              ? 'Delivery starts immediately once you enable the campaign.'
              : 'Starts at 00:00 of the chosen day in the selected timezone.'}
            {startDate !== 'now' && (
              <> TikTok shows schedules in the account timezone (UTC+2), so it displays the same moment converted — not the label picked here.</>
            )}
          </p>

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

          {/* FB creative preview */}
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              FB Creative ({isVideo ? 'video' : 'image'} uploaded to TT)
            </label>
            <div className="mt-1 flex items-center gap-3 border rounded-lg bg-slate-50 p-2">
              {selectedFbAd.thumbnailUrl ? (
                <img
                  src={selectedFbAd.thumbnailUrl}
                  alt=""
                  className="h-20 w-20 rounded object-cover shrink-0 border"
                />
              ) : (
                <div className="h-20 w-20 rounded bg-slate-200 shrink-0 flex items-center justify-center text-[10px] text-slate-500">
                  no thumb
                </div>
              )}
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-semibold text-slate-800 truncate" title={selectedFbAd.adName}>
                  {selectedFbAd.adName}
                </div>
                <div className="text-slate-500 font-mono break-all text-[10px]" title={creativeUrl}>
                  {creativeUrl || '(no creative url)'}
                </div>
              </div>
            </div>
            {!isVideo && (
              <p className="text-xs text-slate-500 mt-1">
                Uploaded as a native TikTok Photo creative — Smart+ adds music and renders it to a feed video automatically.
              </p>
            )}
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

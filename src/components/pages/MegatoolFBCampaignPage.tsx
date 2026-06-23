import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAppStore, type ArticleStatus, type FbAd, type FbAdset, type FbCampaign, type FbCreative, type SelectedFbAd } from '@/store/useAppStore';

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Fetching campaign…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

// FB returns currency in minor units (cents) as a string. Display as a plain
// USD-ish figure with a tag so we don't lie about the currency — many ad
// accounts run non-USD.
const formatBudget = (raw?: string): string | null => {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return (n / 100).toFixed(2);
};

const effectiveStatusBadge = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'bg-green-100 text-green-800 border-green-300';
  if (s === 'PAUSED') return 'bg-slate-200 text-slate-700 border-slate-300';
  if (s.includes('DISAPPROVED') || s.includes('REJECT') || s === 'WITH_ISSUES') return 'bg-red-100 text-red-800 border-red-300';
  if (s.includes('PENDING') || s.includes('REVIEW') || s.includes('LEARNING')) return 'bg-amber-100 text-amber-800 border-amber-300';
  if (s === 'ARCHIVED' || s === 'DELETED') return 'bg-slate-300 text-slate-600 border-slate-400';
  return 'bg-slate-100 text-slate-700 border-slate-300';
};

const Badge = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className ?? ''}`}>
    {children}
  </span>
);

const TruncatedBody = ({ text }: { text: string }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const LIMIT = 120;
  if (text.length <= LIMIT) return <p className="text-xs text-slate-600 whitespace-pre-wrap">{text}</p>;
  return (
    <p className="text-xs text-slate-600 whitespace-pre-wrap">
      {expanded ? text : `${text.slice(0, LIMIT)}…`}{' '}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-blue-600 hover:underline text-[11px]"
      >
        {expanded ? 'less' : 'more'}
      </button>
    </p>
  );
};

const pickCreativeImage = (creative: FbCreative): string | null => {
  // FB returns image_url null for video creatives — fall back to thumbnail_url,
  // then to the link_data.picture (used by Page Post Ads).
  return creative.image_url || creative.thumbnail_url || creative.object_story_spec?.link_data?.picture || null;
};

const extractTrackingUrl = (creative: FbCreative): string => {
  return (
    creative.link_url ||
    creative.object_story_spec?.link_data?.link ||
    creative.object_story_spec?.link_data?.call_to_action?.value?.link ||
    creative.object_story_spec?.video_data?.call_to_action?.value?.link ||
    ''
  );
};

interface AdCardProps {
  ad: FbAd;
  adset: FbAdset;
  campaign: FbCampaign;
  isSelected: boolean;
  onSelect: (snapshot: SelectedFbAd) => void;
}

const AdCard = ({ ad, adset, campaign, isSelected, onSelect }: AdCardProps) => {
  const creative = ad.creative ?? ({} as FbCreative);
  const img = pickCreativeImage(creative);
  const title = creative.title || creative.object_story_spec?.link_data?.name || '';
  const body = creative.body || creative.object_story_spec?.link_data?.message || '';
  const cta = creative.call_to_action_type || creative.object_story_spec?.link_data?.call_to_action?.type || '';
  const link = extractTrackingUrl(creative);
  const hasLink = Boolean(link);

  const handleClick = () => {
    const snapshot: SelectedFbAd = {
      adId: ad.id,
      adName: ad.name,
      adsetId: adset.id,
      adsetName: adset.name,
      campaignId: campaign.id,
      campaignName: campaign.name,
      trackingUrl: link,
      thumbnailUrl: img ?? '',
      creativeTitle: title,
      creativeBody: body,
    };
    onSelect(snapshot);
  };

  return (
    // Rendered as a div + role="button" because the card contains nested
    // interactive children (the "more / less" toggle in TruncatedBody, plus
    // the link anchor) — a <button> can't contain another <button>.
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-pressed={isSelected}
      className={`text-left border rounded-lg bg-white overflow-hidden shadow-sm flex flex-col transition-all hover:shadow-md focus:outline-none cursor-pointer ${
        isSelected ? 'ring-2 ring-amber-500 border-amber-500' : ''
      }`}
    >
      <div className="bg-slate-50 aspect-square w-full overflow-hidden flex items-center justify-center text-slate-400 text-xs relative">
        {img ? (
          <img src={img} alt={ad.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span>No image</span>
        )}
        {isSelected && (
          <span className="absolute top-1 right-1 bg-amber-500 text-white text-[10px] font-bold uppercase px-1.5 py-0.5 rounded">
            Selected
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Badge className={effectiveStatusBadge(ad.effective_status)}>{ad.effective_status}</Badge>
          <span className="font-mono text-[10px] text-slate-400 truncate" title={ad.id}>#{ad.id}</span>
        </div>
        <div className="text-xs font-semibold text-slate-800 line-clamp-2" title={ad.name}>{ad.name}</div>
        {title && <div className="text-sm font-medium text-slate-900">{title}</div>}
        <TruncatedBody text={body} />
        {!hasLink && (
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            no tracking URL — Binom flow unavailable
          </div>
        )}
        {(cta || link) && (
          <div className="mt-auto flex flex-col gap-1 pt-2 border-t border-slate-100">
            {cta && <div className="text-[11px] text-slate-500"><span className="font-semibold">CTA:</span> {cta}</div>}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] text-blue-600 hover:underline truncate"
                title={link}
              >
                {link}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface AdsetBlockProps {
  adset: FbAdset;
  campaign: FbCampaign;
  selectedAdId: string | null;
  onSelect: (snapshot: SelectedFbAd) => void;
}

const AdsetBlock = ({ adset, campaign, selectedAdId, onSelect }: AdsetBlockProps) => {
  const dailyBudget = formatBudget(adset.daily_budget);
  const lifetimeBudget = formatBudget(adset.lifetime_budget);
  return (
    <section className="border rounded-xl bg-slate-50 p-4">
      <header className="flex flex-wrap items-center gap-3 mb-3">
        <h3 className="font-bold text-base text-slate-900 flex-1 min-w-0 truncate" title={adset.name}>{adset.name}</h3>
        <Badge className={effectiveStatusBadge(adset.effective_status)}>{adset.effective_status}</Badge>
        {adset.optimization_goal && <Badge className="bg-slate-100 text-slate-700 border-slate-300">{adset.optimization_goal}</Badge>}
        {dailyBudget && <span className="text-xs text-slate-600"><span className="font-semibold">Daily:</span> {dailyBudget}</span>}
        {lifetimeBudget && <span className="text-xs text-slate-600"><span className="font-semibold">Lifetime:</span> {lifetimeBudget}</span>}
        <span className="text-xs text-slate-500">{adset.ads.length} ad{adset.ads.length === 1 ? '' : 's'}</span>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {adset.ads.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            adset={adset}
            campaign={campaign}
            isSelected={selectedAdId === ad.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
};

interface MegatoolFBCampaignPageProps {
  onOpenBinomOffer?: () => void;
}

export const MegatoolFBCampaignPage = ({ onOpenBinomOffer }: MegatoolFBCampaignPageProps = {}) => {
  const [campaignId, setCampaignId] = useState('');
  const [idError, setIdError] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = useAppStore((s) => s.fbCampaignStatus);
  const data = useAppStore((s) => s.fbCampaignData);
  const error = useAppStore((s) => s.fbCampaignError);
  const fetchFbCampaign = useAppStore((s) => s.fetchFbCampaign);
  const selectedFbAd = useAppStore((s) => s.selectedFbAd);
  const setSelectedFbAd = useAppStore((s) => s.setSelectedFbAd);
  const clearSelectedFbAd = useAppStore((s) => s.clearSelectedFbAd);
  const closeBinomOffer = useAppStore((s) => s.closeBinomOffer);
  const resetBinomOffer = useAppStore((s) => s.resetBinomOffer);

  const isLoading = status === 'loading';

  // Partition adsets so the active ones surface to the top — the operator
  // usually only cares about what's actually serving.
  const { activeAdsets, inactiveAdsets } = useMemo(() => {
    if (!data) return { activeAdsets: [], inactiveAdsets: [] };
    const active: FbAdset[] = [];
    const inactive: FbAdset[] = [];
    for (const a of data.adsets) {
      if (a.effective_status?.toUpperCase() === 'ACTIVE') active.push(a);
      else inactive.push(a);
    }
    return { activeAdsets: active, inactiveAdsets: inactive };
  }, [data]);

  const handleFetch = () => {
    const trimmed = campaignId.trim();
    if (!trimmed) { setIdError(true); return; }
    setIdError(false);
    // Fetching a new campaign invalidates the previous selection and any
    // Binom offer the operator may have built from it — clear both so the
    // Create Binom Offer sub-tab can't carry stale state across campaigns.
    clearSelectedFbAd();
    closeBinomOffer();
    resetBinomOffer();
    void fetchFbCampaign(trimmed);
  };

  const handleCopyJson = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked in some contexts — swallow; the user can
      // still grab the response from the network panel.
    }
  };

  const campaign = data?.campaign;
  const campaignDaily = formatBudget(campaign?.daily_budget);
  const campaignLifetime = formatBudget(campaign?.lifetime_budget);

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl mb-2">1. Input</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Source FB Campaign ID *</label>
              <Input
                value={campaignId}
                onChange={(e) => {
                  setCampaignId(e.target.value);
                  if (idError) setIdError(false);
                }}
                placeholder="e.g. 1203456789012345"
                className={idError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                disabled={isLoading}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFetch(); }}
              />
              {idError && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>
          </div>

          <Button onClick={handleFetch} className="mt-2" disabled={isLoading}>
            {isLoading ? 'Fetching…' : 'Fetch'}
          </Button>

          <p className="text-[11px] text-slate-500 leading-snug mt-2">
            Reads the full campaign tree — adsets and ads with creatives — by Source FB Campaign ID.
            FB tokens are rotated server-side.
          </p>
        </div>
      </div>

      {/* 2. Results */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <h2 className="font-bold text-xl">2. Campaign Tree</h2>
            <Button
              onClick={handleCopyJson}
              disabled={status !== 'success' || !data}
              size="sm"
              className="bg-black hover:bg-gray-800 text-white"
            >
              {copied ? 'Copied!' : 'Copy raw JSON'}
            </Button>
          </div>

          {/* Selected-ad banner — appears once the operator picks any ad card.
              The "Create Binom Offer" CTA is disabled when no tracking URL was
              extractable from the creative; we keep selection allowed so the
              operator can still inspect the ad. */}
          {selectedFbAd && (
            <div className="-mx-4 px-4 py-2 bg-amber-50 border-y border-amber-200 flex items-center gap-3 shrink-0">
              {selectedFbAd.thumbnailUrl && (
                <img
                  src={selectedFbAd.thumbnailUrl}
                  alt=""
                  className="h-10 w-10 rounded object-cover shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-amber-900">
                  <span className="font-semibold">Selected:</span>{' '}
                  <span className="truncate" title={selectedFbAd.adName}>{selectedFbAd.adName}</span>
                </div>
                <div className="text-[10px] text-amber-800/70 truncate" title={selectedFbAd.trackingUrl}>
                  {selectedFbAd.trackingUrl || 'no tracking URL'}
                </div>
              </div>
              <Button
                size="sm"
                disabled={!selectedFbAd.trackingUrl}
                onClick={() => onOpenBinomOffer?.()}
                className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                title={selectedFbAd.trackingUrl ? '' : 'Selected ad has no tracking URL — Binom flow unavailable'}
              >
                → Create Binom Offer
              </Button>
              <button
                type="button"
                onClick={clearSelectedFbAd}
                aria-label="Clear selected ad"
                className="text-amber-700 hover:text-amber-900 text-lg leading-none px-1 shrink-0"
              >
                ×
              </button>
            </div>
          )}

          {/* Status bar */}
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
            {data && status === 'success' && (
              <span className="text-xs text-slate-500 font-mono">
                {data.adsets.length} adset{data.adsets.length === 1 ? '' : 's'} · {data.totalAds} ad{data.totalAds === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4">
            {status === 'idle' && (
              <div className="text-gray-400 italic">Waiting for a campaign ID</div>
            )}
            {status === 'loading' && (
              <div className="text-slate-600 text-sm">Reading campaign tree from Facebook — usually 5–30s.</div>
            )}
            {status === 'error' && (
              <div className="text-red-600 text-sm whitespace-pre-wrap">
                {error ?? 'Unknown error'}
              </div>
            )}
            {status === 'success' && campaign && (
              <div className="flex flex-col gap-4">
                {/* Campaign summary */}
                <section className="border rounded-xl bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h3 className="font-bold text-lg text-slate-900 flex-1 min-w-0 truncate" title={campaign.name}>
                      {campaign.name}
                    </h3>
                    {campaign.effective_status && (
                      <Badge className={effectiveStatusBadge(campaign.effective_status)}>{campaign.effective_status}</Badge>
                    )}
                    {campaign.status && campaign.status !== campaign.effective_status && (
                      <Badge className="bg-slate-100 text-slate-700 border-slate-300">{campaign.status}</Badge>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-y-1 gap-x-4 text-xs text-slate-700">
                    <div><dt className="text-slate-500">ID</dt><dd className="font-mono">{campaign.id}</dd></div>
                    {campaign.objective && <div><dt className="text-slate-500">Objective</dt><dd>{campaign.objective}</dd></div>}
                    {campaign.account_id && <div><dt className="text-slate-500">Account</dt><dd className="font-mono">{campaign.account_id}</dd></div>}
                    {campaignDaily && <div><dt className="text-slate-500">Daily budget</dt><dd>{campaignDaily}</dd></div>}
                    {campaignLifetime && <div><dt className="text-slate-500">Lifetime budget</dt><dd>{campaignLifetime}</dd></div>}
                  </dl>
                </section>

                {activeAdsets.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-green-700">Active</h3>
                    {activeAdsets.map((a) => (
                      <AdsetBlock
                        key={a.id}
                        adset={a}
                        campaign={campaign}
                        selectedAdId={selectedFbAd?.adId ?? null}
                        onSelect={setSelectedFbAd}
                      />
                    ))}
                  </div>
                )}

                {inactiveAdsets.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Inactive / Paused</h3>
                    {inactiveAdsets.map((a) => (
                      <AdsetBlock
                        key={a.id}
                        adset={a}
                        campaign={campaign}
                        selectedAdId={selectedFbAd?.adId ?? null}
                        onSelect={setSelectedFbAd}
                      />
                    ))}
                  </div>
                )}

                {activeAdsets.length === 0 && inactiveAdsets.length === 0 && (
                  <div className="text-slate-500 text-sm italic">Campaign has no adsets.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

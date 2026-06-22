import { useMemo, useState } from 'react';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { OFFER_GEOS, OFFER_GEO_LABELS } from '@/lib/offerGeos';
import { useAppStore } from '@/store/useAppStore';

// === Static dropdown data (mirrors the GET /api/rsoc-articles/options examples
// === in article API.txt — replace with a live fetch once we have the n8n proxy).

const TRAFFIC_SOURCES = ['facebook', 'snapchat', 'tiktok', 'newsbreak', 'smartnews'] as const;
type TrafficSource = typeof TRAFFIC_SOURCES[number];

// Short codes used in the auto-generated campaign / offer names, mirroring the
// "FB" / "SC" / … convention shown in the operator screenshots.
const TRAFFIC_SHORT: Record<TrafficSource, string> = {
  facebook: 'FB',
  snapchat: 'SC',
  tiktok: 'TT',
  newsbreak: 'NB',
  smartnews: 'SN',
};

// Domains the operator can pick from per traffic source. Pulled from the
// `provider_fields.amo.domain.*` example in the OpenAPI doc.
const DOMAINS_BY_TRAFFIC: Record<TrafficSource, string[]> = {
  facebook: ['fintreat.com', 'contranoche.com', 'contradia.com'],
  snapchat: ['moneytano.com'],
  tiktok: ['finomira.com', 'moneytano.com'],
  newsbreak: ['fintreat.com', 'contranoche.com'],
  smartnews: ['fintreat.com', 'contranoche.com'],
};

const TRACKER_LAYOUTS = ['tango', 'bolt', 'india', 'poland', 'sierra', 'smart'] as const;
const STATUSES = ['draft', 'published'] as const;
const PROVIDERS = ['amo'] as const; // future: 'innolytica', 'inuvo', 'jam', 'tonic'

// Allowed FB pixels. Extend by editing this list — eventually fetched from
// the user-settings API once the proxy exists.
const CAMPAIGN_PIXELS: string[] = [
  '1055345896374786',
  '479921728353371',
  '799437594558386',
];

// Campaign group UUIDs the user can pick from — display name → UUID. The list
// has a single entry (ILAB) right now and will grow as more teams are wired in.
const CAMPAIGN_GROUPS: { name: string; uuid: string }[] = [
  { name: 'ILAB', uuid: '05715f2c-827b-4665-970b-7340a0c4c258' },
];

// === Article HTML → { title, intro, body } splitter. The generation workflow
// === emits <article class="article-card"> with an <h1>, then alternating
// === <h2>/<h3>/<p> children. RSOC needs title separately, an "intro" first
// === paragraph (min 50 words) and the rest as body HTML.
interface ParsedArticle { title: string; intro: string; body: string; }
const parseArticle = (html: string): ParsedArticle => {
  if (!html) return { title: '', intro: '', body: '' };
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const articleNode = doc.querySelector('article.article-card');
    if (!articleNode) return { title: '', intro: '', body: '' };

    const h1 = articleNode.querySelector('h1');
    const title = (h1?.textContent ?? '').trim();

    // Walk direct children: skip H1, capture the first non-empty <p> as intro,
    // then concat everything after that into body HTML.
    const children = Array.from(articleNode.children);
    let introHtml = '';
    let introIdx = -1;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (el.tagName === 'H1') continue;
      if (el.tagName === 'P' && (el.textContent ?? '').trim()) {
        introHtml = (el.textContent ?? '').trim();
        introIdx = i;
        break;
      }
    }
    const bodyHtml = children
      .slice(introIdx + 1)
      .map((el) => el.outerHTML)
      .join('\n');
    return { title, intro: introHtml, body: bodyHtml };
  } catch {
    return { title: '', intro: '', body: '' };
  }
};

const wordCount = (s: string): number => {
  if (!s) return 0;
  // Strip HTML tags so the count reflects the actual prose, not the markup.
  const text = s.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ');
  return text.trim().split(/\s+/).filter(Boolean).length;
};

// "United States (US)" → "US" / "Worldwide (WW)" → "WW"
const codeFromLabel = (label: string): string => {
  const m = label.match(/\(([A-Z]+)\)\s*$/);
  return m ? m[1] : '';
};

// Look up a "Name (CODE)" label from an ISO code — used to seed the country
// combobox from the upstream Article-tab geo string (e.g. "United States (US)").
const labelFromCode = (code: string): string => {
  const g = OFFER_GEOS.find((g) => g.code === code);
  return g ? `${g.name} (${g.code})` : '';
};

const titleCase = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';

const PUBLISH_URL = import.meta.env.PUBLIC_WEBHOOK_RSOC_PUBLISH_URL as string | undefined;

interface OfferArticlePageProps {
  onClose: () => void;
}

export const OfferArticlePage = ({ onClose }: OfferArticlePageProps) => {
  const articleHtml = useAppStore((s) => s.articleHtml);
  const articleInputs = useAppStore((s) => s.articleInputs);

  const parsed = useMemo(() => parseArticle(articleHtml ?? ''), [articleHtml]);
  const defaultCountryLabel = useMemo(() => {
    const code = codeFromLabel(articleInputs?.geo ?? '');
    return labelFromCode(code) || 'Worldwide (WW)';
  }, [articleInputs?.geo]);

  // === Base fields ===
  const [name, setName] = useState(articleInputs?.topic ?? parsed.title);
  const [trafficSource, setTrafficSource] = useState<TrafficSource>('facebook');
  const [trackerEnabled, setTrackerEnabled] = useState(true);

  // === Tracker fields (only sent when trackerEnabled) ===
  const [offerCountryLabel, setOfferCountryLabel] = useState(defaultCountryLabel);
  const [campaignPixel, setCampaignPixel] = useState('');
  const [campaignConversionEvent, setCampaignConversionEvent] = useState('Lead');
  const [campaignSource, setCampaignSource] = useState<'none' | 'create'>('create');
  const [campaignGroupUuid, setCampaignGroupUuid] = useState(CAMPAIGN_GROUPS[0]?.uuid ?? '');
  // null = follow the live auto-derived name; string = operator typed an override.
  // Reset button on the field flips it back to null.
  const [campaignNameManual, setCampaignNameManual] = useState<string | null>(null);

  // === Provider selection + amo fields ===
  const [providerSlugs, setProviderSlugs] = useState<string[]>(['amo']);
  const [amoDomain, setAmoDomain] = useState(DOMAINS_BY_TRAFFIC.facebook[0]);
  const [amoTitle, setAmoTitle] = useState(parsed.title);
  const [amoIntro, setAmoIntro] = useState(parsed.intro);
  const [amoBody, setAmoBody] = useState(parsed.body);
  const [amoKeywordsRaw, setAmoKeywordsRaw] = useState(articleInputs?.topic ?? '');
  const [amoLayout, setAmoLayout] = useState<typeof TRACKER_LAYOUTS[number]>('tango');
  const [amoLayoutScroll, setAmoLayoutScroll] = useState(false);
  const [amoChannelId, setAmoChannelId] = useState('');
  // Override-country combobox value. Empty = inherit from tracker_fields.
  const [amoOfferCountryLabel, setAmoOfferCountryLabel] = useState('');
  // Same manual-override pattern as campaign_name: null = use the live
  // auto-derived offer name; string = use this verbatim. Set either by typing
  // in the text input or by picking a template from the quick-fill dropdown.
  const [amoOfferNameManual, setAmoOfferNameManual] = useState<string | null>(null);

  const [status, setStatus] = useState<typeof STATUSES[number]>('draft');

  // === Submit state ===
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResponse, setSubmitResponse] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // When traffic source changes, snap the domain back to the first allowed value
  // for that source (the previous selection is almost always invalid).
  const handleTrafficSourceChange = (v: TrafficSource) => {
    setTrafficSource(v);
    const allowed = DOMAINS_BY_TRAFFIC[v];
    if (!allowed.includes(amoDomain)) setAmoDomain(allowed[0]);
  };

  const toggleProvider = (slug: string, checked: boolean) => {
    setProviderSlugs((p) => (checked ? [...p, slug] : p.filter((s) => s !== slug)));
  };

  const offerCountryCode = codeFromLabel(offerCountryLabel);
  const amoOfferCountryCode = codeFromLabel(amoOfferCountryLabel);

  // === Auto-generated names (mirror the format shown in the operator screens) ===
  // Campaign Name → "{name} | {country} | {traffic} | Buyer_Dev"
  // Offer Name (Tracker) → "{name} | {country} | {traffic} | Buyer_Dev | {Layout} | {Provider} | ch {channel}"
  const autoCampaignName = useMemo(() => {
    const parts = [name, offerCountryCode, TRAFFIC_SHORT[trafficSource], 'Buyer_Dev'];
    return parts.filter(Boolean).join(' | ');
  }, [name, offerCountryCode, trafficSource]);

  const autoOfferName = useMemo(() => {
    const provider = providerSlugs[0] ?? 'amo';
    const chSegment = amoChannelId ? `ch ${amoChannelId}` : '';
    const parts = [
      name,
      offerCountryCode,
      TRAFFIC_SHORT[trafficSource],
      'Buyer_Dev',
      titleCase(amoLayout),
      titleCase(provider),
      chSegment,
    ];
    return parts.filter(Boolean).join(' | ');
  }, [name, offerCountryCode, trafficSource, amoLayout, amoChannelId, providerSlugs]);

  // Resolved names to send on the wire. The "Manual" state is null until the
  // operator types into the field — that's what flips the inline label from
  // "(auto-generated)" to "(custom)".
  const resolvedCampaignName = campaignNameManual ?? autoCampaignName;
  const resolvedOfferName = amoOfferNameManual ?? autoOfferName;

  // Live word counts feeding the inline hints (intro ≥ 50, intro+body ≥ 600).
  const introWords = wordCount(amoIntro);
  const bodyWords = wordCount(amoBody);
  const totalWords = introWords + bodyWords;

  // Build the payload exactly per the OpenAPI spec — keeps the JSON preview
  // honest, and is what we'll POST through the n8n proxy.
  const payload = useMemo(() => {
    const amoFields: Record<string, unknown> = {
      domain: amoDomain,
      title: amoTitle,
      intro: amoIntro,
      body: amoBody,
    };
    if (trackerEnabled) {
      // Keywords are an array on the wire; the UI takes comma- or newline-separated input.
      amoFields.tracker_offer_url_keywords = amoKeywordsRaw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      amoFields.tracker_offer_url_layout = amoLayout;
      amoFields.tracker_offer_url_layout_scroll = amoLayoutScroll;
      if (amoChannelId) amoFields.tracker_offer_url_channel_id = amoChannelId;
      if (amoOfferCountryCode) amoFields.tracker_offer_country_code = amoOfferCountryCode;
      // Always include the resolved (auto or override) offer name — UI shows
      // it pre-populated, so the wire matches what the operator sees.
      amoFields.tracker_offer_name = resolvedOfferName;
    }

    const out: Record<string, unknown> = {
      base_fields: {
        name,
        traffic_source_slug: trafficSource,
        tracker_enabled: trackerEnabled,
        article_source: 'manual',
      },
      provider_slugs: providerSlugs,
      provider_fields: providerSlugs.includes('amo') ? { amo: amoFields } : {},
      status,
    };

    if (trackerEnabled) {
      const trackerFields: Record<string, unknown> = {
        offer_country_code: offerCountryCode,
      };
      if (campaignPixel) trackerFields.campaign_pixel = campaignPixel;
      if (campaignConversionEvent) trackerFields.campaign_conversion_event = campaignConversionEvent;
      trackerFields.campaign_source = campaignSource;
      // Always send the resolved (auto or manual override) campaign name —
      // matches what's shown in the field, label tag tracks which mode.
      trackerFields.campaign_name = resolvedCampaignName;
      if (campaignGroupUuid) trackerFields.campaign_group_uuid = campaignGroupUuid;
      out.tracker_fields = trackerFields;
    }
    return out;
  }, [
    name, trafficSource, trackerEnabled, offerCountryCode, campaignPixel,
    campaignConversionEvent, campaignSource, resolvedCampaignName, campaignGroupUuid,
    providerSlugs, amoDomain, amoTitle, amoIntro, amoBody, amoKeywordsRaw,
    amoLayout, amoLayoutScroll, amoChannelId, amoOfferCountryCode, resolvedOfferName,
    status,
  ]);

  const payloadJson = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitResponse(null);
    if (!PUBLISH_URL) {
      // No webhook yet — log + show the payload so the operator can copy it for
      // manual testing against the n8n proxy when it lands.
      console.log('[OfferArticle] PUBLIC_WEBHOOK_RSOC_PUBLISH_URL not set — payload:', payload);
      setSubmitError(
        'PUBLIC_WEBHOOK_RSOC_PUBLISH_URL is not set in .env — payload was logged to the browser console.',
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const { data } = await axios.post(PUBLISH_URL, payload, { timeout: 60_000 });
      setSubmitResponse(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    } catch (e: unknown) {
      const err = e as { response?: { data?: unknown; status?: number }; message?: string };
      const body = err?.response?.data;
      const msg = body
        ? `${err?.response?.status ?? 'HTTP'}: ${typeof body === 'string' ? body : JSON.stringify(body)}`
        : err?.message ?? String(e);
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyPayload = async () => {
    try { await navigator.clipboard.writeText(payloadJson); } catch { /* clipboard blocked */ }
  };

  if (!articleHtml) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-xl border p-6 shadow-sm text-slate-600 text-sm max-w-md text-center">
          No article is loaded. Go back to the Article tab and generate one first.
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={onClose}>Back to Article</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* ===== LEFT — form ===== */}
      <div className="w-1/2 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-xl">📤 Create Offer Article</h2>
          <Button variant="outline" size="sm" onClick={onClose}>← Back</Button>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Auth ({`Bearer + X-Auth-Email`}) is hardcoded in the n8n webhook. This form just
          shapes the payload from the generated article and your inputs.
        </p>

        {/* --- Base fields --- */}
        <section className="mb-5">
          <h3 className="font-semibold text-sm uppercase text-slate-600 border-b pb-1 mb-3">Base fields</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Offer Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tesla Model Y 2026" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Traffic source *</label>
              <select
                value={trafficSource}
                onChange={(e) => handleTrafficSourceChange(e.target.value as TrafficSource)}
                className="w-full text-sm border rounded-md px-2 py-1 bg-white"
              >
                {TRAFFIC_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trackerEnabled}
                onChange={(e) => setTrackerEnabled(e.target.checked)}
              />
              Tracker enabled
              <InfoTooltip text="When ON, tracker_fields (offer/campaign) are required and the amo provider must include tracker_offer_url_keywords." />
            </label>
          </div>
        </section>

        {/* --- Tracker fields (conditional) --- */}
        {trackerEnabled && (
          <section className="mb-5">
            <h3 className="font-semibold text-sm uppercase text-slate-600 border-b pb-1 mb-3">Tracker fields</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Offer Country *</label>
                <Combobox
                  value={offerCountryLabel}
                  onChange={setOfferCountryLabel}
                  options={OFFER_GEO_LABELS}
                  placeholder="Click to choose or type… e.g. Worldwide (WW)"
                  inputClassName="text-sm rounded-md bg-white px-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Campaign Pixel</label>
                <select
                  value={campaignPixel}
                  onChange={(e) => setCampaignPixel(e.target.value)}
                  className="w-full text-sm border rounded-md px-2 py-1 bg-white"
                >
                  <option value="">(none)</option>
                  {CAMPAIGN_PIXELS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Campaign Conversion Event</label>
                <Input value={campaignConversionEvent} onChange={(e) => setCampaignConversionEvent(e.target.value)} placeholder="Lead" />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Campaign Source *</label>
                <select
                  value={campaignSource}
                  onChange={(e) => setCampaignSource(e.target.value as 'none' | 'create')}
                  className="w-full text-sm border rounded-md px-2 py-1 bg-white"
                >
                  <option value="create">create</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500 flex items-center gap-2">
                  <span>
                    Campaign Name *{' '}
                    <span className="text-slate-400 normal-case">
                      {campaignNameManual === null ? '(auto-generated)' : '(custom)'}
                    </span>
                  </span>
                  {campaignNameManual !== null && (
                    <button
                      type="button"
                      onClick={() => setCampaignNameManual(null)}
                      className="ml-auto text-[10px] normal-case text-blue-600 hover:underline"
                      aria-label="Reset Campaign Name to auto-generated"
                    >
                      ↺ Reset to auto
                    </button>
                  )}
                </label>
                <Input
                  value={resolvedCampaignName}
                  onChange={(e) => setCampaignNameManual(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Campaign Group</label>
                <select
                  value={campaignGroupUuid}
                  onChange={(e) => setCampaignGroupUuid(e.target.value)}
                  className="w-full text-sm border rounded-md px-2 py-1 bg-white"
                >
                  <option value="">(none)</option>
                  {CAMPAIGN_GROUPS.map((g) => (
                    <option key={g.uuid} value={g.uuid}>{g.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        )}

        {/* --- Providers --- */}
        <section className="mb-5">
          <h3 className="font-semibold text-sm uppercase text-slate-600 border-b pb-1 mb-3">Providers</h3>
          <div className="flex gap-3 mb-3">
            {PROVIDERS.map((p) => (
              <label key={p} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={providerSlugs.includes(p)}
                  onChange={(e) => toggleProvider(p, e.target.checked)}
                />
                {p}
              </label>
            ))}
          </div>

          {providerSlugs.includes('amo') && (
            <div className="border rounded-md p-3 bg-slate-50 space-y-3">
              <div className="text-xs font-semibold text-slate-600">amo provider fields</div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">Domain *</label>
                <select
                  value={amoDomain}
                  onChange={(e) => setAmoDomain(e.target.value)}
                  className="w-full text-sm border rounded-md px-2 py-1 bg-white"
                >
                  {DOMAINS_BY_TRAFFIC[trafficSource].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">
                  Title * <span className="text-slate-400 normal-case">({amoTitle.length}/300)</span>
                </label>
                <Input value={amoTitle} onChange={(e) => setAmoTitle(e.target.value)} maxLength={300} />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">
                  Intro * <span className={introWords < 50 ? 'text-red-500 normal-case' : 'text-slate-400 normal-case'}>
                    ({introWords} words, min 50)
                  </span>
                </label>
                <Textarea value={amoIntro} onChange={(e) => setAmoIntro(e.target.value)} className="min-h-24" />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">
                  Body (HTML) * <span className={totalWords < 600 ? 'text-red-500 normal-case' : 'text-slate-400 normal-case'}>
                    (intro + body = {totalWords} words, min 600)
                  </span>
                </label>
                <Textarea value={amoBody} onChange={(e) => setAmoBody(e.target.value)} className="min-h-48 font-mono" />
              </div>
              {trackerEnabled && (
                <>
                  <div>
                    <label className="text-xs font-medium uppercase text-slate-500">
                      Keywords (Tracker) * <span className="text-slate-400 normal-case">(comma or newline separated)</span>
                    </label>
                    <Textarea
                      value={amoKeywordsRaw}
                      onChange={(e) => setAmoKeywordsRaw(e.target.value)}
                      placeholder="Tesla Model Y 2026, Tesla"
                      className="min-h-16"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium uppercase text-slate-500">Layout (Tracker)</label>
                      <select
                        value={amoLayout}
                        onChange={(e) => setAmoLayout(e.target.value as typeof TRACKER_LAYOUTS[number])}
                        className="w-full text-sm border rounded-md px-2 py-1 bg-white"
                      >
                        {TRACKER_LAYOUTS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium uppercase text-slate-500">Channel ID (Tracker)</label>
                      <Input value={amoChannelId} onChange={(e) => setAmoChannelId(e.target.value)} placeholder="123456" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium uppercase text-slate-500">Offer Country (Tracker)</label>
                      <Combobox
                        value={amoOfferCountryLabel}
                        onChange={setAmoOfferCountryLabel}
                        options={OFFER_GEO_LABELS}
                        placeholder={`(leave empty to inherit ${offerCountryCode || 'tracker'})`}
                        inputClassName="text-sm rounded-md bg-white px-2"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium uppercase text-slate-500 flex items-center gap-2">
                        <span>
                          Offer Name (Tracker) *{' '}
                          <span className="text-slate-400 normal-case">
                            {amoOfferNameManual === null ? '(auto-generated)' : '(custom)'}
                          </span>
                        </span>
                        {amoOfferNameManual !== null && (
                          <button
                            type="button"
                            onClick={() => setAmoOfferNameManual(null)}
                            className="ml-auto text-[10px] normal-case text-blue-600 hover:underline"
                            aria-label="Reset Offer Name (Tracker) to auto-generated"
                          >
                            ↺ Reset to auto
                          </button>
                        )}
                      </label>
                      <Input
                        value={resolvedOfferName}
                        onChange={(e) => setAmoOfferNameManual(e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={amoLayoutScroll}
                      onChange={(e) => setAmoLayoutScroll(e.target.checked)}
                    />
                    Layout scroll
                  </label>
                </>
              )}
            </div>
          )}
        </section>

        {/* --- Status --- */}
        <section className="mb-2">
          <h3 className="font-semibold text-sm uppercase text-slate-600 border-b pb-1 mb-3">Status</h3>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof STATUSES[number])}
            className="w-full text-sm border rounded-md px-2 py-1 bg-white"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </section>
      </div>

      {/* ===== RIGHT — JSON preview + submit ===== */}
      <div className="w-1/2 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="font-bold text-xl">Payload preview</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyPayload}>Copy JSON</Button>
            <Button size="sm" onClick={() => void handleSubmit()} disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        </div>

        <pre className="flex-1 min-h-0 overflow-auto text-xs bg-slate-900 text-slate-100 p-3 rounded-md font-mono">
          {payloadJson}
        </pre>

        {/* Submit result area */}
        {(submitError || submitResponse) && (
          <div className="mt-3 shrink-0 max-h-48 overflow-auto">
            {submitError && (
              <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md whitespace-pre-wrap">
                <div className="font-semibold mb-1">Error</div>
                {submitError}
              </div>
            )}
            {submitResponse && (
              <div className="border border-green-300 bg-green-50 text-green-800 text-xs p-2 rounded-md whitespace-pre-wrap font-mono">
                <div className="font-semibold mb-1">Response</div>
                {submitResponse}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

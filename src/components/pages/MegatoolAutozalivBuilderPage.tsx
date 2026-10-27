import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { useAppStore, parseNbEventsResponse, type NbEvent } from '@/store/useAppStore';
import { BINOM_TRACKERS } from '@/lib/binomGroups';
import { START_DATE_OPTIONS, TIMEZONE_OPTIONS } from './MegatoolCreateNbCampaignPage';
import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';
import { logEvent } from '@/lib/usage';
import { getAuthEmail } from '@/lib/identity';
import { customStartError, customStartToUnix, defaultCustomStart, formatInZone, toLocalInputValue } from '@/lib/nbStartTime';

// Autozaliv Builder — web replacement for the "articles (domains)" →
// "Filter for AUTOZALYV" → "Filtered Results" part of the Apps Script tool.
// Step 1 picks articles, step 2 picks each article's ads with the same rules
// as processFilter() in autozaliv_nb/Code.js. Data is read from the sheet via
// the megatool-autozaliv-builder webhook; nothing is written back yet.
// Step 3 reads each landing through Jina and applies the AMO text rules
// (megatool-autozaliv-content), replacing the local Python scripts.
const WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_BUILDER_URL as string | undefined;
const CONTENT_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_CONTENT_URL as string | undefined;
// Step 4 publishes AMO articles (megatool-autozaliv-launch). Buyer → email lives in
// the autozaliv_buyers datatable; the email picks the RSOC account, and the
// existing RSOC options webhook tells us which AMO domains that account has.
// The platform (NewsBreak or Facebook) is picked in the header; from step 4 on it changes the
// AMO traffic source, the offer URL params, the Binom offer group / traffic source and step 6.
const LAUNCH_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_LAUNCH_URL as string | undefined;
const RSOC_OPTIONS_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_RSOC_OPTIONS_URL as string | undefined;
// Step 6 on Facebook (megatool-autozaliv-fb): FB accounts / pages / pixels and the campaign → ad set → ads launch.
const FB_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_FB_URL as string | undefined;
// Step 1 "Parse Adheart" (megatool-adheart-parse): parses the Competitors rows with adheart_update ticked
// in the background; results land in the sheet (new tab, adheart_tab, adheart_parsed).
const ADHEART_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_ADHEART_PARSE_URL as string | undefined;
// Compliance (megatool-autozaliv-compliance): step 2 checks each kept ad + image (short prompt),
// step 3 optionally checks an article together with its ads' images (full prompt). Info only.
const COMPLIANCE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_COMPLIANCE_URL as string | undefined;

type Sheet = { headers: string[]; rows: string[][] };
type Row = Record<string, string>;

type Settings = {
  top: number;
  sortField: string;
  sortDir: 'desc' | 'asc';
  unique: boolean;
  onlyImages: boolean;
  onlyAdheart: boolean;
  affNetwork: 'amo' | 'ads.com';
};
// Matches how the Filter sheet is filled in today.
const DEFAULT_SETTINGS: Settings = {
  top: 3,
  sortField: 'impression',
  sortDir: 'desc',
  unique: true,
  onlyImages: false,
  onlyAdheart: false,
  affNetwork: 'amo',
};

const ARTICLE_COLS = [
  'cnt_ads', 'cnt_ads_7d', 'cnt_ads_14d', 'cnt_ads_30d', 'video_share',
  'top_language_for_article', 'main_adheart_geo', 'avg_duration', 'max_launch_date',
];
const EXAMPLE_COLS = ['examp_creative_title', 'examp_creative_subtext'];
const NOT_USED = 'Don`t use yet';

// Same as trimArticleName() in the Apps Script.
const trimArticle = (s: string) => s.replace(/___\d{4}-\d{2}-\d{2}$/, '');

// dd/mm/yyyy → yyyymmdd so dates sort correctly; otherwise a plain number.
function toNum(v: string): number {
  const d = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (d) return Number(d[3] + d[2] + d[1]);
  return parseFloat(v.replace(/,/g, ''));
}
function compare(a: string, b: string): number {
  const an = toNum(a);
  const bn = toNum(b);
  if (!isNaN(an) && !isNaN(bn)) return an - bn;
  return a.localeCompare(b);
}

// Port of processFilter(): type/source filters → unique image → sort → top N.
function pickAds(ads: Row[], s: Settings): Row[] {
  let out = ads;
  if (s.onlyImages) out = out.filter((r) => (r.ad_type || '').toLowerCase() === 'image');
  if (s.onlyAdheart) out = out.filter((r) => (r.source || '').toLowerCase() === 'adheart');
  if (s.unique) {
    const seen = new Set<string>();
    out = out.filter((r) => {
      if (!r.img_url || seen.has(r.img_url)) return false;
      seen.add(r.img_url);
      return true;
    });
  }
  if (s.sortField) {
    const f = s.sortField;
    out = [...out].sort((a, b) => {
      const c = compare(a[f] || '', b[f] || '');
      return s.sortDir === 'asc' ? c : -c;
    });
  }
  return out.slice(0, Math.max(1, s.top || 10));
}

// Step 1 competitor filter. Competitors live in the sheet's "Competitors" tab (name | domains);
// the import writes the name into the article's "competitor" column. Rows imported before that
// column existed fall back to matching examp_landing_page against the domains (subdomains too).
// adheartSearch / adheartParsed feed the Parse Adheart panel (filters to search, last result).
type Competitor = { name: string; domains: string[]; adheartSearch: string; adheartParsed: string };
// main_adheart_geo mixes ISO alpha-2 and alpha-3 (US / USA) — the geo filter groups them under alpha-2.
const GEO_ALPHA3: Record<string, string> = {
  AGO: 'AO', ARE: 'AE', ARM: 'AM', AUS: 'AU', AZE: 'AZ', BEL: 'BE', BGD: 'BD', BRA: 'BR', CAN: 'CA', CHL: 'CL',
  DEU: 'DE', DNK: 'DK', DZA: 'DZ', ESP: 'ES', FIN: 'FI', FRA: 'FR', GBR: 'GB', GRC: 'GR', HUN: 'HU', IDN: 'ID',
  IND: 'IN', IRL: 'IE', IRQ: 'IQ', ITA: 'IT', JPN: 'JP', KEN: 'KE', KHM: 'KH', KOR: 'KR', KWT: 'KW', LBN: 'LB',
  LUX: 'LU', MAR: 'MA', MEX: 'MX', MYS: 'MY', NGA: 'NG', NLD: 'NL', NZL: 'NZ', PAK: 'PK', PAN: 'PA', PHL: 'PH',
  POL: 'PL', PRT: 'PT', PRY: 'PY', QAT: 'QA', ROU: 'RO', SAU: 'SA', SVN: 'SI', SWE: 'SE', TUR: 'TR', TWN: 'TW',
  USA: 'US', VNM: 'VN', ZAF: 'ZA', AUT: 'AT', ARG: 'AR', BGR: 'BG', CHE: 'CH', COL: 'CO', CZE: 'CZ', SVK: 'SK',
  LVA: 'LV', MLT: 'MT', UKR: 'UA',
};
const geoOf = (g: string) => GEO_ALPHA3[g.trim().toUpperCase()] || g.trim().toUpperCase();

// A stored name no longer in the tab (competitor renamed after import) gives way to the domain match.
const competitorOf = (competitors: Competitor[], cells: Row | undefined) => {
  const stored = cells?.competitor || '';
  if (stored && (competitors.length === 0 || competitors.some((c) => c.name === stored))) return stored;
  const host = (cells?.examp_landing_page || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0];
  return (host && competitors.find((c) => c.domains.some((d) => host === d || host.endsWith('.' + d)))?.name) || stored;
};

// Same as formatCtaText() in the Apps Script: LEARN_MORE → Learn More.
const formatCta = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const toRows = (sheet: Sheet): Row[] =>
  sheet.rows.map((r) => Object.fromEntries(sheet.headers.map((h, i) => [h, r[i] ?? ''])));

async function post(url: string | undefined, envName: string, body: object, timeout: number): Promise<any> {
  if (!url) throw new Error(`${envName} is not set`);
  try {
    const { data } = await axios.post(url, body, { timeout });
    const outer = Array.isArray(data) ? data[0] : data;
    if (data === '' || data == null) throw new Error('Empty response from n8n — check the workflow execution');
    if (!outer?.ok) throw Object.assign(new Error(outer?.error || 'Request failed'), { data: outer });
    return outer;
  } catch (e: any) {
    // keep the reply body: a failed step can still carry ids created before it (e.g. offerId)
    const data = e?.data || e?.response?.data;
    throw Object.assign(new Error(data?.error || e?.message || 'Request failed'), { data });
  }
}
const callBuilder = (body: object): Promise<Sheet & { fetchedAt: string }> =>
  post(WEBHOOK, 'PUBLIC_WEBHOOK_AUTOZALIV_BUILDER_URL', body, 180_000);
const callContent = (body: object) => post(CONTENT_WEBHOOK, 'PUBLIC_WEBHOOK_AUTOZALIV_CONTENT_URL', body, 300_000);
const callLaunch = (body: object) => post(LAUNCH_WEBHOOK, 'PUBLIC_WEBHOOK_AUTOZALIV_LAUNCH_URL', body, 180_000);
const callFb = (body: object, timeout = 60_000) => post(FB_WEBHOOK, 'PUBLIC_WEBHOOK_AUTOZALIV_FB_URL', body, timeout);
const callAdheart = (body: object) => post(ADHEART_WEBHOOK, 'PUBLIC_WEBHOOK_ADHEART_PARSE_URL', body, 60_000);
const callCompliance = (body: object) => post(COMPLIANCE_WEBHOOK, 'PUBLIC_WEBHOOK_AUTOZALIV_COMPLIANCE_URL', body, 300_000);

type Platform = 'nb' | 'fb';
// RSOC traffic source slug per platform.
const TRAFFIC_SOURCE: Record<Platform, string> = { nb: 'newsbreak', fb: 'facebook' };

type Buyer = { buyer: string; email: string };
type LaunchSettings = { buyer: string; domain: string };
type RsocOptions = {
  provider_fields?: { amo?: { domain?: Record<string, Record<string, string>> } };
};
type OptionsState = { status: 'loading' | 'ready' | 'error'; data?: RsocOptions; error?: string };
type AmoState = { status: 'running' | 'done' | 'error'; offerUrl?: string; articleUrl?: string; error?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Step 5: Binom (port of processOffers / processCampaigns / fetchCampaignURLs) ----
const BID_TYPES = ['MAX_CONVERSION', 'TARGET_CPA', 'TARGET_ROAS'];
// Each tracker's campaigns always go on its own click domain.
const TRACKER_DOMAIN: Record<string, string> = {
  'ilab.nnctrack.com': 'perabianco.com',
  'jaguars.nnctrack.com': 'pancettafuns.com',
  'pumas.nnctrack.com': 'alfredofuns.com',
};
type BinomSettings = { tracker: string; group: string; geo: string; nbAccount: string; fbAccount: string; bidType: string; event: string; suffix: string };
type BinomRow = { name?: string; geo?: string; language?: string };
type BinomOptions = { status: 'loading' | 'ready' | 'error'; groups: string[]; domains: { id: string; host: string }[]; error?: string };
type BinomState = { status: 'running' | 'done' | 'error'; offerId?: string; campaignId?: string; campaignName?: string; campaignUrl?: string; error?: string };

// "sarb-dating-sites-for-widows-dab" -> "Dating Sites For Widows": drop the source prefix and
// the short tracking codes at the end (vev, dab, p2c…). Only a default — the Name stays editable.
function defaultName(article: string): string {
  const parts = trimArticle(article).split('-').filter(Boolean);
  if (parts.length > 1 && parts[0] === 'sarb') parts.shift();
  while (parts.length > 1 && parts[parts.length - 1].length <= 3 && /[a-z]/i.test(parts[parts.length - 1])) parts.pop();
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
// Same default as the sheet: complete_payment for TARGET_ROAS, otherwise click_button.
const resolveEvent = (event: string, bidType: string) => (event !== 'auto' ? event : bidType === 'TARGET_ROAS' ? 'complete_payment' : 'click_button');
// "URL for offer" formula from the sheet: article URL + NB macros (+ _roas) + ad_id + utm_term + empty channel.
// The FB sheet uses fbclid and appends ad_id={t6} after the channel.
// _roas follows the event, not the bid type: complete_payment + MAX_CONVERSION warm-ups must
// already report value, or NB never reaches the 20 valued events needed for TARGET_ROAS.
function offerUrlFor(articleUrl: string, keywords: string, event: string, platform: Platform): string {
  const base = articleUrl.split(/[?#]/)[0];
  const kw = keywords.split(',').map((k) => k.trim()).filter(Boolean).join(',');
  const term = kw ? '&utm_term=' + encodeURIComponent(kw) : '';
  if (platform === 'fb') {
    return base + '?m=og&part=bol&utm_source=facebook&utm_medium=gs&fbclid={t10}&term1={clickid}_{campaign_id}'
      + '&term2={campaign_domain}&utm_content={t12}' + term + '&channel=&ad_id={t6}';
  }
  return base + '?m=og&part=bol&utm_source=newsbreak&utm_medium=gs&newsbreak_cid={t10}&term1={clickid}_{campaign_id}'
    + (event === 'complete_payment' ? '_roas' : '') + '&term2={campaign_domain}&utm_content={t12}&ad_id={t2}'
    + term + '&channel=';
}
// ---- Step 6: NB — reuses the MEGATOOL Create NB Campaign webhook (campaign → 1 ad set → ads) ----
const NB_CAMPAIGN_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_NB_CAMPAIGN_CREATOR_URL as string | undefined;
const NB_EVENTS_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_NB_EVENTS_LIST_URL as string | undefined;
const NB_CTA_OPTIONS = ['Learn More', 'Sign Up', 'Shop Now', 'Download', 'Get Quote', 'Apply Now', 'See More', 'Get Offer', 'Subscribe', 'Contact Us', 'Book Now', 'Watch More'];
type NbSettings = { budget: number; startDate: string; timezone: string; bidValue: number; cta: string };
// Advertiser (NB brandName) = fixed "Search | " + a per-campaign part; NB allows 2–25 chars in total.
const ADVERTISER_PREFIX = 'Search | ';
const BRAND_MAX = 25;
// Step 5 Name must fit the advertiser as-is, so it's kept to what's left after the prefix (16).
const NAME_MAX = BRAND_MAX - ADVERTISER_PREFIX.length;
// NB creative limits (NB returns "creative.description length must be between 3 and 90").
const NB_TEXT = { headline: { min: 1, max: 90 }, body: { min: 3, max: 90 } };
// Default part = the Name, cut at a word boundary so the whole advertiser fits.
function fitWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : text.slice(0, max)).trim();
}
// Row of the autozaliv_used datatable: written after an NB / FB campaign is created
// (on FB, nb_campaign_id / nb_account hold the FB campaign / account).
type UsedRow = { article: string; used_at: string; nb_campaign_id: string; buyer: string; nb_account: string; source?: string };
const formatUsedDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
};
type NbState = { status: 'running' | 'done' | 'error'; campaignId?: string; adsetId?: string; adIds?: string[]; error?: string };

// ---- Step 6 on FB: port of CampaignAutomation.js in the FB sheet ----
// Defaults = the sheet's usual row: LEAD / OUTCOME_LEADS / MULTIPLIER / LOWEST_COST_WITHOUT_CAP / no cap / NONE / OFFSITE_CONVERSIONS.
type FbSettings = {
  page: string; pixel: string; event: string; objective: string; goal: string; bidStrategy: string; bidAmount: number;
  budgetMode: string; budget: number; special: string; startDate: string; customStart: string; status: string;
};
const FB_DEFAULTS: FbSettings = {
  page: '', pixel: '', event: 'LEAD', objective: 'OUTCOME_LEADS', goal: 'OFFSITE_CONVERSIONS', bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
  bidAmount: 0, budgetMode: 'MULTIPLIER', budget: 10, special: 'NONE', startDate: 'tomorrow', customStart: '', status: 'ACTIVE',
};
// API value → the name Facebook Ads Manager shows for it.
const FB_EVENT_LABELS: Record<string, string> = { LEAD: 'Lead', PURCHASE: 'Purchase' };
const FB_OBJECTIVE_LABELS: Record<string, string> = { OUTCOME_LEADS: 'Leads', OUTCOME_SALES: 'Sales' };
const FB_GOAL_LABELS: Record<string, string> = {
  OFFSITE_CONVERSIONS: 'Maximize number of conversions', VALUE: 'Maximize value of conversions',
};
const FB_BID_LABELS: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: 'Highest volume', LOWEST_COST_WITH_BID_CAP: 'Bid cap', COST_CAP: 'Cost per result goal',
};
const FB_BUDGET_LABELS: Record<string, string> = { MULTIPLIER: 'Ad set budget', ABSOLUTE: 'Campaign budget' };
const FB_SPECIAL_LABELS: Record<string, string> = {
  NONE: 'None', FINANCIAL_PRODUCTS_SERVICES: 'Financial products and services', EMPLOYMENT: 'Employment',
  HOUSING: 'Housing', ISSUES_ELECTIONS_POLITICS: 'Social issues, elections or politics',
};
const FB_STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active (on)', PAUSED: 'Paused (off)' };
// Presets start at 01:00 in the ad account's time zone (like the sheet); "custom" = a picked moment.
const FB_START_LABELS: Record<string, string> = {
  now: 'Now', tomorrow: 'Tomorrow', 'tomorrow+1': 'Day after tomorrow', 'tomorrow+2': 'In 3 days', custom: 'Custom (date & time)',
};
const FB_OBJECTIVES = Object.keys(FB_OBJECTIVE_LABELS);
const FB_BID_NEEDS_AMOUNT = ['LOWEST_COST_WITH_BID_CAP', 'COST_CAP'];
// Website destination, as in Ads Manager: each choice only offers what fits the one before it.
// Objective → performance goals; objective → conversion events; performance goal → bid strategies.
const FB_GOALS_BY_OBJECTIVE: Record<string, string[]> = {
  OUTCOME_LEADS: ['OFFSITE_CONVERSIONS', 'VALUE'],
  OUTCOME_SALES: ['OFFSITE_CONVERSIONS', 'VALUE'],
};
// Ads Manager calls the conversions goal "Maximize number of leads" under Leads.
const fbGoalLabels = (objective: string): Record<string, string> =>
  objective === 'OUTCOME_LEADS' ? { ...FB_GOAL_LABELS, OFFSITE_CONVERSIONS: 'Maximize number of leads' } : FB_GOAL_LABELS;
// The value goal's only bid here is "Highest value" (same API value as Highest volume).
const fbBidLabels = (goal: string): Record<string, string> =>
  goal === 'VALUE' ? { ...FB_BID_LABELS, LOWEST_COST_WITHOUT_CAP: 'Highest value' } : FB_BID_LABELS;
const FB_EVENTS_BY_OBJECTIVE: Record<string, string[]> = { OUTCOME_LEADS: ['LEAD'], OUTCOME_SALES: ['PURCHASE'] };
const FB_BIDS_BY_GOAL: Record<string, string[]> = {
  OFFSITE_CONVERSIONS: ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP', 'LOWEST_COST_WITH_BID_CAP'],
  VALUE: ['LOWEST_COST_WITHOUT_CAP'],
};
// Only the conversion goals (number / value) optimize for a pixel event.
const FB_PIXEL_GOALS = ['OFFSITE_CONVERSIONS', 'VALUE'];
// Snap a goal / event / bid that the new objective or goal doesn't allow to its first allowed value.
function fitFbSettings(s: FbSettings): FbSettings {
  const goals = FB_GOALS_BY_OBJECTIVE[s.objective] || [];
  const goal = goals.includes(s.goal) ? s.goal : goals[0] || s.goal;
  const events = FB_EVENTS_BY_OBJECTIVE[s.objective] || [];
  const event = events.includes(s.event) ? s.event : events[0] || '';
  const bids = FB_BIDS_BY_GOAL[goal] || [];
  const bidStrategy = bids.includes(s.bidStrategy) ? s.bidStrategy : bids[0] || s.bidStrategy;
  return goal === s.goal && event === s.event && bidStrategy === s.bidStrategy ? s : { ...s, goal, event, bidStrategy };
}
const FB_SPECIAL = Object.keys(FB_SPECIAL_LABELS);
const FB_START = Object.keys(FB_START_LABELS);
const FB_CTAS = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'APPLY_NOW', 'GET_OFFER', 'GET_QUOTE', 'CONTACT_US', 'DOWNLOAD', 'SUBSCRIBE', 'BOOK_TRAVEL', 'ORDER_NOW', 'SEE_MORE', 'WATCH_MORE', 'GET_STARTED'];
// Same as formatCtaText() in the FB sheet: "Learn more" → LEARN_MORE; anything FB doesn't know → LEARN_MORE.
const fbCta = (s: string) => {
  const v = s.trim().toUpperCase().replace(/\s+/g, '_');
  return FB_CTAS.includes(v) ? v : 'LEARN_MORE';
};
// FB has no hard 90-char cut like NB; these only catch empty or absurd texts.
const FB_TEXT = { headline: { min: 0, max: 255 }, body: { min: 1, max: 2200 } };
// token / tokens = fb_tokens NAMES: an account has one token, a page every token that sees it.
type FbItem = { id: string; name: string; token?: string; tokens?: string[] };
// "Page name (id)" keeps same-named pages apart in the pickers.
const itemLabel = (i: FbItem) => `${i.name} (${i.id})`;
type FbOptions = { status: 'idle' | 'loading' | 'ready' | 'error'; accounts: FbItem[]; pages: FbItem[]; error?: string };
// timezone = the ad account's time zone (start-time preview); it comes with the pixels.
type FbPixels = { status: 'loading' | 'ready' | 'error'; pixels: FbItem[]; timezone?: string; error?: string };
type FbPartial = { campaignId?: string; adsetId?: string; ads?: Record<string, string> };
type FbState = { status: 'running' | 'done' | 'error'; campaignId?: string; adsetId?: string; adIds?: string[]; partial?: FbPartial; error?: string };
type EventsState = { status: 'loading' | 'ready' | 'error'; events: NbEvent[]; error?: string };
// "Source Cmp name" from the sheet: Name | GEO | LANG | AZ | RSOC | Buyer | <tomorrow dd/mm/yy>
const tomorrowDdMmYy = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(-2);
};

const todayDdMm = () => {
  const d = new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
};

// AMO limits, same as RSocContentGenerator_autozaliv.py.
const AMO = { intro: 50, body: 600, paragraph: 40 };
const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const countWords = (s?: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;
function amoCheck(c: Row) {
  const intro = countWords(c.intro_text);
  const body = SECTIONS.reduce((n, i) => n + countWords(c['h' + i]) + countWords(c['p' + i]), 0);
  const short = SECTIONS.filter((i) => (c['h' + i] || c['p' + i]) && countWords(c['p' + i]) < AMO.paragraph);
  return { intro, body, short, pass: intro >= AMO.intro && body >= AMO.body && short.length === 0 };
}

type ContentState = { status: 'reading' | 'ready' | 'rewriting' | 'error'; url: string; content?: Row; error?: string; note?: string };

type ComplianceResult = {
  compliant: boolean;
  issues: { type: string; description: string; policy_reference: string }[];
  summary: string;
  category: string;
  main_topic: string;
  recommendations: string;
  translated_content: Record<string, string>;
  optimized_content: Record<string, string>;
  image_error: string;
};
type ComplianceState = { status: 'running' | 'done' | 'error'; result?: ComplianceResult; error?: string };
// Which check opened the details: 'ads' = step 2 (ad + image), 'article' = step 3 (article + images).
type ComplianceDetail = { ad: Row; kind: 'ads' | 'article'; state: ComplianceState };
// What the Compliance webhook gets for one ad; id ties the answer back to the ad.
const compliancePayload = (ad: Row, id: number) => ({
  id, title: ad.ad_title || '', description: ad.ad_text || '', cta: ad.cta ? formatCta(ad.cta) : '', imageUrl: ad.img_url || '',
});

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export function MegatoolAutozalivBuilderPage({ isAdmin = false }: { isAdmin?: boolean }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [platform, setPlatform] = useState<Platform>('nb');
  const trafficSource = TRAFFIC_SOURCE[platform];

  // Step 1 — articles
  const [articles, setArticles] = useState<Sheet | null>(null);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articlesError, setArticlesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<{ src: string; video?: boolean } | null>(null);
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);
  // Video ads open the video itself, everything else the image.
  const previewAd = (ad: Row) => setPreview(ad.video_url ? { src: ad.video_url, video: true } : { src: ad.img_url });
  const [unusedOnly, setUnusedOnly] = useState(true);
  const [minAds, setMinAds] = useState(0);
  const [lang, setLang] = useState('');
  const [geo, setGeo] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [source, setSource] = useState('');
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'cnt_ads_7d', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Step 2 — ads
  const [ads, setAds] = useState<Sheet | null>(null);
  const [adsFor, setAdsFor] = useState('');
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState<string | null>(null);
  const [bulk, setBulk] = useState<Settings>(DEFAULT_SETTINGS);
  const [overrides, setOverrides] = useState<Record<string, Settings>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // Step 3 — content, keyed by article name
  const [contents, setContents] = useState<Record<string, ContentState>>({});
  const [openArticle, setOpenArticle] = useState<string | null>(null);

  // Compliance, keyed by adKey: step 2 = ad + image check, step 3 = article + images check
  const [adCompliance, setAdCompliance] = useState<Record<string, ComplianceState>>({});
  const [articleCompliance, setArticleCompliance] = useState<Record<string, ComplianceState>>({});
  const [complianceDetail, setComplianceDetail] = useState<ComplianceDetail | null>(null);

  // Step 4 — launch
  const [buyers, setBuyers] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; list: Buyer[]; error?: string }>({ status: 'idle', list: [] });
  const [optionsByEmail, setOptionsByEmail] = useState<Record<string, OptionsState>>({});
  const [launchBulk, setLaunchBulk] = useState<LaunchSettings>({ buyer: '', domain: '' });
  const [launchOverrides, setLaunchOverrides] = useState<Record<string, Partial<LaunchSettings>>>({});
  const [keywords, setKeywords] = useState<Record<string, string>>({});
  const [amo, setAmo] = useState<Record<string, AmoState>>({});
  const [publishing, setPublishing] = useState(false);

  // Step 5 — Binom
  const [binomBulk, setBinomBulk] = useState<BinomSettings>({ tracker: BINOM_TRACKERS[0], group: '', geo: '', nbAccount: '', fbAccount: '', bidType: 'MAX_CONVERSION', event: 'auto', suffix: '' });
  const [binomRows, setBinomRows] = useState<Record<string, BinomRow>>({});
  const [binomOptions, setBinomOptions] = useState<Record<string, BinomOptions>>({});
  const [binom, setBinom] = useState<Record<string, BinomState>>({});
  const [binomRunning, setBinomRunning] = useState(false);
  const nbAccountsList = useAppStore((s) => s.nbAccountsList);
  const nbAccountsStatus = useAppStore((s) => s.nbAccountsStatus);
  const fetchNbAccounts = useAppStore((s) => s.fetchNbAccounts);

  // Step 6 — NB
  const [nbBulk, setNbBulk] = useState<NbSettings>({ budget: 10, startDate: 'tomorrow', timezone: 'PDT', bidValue: 0, cta: '' });
  const [nbNames, setNbNames] = useState<Record<string, string>>({});
  const [nbAdvertisers, setNbAdvertisers] = useState<Record<string, string>>({});
  // Per-ad text edits, keyed by adKey(); unset = the source ad's text as it is.
  const [nbAdEdits, setNbAdEdits] = useState<Record<string, { headline?: string; body?: string }>>({});
  const [nbOpen, setNbOpen] = useState<string | null>(null);
  const [nbEvents, setNbEvents] = useState<Record<string, EventsState>>({});
  const [nb, setNb] = useState<Record<string, NbState>>({});
  const [nbRunning, setNbRunning] = useState(false);
  // AI shortening (step 5 names, step 6 descriptions), keyed 'name|<article>' / 'desc|<article>'.
  const [shortening, setShortening] = useState<Record<string, { busy?: boolean; error?: string }>>({});

  // Step 6 — FB (campaign names and ad text edits are shared with the NB state above)
  const [fbOptions, setFbOptions] = useState<FbOptions>({ status: 'idle', accounts: [], pages: [] });
  const [fbPixels, setFbPixels] = useState<Record<string, FbPixels>>({});
  const [fbBulk, setFbBulkRaw] = useState<FbSettings>(FB_DEFAULTS);
  // Every change goes through fitFbSettings, so a choice the objective / goal doesn't allow never sticks.
  const setFbBulk = (update: (b: FbSettings) => FbSettings) => setFbBulkRaw((b) => fitFbSettings(update(b)));
  const [fb, setFb] = useState<Record<string, FbState>>({});
  const [fbRunning, setFbRunning] = useState(false);

  const loadArticles = async () => {
    setArticlesLoading(true);
    setArticlesError(null);
    try {
      setArticles(await callBuilder({ action: 'articles' }));
    } catch (e: any) {
      setArticlesError(e.message);
    } finally {
      setArticlesLoading(false);
    }
  };
  // Articles the Builder already launched (autozaliv_used datatable), latest per article.
  const [usedMap, setUsedMap] = useState<Record<string, UsedRow>>({});
  const loadUsed = async () => {
    try {
      const res = await callLaunch({ action: 'used-list' });
      const map: Record<string, UsedRow> = {};
      for (const u of (res.used || []) as UsedRow[]) {
        const k = trimArticle(u.article);
        if (!map[k] || u.used_at > map[k].used_at) map[k] = u;
      }
      setUsedMap(map);
    } catch {
      // not fatal: the sheet's own "used" column still shows
    }
  };
  const loadCompetitors = async () => {
    try {
      const res = await callBuilder({ action: 'competitors' });
      const col = (h: string) => res.headers.indexOf(h);
      setCompetitors(
        res.rows.map((r) => ({
          name: (r[col('name')] || '').trim(),
          domains: (r[col('domains')] || '').toLowerCase().split(/[\s,;]+/).map((d) => d.replace(/^www\./, '')).filter(Boolean),
          adheartSearch: (r[col('adheart_search')] || '').trim(),
          adheartParsed: (r[col('adheart_parsed')] || '').trim(),
        })).filter((c) => c.name),
      );
    } catch {
      // not fatal: the sheet's "competitor" column still filters
    }
  };
  useEffect(() => {
    loadArticles();
    loadUsed();
    loadCompetitors();
  }, []);
  const [adheartRun, setAdheartRun] = useState<{ busy?: boolean; msg?: string; error?: string }>({});
  // Same knobs as adheart_* in ads_archive/main.py. Empty min reach = any; empty geo = any.
  const [adheartOpen, setAdheartOpen] = useState(false);
  const [adheartOpts, setAdheartOpts] = useState({ start: '7 days ago', date: '', minReach: '20', geo: '', maxPages: '150' });
  // Competitors picked in the panel, and filters edited there (this run only; unset = the sheet's
  // adheart_search, or the domains joined with " | " — the same fallback the workflow applies).
  const [adheartPicked, setAdheartPicked] = useState<Set<string>>(new Set());
  const [adheartSearchEdits, setAdheartSearchEdits] = useState<Record<string, string>>({});
  const adheartSearchFor = (c: Competitor) => adheartSearchEdits[c.name] ?? (c.adheartSearch || c.domains.join(' | '));
  const parseAdheart = async () => {
    const o = adheartOpts;
    setAdheartRun({ busy: true });
    try {
      const res = await callAdheart({
        action: 'competitors',
        competitors: competitors.filter((c) => adheartPicked.has(c.name)).map((c) => ({ name: c.name, search: adheartSearchFor(c) })),
        startDate: o.start === 'date' ? o.date : o.start,
        minReach: Number(o.minReach) || 0,
        geo: o.geo,
        maxPages: Number(o.maxPages) || 150,
      });
      const names = (res.jobs || []).map((j: { name: string }) => j.name).join(', ');
      const skipped = (res.skipped || []).length ? ` Skipped: ${res.skipped.join('; ')}.` : '';
      setAdheartPicked(new Set());
      setAdheartRun({
        msg: `Adheart parse started: ${names}. Press ↻ Status in a few minutes to see each result; a finished one is ticked for "Import checked competitors" (Adheart) in the sheet.${skipped}`,
      });
    } catch (e: any) {
      setAdheartRun({ error: e.message });
    }
  };

  // Article name is column B, "used" formula is column D (see DataAutomations.js).
  const articleRows = useMemo(() => {
    if (!articles) return [];
    return articles.rows.map((r) => ({
      name: r[1],
      used: r[3] && r[3] !== NOT_USED ? r[3] : '',
      launched: usedMap[trimArticle(r[1])] as UsedRow | undefined,
      cells: Object.fromEntries(articles.headers.map((h, i) => [h, r[i] ?? ''])) as Row,
    })).map((a) => ({ ...a, competitor: competitorOf(competitors, a.cells) }));
  }, [articles, usedMap, competitors]);
  const cols = useMemo(() => ARTICLE_COLS.filter((c) => articles?.headers.includes(c)), [articles]);
  const exampleCols = useMemo(() => EXAMPLE_COLS.filter((c) => articles?.headers.includes(c)), [articles]);
  const articleByTrimmed = useMemo(
    () => Object.fromEntries(articleRows.map((a) => [trimArticle(a.name), a.cells])) as Record<string, Row>,
    [articleRows],
  );
  const langs = useMemo(
    () => [...new Set(articleRows.map((a) => a.cells.top_language_for_article).filter(Boolean))].sort(),
    [articleRows],
  );
  const geos = useMemo(
    () => [...new Set(articleRows.map((a) => geoOf(a.cells.main_adheart_geo || '')).filter(Boolean))].sort(),
    [articleRows],
  );
  const competitorNames = useMemo(
    () => [...new Set([...competitors.map((c) => c.name), ...articleRows.map((a) => a.competitor)].filter(Boolean))].sort(),
    [competitors, articleRows],
  );
  const sources = useMemo(
    () => [...new Set(articleRows.map((a) => a.cells.example_source).filter(Boolean))].sort(),
    [articleRows],
  );
  // Latest import (the article name's ___YYYY-MM-DD suffix) per source for the picked competitor / source.
  const lastParsed = useMemo(() => {
    if (!competitor && !source) return [];
    const latest: Record<string, string> = {};
    for (const a of articleRows) {
      const src = a.cells.example_source || '';
      if ((competitor && a.competitor !== competitor) || (source && src !== source)) continue;
      const d = a.name.match(/___(\d{4})-(\d{2})-(\d{2})$/);
      const iso = d ? `${d[1]}-${d[2]}-${d[3]}` : '';
      if (iso && (!latest[src] || iso > latest[src])) latest[src] = iso;
    }
    return Object.entries(latest)
      .sort()
      .map(([src, iso]) => `${src || 'no source'} ${iso.split('-').reverse().join('.')}`);
  }, [articleRows, competitor, source]);

  const q = search.trim().toLowerCase();
  const visibleArticles = useMemo(() => {
    const list = articleRows.filter(
      (a) =>
        (!q || a.name.toLowerCase().includes(q)) &&
        (!unusedOnly || (!a.used && !a.launched)) &&
        (!minAds || (toNum(a.cells.cnt_ads || '0') || 0) >= minAds) &&
        (!lang || (a.cells.top_language_for_article || '').toLowerCase().startsWith(lang.trim().toLowerCase())) &&
        (!geo || geoOf(a.cells.main_adheart_geo || '').startsWith(geo.trim().toUpperCase())) &&
        (!competitor || a.competitor === competitor) &&
        (!source || a.cells.example_source === source),
    );
    const key = sort.key;
    return [...list].sort((a, b) => {
      const c = key === 'article' ? a.name.localeCompare(b.name) : compare(a.cells[key] || '', b.cells[key] || '');
      return sort.dir === 'asc' ? c : -c;
    });
  }, [articleRows, q, unusedOnly, minAds, lang, geo, competitor, source, sort]);

  const toggle = (name: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  const allVisibleSelected = visibleArticles.length > 0 && visibleArticles.every((a) => selected.has(a.name));
  const toggleAllVisible = () =>
    setSelected((s) => {
      const n = new Set(s);
      visibleArticles.forEach((a) => (allVisibleSelected ? n.delete(a.name) : n.add(a.name)));
      return n;
    });
  const sortBy = (key: string) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const selectedList = useMemo(() => [...selected].sort(), [selected]);

  const goToAds = async () => {
    setStep(2);
    const key = selectedList.join('\n');
    if (key === adsFor && ads) return;
    setAdsLoading(true);
    setAdsError(null);
    try {
      setAds(await callBuilder({ action: 'ads', articles: selectedList }));
      setAdsFor(key);
    } catch (e: any) {
      setAdsError(e.message);
    } finally {
      setAdsLoading(false);
    }
  };

  const adsByArticle = useMemo(() => {
    const map: Record<string, Row[]> = {};
    if (ads) toRows(ads).forEach((r) => (map[trimArticle(r.article)] ||= []).push(r));
    return map;
  }, [ads]);

  const groups = selectedList.map((name) => {
    const trimmed = trimArticle(name);
    const settings = overrides[name] || bulk;
    const all = adsByArticle[trimmed] || [];
    const picked = pickAds(all, settings);
    // One landing per article: the top picked ad's, else the article's example.
    const landing = picked.find((ad) => ad.landing_url)?.landing_url || articleByTrimmed[trimmed]?.examp_landing_page || '';
    // keys_for_article in the sheet came from scraped_keywords (ad first, then article).
    const defaultKeywords = picked.find((ad) => ad.scraped_keywords)?.scraped_keywords || articleByTrimmed[trimmed]?.scraped_keywords || '';
    return { name, settings, total: all.length, picked, landing, defaultKeywords };
  });
  const adKey = (article: string, ad: Row) => `${article}|${ad.ad_key || ad.img_url}`;
  const keptAds = (g: (typeof groups)[number]) => g.picked.filter((ad) => !excluded.has(adKey(g.name, ad)));
  const keptCount = groups.reduce((n, g) => n + keptAds(g).length, 0);

  // Step 2 "Check compliance": every kept ad that has no result yet (all of them again once all are done).
  const allKept = groups.flatMap((g) => keptAds(g).map((ad) => ({ k: adKey(g.name, ad), ad })));
  const adComplianceRunning = allKept.some(({ k }) => adCompliance[k]?.status === 'running');
  const checkAdsCompliance = async () => {
    const pending = allKept.filter(({ k }) => adCompliance[k]?.status !== 'done');
    const todo = pending.length ? pending : allKept;
    setAdCompliance((s) => ({ ...s, ...Object.fromEntries(todo.map(({ k }) => [k, { status: 'running' } as ComplianceState])) }));
    let flagged = 0;
    let failed = 0;
    await pool(todo, 3, async ({ k, ad }) => {
      try {
        const res = await callCompliance({ action: 'ads', ad: compliancePayload(ad, 1) });
        const result: ComplianceResult | undefined = res.results?.[0];
        if (!result) throw new Error('No answer for this ad');
        if ((result as any).error) throw new Error((result as any).error);
        if (!result.compliant) flagged++;
        setAdCompliance((s) => ({ ...s, [k]: { status: 'done', result } }));
      } catch (e: any) {
        failed++;
        setAdCompliance((s) => ({ ...s, [k]: { status: 'error', error: e.message } }));
      }
    });
    logEvent({ tab: 'megatool-autozaliv', action: 'checkAdsCompliance', meta: { ads: todo.length }, metaOut: { flagged, failed } });
  };

  // Step 3 "Analyze compliance": one article + all its kept ads (with images) in one call, full prompt.
  const checkArticleCompliance = async (g: (typeof groups)[number]) => {
    const content = contents[g.name]?.content;
    const list = keptAds(g);
    if (!content || list.length === 0) return;
    const keys = list.map((ad) => adKey(g.name, ad));
    setArticleCompliance((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, { status: 'running' } as ComplianceState])) }));
    const logMeta = { article: g.name, ads: list.length };
    try {
      const res = await callCompliance({ action: 'article', article: content, ads: list.map((ad, i) => compliancePayload(ad, i + 1)) });
      const results: ComplianceResult[] = res.results || [];
      setArticleCompliance((s) => ({
        ...s,
        ...Object.fromEntries(keys.map((k, i): [string, ComplianceState] => [k, results[i] && !(results[i] as any).error
          ? { status: 'done', result: results[i] }
          : { status: 'error', error: (results[i] as any)?.error || 'No answer for this ad' }])),
      }));
      logEvent({ tab: 'megatool-autozaliv', action: 'checkArticleCompliance', meta: logMeta, metaOut: { flagged: results.filter((r) => r && !r.compliant).length } });
    } catch (e: any) {
      setArticleCompliance((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, { status: 'error', error: e.message } as ComplianceState])) }));
      logEvent({ tab: 'megatool-autozaliv', action: 'checkArticleCompliance', meta: logMeta, metaOut: e.data, errorMessage: e.message });
    }
  };
  const articleComplianceRunning = (g: (typeof groups)[number]) => keptAds(g).some((ad) => articleCompliance[adKey(g.name, ad)]?.status === 'running');

  const patchContent = (name: string, patch: Partial<ContentState>) =>
    setContents((s) => ({ ...s, [name]: { ...s[name], ...patch } as ContentState }));

  const readArticle = async (name: string, url: string) => {
    if (!url) {
      patchContent(name, { status: 'error', url, error: 'No landing URL for this article' });
      return;
    }
    patchContent(name, { status: 'reading', url, error: undefined, note: undefined });
    try {
      const res = await callContent({ action: 'read', url });
      patchContent(name, { status: 'ready', content: res.content });
    } catch (e: any) {
      patchContent(name, { status: 'error', error: e.message });
    }
  };

  const rewriteArticle = async (name: string) => {
    const content = contents[name]?.content;
    if (!content) return;
    patchContent(name, { status: 'rewriting', error: undefined, note: undefined });
    try {
      const res = await callContent({ action: 'rewrite', content });
      const changed = Object.keys(res.changes || {});
      setContents((s) => ({
        ...s,
        [name]: {
          ...s[name],
          status: 'ready',
          content: { ...s[name].content, ...res.changes },
          note: res.mode === 'none' ? 'Already meets AMO rules' : `Rewrote ${changed.join(', ') || 'nothing'}`,
        },
      }));
    } catch (e: any) {
      patchContent(name, { status: 'ready', error: e.message });
    }
  };

  // Read every article that has no content yet (or whose landing changed).
  const goToContent = () => {
    setStep(3);
    const todo = groups.filter((g) => {
      const c = contents[g.name];
      return !c || (c.status === 'error' && !c.content) || c.url !== g.landing;
    });
    pool(todo, 3, (g) => readArticle(g.name, g.landing));
  };
  const rewriteFailing = () => {
    const todo = selectedList.filter((n) => {
      const c = contents[n];
      return c?.status === 'ready' && c.content && !amoCheck(c.content).pass;
    });
    pool(todo, 2, rewriteArticle);
  };
  const editField = (name: string, field: string, value: string) =>
    setContents((s) => ({ ...s, [name]: { ...s[name], content: { ...s[name].content, [field]: value } } }));

  const passCount = selectedList.filter((n) => {
    const c = contents[n]?.content;
    return c && amoCheck(c).pass;
  }).length;

  // ---- Step 4: launch ----
  const loadBuyers = async () => {
    setBuyers((b) => ({ ...b, status: 'loading', error: undefined }));
    try {
      const res = await callLaunch({ action: 'buyers' });
      setBuyers({ status: 'ready', list: res.buyers || [] });
    } catch (e: any) {
      setBuyers({ status: 'error', list: [], error: e.message });
    }
  };
  const goToLaunch = () => {
    setStep(4);
    if (buyers.status === 'idle' || buyers.status === 'error') loadBuyers();
  };

  const emailOf = (buyer: string) => buyers.list.find((b) => b.buyer === buyer)?.email || '';
  // RSOC options are per account, so fetch them once per buyer email.
  const ensureOptions = async (email: string) => {
    if (!email || optionsByEmail[email]) return;
    setOptionsByEmail((s) => ({ ...s, [email]: { status: 'loading' } }));
    try {
      if (!RSOC_OPTIONS_WEBHOOK) throw new Error('PUBLIC_WEBHOOK_RSOC_OPTIONS_URL is not set');
      const { data } = await axios.post(RSOC_OPTIONS_WEBHOOK, { email }, { timeout: 30_000 });
      const outer = Array.isArray(data) ? data[0] : data;
      const opts = outer?.data ?? outer;
      if (!opts?.provider_fields) throw new Error(outer?.message || 'RSOC options returned no data');
      setOptionsByEmail((s) => ({ ...s, [email]: { status: 'ready', data: opts } }));
    } catch (e: any) {
      setOptionsByEmail((s) => ({ ...s, [email]: { status: 'error', error: e?.response?.data?.message || e.message } }));
    }
  };
  const domainsFor = (email: string) =>
    Object.keys(optionsByEmail[email]?.data?.provider_fields?.amo?.domain?.[trafficSource] || {});

  // Row value = override ?? default; a domain the account can't use falls back to its first one.
  const launchFor = (name: string): LaunchSettings & { email: string; domains: string[] } => {
    const ov = launchOverrides[name] || {};
    const buyer = ov.buyer ?? launchBulk.buyer;
    const email = emailOf(buyer);
    const domains = domainsFor(email);
    const wanted = ov.domain ?? launchBulk.domain;
    return { buyer, email, domain: domains.includes(wanted) ? wanted : domains[0] || '', domains };
  };
  const setOverride = (name: string, patch: Partial<LaunchSettings>) =>
    setLaunchOverrides((o) => ({ ...o, [name]: { ...o[name], ...patch } }));

  const usedEmails = [...new Set([launchBulk.buyer, ...Object.values(launchOverrides).map((o) => o.buyer || '')].map(emailOf).filter(Boolean))];
  useEffect(() => {
    usedEmails.forEach(ensureOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedEmails.join('|')]);

  const keywordsFor = (g: (typeof groups)[number]) => keywords[g.name] ?? g.defaultKeywords;

  // 1️⃣ Create AMO articles — one at a time, like the sheet (AMO is slow and rate-limited).
  const createAmoArticles = async () => {
    setPublishing(true);
    const todo = groups.filter((g) => amo[g.name]?.status !== 'done');
    for (const [n, g] of todo.entries()) {
      const c = contents[g.name]?.content;
      const l = launchFor(g.name);
      const error = !c ? 'No content — read it in step 3'
        : !amoCheck(c).pass ? 'Content fails AMO rules — fix it in step 3'
        : !l.email ? 'Pick a buyer'
        : !l.domain ? `This buyer has no AMO domain for ${trafficSource}` : '';
      if (error) {
        setAmo((s) => ({ ...s, [g.name]: { status: 'error', error } }));
        continue;
      }
      setAmo((s) => ({ ...s, [g.name]: { status: 'running' } }));
      const logMeta = { platform, article: g.name, buyer: l.buyer, domain: l.domain };
      try {
        const res = await callLaunch({
          action: 'amo-article', email: l.email, domain: l.domain, trafficSource, keywords: keywordsFor(g), content: c,
        });
        setAmo((s) => ({ ...s, [g.name]: { status: 'done', offerUrl: res.offerUrl, articleUrl: res.articleUrl } }));
        logEvent({ tab: 'megatool-autozaliv', action: 'createAmoArticle', meta: logMeta, metaOut: { articleUrl: res.articleUrl } });
      } catch (e: any) {
        setAmo((s) => ({ ...s, [g.name]: { status: 'error', error: e.message } }));
        logEvent({ tab: 'megatool-autozaliv', action: 'createAmoArticle', meta: logMeta, metaOut: e.data, errorMessage: e.message });
      }
      if (n < todo.length - 1) await sleep(3000);
    }
    setPublishing(false);
  };
  const amoDone = selectedList.filter((n) => amo[n]?.status === 'done').length;
  const bulkEmail = emailOf(launchBulk.buyer);
  const bulkOptions = optionsByEmail[bulkEmail];

  // ---- Step 5: Binom ----
  const loadBinomOptions = async (tracker: string) => {
    setBinomOptions((s) => ({ ...s, [tracker]: { status: 'loading', groups: [], domains: [] } }));
    try {
      const res = await callLaunch({ action: 'binom-options', tracker });
      setBinomOptions((s) => ({ ...s, [tracker]: { status: 'ready', groups: res.groups || [], domains: res.domains || [] } }));
    } catch (e: any) {
      setBinomOptions((s) => ({ ...s, [tracker]: { status: 'error', groups: [], domains: [], error: e.message } }));
    }
  };
  // FB accounts + pages come from the fb_accounts / fb_pages datatables (weekly "Sync FB" in n8n).
  const loadFbOptions = async () => {
    setFbOptions((s) => ({ ...s, status: 'loading', error: undefined }));
    try {
      const res = await callFb({ action: 'options' });
      setFbOptions({ status: 'ready', accounts: res.accounts || [], pages: res.pages || [] });
    } catch (e: any) {
      setFbOptions({ status: 'error', accounts: [], pages: [], error: e.message });
    }
  };
  const goToBinom = () => {
    setStep(5);
    if (platform === 'nb' && nbAccountsStatus === 'idle') void fetchNbAccounts();
    if (platform === 'fb' && (fbOptions.status === 'idle' || fbOptions.status === 'error')) loadFbOptions();
  };
  // The account goes into the Binom campaign name, so it is picked in step 5 for both platforms.
  // The FB account field takes the picked "name (id)", the bare name, or a typed id (with or without act_).
  const fbTyped = binomBulk.fbAccount.trim();
  const fbTypedId = fbTyped.replace(/^act_/i, '');
  const fbAccount = fbTyped
    ? fbOptions.accounts.find((a) => itemLabel(a) === fbTyped || a.name === fbTyped || a.id === fbTypedId)
    : undefined;
  const launchAccount = platform === 'fb' ? fbAccount?.name || '' : binomBulk.nbAccount;
  useEffect(() => {
    if (step === 5 && !binomOptions[binomBulk.tracker]) loadBinomOptions(binomBulk.tracker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, binomBulk.tracker]);
  const trackerOpts = binomOptions[binomBulk.tracker];
  const bulkGroup = trackerOpts?.groups.includes(binomBulk.group) ? binomBulk.group : '';
  const domainHost = TRACKER_DOMAIN[binomBulk.tracker] || '';
  const bulkDomain = trackerOpts?.domains.find((d) => d.host === domainHost);

  // Offer name / Binom Cmp name = the sheet formulas, built from the same fields.
  const binomFor = (g: (typeof groups)[number]) => {
    const row = binomRows[g.name] || {};
    const name = row.name ?? defaultName(g.name);
    // Empty bulk Geo → each article's own geo (like lang), US if the sheet has none.
    const geo = (row.geo ?? (binomBulk.geo.trim() || geoOf(articleByTrimmed[trimArticle(g.name)]?.main_adheart_geo || '') || 'US')).trim().toUpperCase();
    const lang = (row.language ?? (articleByTrimmed[trimArticle(g.name)]?.top_language_for_article || 'en')).trim().toUpperCase();
    // Buyers are stored as "First Last" — names only carry the first name.
    const buyer = launchFor(g.name).buyer.trim().split(/\s+/)[0];
    const articleUrl = amo[g.name]?.articleUrl || '';
    const amoLabel = (articleUrl.match(/https?:\/\/([^.]+)/) || [])[1] || '';
    const offerName = `${name} | ${geo} | ${lang} | AMO | AUTOZALYV${buyer ? ' | ' + buyer : ''} | ch=auto${amoLabel ? ' | ' + amoLabel : ''}`;
    // Empty suffix → the competitor the article's landing page belongs to.
    const suffix = binomBulk.suffix.trim() || competitorOf(competitors, articleByTrimmed[trimArticle(g.name)]);
    const tail = [launchAccount, todayDdMm(), suffix].filter(Boolean).join(' ');
    const campaignName = `${name} | ${geo} | AMO | AUTOZALYV | ${buyer} | ${tail}`;
    const offerUrl = articleUrl ? offerUrlFor(articleUrl, keywordsFor(g), resolveEvent(binomBulk.event, binomBulk.bidType), platform) : '';
    return { name, geo, lang, offerName, campaignName, offerUrl };
  };
  const setBinomRow = (name: string, patch: BinomRow) => setBinomRows((r) => ({ ...r, [name]: { ...r[name], ...patch } }));
  const setShort = (keys: string[], v: { busy?: boolean; error?: string }) =>
    setShortening((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, v])) }));

  // AI-shorten Names over NAME_MAX, all in one call. Rows already sent to Binom keep theirs.
  // The limit only exists because the Name is the NB advertiser — FB has no such field.
  const binomLocked = (name: string) => binom[name]?.status === 'done' || binom[name]?.status === 'running';
  const longNames = platform === 'nb' ? groups.filter((g) => !binomLocked(g.name) && binomFor(g).name.length > NAME_MAX) : [];
  const shortenNames = async (list: typeof groups) => {
    const keys = list.map((g) => 'name|' + g.name);
    setShort(keys, { busy: true });
    try {
      const res = await callContent({ action: 'shorten', kind: 'name', max: NAME_MAX, texts: list.map((g) => binomFor(g).name) });
      list.forEach((g, i) => res.results?.[i] && setBinomRow(g.name, { name: res.results[i] }));
      setShort(keys, {});
    } catch (e: any) {
      setShort(keys, { error: e.message });
    }
  };

  // 2️⃣ Create Binom — offer + campaign per article, one at a time like the sheet.
  const createBinom = async () => {
    setBinomRunning(true);
    const todo = groups.filter((g) => binom[g.name]?.status !== 'done');
    for (const [n, g] of todo.entries()) {
      const b = binomFor(g);
      const error = amo[g.name]?.status !== 'done' ? 'Create the AMO article first (step 4)'
        : !bulkGroup ? 'Pick a Binom group'
        : !bulkDomain ? `Tracker domain ${domainHost || '?'} not found on ${binomBulk.tracker}`
        : !launchAccount ? `Pick the ${platform.toUpperCase()} account (it is part of the campaign name)`
        : !b.name.trim() ? 'Name is empty' : '';
      if (error) {
        setBinom((s) => ({ ...s, [g.name]: { ...s[g.name], status: 'error', error } }));
        continue;
      }
      const prev = binom[g.name];
      setBinom((s) => ({ ...s, [g.name]: { ...s[g.name], status: 'running', error: undefined } }));
      const logMeta = { platform, article: g.name, tracker: binomBulk.tracker, campaignName: b.campaignName };
      try {
        const res = await callLaunch({
          action: 'binom', tracker: binomBulk.tracker, group: bulkGroup, domainId: bulkDomain?.id, geo: b.geo, trafficSource,
          event: resolveEvent(binomBulk.event, binomBulk.bidType), offerName: b.offerName, offerUrl: b.offerUrl,
          campaignName: b.campaignName, offerId: prev?.offerId,
        });
        setBinom((s) => ({ ...s, [g.name]: { status: 'done', offerId: res.offerId, campaignId: res.campaignId, campaignName: b.campaignName, campaignUrl: res.campaignUrl } }));
        logEvent({ tab: 'megatool-autozaliv', action: 'createBinomCampaign', meta: logMeta, metaOut: { offerId: res.offerId, campaignId: res.campaignId } });
      } catch (e: any) {
        // keep an offer id from a half-finished run so Retry doesn't create a second offer
        const offerId = e.data?.offerId || prev?.offerId;
        setBinom((s) => ({ ...s, [g.name]: { status: 'error', error: e.message, offerId } }));
        logEvent({ tab: 'megatool-autozaliv', action: 'createBinomCampaign', meta: logMeta, metaOut: e.data, errorMessage: e.message });
      }
      if (n < todo.length - 1) await sleep(1000);
    }
    setBinomRunning(false);
  };
  const binomDone = selectedList.filter((n) => binom[n]?.status === 'done').length;

  // ---- Step 6: NB ----
  // Account + bid type + tracking event were already chosen in the Binom step (they're in the
  // Binom campaign name / URL), so NB reuses them.
  const nbAccountId = nbAccountsList.find((a) => a.name === binomBulk.nbAccount)?.id || '';
  const trackingEvent = resolveEvent(binomBulk.event, binomBulk.bidType);
  const loadNbEvents = async (accountId: string) => {
    setNbEvents((s) => ({ ...s, [accountId]: { status: 'loading', events: [] } }));
    try {
      if (!NB_EVENTS_WEBHOOK) throw new Error('PUBLIC_WEBHOOK_NB_EVENTS_LIST_URL is not set');
      const { data } = await axios.post(NB_EVENTS_WEBHOOK, { adAccountId: accountId }, { timeout: 30_000 });
      setNbEvents((s) => ({ ...s, [accountId]: { status: 'ready', events: parseNbEventsResponse(data) } }));
    } catch (e: any) {
      setNbEvents((s) => ({ ...s, [accountId]: { status: 'error', events: [], error: e.message } }));
    }
  };
  useEffect(() => {
    if (step === 6 && nbAccountId && !nbEvents[nbAccountId]) loadNbEvents(nbAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, nbAccountId]);
  // Tracking events are per NB ad account: pick this account's event of the chosen type.
  const accountEvents = nbEvents[nbAccountId];
  const trackingId = accountEvents?.events.find((e) => (e.eventType || '').toLowerCase() === trackingEvent)?.id || '';

  // Ads that go to NB: the picked, not-excluded ads. Ad Name = "<Name>_IMAGE_1" / "<Name>_VIDEO_1" like the sheet.
  const nbAdsFor = (g: (typeof groups)[number]) => {
    const name = binomFor(g).name;
    let images = 0;
    let videos = 0;
    return g.picked
      .filter((ad) => !excluded.has(adKey(g.name, ad)))
      .map((ad) => {
        const isVideo = (ad.ad_type || '').toLowerCase() === 'video' && !!ad.video_url;
        const key = adKey(g.name, ad);
        const edit = nbAdEdits[key] || {};
        return {
          key,
          img: ad.img_url,
          isVideo,
          adName: isVideo ? `${name}_VIDEO_${++videos}` : `${name}_IMAGE_${++images}`,
          headline: edit.headline ?? (ad.ad_title || ''),
          body: edit.body ?? (ad.ad_text || ''),
          assetUrl: isVideo ? ad.video_url : ad.img_url,
          cta: ad.cta ? formatCta(ad.cta) : '',
        };
      })
      .filter((ad) => ad.assetUrl);
  };
  // First NB text-limit problem in an article's ads, or ''.
  const nbTextError = (ads: ReturnType<typeof nbAdsFor>) => {
    for (const ad of ads) {
      const h = ad.headline.trim().length;
      const b = ad.body.trim().length;
      if (h < NB_TEXT.headline.min || h > NB_TEXT.headline.max) return `${ad.adName}: headline is ${h} chars (NB allows ${NB_TEXT.headline.min}–${NB_TEXT.headline.max})`;
      if (b < NB_TEXT.body.min || b > NB_TEXT.body.max) return `${ad.adName}: description is ${b} chars (NB allows ${NB_TEXT.body.min}–${NB_TEXT.body.max})`;
    }
    return '';
  };
  const editAd = (key: string, patch: { headline?: string; body?: string }) =>
    setNbAdEdits((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  // AI-rewrite descriptions over NB's limit, one call per article, same language. A description
  // the model didn't return stays as it is (never auto-cut).
  const longDescs = (g: (typeof groups)[number]) => nbAdsFor(g).filter((ad) => ad.body.trim().length > NB_TEXT.body.max);
  const shortenDescriptions = async (g: (typeof groups)[number]) => {
    const ads = longDescs(g);
    if (!ads.length) return;
    const key = 'desc|' + g.name;
    setShort([key], { busy: true });
    try {
      const res = await callContent({
        action: 'shorten', kind: 'description', max: NB_TEXT.body.max,
        context: contents[g.name]?.content?.article_headline || binomFor(g).name,
        texts: ads.map((ad) => ad.body),
      });
      ads.forEach((ad, i) => res.results?.[i] && editAd(ad.key, { body: res.results[i] }));
      setShort([key], {});
    } catch (e: any) {
      setShort([key], { error: e.message });
    }
  };
  const nbLocked = (name: string) => nb[name]?.status === 'done' || nb[name]?.status === 'running';
  const nbLongDescGroups = groups.filter((g) => !nbLocked(g.name) && longDescs(g).length > 0);
  const nbNameFor = (g: (typeof groups)[number]) => {
    if (nbNames[g.name] !== undefined) return nbNames[g.name];
    const b = binomFor(g);
    const buyer = launchFor(g.name).buyer.trim().split(/\s+/)[0];
    return `${b.name} | ${b.geo} | ${b.lang} | AUTOZALYV | RSOC${buyer ? ' | ' + buyer : ''} | ${tomorrowDdMmYy()}`;
  };
  const advertiserPartFor = (g: (typeof groups)[number]) =>
    nbAdvertisers[g.name] ?? fitWords(binomFor(g).name, BRAND_MAX - ADVERTISER_PREFIX.length);
  const advertiserFor = (g: (typeof groups)[number]) => (ADVERTISER_PREFIX + advertiserPartFor(g)).trim();
  // One CTA per campaign (the NB workflow takes a campaign-level CTA): default = the most common one of the ads.
  const defaultCta = (() => {
    const counts: Record<string, number> = {};
    groups.forEach((g) => nbAdsFor(g).forEach((ad) => { if (NB_CTA_OPTIONS.includes(ad.cta)) counts[ad.cta] = (counts[ad.cta] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Learn More';
  })();
  const cta = nbBulk.cta || defaultCta;
  const goToNb = () => setStep(6);

  // 3️⃣ Create NB — one campaign + one ad set per article, all its ads inside (like the sheet).
  const createNb = async () => {
    setNbRunning(true);
    const todo = groups.filter((g) => nb[g.name]?.status !== 'done');
    for (const [n, g] of todo.entries()) {
      const ads = nbAdsFor(g);
      const advertiser = advertiserFor(g);
      const bid = binomBulk.bidType;
      const error = binom[g.name]?.status !== 'done' ? 'Create the Binom campaign first (step 5)'
        : !nbAccountId ? 'Pick the NB account in step 5'
        : !trackingId ? `NB account has no "${trackingEvent}" tracking event`
        : advertiser.length < 2 || advertiser.length > 25 ? `Advertiser is ${advertiser.length} chars — NB allows 2–25`
        : ads.length === 0 ? 'No ads left for this article'
        : nbTextError(ads) ? nbTextError(ads) + ' — fix it under "Edit ads"'
        : bid !== 'MAX_CONVERSION' && !(nbBulk.bidValue > 0) ? `Set the ${bid === 'TARGET_ROAS' ? 'ROAS %' : 'CPA $'} value` : '';
      if (error) {
        setNb((s) => ({ ...s, [g.name]: { status: 'error', error } }));
        continue;
      }
      setNb((s) => ({ ...s, [g.name]: { status: 'running' } }));
      const logMeta = { article: g.name, nbAccount: binomBulk.nbAccount, campaignName: nbNameFor(g), ads: ads.length };
      try {
        if (!NB_CAMPAIGN_WEBHOOK) throw new Error('PUBLIC_WEBHOOK_NB_CAMPAIGN_CREATOR_URL is not set');
        const { data } = await axios.post(NB_CAMPAIGN_WEBHOOK, {
          nbAccountId,
          campaignName: nbNameFor(g),
          callToAction: cta,
          brandName: advertiser,
          clickThroughUrl: binom[g.name].campaignUrl,
          budget: nbBulk.budget,
          startDate: nbBulk.startDate,
          startTimezone: nbBulk.timezone,
          trackingId,
          bidType: bid,
          // same units as the Create NB Campaign tab: roas is a fraction, bidRate is cents
          ...(bid === 'TARGET_ROAS' ? { roas: nbBulk.bidValue / 100 } : {}),
          ...(bid === 'TARGET_CPA' ? { bidRate: Math.round(nbBulk.bidValue * 100) } : {}),
          ads: ads.map(({ adName, headline, body, assetUrl }) => ({ adName, headline: headline.trim(), body: body.trim(), assetUrl })),
          adsetSizes: [ads.length],
        }, { timeout: 600_000 });
        const outer = Array.isArray(data) ? data[0] : data;
        if (!outer || outer.ok === false) {
          const partial = outer?.partial?.campaignId ? ` (NB campaign ${outer.partial.campaignId} was created — delete it before retrying)` : '';
          throw new Error((outer?.error || 'NB campaign failed') + partial);
        }
        setNb((s) => ({ ...s, [g.name]: { status: 'done', campaignId: outer.campaignId, adsetId: outer.adsetId, adIds: outer.adIds } }));
        logEvent({ tab: 'megatool-autozaliv', action: 'createNbCampaign', meta: logMeta, metaOut: { campaignId: outer.campaignId, adsetId: outer.adsetId } });
        // Pin the article as used (with the date) so step 1 shows it next time.
        const used: UsedRow = {
          article: g.name, used_at: new Date().toISOString(), nb_campaign_id: String(outer.campaignId || ''),
          buyer: launchFor(g.name).buyer, nb_account: binomBulk.nbAccount,
        };
        // email / campaignName / binomCampaignName go to the autozaliv_campaigns log only.
        getAuthEmail().then((ident) => callLaunch({
          action: 'mark-used', article: g.name, nbCampaignId: used.nb_campaign_id,
          binomCampaignId: binom[g.name]?.campaignId, buyer: used.buyer, nbAccount: used.nb_account,
          email: ident?.email || '', campaignName: logMeta.campaignName, binomCampaignName: binom[g.name]?.campaignName || '',
        }))
          .then(() => setUsedMap((m) => ({ ...m, [trimArticle(g.name)]: used })))
          .catch((err: any) => setNb((s) => ({ ...s, [g.name]: { ...s[g.name], error: `Created, but not marked as used: ${err.message}` } })));
      } catch (e: any) {
        const body = e?.response?.data;
        const outer = Array.isArray(body) ? body[0] : body;
        const partial = outer?.partial?.campaignId ? ` (NB campaign ${outer.partial.campaignId} was created — delete it before retrying)` : '';
        setNb((s) => ({ ...s, [g.name]: { status: 'error', error: outer?.error ? outer.error + partial : e.message } }));
        logEvent({ tab: 'megatool-autozaliv', action: 'createNbCampaign', meta: logMeta, metaOut: outer, errorMessage: outer?.error ? outer.error + partial : e.message });
      }
      if (n < todo.length - 1) await sleep(1000);
    }
    setNbRunning(false);
  };
  const nbDone = selectedList.filter((n) => nb[n]?.status === 'done').length;

  // ---- Step 6: FB ----
  const fbAccountId = fbAccount?.id || '';
  // Only pages on the account's token: another token's page fails with "no Advertiser role".
  const fbPages = fbAccount ? fbOptions.pages.filter((p) => p.tokens?.includes(fbAccount.token || '')) : [];
  const fbPageId = fbPages.find((p) => itemLabel(p) === fbBulk.page)?.id || '';
  const loadFbPixels = async (accountId: string) => {
    setFbPixels((s) => ({ ...s, [accountId]: { status: 'loading', pixels: [] } }));
    try {
      const res = await callFb({ action: 'pixels', accountId });
      setFbPixels((s) => ({ ...s, [accountId]: { status: 'ready', pixels: res.pixels || [], timezone: res.timezone || undefined } }));
    } catch (e: any) {
      setFbPixels((s) => ({ ...s, [accountId]: { status: 'error', pixels: [], error: e.message } }));
    }
  };
  useEffect(() => {
    if (step === 6 && platform === 'fb' && fbAccountId && !fbPixels[fbAccountId]) loadFbPixels(fbAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, platform, fbAccountId]);
  const accountPixels = fbPixels[fbAccountId];
  // A pixel picked for another account doesn't count; an account with one pixel gets it by default.
  const fbPixel = accountPixels?.pixels.find((p) => itemLabel(p) === fbBulk.pixel)
    || (accountPixels?.pixels.length === 1 ? accountPixels.pixels[0] : undefined);
  const fbNeedsPixel = FB_PIXEL_GOALS.includes(fbBulk.goal);
  // Ad URL formula from the FB sheet: the Binom link with funnel=funnel → funnel=<pixel id>,
  // and ts= follows the conversion event (the Binom link comes with ts=Lead; Sales needs ts=Purchase).
  const fbLinkFor = (name: string) => {
    let url = binom[name]?.campaignUrl || '';
    if (fbPixel) url = url.replace('funnel=funnel', 'funnel=' + fbPixel.id);
    const ts = FB_EVENT_LABELS[fbBulk.event];
    if (ts) url = url.replace(/([?&])ts=[^&#]*/, `$1ts=${ts}`);
    return url;
  };
  const fbTextError = (ads: ReturnType<typeof nbAdsFor>) => {
    for (const ad of ads) {
      const h = ad.headline.trim().length;
      const b = ad.body.trim().length;
      if (h > FB_TEXT.headline.max) return `${ad.adName}: headline is ${h} chars (max ${FB_TEXT.headline.max})`;
      if (b < FB_TEXT.body.min || b > FB_TEXT.body.max) return `${ad.adName}: primary text is ${b} chars (FB allows ${FB_TEXT.body.min}–${FB_TEXT.body.max})`;
    }
    return '';
  };

  // 3️⃣ Create FB — one campaign + one ad set per article, all its ads inside (like the sheet).
  // A failed run keeps what FB already created (partial) and Retry continues from there.
  const createFb = async () => {
    setFbRunning(true);
    const todo = groups.filter((g) => fb[g.name]?.status !== 'done');
    for (const [n, g] of todo.entries()) {
      const ads = nbAdsFor(g);
      const prev = fb[g.name];
      const error = binom[g.name]?.status !== 'done' ? 'Create the Binom campaign first (step 5)'
        : !fbAccountId ? 'Pick the FB account in step 5'
        : !fbPageId ? 'Pick a page'
        : fbNeedsPixel && !fbPixel ? `Pick a pixel — ${fbBulk.goal} needs one`
        : FB_BID_NEEDS_AMOUNT.includes(fbBulk.bidStrategy) && !(fbBulk.bidAmount > 0) ? `Set the bid amount for ${fbBulk.bidStrategy}`
        : !(fbBulk.budget > 0) ? 'Set the daily budget'
        : fbBulk.startDate === 'custom' && customStartError(fbBulk.customStart) ? `Start: ${customStartError(fbBulk.customStart)}`
        : ads.length === 0 ? 'No ads left for this article'
        : fbTextError(ads) ? fbTextError(ads) + ' — fix it under "Edit ads"' : '';
      if (error) {
        setFb((s) => ({ ...s, [g.name]: { ...s[g.name], status: 'error', error } }));
        continue;
      }
      setFb((s) => ({ ...s, [g.name]: { ...s[g.name], status: 'running', error: undefined } }));
      const logMeta = { article: g.name, fbAccount: fbAccount?.name || fbAccountId, campaignName: nbNameFor(g), ads: ads.length };
      try {
        const res = await callFb({
          action: 'launch', accountId: fbAccountId, pageId: fbPageId, pixelId: fbNeedsPixel ? fbPixel?.id : '',
          event: fbBulk.event, objective: fbBulk.objective, optimizationGoal: fbBulk.goal, bidStrategy: fbBulk.bidStrategy,
          bidAmount: fbBulk.bidAmount, budgetMode: fbBulk.budgetMode, budget: fbBulk.budget, specialAdCategory: fbBulk.special,
          geo: binomFor(g).geo, startDate: fbBulk.startDate, status: fbBulk.status, campaignName: nbNameFor(g), link: fbLinkFor(g.name),
          ...(fbBulk.startDate === 'custom' ? { startTime: customStartToUnix(fbBulk.customStart) } : {}),
          ads: ads.map((ad) => ({
            key: ad.key, adName: ad.adName, title: ad.headline.trim(), body: ad.body.trim(), cta: fbCta(ad.cta),
            imageUrl: ad.img || '', videoUrl: ad.isVideo ? ad.assetUrl : '',
          })),
          resume: prev?.partial,
        }, 600_000);
        setFb((s) => ({ ...s, [g.name]: { status: 'done', campaignId: res.campaignId, adsetId: res.adsetId, adIds: res.adIds } }));
        logEvent({ tab: 'megatool-autozaliv', action: 'createFbCampaign', meta: logMeta, metaOut: { campaignId: res.campaignId, adsetId: res.adsetId } });
        const used: UsedRow = {
          article: g.name, used_at: new Date().toISOString(), nb_campaign_id: String(res.campaignId || ''),
          buyer: launchFor(g.name).buyer, nb_account: fbAccount?.name || '', source: 'fb',
        };
        getAuthEmail().then((ident) => callLaunch({
          action: 'mark-used', article: g.name, nbCampaignId: used.nb_campaign_id, source: 'fb',
          binomCampaignId: binom[g.name]?.campaignId, buyer: used.buyer, nbAccount: used.nb_account,
          email: ident?.email || '', campaignName: logMeta.campaignName, binomCampaignName: binom[g.name]?.campaignName || '',
        }))
          .then(() => setUsedMap((m) => ({ ...m, [trimArticle(g.name)]: used })))
          .catch((err: any) => setFb((s) => ({ ...s, [g.name]: { ...s[g.name], error: `Created, but not marked as used: ${err.message}` } })));
      } catch (e: any) {
        const partial: FbPartial | undefined = e.data?.partial || prev?.partial;
        setFb((s) => ({ ...s, [g.name]: { status: 'error', error: e.message, partial } }));
        logEvent({ tab: 'megatool-autozaliv', action: 'createFbCampaign', meta: logMeta, metaOut: e.data, errorMessage: e.message });
      }
      if (n < todo.length - 1) await sleep(1000);
    }
    setFbRunning(false);
  };
  const fbDone = selectedList.filter((n) => fb[n]?.status === 'done').length;

  // "New run": forget this step's results (and the later steps', which were built on them) so the
  // same articles can be launched again for another buyer / account. Nothing is deleted remotely.
  const newRun = (from: 4 | 5 | 6) => {
    const p = platform.toUpperCase();
    const what = from === 4 ? `AMO, Binom and ${p}` : from === 5 ? `Binom and ${p}` : p;
    if (!window.confirm(`Start a new run? The ${what} results on this page are cleared so you can create them again with other settings. Nothing is deleted in AMO / Binom / ${p}.`)) return;
    if (from === 4) setAmo({});
    if (from <= 5) setBinom({});
    setNb({});
    setFb({});
  };
  const anyRunning = publishing || binomRunning || nbRunning || fbRunning;
  // The platform changes the AMO article URL params, so it is fixed once articles exist (New run frees it).
  const platformLocked = Object.keys(amo).length > 0 || anyRunning;

  const toggleAd = (k: string) =>
    setExcluded((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 text-sm">
        <StepPill n={1} label="Articles" active={step === 1} onClick={() => setStep(1)} />
        <span className="text-slate-400">→</span>
        <StepPill n={2} label="Choose ads" active={step === 2} onClick={() => selected.size && goToAds()} />
        <span className="text-slate-400">→</span>
        <StepPill n={3} label="Content" active={step === 3} onClick={() => selected.size && ads && goToContent()} disabled={!ads} />
        <span className="text-slate-400">→</span>
        <StepPill n={4} label="AMO articles" active={step === 4} onClick={goToLaunch} disabled={Object.keys(contents).length === 0} />
        <span className="text-slate-400">→</span>
        <StepPill n={5} label="Binom" active={step === 5} onClick={goToBinom} disabled={amoDone === 0} />
        <span className="text-slate-400">→</span>
        <StepPill n={6} label={platform.toUpperCase()} active={step === 6} onClick={goToNb} disabled={binomDone === 0} />
        <div
          className="ml-auto flex items-center gap-1.5"
          title={platformLocked ? 'AMO articles were already created for this platform — use "↻ New run" in step 4 to switch' : 'Where the campaigns go — changes steps 4–6'}
        >
          <span className="text-slate-500">Platform</span>
          {(['nb', 'fb'] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={platformLocked}
              onClick={() => setPlatform(p)}
              className={`rounded px-2.5 py-1 border text-xs font-semibold ${
                platform === p ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
              } ${platformLocked && platform !== p ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {p === 'nb' ? 'NewsBreak' : 'Facebook'}
            </button>
          ))}
        </div>
      </div>

      {step === 1 && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search article…" className="h-8 w-64 bg-white" />
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={unusedOnly} onChange={(e) => setUnusedOnly(e.target.checked)} />
              Unused only
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              Min ads
              <Input type="number" min={0} value={minAds} onChange={(e) => setMinAds(Number(e.target.value) || 0)} className="h-8 w-20 bg-white" />
            </label>
            {/* Typed text filters by the first letters ("d" → da, de); × clears it (the box shows empty while focused). */}
            {langs.length > 0 && (
              <div className="flex items-center">
                <FilterCombobox value={lang} onChange={setLang} options={langs} prefixMatch placeholder="All languages" className="w-36" inputClassName="h-8 bg-white text-sm" />
                {lang && <button type="button" title="All languages" onClick={() => setLang('')} className="px-1 text-slate-400 hover:text-slate-700">×</button>}
              </div>
            )}
            {geos.length > 0 && (
              <div className="flex items-center">
                <FilterCombobox value={geo} onChange={setGeo} options={geos} prefixMatch placeholder="All geos" className="w-28" inputClassName="h-8 bg-white text-sm" />
                {geo && <button type="button" title="All geos" onClick={() => setGeo('')} className="px-1 text-slate-400 hover:text-slate-700">×</button>}
              </div>
            )}
            <select value={competitor} onChange={(e) => setCompetitor(e.target.value)} className="h-8 rounded border border-slate-200 bg-white px-2 text-sm">
              <option value="">All competitors</option>
              {competitorNames.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {sources.length > 0 && (
              <select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 rounded border border-slate-200 bg-white px-2 text-sm">
                <option value="">All sources</option>
                {sources.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            {(competitor || source) && (
              <span className="text-xs text-slate-500">
                Last parse: {lastParsed.length > 0 ? lastParsed.join(' · ') : '—'}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
              {visibleArticles.length} of {articleRows.length} articles
              {/* Admin-only: writes tabs into the source spreadsheet and the Competitors tab. */}
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setAdheartOpen((v) => !v)} title="Pick competitors and parse their Adheart ads">
                  Parse Adheart
                </Button>
              )}
              <Button size="sm" onClick={loadArticles} disabled={articlesLoading}>
                {articlesLoading ? 'Loading…' : 'Refresh'}
              </Button>
            </div>
          </div>
          {articlesError && <ErrorBox msg={articlesError} />}
          {isAdmin && adheartOpen && (
            <div className="mx-4 mb-2 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              {/* Competitors (from the sheet's Competitors tab): pick, check / edit filters, see the last result. */}
              <div className="basis-full">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-semibold text-slate-800">Parse Adheart</span>
                  <span>— pick competitors. Filters: one per line, "|" = or, a space inside = and.</span>
                  <Button size="sm" variant="outline" className="ml-auto h-7" onClick={loadCompetitors}>↻ Status</Button>
                </div>
                <div className="max-h-64 overflow-auto rounded border border-slate-200">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-slate-100 text-left text-[10px] font-bold uppercase text-gray-500">
                      <tr>
                        <th className="w-8 px-2 py-1">
                          <input
                            type="checkbox"
                            checked={competitors.length > 0 && adheartPicked.size === competitors.length}
                            onChange={(e) => setAdheartPicked(e.target.checked ? new Set(competitors.map((c) => c.name)) : new Set())}
                          />
                        </th>
                        <th className="px-2 py-1">competitor</th>
                        <th className="px-2 py-1">filters</th>
                        <th className="px-2 py-1">last result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {competitors.map((c) => (
                        <tr key={c.name} className="border-t border-slate-100 align-top">
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              checked={adheartPicked.has(c.name)}
                              onChange={(e) =>
                                setAdheartPicked((s) => {
                                  const n = new Set(s);
                                  if (e.target.checked) n.add(c.name);
                                  else n.delete(c.name);
                                  return n;
                                })
                              }
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-800">{c.name}</td>
                          <td className="w-1/2 px-2 py-1">
                            <textarea
                              value={adheartSearchFor(c)}
                              onChange={(e) => setAdheartSearchEdits((s) => ({ ...s, [c.name]: e.target.value }))}
                              rows={1}
                              className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 font-mono text-[11px]"
                            />
                          </td>
                          <td className="px-2 py-1 text-[11px]">{c.adheartParsed || '—'}</td>
                        </tr>
                      ))}
                      {competitors.length === 0 && (
                        <tr><td colSpan={4} className="px-2 py-2 text-slate-400">No competitors loaded — press ↻ Status.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <label className="flex flex-col gap-1">
                Ads placed since
                <div className="flex gap-1">
                  <select value={adheartOpts.start} onChange={(e) => setAdheartOpts((o) => ({ ...o, start: e.target.value }))} className="h-8 rounded border border-slate-200 bg-white px-2 text-sm">
                    {['1 day ago', '3 days ago', '7 days ago', '14 days ago', '1 month ago', '3 months ago'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                    <option value="date">Pick a date…</option>
                  </select>
                  {adheartOpts.start === 'date' && (
                    <Input type="date" value={adheartOpts.date} onChange={(e) => setAdheartOpts((o) => ({ ...o, date: e.target.value }))} className="h-8 w-36 bg-white" />
                  )}
                </div>
              </label>
              <label className="flex flex-col gap-1" title="Only ads that reached at least this many people. Empty = any.">
                Min reach
                <Input type="number" min={0} value={adheartOpts.minReach} onChange={(e) => setAdheartOpts((o) => ({ ...o, minReach: e.target.value }))} placeholder="any" className="h-8 w-24 bg-white" />
              </label>
              <label className="flex flex-col gap-1" title="Country codes, comma-separated (US, GB = either). Empty = any.">
                Geo
                <Input value={adheartOpts.geo} onChange={(e) => setAdheartOpts((o) => ({ ...o, geo: e.target.value.toUpperCase() }))} placeholder="any, e.g. US, GB" className="h-8 w-32 bg-white" />
              </label>
              <label className="flex flex-col gap-1" title="40 ads per page, up to 1000 pages per search.">
                Max pages
                <Input type="number" min={1} max={1000} value={adheartOpts.maxPages} onChange={(e) => setAdheartOpts((o) => ({ ...o, maxPages: e.target.value }))} className="h-8 w-24 bg-white" />
              </label>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setAdheartOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={parseAdheart} disabled={adheartRun.busy || adheartPicked.size === 0 || (adheartOpts.start === 'date' && !adheartOpts.date)}>
                  {adheartRun.busy ? 'Starting…' : `Start${adheartPicked.size ? ` (${adheartPicked.size})` : ''}`}
                </Button>
              </div>
            </div>
          )}
          {adheartRun.error && <ErrorBox msg={`Parse Adheart: ${adheartRun.error}`} />}
          {adheartRun.msg && <div className="mx-4 mb-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{adheartRun.msg}</div>}
          <div className="flex-1 overflow-auto mx-4 rounded border border-slate-200 bg-white">
            {!articles && articlesLoading ? (
              <div className="p-6 text-sm text-slate-500">Loading articles…</div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-slate-100 z-10">
                  <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                    <th className="px-2 py-2 w-8">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                    </th>
                    <th className="px-2 py-2 w-12" />
                    <SortTh label="article" k="article" sort={sort} onSort={sortBy} />
                    <th className="px-2 py-2">used</th>
                    {exampleCols.map((c) => (
                      <th key={c} className="px-2 py-2 whitespace-nowrap">{c.replace('examp_creative_', 'example ')}</th>
                    ))}
                    <th className="px-2 py-2 whitespace-nowrap">landing</th>
                    {cols.map((c) => (
                      <SortTh key={c} label={c.replace(/_/g, ' ')} k={c} sort={sort} onSort={sortBy} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleArticles.map((a) => (
                    <tr
                      key={a.name}
                      onClick={() => toggle(a.name)}
                      className={`border-b border-slate-100 cursor-pointer ${selected.has(a.name) ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-2 py-1">
                        <input type="checkbox" checked={selected.has(a.name)} onChange={() => toggle(a.name)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="px-2 py-1 min-w-[52px]">
                        {a.cells.examp_image_url ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreview(a.cells.examp_video_url ? { src: a.cells.examp_video_url, video: true } : { src: a.cells.examp_image_url });
                            }}
                            className="relative block h-9 w-9 cursor-zoom-in"
                          >
                            <img src={a.cells.examp_image_url} loading="lazy" alt="" className="h-9 w-9 max-w-none rounded object-cover bg-slate-100" />
                            {a.cells.examp_video_url && <PlayMark />}
                          </button>
                        ) : a.cells.examp_video_url ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setPreview({ src: a.cells.examp_video_url, video: true }); }}
                            className="relative block h-9 w-9 rounded bg-slate-800 cursor-zoom-in"
                          >
                            <PlayMark />
                          </button>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 max-w-[420px] truncate text-slate-800" title={a.name}>
                        {trimArticle(a.name)}
                      </td>
                      <td
                        className="px-2 py-1 max-w-[160px] truncate text-xs"
                        title={a.launched
                          ? `Launched in the Builder ${new Date(a.launched.used_at).toLocaleString()} · buyer ${a.launched.buyer || '—'} · ${a.launched.source === 'fb' ? 'FB' : 'NB'} campaign ${a.launched.nb_campaign_id || '—'}`
                          : a.used}
                      >
                        {a.launched ? (
                          <span className="text-emerald-700">✔ used {formatUsedDate(a.launched.used_at)}</span>
                        ) : a.used ? (
                          <span className="text-emerald-700">✔ used</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      {exampleCols.map((c) => (
                        <td key={c} className="px-2 py-1 max-w-[260px] truncate text-xs text-slate-600" title={a.cells[c]}>
                          {a.cells[c]}
                        </td>
                      ))}
                      <td className="px-2 py-1 max-w-[200px] truncate text-xs">
                        <LandingLink url={a.cells.examp_landing_page} />
                      </td>
                      {cols.map((c) => (
                        <td key={c} className="px-2 py-1 whitespace-nowrap text-slate-700">{a.cells[c]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-200 bg-white">
            <span className="text-sm text-slate-700">{selected.size} articles selected</span>
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-slate-500 underline">
                clear
              </button>
            )}
            <Button className="ml-auto" disabled={selected.size === 0 || selected.size > 200} onClick={goToAds}>
              Next: choose ads →
            </Button>
          </div>
        </>
      )}

      {/* Full-screen image / video preview (step 1 thumbnails, step 2 ad cards, step 3 ad thumbnails) */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPreview(null); }}
            className="absolute top-4 right-4 text-white text-3xl leading-none w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full"
            aria-label="Close"
          >
            ×
          </button>
          {preview.video ? (
            <video
              src={preview.src}
              controls
              autoPlay
              className="max-w-[92vw] max-h-[92vh] rounded-md bg-black"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={preview.src}
              alt=""
              className="max-w-[92vw] max-h-[92vh] object-contain rounded-md"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
      {complianceDetail && <ComplianceDetailModal detail={complianceDetail} onClose={() => setComplianceDetail(null)} />}

      {step === 2 && (
        <>
          <div className="mx-4 mb-2 rounded border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-gray-500 mb-1.5">Settings for all articles</div>
            <SettingsControls value={bulk} onChange={setBulk} />
          </div>
          {adsError && <ErrorBox msg={adsError} />}
          <div className="flex-1 overflow-auto px-4 pb-2 space-y-3">
            {adsLoading ? (
              <div className="p-6 text-sm text-slate-500">Loading ads for {selectedList.length} articles…</div>
            ) : (
              groups.map((g) => {
                const custom = !!overrides[g.name];
                const kept = g.picked.filter((ad) => !excluded.has(adKey(g.name, ad))).length;
                return (
                  <div key={g.name} className="rounded border border-slate-200 bg-white p-3">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-slate-800 truncate" title={g.name}>{trimArticle(g.name)}</div>
                        <div className="text-xs truncate">
                          <LandingLink url={g.landing} full />
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 whitespace-nowrap">
                        {kept} of {g.picked.length} kept · {g.total} ads total · {g.settings.affNetwork}
                      </div>
                      <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={custom}
                          onChange={(e) =>
                            setOverrides((o) => {
                              const n = { ...o };
                              e.target.checked ? (n[g.name] = { ...bulk }) : delete n[g.name];
                              return n;
                            })
                          }
                        />
                        Own settings
                      </label>
                    </div>
                    {custom && (
                      <div className="mb-2 rounded bg-slate-50 px-2 py-1.5">
                        <SettingsControls
                          value={overrides[g.name]}
                          onChange={(s) => setOverrides((o) => ({ ...o, [g.name]: s }))}
                        />
                      </div>
                    )}
                    {g.picked.length === 0 ? (
                      <div className="text-xs text-slate-400">No ads match these settings.</div>
                    ) : (
                      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                        {g.picked.map((ad) => {
                          const k = adKey(g.name, ad);
                          return (
                            <AdCard
                              key={k} ad={ad} metric={g.settings.sortField} off={excluded.has(k)} onToggle={() => toggleAd(k)} onPreview={() => previewAd(ad)}
                              compliance={excluded.has(k) ? undefined : adCompliance[k]}
                              onCompliance={() => adCompliance[k] && setComplianceDetail({ ad, kind: 'ads', state: adCompliance[k] })}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-200 bg-white">
            <Button variant="outline" onClick={() => setStep(1)}>← Articles</Button>
            <span className="text-sm text-slate-700">
              {selectedList.length} articles · {keptCount} ads selected
            </span>
            <ComplianceSummary states={allKept.map(({ k }) => adCompliance[k])} />
            <Button
              variant="outline" className="ml-auto" disabled={adsLoading || keptCount === 0 || adComplianceRunning}
              onClick={checkAdsCompliance}
              title="Checks the selected ads (text + image) against the compliance rules. Info only — nothing is blocked."
            >
              {adComplianceRunning ? 'Checking compliance…' : `Check compliance (${keptCount})`}
            </Button>
            <Button disabled={adsLoading || !ads} onClick={goToContent}>
              Next: content →
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-sm">
            <span className="text-slate-600">
              AMO rules: intro ≥ {AMO.intro} words · body ≥ {AMO.body} words · every paragraph ≥ {AMO.paragraph} words
            </span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={goToContent}>Read missing</Button>
              <Button size="sm" onClick={rewriteFailing}>Rewrite all failing</Button>
              <Button
                size="sm" variant="outline"
                disabled={groups.every((g) => !contents[g.name]?.content || keptAds(g).length === 0 || articleComplianceRunning(g))}
                onClick={() => pool(groups.filter((g) => contents[g.name]?.content && keptAds(g).length > 0 && !articleComplianceRunning(g)), 2, checkArticleCompliance)}
                title="Optional: checks every article together with its ads' images (full compliance prompt). Info only."
              >
                Analyze all compliance
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto px-4 pb-2 space-y-2">
            {groups.map((g) => {
              const st = contents[g.name];
              const c = st?.content;
              const check = c ? amoCheck(c) : null;
              const open = openArticle === g.name;
              const busy = st?.status === 'reading' || st?.status === 'rewriting';
              return (
                <div key={g.name} className="rounded border border-slate-200 bg-white">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <button type="button" onClick={() => setOpenArticle(open ? null : g.name)} className="min-w-0 flex-1 text-left">
                      <div className="font-medium text-sm text-slate-800 truncate">
                        {open ? '▾' : '▸'} {c?.article_headline || trimArticle(g.name)}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{trimArticle(g.name)}</div>
                    </button>
                    <div className="flex items-center gap-2 text-xs whitespace-nowrap">
                      {st?.status === 'reading' && <span className="text-slate-500">Reading…</span>}
                      {st?.status === 'rewriting' && <span className="text-slate-500">Rewriting…</span>}
                      {check && (
                        <>
                          <Badge ok={check.intro >= AMO.intro}>intro {check.intro}w</Badge>
                          <Badge ok={check.body >= AMO.body}>body {check.body}w</Badge>
                          <Badge ok={check.short.length === 0}>{check.short.length} short ¶</Badge>
                        </>
                      )}
                      <LandingLink url={g.landing} />
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => readArticle(g.name, g.landing)}>Re-read</Button>
                      <Button size="sm" disabled={busy || !c} onClick={() => rewriteArticle(g.name)}>Rewrite</Button>
                      <Button
                        size="sm" variant="outline" disabled={!c || keptAds(g).length === 0 || articleComplianceRunning(g)}
                        onClick={() => checkArticleCompliance(g)}
                        title="Optional: checks this article together with its ads' images (full compliance prompt). Info only."
                      >
                        {articleComplianceRunning(g) ? 'Analyzing…' : 'Analyze compliance'}
                      </Button>
                    </div>
                  </div>
                  {keptAds(g).length > 0 && (
                    <div className="flex flex-wrap gap-2 px-3 pb-2">
                      {keptAds(g).map((ad) => {
                        const k = adKey(g.name, ad);
                        const cs = articleCompliance[k];
                        return (
                          <div key={k} className="relative h-16 w-16 rounded border border-slate-200 bg-slate-100 overflow-hidden" title={ad.ad_title}>
                            {ad.img_url || ad.video_url ? (
                              <button type="button" onClick={() => previewAd(ad)} className="relative h-full w-full bg-slate-800">
                                {ad.img_url && <img src={ad.img_url} loading="lazy" alt="" className="h-full w-full object-cover" />}
                                {ad.video_url && <PlayMark />}
                              </button>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] uppercase text-slate-400">{ad.ad_type || 'no img'}</div>
                            )}
                            {cs && (
                              <span className="absolute bottom-0.5 left-0.5">
                                <ComplianceBadge state={cs} onOpen={() => setComplianceDetail({ ad, kind: 'article', state: cs })} />
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {(st?.error || st?.note) && (
                    <div className={`px-3 pb-2 text-xs ${st.error ? 'text-red-600' : 'text-emerald-700'}`}>{st.error || st.note}</div>
                  )}
                  {open && c && (
                    <div className="border-t border-slate-100 px-3 py-3 space-y-3">
                      <Field label="Headline">
                        <Input value={c.article_headline || ''} onChange={(e) => editField(g.name, 'article_headline', e.target.value)} className="bg-white" />
                      </Field>
                      <Field label={`Intro · ${countWords(c.intro_text)} words`} bad={countWords(c.intro_text) < AMO.intro}>
                        <TextArea value={c.intro_text} onChange={(v) => editField(g.name, 'intro_text', v)} />
                      </Field>
                      {SECTIONS.filter((i) => c['h' + i] || c['p' + i]).map((i) => (
                        <div key={i} className="rounded border border-slate-100 p-2 space-y-1.5">
                          <Input value={c['h' + i]} onChange={(e) => editField(g.name, 'h' + i, e.target.value)} className="bg-white font-medium" />
                          <Field label={`p${i} · ${countWords(c['p' + i])} words`} bad={countWords(c['p' + i]) < AMO.paragraph}>
                            <TextArea value={c['p' + i]} onChange={(v) => editField(g.name, 'p' + i, v)} />
                          </Field>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-200 bg-white">
            <Button variant="outline" onClick={() => setStep(2)}>← Choose ads</Button>
            <span className="text-sm text-slate-700">
              {passCount} of {selectedList.length} articles pass AMO rules
            </span>
            <Button className="ml-auto" onClick={goToLaunch}>
              Next: launch →
            </Button>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <div className="mx-4 mb-2 rounded border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-gray-500 mb-1.5">Defaults for all articles</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
              <label className="flex items-center gap-1.5">
                Buyer
                <Combobox
                  value={launchBulk.buyer}
                  onChange={(v) => setLaunchBulk((b) => ({ ...b, buyer: v }))}
                  options={buyers.list.map((b) => b.buyer)}
                  placeholder={buyers.status === 'loading' ? 'Loading…' : 'Search buyer…'}
                  className="w-52"
                  inputClassName="h-7 bg-white"
                />
              </label>
              <span className="text-slate-500">New Source: <b className="text-slate-700">{trafficSource}</b></span>
              <label className="flex items-center gap-1.5">
                domain amo
                <Select
                  value={domainsFor(bulkEmail).includes(launchBulk.domain) ? launchBulk.domain : domainsFor(bulkEmail)[0] || ''}
                  onChange={(v) => setLaunchBulk((b) => ({ ...b, domain: v }))}
                  options={domainsFor(bulkEmail)}
                  placeholder={bulkEmail ? '— none —' : '— pick buyer —'}
                />
              </label>
              <span className="text-xs text-slate-500">
                {buyers.status === 'loading' && 'Loading buyers…'}
                {buyers.status === 'ready' && buyers.list.length === 0 && 'No buyers yet — add rows to the autozaliv_buyers datatable in n8n'}
                {bulkOptions?.status === 'loading' && 'Loading this buyer’s RSOC options…'}
                {bulkOptions?.status === 'error' && <span className="text-red-600">RSOC options: {bulkOptions.error}</span>}
              </span>
            </div>
          </div>
          {buyers.status === 'error' && <ErrorBox msg={`Buyers: ${buyers.error}`} />}
          <div className="flex-1 overflow-auto mx-4 mb-2 rounded border border-slate-200 bg-white">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-100 z-10">
                <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                  <th className="px-2 py-2">article</th>
                  <th className="px-2 py-2">content</th>
                  <th className="px-2 py-2">buyer</th>
                  <th className="px-2 py-2">domain amo</th>
                  <th className="px-2 py-2">keywords (utm_term)</th>
                  <th className="px-2 py-2">1️⃣ AMO article</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const l = launchFor(g.name);
                  const c = contents[g.name]?.content;
                  const a = amo[g.name];
                  const locked = a?.status === 'done' || a?.status === 'running';
                  return (
                    <tr key={g.name} className="border-b border-slate-100 align-top">
                      <td className="px-2 py-1.5 max-w-[260px] truncate text-slate-800" title={g.name}>{trimArticle(g.name)}</td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {c ? <Badge ok={amoCheck(c).pass}>{amoCheck(c).pass ? 'AMO ok' : 'fails AMO'}</Badge> : <span className="text-slate-400">not read</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {locked ? (
                          <span className="text-xs text-slate-700 whitespace-nowrap">{l.buyer || '—'}</span>
                        ) : (
                          <Combobox
                            value={l.buyer}
                            onChange={(v) => setOverride(g.name, { buyer: v })}
                            options={buyers.list.map((b) => b.buyer)}
                            placeholder="Search…"
                            className="w-44"
                            inputClassName="h-7 bg-white text-xs"
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Select value={l.domain} disabled={locked} onChange={(v) => setOverride(g.name, { domain: v })} options={l.domains} placeholder="—" />
                      </td>
                      <td className="px-2 py-1.5 min-w-[200px]">
                        <Input value={keywordsFor(g)} disabled={locked} onChange={(e) => setKeywords((k) => ({ ...k, [g.name]: e.target.value }))} className="h-7 bg-white text-xs" />
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[320px]">
                        {a?.status === 'running' && <span className="text-slate-500">Publishing…</span>}
                        {a?.status === 'done' && (
                          <div className="space-y-0.5">
                            <LandingLink url={a.articleUrl} full />
                            <div className="truncate text-slate-500" title={a.offerUrl}>offer: {a.offerUrl}</div>
                          </div>
                        )}
                        {a?.status === 'error' && <span className="text-red-600 break-words">{a.error}</span>}
                        {!a && <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-200 bg-white">
            <Button variant="outline" onClick={() => setStep(3)}>← Content</Button>
            <span className="text-sm text-slate-700">{amoDone} of {selectedList.length} AMO articles created</span>
            <Button className="ml-auto" disabled={publishing || amoDone === selectedList.length} onClick={createAmoArticles}>
              {publishing ? 'Creating…' : '1️⃣ Create AMO articles'}
            </Button>
            <Button variant="outline" disabled={anyRunning || Object.keys(amo).length === 0} onClick={() => newRun(4)}>↻ New run</Button>
            <Button variant="outline" disabled={amoDone === 0} onClick={goToBinom}>Next: Binom →</Button>
          </div>
        </>
      )}

      {step === 5 && (
        <>
          <div className="mx-4 mb-2 rounded border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-gray-500 mb-1.5">Binom settings for all articles</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
              <label className="flex items-center gap-1.5">
                Tracker
                <Select value={binomBulk.tracker} onChange={(v) => setBinomBulk((b) => ({ ...b, tracker: v, group: '' }))} options={[...BINOM_TRACKERS]} />
              </label>
              <label className="flex items-center gap-1.5">
                Group Binom
                <Select value={bulkGroup} onChange={(v) => setBinomBulk((b) => ({ ...b, group: v }))} options={trackerOpts?.groups || []} placeholder="— pick —" />
              </label>
              <label className="flex items-center gap-1.5">
                Geo
                <Input value={binomBulk.geo} onChange={(e) => setBinomBulk((b) => ({ ...b, geo: e.target.value.toUpperCase() }))} placeholder="auto" title="Empty = each article's geo from the sheet" className="h-7 w-16 bg-white" />
              </label>
              {platform === 'nb' ? (
                <>
                  <label className="flex items-center gap-1.5">
                    NB Account
                    <Combobox
                      value={binomBulk.nbAccount}
                      onChange={(v) => setBinomBulk((b) => ({ ...b, nbAccount: v }))}
                      options={nbAccountsList.map((a) => a.name)}
                      placeholder={nbAccountsStatus === 'loading' ? 'Loading…' : 'Search account…'}
                      className="w-64"
                      inputClassName="h-7 bg-white"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Bid Type
                    <Select value={binomBulk.bidType} onChange={(v) => setBinomBulk((b) => ({ ...b, bidType: v }))} options={BID_TYPES} />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Tracking event
                    <Select value={binomBulk.event} onChange={(v) => setBinomBulk((b) => ({ ...b, event: v }))} options={['auto', 'click_button', 'complete_payment']} />
                    {binomBulk.event === 'auto' && <span className="text-xs text-slate-500">→ {resolveEvent('auto', binomBulk.bidType)}</span>}
                  </label>
                </>
              ) : (
                <label className="flex items-center gap-1.5">
                  FB Account
                  <Combobox
                    value={binomBulk.fbAccount}
                    onChange={(v) => setBinomBulk((b) => ({ ...b, fbAccount: v }))}
                    options={fbOptions.accounts.map(itemLabel)}
                    placeholder={fbOptions.status === 'loading' ? 'Loading…' : 'Search name or id…'}
                    className="w-80"
                    inputClassName="h-7 bg-white"
                  />
                  {fbAccount && fbTyped !== itemLabel(fbAccount) && <span className="text-xs text-emerald-700">→ {itemLabel(fbAccount)}</span>}
                  {fbOptions.status === 'ready' && fbTyped && !fbAccount && <span className="text-xs text-red-600">no account with this name / id</span>}
                  {fbOptions.status === 'error' && <span className="text-xs text-red-600">{fbOptions.error}</span>}
                  {fbOptions.status === 'ready' && fbOptions.accounts.length === 0 && (
                    <span className="text-xs text-slate-500">fb_accounts is empty — run "Sync FB" in n8n</span>
                  )}
                </label>
              )}
              <label className="flex items-center gap-1.5">
                Cmp name suffix
                <Input value={binomBulk.suffix} onChange={(e) => setBinomBulk((b) => ({ ...b, suffix: e.target.value }))} placeholder="auto: competitor" className="h-7 w-32 bg-white" />
              </label>
              <span className="text-xs text-slate-500">
                {trackerOpts?.status === 'loading' && 'Loading groups and domains…'}
                {trackerOpts?.status === 'error' && <span className="text-red-600">{trackerOpts.error}</span>}
              </span>
            </div>
          </div>
          {platform === 'nb' && (
            <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-sm">
              <span className="text-slate-600">Name ≤ {NAME_MAX} chars — it is also the NB advertiser after "{ADVERTISER_PREFIX.trim()}"</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" disabled={longNames.length === 0 || longNames.some((g) => shortening['name|' + g.name]?.busy)} onClick={() => shortenNames(longNames)}>
                  Shorten all long names ({longNames.length})
                </Button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-auto mx-4 mb-2 rounded border border-slate-200 bg-white">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-100 z-10">
                <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                  <th className="px-2 py-2">article</th>
                  <th className="px-2 py-2">name</th>
                  <th className="px-2 py-2">geo</th>
                  <th className="px-2 py-2">lang</th>
                  <th className="px-2 py-2">offer name / binom cmp name</th>
                  <th className="px-2 py-2">2️⃣ Binom</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const b = binomFor(g);
                  const r = binom[g.name];
                  const locked = r?.status === 'done' || r?.status === 'running';
                  const noAmo = amo[g.name]?.status !== 'done';
                  const sn = shortening['name|' + g.name];
                  return (
                    <tr key={g.name} className={`border-b border-slate-100 align-top ${noAmo ? 'opacity-50' : ''}`}>
                      <td className="px-2 py-1.5 max-w-[220px] truncate text-slate-800" title={g.name}>{trimArticle(g.name)}</td>
                      <td className="px-2 py-1.5 min-w-[160px]">
                        <Input value={b.name} disabled={locked || sn?.busy} onChange={(e) => setBinomRow(g.name, { name: e.target.value })} className="h-7 bg-white text-xs" />
                        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                          {platform === 'nb' && <span className={b.name.length > NAME_MAX ? 'text-red-600' : 'text-slate-400'}>{b.name.length}/{NAME_MAX}</span>}
                          {platform === 'nb' && !locked && b.name.length > NAME_MAX && (
                            <button type="button" disabled={sn?.busy} onClick={() => shortenNames([g])} className="text-blue-600 underline hover:no-underline disabled:text-slate-400">
                              {sn?.busy ? 'Shortening…' : '✨ Shorten'}
                            </button>
                          )}
                          {!locked && !sn?.busy && b.name !== defaultName(g.name) && (
                            <button type="button" onClick={() => setBinomRow(g.name, { name: undefined })} title={defaultName(g.name)} className="text-slate-500 underline hover:no-underline">
                              ↺ Original
                            </button>
                          )}
                        </div>
                        {sn?.error && <div className="text-[11px] text-red-600 break-words">{sn.error}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={b.geo} disabled={locked} onChange={(e) => setBinomRow(g.name, { geo: e.target.value.toUpperCase() })} className="h-7 w-14 bg-white text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={b.lang} disabled={locked} onChange={(e) => setBinomRow(g.name, { language: e.target.value.toUpperCase() })} className="h-7 w-14 bg-white text-xs" />
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-600 max-w-[420px]">
                        <div className="truncate" title={b.offerName}>{b.offerName}</div>
                        <div className="truncate" title={b.campaignName}>{b.campaignName}</div>
                        {b.offerUrl && <div className="truncate text-slate-400" title={b.offerUrl}>{b.offerUrl}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[320px]">
                        {noAmo && <span className="text-slate-400">no AMO article yet</span>}
                        {r?.status === 'running' && <span className="text-slate-500">Creating…</span>}
                        {r?.status === 'done' && (
                          <div className="space-y-0.5">
                            <div className="text-slate-600">offer {r.offerId} · campaign {r.campaignId}</div>
                            <div className="truncate text-blue-600" title={r.campaignUrl}>{r.campaignUrl}</div>
                          </div>
                        )}
                        {r?.status === 'error' && (
                          <span className="text-red-600 break-words">
                            {r.error}
                            {r.offerId ? ` (offer ${r.offerId} kept — Retry reuses it)` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-200 bg-white">
            <Button variant="outline" onClick={() => setStep(4)}>← AMO articles</Button>
            <span className="text-sm text-slate-700">{binomDone} of {selectedList.length} Binom campaigns created</span>
            <Button className="ml-auto" disabled={binomRunning || binomDone === selectedList.length} onClick={createBinom}>
              {binomRunning ? 'Creating…' : '2️⃣ Create Binom'}
            </Button>
            <Button variant="outline" disabled={anyRunning || Object.keys(binom).length === 0} onClick={() => newRun(5)}>↻ New run</Button>
            <Button variant="outline" disabled={binomDone === 0} onClick={goToNb}>Next: {platform.toUpperCase()} →</Button>
          </div>
        </>
      )}

      {step === 6 && platform === 'nb' && (
        <>
          <div className="mx-4 mb-2 rounded border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-gray-500 mb-1.5">NB settings for all articles</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
              <span className="text-slate-500">
                Account: <b className="text-slate-700">{binomBulk.nbAccount || '— pick in step 5 —'}</b>
                {nbAccountId && <span className="text-xs"> ({nbAccountId})</span>}
              </span>
              <span className="text-slate-500">
                Event: <b className="text-slate-700">{trackingEvent}</b>{' '}
                {accountEvents?.status === 'loading' && <span className="text-xs">loading…</span>}
                {accountEvents?.status === 'ready' && (trackingId
                  ? <span className="text-xs text-emerald-700">id {trackingId}</span>
                  : <span className="text-xs text-red-600">not in this account</span>)}
                {accountEvents?.status === 'error' && <span className="text-xs text-red-600">{accountEvents.error}</span>}
              </span>
              <label className="flex items-center gap-1.5">
                Daily budget $
                <Input type="number" min={1} value={nbBulk.budget} onChange={(e) => setNbBulk((b) => ({ ...b, budget: Number(e.target.value) || 0 }))} className="h-7 w-20 bg-white" />
              </label>
              <label className="flex items-center gap-1.5">
                Bid
                <span className="font-medium">{binomBulk.bidType}</span>
                {binomBulk.bidType !== 'MAX_CONVERSION' && (
                  <>
                    <Input type="number" min={0} step="0.01" value={nbBulk.bidValue} onChange={(e) => setNbBulk((b) => ({ ...b, bidValue: Number(e.target.value) || 0 }))} className="h-7 w-20 bg-white" />
                    <span className="text-xs text-slate-500">{binomBulk.bidType === 'TARGET_ROAS' ? '% ROAS' : '$ CPA'}</span>
                  </>
                )}
              </label>
              <label className="flex items-center gap-1.5">
                Start
                <Select value={nbBulk.startDate} onChange={(v) => setNbBulk((b) => ({ ...b, startDate: v }))} options={START_DATE_OPTIONS.map((o) => o.value)} />
                <Select value={nbBulk.timezone} onChange={(v) => setNbBulk((b) => ({ ...b, timezone: v }))} options={TIMEZONE_OPTIONS.map((o) => o.value)} />
              </label>
              <label className="flex items-center gap-1.5">
                CTA
                <Select value={cta} onChange={(v) => setNbBulk((b) => ({ ...b, cta: v }))} options={NB_CTA_OPTIONS} />
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-sm">
            <span className="text-slate-600">NB description ≤ {NB_TEXT.body.max} chars</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" disabled={nbLongDescGroups.length === 0 || nbLongDescGroups.some((g) => shortening['desc|' + g.name]?.busy)} onClick={() => pool(nbLongDescGroups, 2, shortenDescriptions)}>
                Rewrite all long descriptions ({nbLongDescGroups.reduce((n, g) => n + longDescs(g).length, 0)})
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto mx-4 mb-2 rounded border border-slate-200 bg-white">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-100 z-10">
                <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                  <th className="px-2 py-2">article</th>
                  <th className="px-2 py-2">NB campaign / ad set name</th>
                  <th className="px-2 py-2">advertiser</th>
                  <th className="px-2 py-2">ads</th>
                  <th className="px-2 py-2">click URL (Binom)</th>
                  <th className="px-2 py-2">3️⃣ NB</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const ads = nbAdsFor(g);
                  const r = nb[g.name];
                  const locked = r?.status === 'done' || r?.status === 'running';
                  const noBinom = binom[g.name]?.status !== 'done';
                  const sd = shortening['desc|' + g.name];
                  return [
                    <tr key={g.name} className={`border-b border-slate-100 align-top ${noBinom ? 'opacity-50' : ''}`}>
                      <td className="px-2 py-1.5 max-w-[220px] truncate text-slate-800" title={g.name}>{trimArticle(g.name)}</td>
                      <td className="px-2 py-1.5 min-w-[320px]">
                        <Input value={nbNameFor(g)} disabled={locked} onChange={(e) => setNbNames((s) => ({ ...s, [g.name]: e.target.value }))} className="h-7 bg-white text-xs" />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-slate-500">{ADVERTISER_PREFIX}</span>
                          <Input
                            value={advertiserPartFor(g)}
                            disabled={locked}
                            onChange={(e) => setNbAdvertisers((s) => ({ ...s, [g.name]: e.target.value }))}
                            className="h-7 w-36 bg-white text-xs"
                          />
                          <span className={advertiserFor(g).length > BRAND_MAX ? 'text-red-600' : 'text-slate-400'}>
                            {advertiserFor(g).length}/{BRAND_MAX}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-600 whitespace-nowrap">
                        <button type="button" onClick={() => setNbOpen(nbOpen === g.name ? null : g.name)} className="underline hover:no-underline">
                          {nbOpen === g.name ? '▾' : '▸'} Edit ads ({ads.length})
                        </button>
                        {nbTextError(ads) && <div className="text-red-600">text too long/short</div>}
                        {!locked && longDescs(g).length > 0 && (
                          <button type="button" disabled={sd?.busy} onClick={() => shortenDescriptions(g)} className="block text-blue-600 underline hover:no-underline disabled:text-slate-400">
                            {sd?.busy ? 'Rewriting…' : `✨ Rewrite ${longDescs(g).length} long description${longDescs(g).length > 1 ? 's' : ''}`}
                          </button>
                        )}
                        {sd?.error && <div className="text-red-600 whitespace-normal break-words">{sd.error}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[260px] truncate text-slate-500" title={binom[g.name]?.campaignUrl}>
                        {binom[g.name]?.campaignUrl || 'no Binom campaign yet'}
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[320px]">
                        {r?.status === 'running' && <span className="text-slate-500">Uploading assets & creating…</span>}
                        {r?.status === 'done' && (
                          <div className="text-slate-600">
                            campaign {r.campaignId} · ad set {r.adsetId} · {r.adIds?.length || 0} ads
                            {r.error && <div className="text-amber-600">{r.error}</div>}
                          </div>
                        )}
                        {r?.status === 'error' && <span className="text-red-600 break-words">{r.error}</span>}
                      </td>
                    </tr>,
                    nbOpen === g.name && (
                      <tr key={g.name + '|ads'} className="border-b border-slate-200 bg-slate-50">
                        <td colSpan={6} className="px-3 py-2 space-y-2">
                          {ads.map((ad) => (
                            <div key={ad.key} className="flex gap-3 rounded border border-slate-200 bg-white p-2">
                              {ad.img && <img src={ad.img} loading="lazy" alt="" className="h-16 w-16 max-w-none rounded object-cover bg-slate-100" />}
                              <div className="flex-1 space-y-1.5 min-w-0">
                                <div className="text-[10px] font-bold uppercase text-gray-500">{ad.adName}</div>
                                <TextCounter
                                  label="Headline" value={ad.headline} limit={NB_TEXT.headline} disabled={locked}
                                  onChange={(v) => editAd(ad.key, { headline: v })}
                                />
                                <TextCounter
                                  label="Description" value={ad.body} limit={NB_TEXT.body} disabled={locked}
                                  onChange={(v) => editAd(ad.key, { body: v })}
                                />
                              </div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-200 bg-white">
            <Button variant="outline" onClick={() => setStep(5)}>← Binom</Button>
            <span className="text-sm text-slate-700">{nbDone} of {selectedList.length} NB campaigns created</span>
            <Button className="ml-auto" disabled={nbRunning || nbDone === selectedList.length} onClick={createNb}>
              {nbRunning ? 'Creating…' : '3️⃣ Create NB campaigns'}
            </Button>
            <Button variant="outline" disabled={anyRunning || Object.keys(nb).length === 0} onClick={() => newRun(6)}>↻ New run</Button>
          </div>
        </>
      )}

      {step === 6 && platform === 'fb' && (
        <>
          <div className="mx-4 mb-2 rounded border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-gray-500 mb-1.5">FB settings for all articles</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
              <span className="text-slate-500">
                Account: <b className="text-slate-700">{fbAccount?.name || '— pick in step 5 —'}</b>
                {fbAccountId && <span className="text-xs"> ({fbAccountId})</span>}
              </span>
              <label className="flex items-center gap-1.5">
                Page
                <Combobox
                  value={fbBulk.page}
                  onChange={(v) => setFbBulk((b) => ({ ...b, page: v }))}
                  options={fbPages.map(itemLabel)}
                  placeholder={fbOptions.status === 'loading' ? 'Loading…' : !fbAccount ? 'Pick account first' : fbPages.length ? 'Search page…' : 'No pages on this account\'s token'}
                  className="w-72"
                  inputClassName="h-7 bg-white"
                />
              </label>
              <label className="flex items-center gap-1.5">
                Pixel
                <Select
                  value={fbPixel ? itemLabel(fbPixel) : fbBulk.pixel}
                  onChange={(v) => setFbBulk((b) => ({ ...b, pixel: v }))}
                  options={(accountPixels?.pixels || []).map(itemLabel)}
                  placeholder={accountPixels?.status === 'loading' ? 'Loading…' : '— pick —'}
                  disabled={!fbNeedsPixel}
                />
                {accountPixels?.status === 'error' && <span className="text-xs text-red-600">{accountPixels.error}</span>}
                {accountPixels?.status === 'ready' && accountPixels.pixels.length === 0 && <span className="text-xs text-red-600">no pixels on this account</span>}
              </label>
              <label className="flex items-center gap-1.5">
                Campaign objective
                <Select value={fbBulk.objective} onChange={(v) => setFbBulk((b) => ({ ...b, objective: v }))} options={FB_OBJECTIVES} labels={FB_OBJECTIVE_LABELS} />
              </label>
              <label className="flex items-center gap-1.5">
                Performance goal
                <Select value={fbBulk.goal} onChange={(v) => setFbBulk((b) => ({ ...b, goal: v }))} options={FB_GOALS_BY_OBJECTIVE[fbBulk.objective] || []} labels={fbGoalLabels(fbBulk.objective)} />
              </label>
              <label className="flex items-center gap-1.5">
                Conversion event
                <Select
                  value={fbBulk.event}
                  onChange={(v) => setFbBulk((b) => ({ ...b, event: v }))}
                  options={fbNeedsPixel ? FB_EVENTS_BY_OBJECTIVE[fbBulk.objective] || [] : []}
                  labels={FB_EVENT_LABELS}
                  placeholder="— not used —"
                  disabled={!fbNeedsPixel}
                />
              </label>
              <label className="flex items-center gap-1.5">
                Bid strategy
                <Select value={fbBulk.bidStrategy} onChange={(v) => setFbBulk((b) => ({ ...b, bidStrategy: v }))} options={FB_BIDS_BY_GOAL[fbBulk.goal] || []} labels={fbBidLabels(fbBulk.goal)} />
                {FB_BID_NEEDS_AMOUNT.includes(fbBulk.bidStrategy) && (
                  <>
                    <Input type="number" min={0} step="0.01" value={fbBulk.bidAmount} onChange={(e) => setFbBulk((b) => ({ ...b, bidAmount: Number(e.target.value) || 0 }))} className="h-7 w-20 bg-white" />
                    <span className="text-xs text-slate-500">$</span>
                  </>
                )}
              </label>
              <label className="flex items-center gap-1.5">
                Budget
                <Select value={fbBulk.budgetMode} onChange={(v) => setFbBulk((b) => ({ ...b, budgetMode: v }))} options={Object.keys(FB_BUDGET_LABELS)} labels={FB_BUDGET_LABELS} />
                <Input type="number" min={1} value={fbBulk.budget} onChange={(e) => setFbBulk((b) => ({ ...b, budget: Number(e.target.value) || 0 }))} className="h-7 w-20 bg-white" />
                <span className="text-xs text-slate-500">$ daily</span>
              </label>
              <label className="flex items-center gap-1.5">
                Special ad categories
                <Select value={fbBulk.special} onChange={(v) => setFbBulk((b) => ({ ...b, special: v }))} options={FB_SPECIAL} labels={FB_SPECIAL_LABELS} />
              </label>
              <label className="flex items-center gap-1.5">
                Status
                <Select value={fbBulk.status} onChange={(v) => setFbBulk((b) => ({ ...b, status: v }))} options={Object.keys(FB_STATUS_LABELS)} labels={FB_STATUS_LABELS} />
              </label>
            </div>
            {/* Start date: presets like Newsbreak Copier, plus a custom moment (not inside a <label> — the picker is a popover). */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
              <span>Start date</span>
              <Select
                value={fbBulk.startDate}
                onChange={(v) => setFbBulk((b) => ({ ...b, startDate: v, ...(v === 'custom' ? { customStart: defaultCustomStart() } : {}) }))}
                options={FB_START}
                labels={FB_START_LABELS}
              />
              {fbBulk.startDate === 'custom' ? (
                <>
                  <div className="w-56">
                    <DateTimePicker24h
                      value={fbBulk.customStart}
                      minDate={toLocalInputValue(new Date()).slice(0, 10)}
                      onChange={(v) => setFbBulk((b) => ({ ...b, customStart: v }))}
                    />
                  </div>
                  <span className="text-xs text-slate-500">your time ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
                  {customStartError(fbBulk.customStart) ? (
                    <span className="text-xs text-red-600">{customStartError(fbBulk.customStart)}</span>
                  ) : accountPixels?.timezone && (
                    <span className="text-xs text-slate-600">
                      = <b>{formatInZone(new Date(fbBulk.customStart).getTime(), accountPixels.timezone)}</b> account time
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-slate-500">
                  {fbBulk.startDate === 'now' ? 'starts right away' : `01:00 account time${accountPixels?.timezone ? ` (${accountPixels.timezone})` : ''}`}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto mx-4 mb-2 rounded border border-slate-200 bg-white">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-100 z-10">
                <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                  <th className="px-2 py-2">article</th>
                  <th className="px-2 py-2">FB campaign / ad set name</th>
                  <th className="px-2 py-2">ads</th>
                  <th className="px-2 py-2">ad URL (Binom, funnel = pixel)</th>
                  <th className="px-2 py-2">3️⃣ FB</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const ads = nbAdsFor(g);
                  const r = fb[g.name];
                  const locked = r?.status === 'done' || r?.status === 'running';
                  const noBinom = binom[g.name]?.status !== 'done';
                  const link = fbLinkFor(g.name);
                  return [
                    <tr key={g.name} className={`border-b border-slate-100 align-top ${noBinom ? 'opacity-50' : ''}`}>
                      <td className="px-2 py-1.5 max-w-[220px] truncate text-slate-800" title={g.name}>{trimArticle(g.name)}</td>
                      <td className="px-2 py-1.5 min-w-[320px]">
                        <Input value={nbNameFor(g)} disabled={locked || !!r?.partial?.campaignId} onChange={(e) => setNbNames((s) => ({ ...s, [g.name]: e.target.value }))} className="h-7 bg-white text-xs" />
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-600 whitespace-nowrap">
                        <button type="button" onClick={() => setNbOpen(nbOpen === g.name ? null : g.name)} className="underline hover:no-underline">
                          {nbOpen === g.name ? '▾' : '▸'} Edit ads ({ads.length})
                        </button>
                        {fbTextError(ads) && <div className="text-red-600">text too long/short</div>}
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[260px] truncate text-slate-500" title={link}>
                        {link || 'no Binom campaign yet'}
                        {link && !link.includes('funnel=') && <div className="text-amber-600">no funnel= in the Binom link</div>}
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[320px]">
                        {r?.status === 'running' && <span className="text-slate-500">Uploading creatives & creating…</span>}
                        {r?.status === 'done' && (
                          <div className="text-slate-600">
                            campaign {r.campaignId} · ad set {r.adsetId} · {r.adIds?.length || 0} ads
                            {r.error && <div className="text-amber-600">{r.error}</div>}
                          </div>
                        )}
                        {r?.status === 'error' && (
                          <span className="text-red-600 break-words">
                            {r.error}
                            {r.partial?.campaignId && ` (campaign ${r.partial.campaignId}${r.partial.adsetId ? ' · ad set ' + r.partial.adsetId : ''} kept — Retry continues it)`}
                          </span>
                        )}
                      </td>
                    </tr>,
                    nbOpen === g.name && (
                      <tr key={g.name + '|ads'} className="border-b border-slate-200 bg-slate-50">
                        <td colSpan={5} className="px-3 py-2 space-y-2">
                          {ads.map((ad) => (
                            <div key={ad.key} className="flex gap-3 rounded border border-slate-200 bg-white p-2">
                              {ad.img && <img src={ad.img} loading="lazy" alt="" className="h-16 w-16 max-w-none rounded object-cover bg-slate-100" />}
                              <div className="flex-1 space-y-1.5 min-w-0">
                                <div className="text-[10px] font-bold uppercase text-gray-500">{ad.adName} · {fbCta(ad.cta)}</div>
                                <TextCounter
                                  label="Headline" value={ad.headline} limit={FB_TEXT.headline} disabled={locked || !!r?.partial?.ads?.[ad.key]}
                                  onChange={(v) => editAd(ad.key, { headline: v })}
                                />
                                <TextCounter
                                  label="Primary text" value={ad.body} limit={FB_TEXT.body} disabled={locked || !!r?.partial?.ads?.[ad.key]}
                                  onChange={(v) => editAd(ad.key, { body: v })}
                                />
                              </div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-200 bg-white">
            <Button variant="outline" onClick={() => setStep(5)}>← Binom</Button>
            <span className="text-sm text-slate-700">{fbDone} of {selectedList.length} FB campaigns created</span>
            <Button className="ml-auto" disabled={fbRunning || fbDone === selectedList.length} onClick={createFb}>
              {fbRunning ? 'Creating…' : '3️⃣ Create FB campaigns'}
            </Button>
            <Button variant="outline" disabled={anyRunning || Object.keys(fb).length === 0} onClick={() => newRun(6)}>↻ New run</Button>
          </div>
        </>
      )}
    </div>
  );
}

// Step 1 language / geo filter box: keeps the typed text locally so letters show at once, and
// passes it up only after typing pauses — re-filtering ~5k table rows per keystroke made typing lag.
function FilterCombobox({ value, onChange, ...rest }: ComponentProps<typeof Combobox>) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return <Combobox value={text} onChange={setText} {...rest} />;
}

function StepPill({ n, label, active, disabled, onClick }: { n: number; label: string; active: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-3 py-1 border ${
        active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {n}. {label}
    </button>
  );
}

function SortTh({ label, k, sort, onSort }: { label: string; k: string; sort: { key: string; dir: string }; onSort: (k: string) => void }) {
  return (
    <th className="px-2 py-2 whitespace-nowrap cursor-pointer select-none hover:text-gray-800" onClick={() => onSort(k)}>
      {label}
      {sort.key === k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );
}

// Only Top is editable; sort / unique image / type / network stay at DEFAULT_SETTINGS.
function SettingsControls({ value, onChange }: { value: Settings; onChange: (s: Settings) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
      <label className="flex items-center gap-1.5">
        Top
        <Input type="number" min={1} value={value.top} onChange={(e) => onChange({ ...value, top: Number(e.target.value) || 1 })} className="h-7 w-16 bg-white" />
      </label>
    </div>
  );
}

// Compliance verdict chip. It sits inside clickable cards, so it is a span (no nested button)
// and stops the click from toggling the card.
function ComplianceBadge({ state, onOpen }: { state: ComplianceState; onOpen: () => void }) {
  const r = state.result;
  const [cls, label, tip] = state.status === 'running' ? ['bg-slate-500', '…', 'Checking compliance…']
    : state.status === 'error' ? ['bg-red-600', '!', `Compliance check failed: ${state.error}`]
    : r?.compliant ? ['bg-emerald-600', '✓ OK', 'Compliant — click for details']
    : ['bg-amber-500', `! ${r?.issues.length || ''}`.trim(), `${r?.issues.map((i) => i.description).join('; ') || r?.summary || 'Not compliant'} — click for details`];
  return (
    <span
      role="button"
      tabIndex={0}
      title={tip}
      onClick={(e) => { e.stopPropagation(); if (state.status !== 'running') onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); if (state.status !== 'running') onOpen(); } }}
      className={`inline-block rounded px-1.5 text-[10px] font-medium text-white shadow ${cls} ${state.status === 'running' ? '' : 'cursor-pointer'}`}
    >
      {label}
    </span>
  );
}

function ComplianceSummary({ states }: { states: (ComplianceState | undefined)[] }) {
  const done = states.filter((s) => s?.status === 'done');
  if (done.length === 0) return null;
  const flagged = done.filter((s) => !s!.result?.compliant).length;
  const failed = states.filter((s) => s?.status === 'error').length;
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`h-2 w-2 rounded-full ${flagged ? 'bg-yellow-500' : 'bg-green-500'}`} />
      {flagged ? `${flagged} of ${done.length} checked ads flagged` : `All ${done.length} checked ads compliant`}
      {failed > 0 && <span className="text-red-600">· {failed} failed</span>}
    </span>
  );
}

function ComplianceDetailModal({ detail, onClose }: { detail: ComplianceDetail; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const { ad, kind, state } = detail;
  const r = state.result;
  const block = (title: string, rec: Record<string, string>) => {
    const entries = Object.entries(rec).filter(([, v]) => v);
    if (entries.length === 0) return null;
    return (
      <div>
        <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">{title}</div>
        <div className="space-y-1 text-xs">
          {entries.map(([k, v]) => (
            <div key={k}><span className="text-slate-500">{k}:</span> <span className="text-slate-800 whitespace-pre-wrap">{v}</span></div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-lg bg-white p-4 shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          {ad.img_url && <img src={ad.img_url} alt="" className="h-20 w-20 rounded object-cover border border-slate-200" />}
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase text-slate-500">
              {kind === 'ads' ? 'Compliance · ad + image' : 'Compliance · article + images'}
            </div>
            <div className="text-sm font-medium text-slate-800 line-clamp-2">{ad.ad_title || ad.ad_text || '—'}</div>
            {state.status === 'error' ? (
              <div className="text-sm text-red-600">Check failed: {state.error}</div>
            ) : r && (
              <div className="flex items-center gap-1.5 text-sm">
                <span className={`h-2 w-2 rounded-full ${r.compliant ? 'bg-green-500' : 'bg-yellow-500'}`} />
                {r.compliant ? 'Compliant' : `Not compliant · ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}`}
                {r.category && <span className="text-xs text-slate-500">· {r.category}{r.main_topic ? ` — ${r.main_topic}` : ''}</span>}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Close">×</button>
        </div>
        {r && (
          <>
            {r.image_error && <div className="text-xs text-amber-700">Image not checked: {r.image_error}</div>}
            {r.issues.length > 0 && (
              <div className="space-y-1.5">
                {r.issues.map((i, n) => (
                  <div key={n} className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs">
                    <span className="font-medium text-amber-800">{i.type}</span>
                    {i.policy_reference && <span className="text-amber-700"> · policy {i.policy_reference}</span>}
                    <div className="text-slate-700">{i.description}</div>
                  </div>
                ))}
              </div>
            )}
            {r.summary && <div className="text-xs text-slate-700"><span className="font-bold uppercase text-[10px] text-slate-500">Summary </span>{r.summary}</div>}
            {r.recommendations && <div className="text-xs text-slate-700"><span className="font-bold uppercase text-[10px] text-slate-500">Recommendations </span>{r.recommendations}</div>}
            {!r.compliant && block('Optimized content', r.optimized_content)}
            {block('Translated (UA)', r.translated_content)}
          </>
        )}
      </div>
    </div>
  );
}

// Play triangle over a video thumbnail.
function PlayMark() {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[9px] text-white">▶</span>
    </span>
  );
}

function AdCard({ ad, metric, off, onToggle, onPreview, compliance, onCompliance }: {
  ad: Row; metric: string; off: boolean; onToggle: () => void; onPreview: () => void; compliance?: ComplianceState; onCompliance: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={off ? 'Excluded — click to include' : 'Click to exclude'}
      className={`relative text-left rounded border overflow-hidden transition ${
        off ? 'border-slate-200 opacity-35 grayscale' : 'border-slate-300 hover:border-amber-400'
      }`}
    >
      <div className="relative aspect-square bg-slate-100">
        {ad.img_url && <img src={ad.img_url} loading="lazy" alt="" className="h-full w-full object-cover" />}
        {ad.video_url && <PlayMark />}
        {compliance && (
          <span className="absolute bottom-1 left-1">
            <ComplianceBadge state={compliance} onOpen={onCompliance} />
          </span>
        )}
        {(ad.img_url || ad.video_url) && (
          // span, not button: the card itself is a button (toggle).
          <span
            role="button"
            title={ad.video_url ? 'Play video full size' : 'Open image full size'}
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white hover:bg-black"
          >
            {ad.video_url ? '▶ full' : '⤢ full'}
          </span>
        )}
      </div>
      <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 text-[10px] uppercase text-white">{ad.ad_type || '?'}</span>
      <span className={`absolute top-1 right-1 rounded px-1.5 text-[10px] text-white ${off ? 'bg-slate-500' : 'bg-emerald-600'}`}>
        {off ? '✘' : '✔'}
      </span>
      <div className="p-1.5 space-y-1">
        <div className="text-xs font-medium text-slate-800 line-clamp-2" title={ad.ad_title}>{ad.ad_title || '—'}</div>
        <div className="text-[11px] text-slate-600 line-clamp-3" title={ad.ad_text}>{ad.ad_text || '—'}</div>
        {ad.cta && (
          <span className="inline-block rounded bg-blue-50 border border-blue-200 px-1.5 text-[10px] text-blue-700">{formatCta(ad.cta)}</span>
        )}
        <div className="text-[10px] text-slate-500 truncate">
          {metric}: {ad[metric] || '—'} · {ad.source}
        </div>
      </div>
    </button>
  );
}

// Opens in a new tab; stopPropagation keeps a click from toggling the row/card.
function LandingLink({ url, full }: { url?: string; full?: boolean }) {
  if (!url) return <span className="text-slate-400">—</span>;
  let label = url;
  if (!full) {
    try {
      label = new URL(url).hostname;
    } catch {}
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url} onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">
      {label}
    </a>
  );
}

// labels: optional display text per value (the value is still what gets sent).
function Select({ value, onChange, options, placeholder, disabled, labels }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; disabled?: boolean; labels?: Record<string, string>;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      title={labels ? value : undefined}
      className={`h-7 rounded border border-slate-200 bg-white px-1 text-sm disabled:opacity-50 ${labels ? 'max-w-[280px]' : 'max-w-[200px]'}`}
    >
      {placeholder !== undefined && !options.includes(value) && <option value={value}>{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o}>{labels?.[o] ?? o}</option>
      ))}
    </select>
  );
}

// One NB text field with a live length counter against NB's limit.
function TextCounter({ label, value, limit, disabled, onChange }: {
  label: string; value: string; limit: { min: number; max: number }; disabled?: boolean; onChange: (v: string) => void;
}) {
  const n = value.trim().length;
  const bad = n < limit.min || n > limit.max;
  return (
    <div>
      <div className="flex items-center gap-2 text-[10px] uppercase">
        <span className="font-bold text-gray-500">{label}</span>
        <span className={bad ? 'text-red-600 font-bold' : 'text-slate-400'}>{n}/{limit.max}</span>
      </div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, Math.max(2, Math.ceil(value.length / 110)))}
        className={`w-full rounded border bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none disabled:opacity-60 ${bad ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'}`}
      />
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 border ${ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
      {children}
    </span>
  );
}

function Field({ label, bad, children }: { label: string; bad?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className={`mb-1 text-[10px] font-bold uppercase ${bad ? 'text-red-600' : 'text-gray-500'}`}>{label}</div>
      {children}
    </div>
  );
}

function TextArea({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      rows={Math.min(12, Math.max(3, Math.ceil((value || '').length / 140)))}
      className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:outline-none focus:border-slate-400"
    />
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div className="mx-4 mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>;
}

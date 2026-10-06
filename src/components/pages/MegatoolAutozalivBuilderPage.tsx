import { useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { useAppStore, parseNbEventsResponse, type NbEvent } from '@/store/useAppStore';
import { BINOM_TRACKERS } from '@/lib/binomGroups';
import { START_DATE_OPTIONS, TIMEZONE_OPTIONS } from './MegatoolCreateNbCampaignPage';
import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';
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

// Step 1 competitor filter: competitor → texts one of which its landing URL contains.
const COMPETITORS: Record<string, string[]> = {
  organizertone: ['organizertone', 'balancebazar.com'],
  sarb: ['sarb'],
  ad2lynx: [
    'perabianco.com', 'pancettafuns.com', 'walletilo.com', 'contranoche.com', 'contradia.com', 'healthquix.com',
    'geeksstory.com', 'finomira.com', 'fintreat.com', 'healquix.com', 'moneytano.com',
  ],
  amo: ['financeply.com', 'contraspero.com', 'fortunevia.com', 'retrotreat.com', 'thetopselected.com', 'topfindtoday.com'],
  'Orbitpeek (Tonic)': ['orbitpeek.com'],
  theunexploredroad: ['theunexploredroad.com'],
};
const competitorOf = (url: string) =>
  Object.keys(COMPETITORS).find((c) => COMPETITORS[c].some((s) => url.toLowerCase().includes(s))) || '';

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
type BinomState = { status: 'running' | 'done' | 'error'; offerId?: string; campaignId?: string; campaignUrl?: string; error?: string };

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
function offerUrlFor(articleUrl: string, keywords: string, bidType: string, platform: Platform): string {
  const base = articleUrl.split(/[?#]/)[0];
  const kw = keywords.split(',').map((k) => k.trim()).filter(Boolean).join(',');
  const term = kw ? '&utm_term=' + encodeURIComponent(kw) : '';
  if (platform === 'fb') {
    return base + '?m=og&part=bol&utm_source=facebook&utm_medium=gs&fbclid={t10}&term1={clickid}_{campaign_id}'
      + '&term2={campaign_domain}&utm_content={t12}' + term + '&channel=&ad_id={t6}';
  }
  return base + '?m=og&part=bol&utm_source=newsbreak&utm_medium=gs&newsbreak_cid={t10}&term1={clickid}_{campaign_id}'
    + (bidType === 'TARGET_ROAS' ? '_roas' : '') + '&term2={campaign_domain}&utm_content={t12}&ad_id={t2}'
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
const FB_OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: 'Leads', OUTCOME_SALES: 'Sales', OUTCOME_TRAFFIC: 'Traffic',
};
const FB_GOAL_LABELS: Record<string, string> = {
  OFFSITE_CONVERSIONS: 'Maximize number of conversions', LANDING_PAGE_VIEWS: 'Maximize number of landing page views',
  LINK_CLICKS: 'Maximize number of link clicks', IMPRESSIONS: 'Maximize number of impressions', REACH: 'Maximize daily unique reach',
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
  OUTCOME_LEADS: ['OFFSITE_CONVERSIONS'],
  OUTCOME_SALES: ['OFFSITE_CONVERSIONS'],
  OUTCOME_TRAFFIC: ['LANDING_PAGE_VIEWS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH'],
};
const FB_EVENTS_BY_OBJECTIVE: Record<string, string[]> = { OUTCOME_LEADS: ['LEAD'], OUTCOME_SALES: ['PURCHASE'] };
const FB_BIDS_BY_GOAL: Record<string, string[]> = {
  OFFSITE_CONVERSIONS: ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP', 'LOWEST_COST_WITH_BID_CAP'],
  LANDING_PAGE_VIEWS: ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP', 'LOWEST_COST_WITH_BID_CAP'],
  LINK_CLICKS: ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP', 'LOWEST_COST_WITH_BID_CAP'],
  IMPRESSIONS: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP'],
  REACH: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP'],
};
// Only "Maximize number of conversions" optimizes for a pixel event.
const FB_PIXEL_GOALS = ['OFFSITE_CONVERSIONS'];
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
type FbItem = { id: string; name: string };
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

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export function MegatoolAutozalivBuilderPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [platform, setPlatform] = useState<Platform>('nb');
  const trafficSource = TRAFFIC_SOURCE[platform];

  // Step 1 — articles
  const [articles, setArticles] = useState<Sheet | null>(null);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articlesError, setArticlesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  useEffect(() => {
    if (!previewImage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewImage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage]);
  const [unusedOnly, setUnusedOnly] = useState(true);
  const [minAds, setMinAds] = useState(0);
  const [lang, setLang] = useState('');
  const [competitor, setCompetitor] = useState('');
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

  // Step 4 — launch
  const [buyers, setBuyers] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; list: Buyer[]; error?: string }>({ status: 'idle', list: [] });
  const [optionsByEmail, setOptionsByEmail] = useState<Record<string, OptionsState>>({});
  const [launchBulk, setLaunchBulk] = useState<LaunchSettings>({ buyer: '', domain: '' });
  const [launchOverrides, setLaunchOverrides] = useState<Record<string, Partial<LaunchSettings>>>({});
  const [keywords, setKeywords] = useState<Record<string, string>>({});
  const [amo, setAmo] = useState<Record<string, AmoState>>({});
  const [publishing, setPublishing] = useState(false);

  // Step 5 — Binom
  const [binomBulk, setBinomBulk] = useState<BinomSettings>({ tracker: BINOM_TRACKERS[0], group: '', geo: 'US', nbAccount: '', fbAccount: '', bidType: 'MAX_CONVERSION', event: 'auto', suffix: '' });
  const [binomRows, setBinomRows] = useState<Record<string, BinomRow>>({});
  const [binomOptions, setBinomOptions] = useState<Record<string, BinomOptions>>({});
  const [binom, setBinom] = useState<Record<string, BinomState>>({});
  const [binomRunning, setBinomRunning] = useState(false);
  const nbAccountsList = useAppStore((s) => s.nbAccountsList);
  const nbAccountsStatus = useAppStore((s) => s.nbAccountsStatus);
  const fetchNbAccounts = useAppStore((s) => s.fetchNbAccounts);

  // Step 6 — NB
  const [nbBulk, setNbBulk] = useState<NbSettings>({ budget: 10, startDate: 'now+3h', timezone: 'PDT', bidValue: 0, cta: '' });
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
  useEffect(() => {
    loadArticles();
    loadUsed();
  }, []);

  // Article name is column B, "used" formula is column D (see DataAutomations.js).
  const articleRows = useMemo(() => {
    if (!articles) return [];
    return articles.rows.map((r) => ({
      name: r[1],
      used: r[3] && r[3] !== NOT_USED ? r[3] : '',
      launched: usedMap[trimArticle(r[1])] as UsedRow | undefined,
      cells: Object.fromEntries(articles.headers.map((h, i) => [h, r[i] ?? ''])) as Row,
    }));
  }, [articles, usedMap]);
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

  const q = search.trim().toLowerCase();
  const visibleArticles = useMemo(() => {
    const list = articleRows.filter(
      (a) =>
        (!q || a.name.toLowerCase().includes(q)) &&
        (!unusedOnly || (!a.used && !a.launched)) &&
        (!minAds || (toNum(a.cells.cnt_ads || '0') || 0) >= minAds) &&
        (!lang || a.cells.top_language_for_article === lang) &&
        (!competitor || COMPETITORS[competitor].some((s) => (a.cells.examp_landing_page || '').toLowerCase().includes(s))),
    );
    const key = sort.key;
    return [...list].sort((a, b) => {
      const c = key === 'article' ? a.name.localeCompare(b.name) : compare(a.cells[key] || '', b.cells[key] || '');
      return sort.dir === 'asc' ? c : -c;
    });
  }, [articleRows, q, unusedOnly, minAds, lang, competitor, sort]);

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
  const keptCount = groups.reduce((n, g) => n + g.picked.filter((ad) => !excluded.has(adKey(g.name, ad))).length, 0);

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
      try {
        const res = await callLaunch({
          action: 'amo-article', email: l.email, domain: l.domain, trafficSource, keywords: keywordsFor(g), content: c,
        });
        setAmo((s) => ({ ...s, [g.name]: { status: 'done', offerUrl: res.offerUrl, articleUrl: res.articleUrl } }));
      } catch (e: any) {
        setAmo((s) => ({ ...s, [g.name]: { status: 'error', error: e.message } }));
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
    const geo = (row.geo ?? binomBulk.geo).trim().toUpperCase();
    const lang = (row.language ?? (articleByTrimmed[trimArticle(g.name)]?.top_language_for_article || 'en')).trim().toUpperCase();
    // Buyers are stored as "First Last" — names only carry the first name.
    const buyer = launchFor(g.name).buyer.trim().split(/\s+/)[0];
    const articleUrl = amo[g.name]?.articleUrl || '';
    const amoLabel = (articleUrl.match(/https?:\/\/([^.]+)/) || [])[1] || '';
    const offerName = `${name} | ${geo} | ${lang} | AMO | AUTOZALYV${buyer ? ' | ' + buyer : ''} | ch=auto${amoLabel ? ' | ' + amoLabel : ''}`;
    // Empty suffix → the competitor the article's landing page belongs to.
    const suffix = binomBulk.suffix.trim() || competitorOf(articleByTrimmed[trimArticle(g.name)]?.examp_landing_page || '');
    const tail = [launchAccount, todayDdMm(), suffix].filter(Boolean).join(' ');
    const campaignName = `${name} | ${geo} | AMO | AUTOZALYV | ${buyer} | ${tail}`;
    const offerUrl = articleUrl ? offerUrlFor(articleUrl, keywordsFor(g), binomBulk.bidType, platform) : '';
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
      try {
        const res = await callLaunch({
          action: 'binom', tracker: binomBulk.tracker, group: bulkGroup, domainId: bulkDomain?.id, geo: b.geo, trafficSource,
          event: resolveEvent(binomBulk.event, binomBulk.bidType), offerName: b.offerName, offerUrl: b.offerUrl,
          campaignName: b.campaignName, offerId: prev?.offerId,
        });
        setBinom((s) => ({ ...s, [g.name]: { status: 'done', offerId: res.offerId, campaignId: res.campaignId, campaignUrl: res.campaignUrl } }));
      } catch (e: any) {
        // keep an offer id from a half-finished run so Retry doesn't create a second offer
        const offerId = e.data?.offerId || prev?.offerId;
        setBinom((s) => ({ ...s, [g.name]: { status: 'error', error: e.message, offerId } }));
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
        // Pin the article as used (with the date) so step 1 shows it next time.
        const used: UsedRow = {
          article: g.name, used_at: new Date().toISOString(), nb_campaign_id: String(outer.campaignId || ''),
          buyer: launchFor(g.name).buyer, nb_account: binomBulk.nbAccount,
        };
        callLaunch({
          action: 'mark-used', article: g.name, nbCampaignId: used.nb_campaign_id,
          binomCampaignId: binom[g.name]?.campaignId, buyer: used.buyer, nbAccount: used.nb_account,
        })
          .then(() => setUsedMap((m) => ({ ...m, [trimArticle(g.name)]: used })))
          .catch((err: any) => setNb((s) => ({ ...s, [g.name]: { ...s[g.name], error: `Created, but not marked as used: ${err.message}` } })));
      } catch (e: any) {
        const body = e?.response?.data;
        const outer = Array.isArray(body) ? body[0] : body;
        const partial = outer?.partial?.campaignId ? ` (NB campaign ${outer.partial.campaignId} was created — delete it before retrying)` : '';
        setNb((s) => ({ ...s, [g.name]: { status: 'error', error: outer?.error ? outer.error + partial : e.message } }));
      }
      if (n < todo.length - 1) await sleep(1000);
    }
    setNbRunning(false);
  };
  const nbDone = selectedList.filter((n) => nb[n]?.status === 'done').length;

  // ---- Step 6: FB ----
  const fbAccountId = fbAccount?.id || '';
  const fbPageId = fbOptions.pages.find((p) => itemLabel(p) === fbBulk.page)?.id || '';
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
  // Ad URL formula from the FB sheet: the Binom link with funnel=funnel → funnel=<pixel id>.
  const fbLinkFor = (name: string) => {
    const url = binom[name]?.campaignUrl || '';
    return fbPixel ? url.replace('funnel=funnel', 'funnel=' + fbPixel.id) : url;
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
        const used: UsedRow = {
          article: g.name, used_at: new Date().toISOString(), nb_campaign_id: String(res.campaignId || ''),
          buyer: launchFor(g.name).buyer, nb_account: fbAccount?.name || '', source: 'fb',
        };
        callLaunch({
          action: 'mark-used', article: g.name, nbCampaignId: used.nb_campaign_id, source: 'fb',
          binomCampaignId: binom[g.name]?.campaignId, buyer: used.buyer, nbAccount: used.nb_account,
        })
          .then(() => setUsedMap((m) => ({ ...m, [trimArticle(g.name)]: used })))
          .catch((err: any) => setFb((s) => ({ ...s, [g.name]: { ...s[g.name], error: `Created, but not marked as used: ${err.message}` } })));
      } catch (e: any) {
        const partial: FbPartial | undefined = e.data?.partial || prev?.partial;
        setFb((s) => ({ ...s, [g.name]: { status: 'error', error: e.message, partial } }));
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
            {langs.length > 0 && (
              <select value={lang} onChange={(e) => setLang(e.target.value)} className="h-8 rounded border border-slate-200 bg-white px-2 text-sm">
                <option value="">All languages</option>
                {langs.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            )}
            <select value={competitor} onChange={(e) => setCompetitor(e.target.value)} className="h-8 rounded border border-slate-200 bg-white px-2 text-sm">
              <option value="">All competitors</option>
              {Object.keys(COMPETITORS).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
              {visibleArticles.length} of {articleRows.length} articles
              <Button size="sm" onClick={loadArticles} disabled={articlesLoading}>
                {articlesLoading ? 'Loading…' : 'Refresh'}
              </Button>
            </div>
          </div>
          {articlesError && <ErrorBox msg={articlesError} />}
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
                        {a.cells.examp_image_url && (
                          <img
                            src={a.cells.examp_image_url}
                            loading="lazy"
                            alt=""
                            onClick={(e) => { e.stopPropagation(); setPreviewImage(a.cells.examp_image_url); }}
                            className="h-9 w-9 max-w-none rounded object-cover bg-slate-100 cursor-zoom-in"
                          />
                        )}
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
          {previewImage && (
            <div
              className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
              onClick={() => setPreviewImage(null)}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}
                className="absolute top-4 right-4 text-white text-3xl leading-none w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full"
                aria-label="Close"
              >
                ×
              </button>
              <img
                src={previewImage}
                alt=""
                className="max-w-[92vw] max-h-[92vh] object-contain rounded-md"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </>
      )}

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
                            <AdCard key={k} ad={ad} metric={g.settings.sortField} off={excluded.has(k)} onToggle={() => toggleAd(k)} />
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
            <Button className="ml-auto" disabled={adsLoading || !ads} onClick={goToContent}>
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
                    </div>
                  </div>
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
                <Input value={binomBulk.geo} onChange={(e) => setBinomBulk((b) => ({ ...b, geo: e.target.value.toUpperCase() }))} className="h-7 w-16 bg-white" />
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
                  options={fbOptions.pages.map(itemLabel)}
                  placeholder={fbOptions.status === 'loading' ? 'Loading…' : 'Search page…'}
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
                <Select value={fbBulk.goal} onChange={(v) => setFbBulk((b) => ({ ...b, goal: v }))} options={FB_GOALS_BY_OBJECTIVE[fbBulk.objective] || []} labels={FB_GOAL_LABELS} />
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
                <Select value={fbBulk.bidStrategy} onChange={(v) => setFbBulk((b) => ({ ...b, bidStrategy: v }))} options={FB_BIDS_BY_GOAL[fbBulk.goal] || []} labels={FB_BID_LABELS} />
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

function AdCard({ ad, metric, off, onToggle }: { ad: Row; metric: string; off: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={off ? 'Excluded — click to include' : 'Click to exclude'}
      className={`relative text-left rounded border overflow-hidden transition ${
        off ? 'border-slate-200 opacity-35 grayscale' : 'border-slate-300 hover:border-amber-400'
      }`}
    >
      <div className="aspect-square bg-slate-100">
        {ad.img_url && <img src={ad.img_url} loading="lazy" alt="" className="h-full w-full object-cover" />}
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

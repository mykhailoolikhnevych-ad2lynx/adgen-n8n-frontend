import { useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { useAppStore, parseNbEventsResponse, type NbEvent } from '@/store/useAppStore';
import { BINOM_TRACKERS } from '@/lib/binomGroups';
import { START_DATE_OPTIONS, TIMEZONE_OPTIONS } from './MegatoolCreateNbCampaignPage';

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
// Autozaliv only runs on NewsBreak, so the traffic source is fixed.
const LAUNCH_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_LAUNCH_URL as string | undefined;
const RSOC_OPTIONS_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_RSOC_OPTIONS_URL as string | undefined;

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
const PREFERRED_SORT = [
  'impression', 'heat', 'conversion', 'days_count', 'all_exposure_value',
  'new_week_exposure_value', 'first_seen', 'last_seen',
];
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

type Buyer = { buyer: string; email: string };
type LaunchSettings = { buyer: string; domain: string };
const TRAFFIC_SOURCE = 'newsbreak';
type RsocOptions = {
  provider_fields?: { amo?: { domain?: Record<string, Record<string, string>> } };
};
type OptionsState = { status: 'loading' | 'ready' | 'error'; data?: RsocOptions; error?: string };
type AmoState = { status: 'running' | 'done' | 'error'; offerUrl?: string; articleUrl?: string; error?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Step 5: Binom (port of processOffers / processCampaigns / fetchCampaignURLs) ----
const BID_TYPES = ['MAX_CONVERSION', 'TARGET_CPA', 'TARGET_ROAS'];
type BinomSettings = { tracker: string; group: string; domainId: string; geo: string; nbAccount: string; bidType: string; event: string; suffix: string };
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
function offerUrlFor(articleUrl: string, keywords: string, bidType: string): string {
  const base = articleUrl.split(/[?#]/)[0];
  const kw = keywords.split(',').map((k) => k.trim()).filter(Boolean).join(',');
  return base + '?m=og&part=bol&utm_source=newsbreak&utm_medium=gs&newsbreak_cid={t10}&term1={clickid}_{campaign_id}'
    + (bidType === 'TARGET_ROAS' ? '_roas' : '') + '&term2={campaign_domain}&utm_content={t12}&ad_id={t2}'
    + (kw ? '&utm_term=' + encodeURIComponent(kw) : '') + '&channel=';
}
// ---- Step 6: NB — reuses the MEGATOOL Create NB Campaign webhook (campaign → 1 ad set → ads) ----
const NB_CAMPAIGN_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_NB_CAMPAIGN_CREATOR_URL as string | undefined;
const NB_EVENTS_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_NB_EVENTS_LIST_URL as string | undefined;
const NB_CTA_OPTIONS = ['Learn More', 'Sign Up', 'Shop Now', 'Download', 'Get Quote', 'Apply Now', 'See More', 'Get Offer', 'Subscribe', 'Contact Us', 'Book Now', 'Watch More'];
type NbSettings = { budget: number; startDate: string; timezone: string; bidValue: number; cta: string };
// Advertiser (NB brandName) = fixed "Search | " + a per-campaign part; NB allows 2–25 chars in total.
const ADVERTISER_PREFIX = 'Search | ';
const BRAND_MAX = 25;
// Default part = the Name, cut at a word boundary so the whole advertiser fits.
function fitWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : text.slice(0, max)).trim();
}
type NbState = { status: 'running' | 'done' | 'error'; campaignId?: string; adsetId?: string; adIds?: string[]; error?: string };
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

  // Step 1 — articles
  const [articles, setArticles] = useState<Sheet | null>(null);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articlesError, setArticlesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [unusedOnly, setUnusedOnly] = useState(true);
  const [minAds, setMinAds] = useState(0);
  const [lang, setLang] = useState('');
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
  const [binomBulk, setBinomBulk] = useState<BinomSettings>({ tracker: BINOM_TRACKERS[0], group: '', domainId: '', geo: 'US', nbAccount: '', bidType: 'MAX_CONVERSION', event: 'auto', suffix: '' });
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
  const [nbEvents, setNbEvents] = useState<Record<string, EventsState>>({});
  const [nb, setNb] = useState<Record<string, NbState>>({});
  const [nbRunning, setNbRunning] = useState(false);

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
  useEffect(() => {
    loadArticles();
  }, []);

  // Article name is column B, "used" formula is column D (see DataAutomations.js).
  const articleRows = useMemo(() => {
    if (!articles) return [];
    return articles.rows.map((r) => ({
      name: r[1],
      used: r[3] && r[3] !== NOT_USED ? r[3] : '',
      cells: Object.fromEntries(articles.headers.map((h, i) => [h, r[i] ?? ''])) as Row,
    }));
  }, [articles]);
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
        (!unusedOnly || !a.used) &&
        (!minAds || (toNum(a.cells.cnt_ads || '0') || 0) >= minAds) &&
        (!lang || a.cells.top_language_for_article === lang),
    );
    const key = sort.key;
    return [...list].sort((a, b) => {
      const c = key === 'article' ? a.name.localeCompare(b.name) : compare(a.cells[key] || '', b.cells[key] || '');
      return sort.dir === 'asc' ? c : -c;
    });
  }, [articleRows, q, unusedOnly, minAds, lang, sort]);

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
  const sortOptions = useMemo(() => {
    const h = ads?.headers || [];
    return [...PREFERRED_SORT.filter((f) => h.includes(f)), ...h.filter((f) => !PREFERRED_SORT.includes(f) && f !== 'img')];
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
    Object.keys(optionsByEmail[email]?.data?.provider_fields?.amo?.domain?.[TRAFFIC_SOURCE] || {});

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
        : !l.domain ? 'This buyer has no AMO domain for newsbreak' : '';
      if (error) {
        setAmo((s) => ({ ...s, [g.name]: { status: 'error', error } }));
        continue;
      }
      setAmo((s) => ({ ...s, [g.name]: { status: 'running' } }));
      try {
        const res = await callLaunch({
          action: 'amo-article', email: l.email, domain: l.domain, trafficSource: TRAFFIC_SOURCE, keywords: keywordsFor(g), content: c,
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
  const goToBinom = () => {
    setStep(5);
    if (nbAccountsStatus === 'idle') void fetchNbAccounts();
  };
  useEffect(() => {
    if (step === 5 && !binomOptions[binomBulk.tracker]) loadBinomOptions(binomBulk.tracker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, binomBulk.tracker]);
  const trackerOpts = binomOptions[binomBulk.tracker];
  const bulkGroup = trackerOpts?.groups.includes(binomBulk.group) ? binomBulk.group : '';
  const bulkDomain = trackerOpts?.domains.find((d) => d.id === binomBulk.domainId);

  // Offer name / Binom Cmp name = the sheet formulas, built from the same fields.
  const binomFor = (g: (typeof groups)[number]) => {
    const row = binomRows[g.name] || {};
    const name = row.name ?? defaultName(g.name);
    const geo = (row.geo ?? binomBulk.geo).trim().toUpperCase();
    const lang = (row.language ?? (articleByTrimmed[trimArticle(g.name)]?.top_language_for_article || 'en')).trim().toUpperCase();
    const buyer = launchFor(g.name).buyer;
    const articleUrl = amo[g.name]?.articleUrl || '';
    const amoLabel = (articleUrl.match(/https?:\/\/([^.]+)/) || [])[1] || '';
    const offerName = `${name} | ${geo} | ${lang} | AMO | AUTOZALYV${buyer ? ' | ' + buyer : ''} | ch=auto${amoLabel ? ' | ' + amoLabel : ''}`;
    const tail = [binomBulk.nbAccount, todayDdMm(), binomBulk.suffix.trim()].filter(Boolean).join(' ');
    const campaignName = `${name} | ${geo} | AMO | AZ | ${buyer} | ${tail}`;
    const offerUrl = articleUrl ? offerUrlFor(articleUrl, keywordsFor(g), binomBulk.bidType) : '';
    return { name, geo, lang, offerName, campaignName, offerUrl };
  };
  const setBinomRow = (name: string, patch: BinomRow) => setBinomRows((r) => ({ ...r, [name]: { ...r[name], ...patch } }));

  // 2️⃣ Create Binom — offer + campaign per article, one at a time like the sheet.
  const createBinom = async () => {
    setBinomRunning(true);
    const todo = groups.filter((g) => binom[g.name]?.status !== 'done');
    for (const [n, g] of todo.entries()) {
      const b = binomFor(g);
      const error = amo[g.name]?.status !== 'done' ? 'Create the AMO article first (step 4)'
        : !bulkGroup ? 'Pick a Binom group'
        : !bulkDomain ? 'Pick a tracker domain'
        : !binomBulk.nbAccount ? 'Pick the NB account (it is part of the campaign name)'
        : !b.name.trim() ? 'Name is empty' : '';
      if (error) {
        setBinom((s) => ({ ...s, [g.name]: { ...s[g.name], status: 'error', error } }));
        continue;
      }
      const prev = binom[g.name];
      setBinom((s) => ({ ...s, [g.name]: { ...s[g.name], status: 'running', error: undefined } }));
      try {
        const res = await callLaunch({
          action: 'binom', tracker: binomBulk.tracker, group: bulkGroup, domainId: bulkDomain?.id, geo: b.geo,
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
        return {
          adName: isVideo ? `${name}_VIDEO_${++videos}` : `${name}_IMAGE_${++images}`,
          headline: ad.ad_title || '',
          body: ad.ad_text || '',
          assetUrl: isVideo ? ad.video_url : ad.img_url,
          cta: ad.cta ? formatCta(ad.cta) : '',
        };
      })
      .filter((ad) => ad.assetUrl);
  };
  const nbNameFor = (g: (typeof groups)[number]) => {
    if (nbNames[g.name] !== undefined) return nbNames[g.name];
    const b = binomFor(g);
    const buyer = launchFor(g.name).buyer;
    return `${b.name} | ${b.geo} | ${b.lang} | AZ | RSOC${buyer ? ' | ' + buyer : ''} | ${tomorrowDdMmYy()}`;
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
          ads: ads.map(({ adName, headline, body, assetUrl }) => ({ adName, headline, body, assetUrl })),
          adsetSizes: [ads.length],
        }, { timeout: 600_000 });
        const outer = Array.isArray(data) ? data[0] : data;
        if (!outer || outer.ok === false) {
          const partial = outer?.partial?.campaignId ? ` (NB campaign ${outer.partial.campaignId} was created — delete it before retrying)` : '';
          throw new Error((outer?.error || 'NB campaign failed') + partial);
        }
        setNb((s) => ({ ...s, [g.name]: { status: 'done', campaignId: outer.campaignId, adsetId: outer.adsetId, adIds: outer.adIds } }));
      } catch (e: any) {
        const body = e?.response?.data;
        const outer = Array.isArray(body) ? body[0] : body;
        setNb((s) => ({ ...s, [g.name]: { status: 'error', error: outer?.error || e.message } }));
      }
      if (n < todo.length - 1) await sleep(1000);
    }
    setNbRunning(false);
  };
  const nbDone = selectedList.filter((n) => nb[n]?.status === 'done').length;

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
        <StepPill n={6} label="NB" active={step === 6} onClick={goToNb} disabled={binomDone === 0} />
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
                          <img src={a.cells.examp_image_url} loading="lazy" alt="" className="h-9 w-9 max-w-none rounded object-cover bg-slate-100" />
                        )}
                      </td>
                      <td className="px-2 py-1 max-w-[420px] truncate text-slate-800" title={a.name}>
                        {trimArticle(a.name)}
                      </td>
                      <td className="px-2 py-1 max-w-[160px] truncate text-xs" title={a.used}>
                        {a.used ? <span className="text-emerald-700">✔ used</span> : <span className="text-slate-400">—</span>}
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

      {step === 2 && (
        <>
          <div className="mx-4 mb-2 rounded border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-gray-500 mb-1.5">Settings for all articles</div>
            <SettingsControls value={bulk} onChange={setBulk} sortOptions={sortOptions} />
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
                          sortOptions={sortOptions}
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
                <Select value={launchBulk.buyer} onChange={(v) => setLaunchBulk((b) => ({ ...b, buyer: v }))} options={buyers.list.map((b) => b.buyer)} placeholder="— pick —" />
              </label>
              <span className="text-slate-500">New Source: <b className="text-slate-700">{TRAFFIC_SOURCE}</b></span>
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
                        <Select value={l.buyer} disabled={locked} onChange={(v) => setOverride(g.name, { buyer: v })} options={buyers.list.map((b) => b.buyer)} placeholder="—" />
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
                <Select value={binomBulk.tracker} onChange={(v) => setBinomBulk((b) => ({ ...b, tracker: v, group: '', domainId: '' }))} options={[...BINOM_TRACKERS]} />
              </label>
              <label className="flex items-center gap-1.5">
                Group Binom
                <Select value={bulkGroup} onChange={(v) => setBinomBulk((b) => ({ ...b, group: v }))} options={trackerOpts?.groups || []} placeholder="— pick —" />
              </label>
              <label className="flex items-center gap-1.5">
                Tracker Domain
                <Select
                  value={bulkDomain?.host || ''}
                  onChange={(host) => setBinomBulk((b) => ({ ...b, domainId: trackerOpts?.domains.find((d) => d.host === host)?.id || '' }))}
                  options={(trackerOpts?.domains || []).map((d) => d.host)}
                  placeholder="— pick —"
                />
              </label>
              <label className="flex items-center gap-1.5">
                Geo
                <Input value={binomBulk.geo} onChange={(e) => setBinomBulk((b) => ({ ...b, geo: e.target.value.toUpperCase() }))} className="h-7 w-16 bg-white" />
              </label>
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
              <label className="flex items-center gap-1.5">
                Cmp name suffix
                <Input value={binomBulk.suffix} onChange={(e) => setBinomBulk((b) => ({ ...b, suffix: e.target.value }))} placeholder="e.g. spike" className="h-7 w-28 bg-white" />
              </label>
              <span className="text-xs text-slate-500">
                {trackerOpts?.status === 'loading' && 'Loading groups and domains…'}
                {trackerOpts?.status === 'error' && <span className="text-red-600">{trackerOpts.error}</span>}
              </span>
            </div>
          </div>
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
                  return (
                    <tr key={g.name} className={`border-b border-slate-100 align-top ${noAmo ? 'opacity-50' : ''}`}>
                      <td className="px-2 py-1.5 max-w-[220px] truncate text-slate-800" title={g.name}>{trimArticle(g.name)}</td>
                      <td className="px-2 py-1.5 min-w-[160px]">
                        <Input value={b.name} disabled={locked} onChange={(e) => setBinomRow(g.name, { name: e.target.value })} className="h-7 bg-white text-xs" />
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
            <Button variant="outline" disabled={binomDone === 0} onClick={goToNb}>Next: NB →</Button>
          </div>
        </>
      )}

      {step === 6 && (
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
                  return (
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
                      <td className="px-2 py-1.5 text-xs text-slate-600 whitespace-nowrap" title={ads.map((a) => a.adName).join('\n')}>
                        {ads.length} ({ads.map((a) => a.adName.split('_').slice(-2).join('_')).join(', ')})
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[260px] truncate text-slate-500" title={binom[g.name]?.campaignUrl}>
                        {binom[g.name]?.campaignUrl || 'no Binom campaign yet'}
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[320px]">
                        {r?.status === 'running' && <span className="text-slate-500">Uploading assets & creating…</span>}
                        {r?.status === 'done' && (
                          <div className="text-slate-600">
                            campaign {r.campaignId} · ad set {r.adsetId} · {r.adIds?.length || 0} ads
                          </div>
                        )}
                        {r?.status === 'error' && <span className="text-red-600 break-words">{r.error}</span>}
                      </td>
                    </tr>
                  );
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

function SettingsControls({ value, onChange, sortOptions }: { value: Settings; onChange: (s: Settings) => void; sortOptions: string[] }) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  const check = (label: string, key: 'unique' | 'onlyImages' | 'onlyAdheart') => (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={value[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
      <label className="flex items-center gap-1.5">
        Top
        <Input type="number" min={1} value={value.top} onChange={(e) => set({ top: Number(e.target.value) || 1 })} className="h-7 w-16 bg-white" />
      </label>
      <label className="flex items-center gap-1.5">
        Sort by
        <select value={value.sortField} onChange={(e) => set({ sortField: e.target.value })} className="h-7 rounded border border-slate-200 bg-white px-1">
          {(sortOptions.includes(value.sortField) ? sortOptions : [value.sortField, ...sortOptions]).map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select value={value.sortDir} onChange={(e) => set({ sortDir: e.target.value as Settings['sortDir'] })} className="h-7 rounded border border-slate-200 bg-white px-1">
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
      </label>
      {check('Unique image', 'unique')}
      {check('Images only', 'onlyImages')}
      {check('Adheart only', 'onlyAdheart')}
      <label className="flex items-center gap-1.5">
        Network
        <select value={value.affNetwork} onChange={(e) => set({ affNetwork: e.target.value as Settings['affNetwork'] })} className="h-7 rounded border border-slate-200 bg-white px-1">
          <option value="amo">amo</option>
          <option value="ads.com">ads.com</option>
        </select>
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

function Select({ value, onChange, options, placeholder, disabled }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 max-w-[200px] rounded border border-slate-200 bg-white px-1 text-sm disabled:opacity-50"
    >
      {placeholder !== undefined && !options.includes(value) && <option value={value}>{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
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

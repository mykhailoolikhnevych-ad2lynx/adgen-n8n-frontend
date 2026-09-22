import { useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Autozaliv Builder — web replacement for the "articles (domains)" →
// "Filter for AUTOZALYV" → "Filtered Results" part of the Apps Script tool.
// Step 1 picks articles, step 2 picks each article's ads with the same rules
// as processFilter() in autozaliv_nb/Code.js. Data is read from the sheet via
// the megatool-autozaliv-builder webhook; nothing is written back yet.
// Step 3 reads each landing through Jina and applies the AMO text rules
// (megatool-autozaliv-content), replacing the local Python scripts.
const WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_BUILDER_URL as string | undefined;
const CONTENT_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_CONTENT_URL as string | undefined;

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
    if (!outer?.ok) throw new Error(outer?.error || 'Request failed');
    return outer;
  } catch (e: any) {
    throw new Error(e?.response?.data?.error || e?.message || 'Request failed');
  }
}
const callBuilder = (body: object): Promise<Sheet & { fetchedAt: string }> =>
  post(WEBHOOK, 'PUBLIC_WEBHOOK_AUTOZALIV_BUILDER_URL', body, 180_000);
const callContent = (body: object) => post(CONTENT_WEBHOOK, 'PUBLIC_WEBHOOK_AUTOZALIV_CONTENT_URL', body, 300_000);

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
  const [step, setStep] = useState<1 | 2 | 3>(1);

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
    return { name, settings, total: all.length, picked, landing };
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
        <StepPill n={4} label="Launch settings" active={false} disabled />
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
            <Button className="ml-auto" disabled title="Launch settings are the next part">
              Next: launch settings →
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

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { ARTICLE_GEOS, adLanguagesForGeo } from '@/lib/geos';
import { useAppStore, type ArticleStatus } from '@/store/useAppStore';

// The 3 "Basic LLM Chain" prompt variants in the n8n RSOC webhook (the `mode` field),
// ordered from the most informative to the least. mode "1" is the n8n default.
const CONCEPT_MODES: { value: string; label: string; hint: string }[] = [
  { value: '1', label: 'Detailed', hint: 'Most concrete: real facts, ranges and comparisons plus a short bullet rundown. Withholds only the reader’s personal answer.' },
  { value: '2', label: 'Balanced', hint: 'Moderate: round-number ranges in each paragraph, no exact figures or brand lists.' },
  { value: '3', label: 'Teaser', hint: 'Least info: almost no numbers, maximum curiosity gap to push clicks to the search box.' },
];

const CONCEPT_HELP =
  'Який промпт-варіант генерує статтю — від найбільш інформативного до найменш:\n' +
  '• Detailed — найбільше конкретики: реальні факти, діапазони, порівняння + короткий список-перелік. Притримує лише персональну відповідь читача.\n' +
  '• Balanced — помірно: округлені діапазони чисел у кожному абзаці, без точних цифр і переліків брендів.\n' +
  '• Teaser — мінімум конкретики, майже без чисел. Максимальний «розрив цікавості», щоб підштовхнути клік у пошуковий блок.';

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Generating…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

// The n8n workflow parses the country code via /\(([A-Z]+)\)$/ — anything not in
// ARTICLE_GEOS will crash the workflow, so we gate submission on this set.
const VALID_GEO_SET = new Set(ARTICLE_GEOS);

// Pull the article body + reference URLs out of the HTML the webhook returns and
// flatten them into the plain-text shape the user wants on the clipboard.
const extractArticleText = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // The first `<article class="article-card">` is the article; the second is References.
  const articleNode = doc.querySelector('article.article-card');
  const bodyLines: string[] = [];
  if (articleNode) {
    articleNode.childNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const text = (el.textContent ?? '').trim();
      if (!text) return;
      if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3') {
        bodyLines.push('', text, '');
      } else {
        bodyLines.push(text, '');
      }
    });
  }

  // References live in the second `.article-card` div — pull out the href, not the link text.
  const refUrls = Array.from(doc.querySelectorAll('div.article-card a'))
    .map((a) => (a as HTMLAnchorElement).href)
    .filter(Boolean);

  const parts: string[] = [];
  const body = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body) parts.push(body);
  if (refUrls.length > 0) parts.push('References\n' + refUrls.join('\n'));
  return parts.join('\n\n');
};

export const ArticlePage = () => {
  const [topic, setTopic] = useState('');
  const [geo, setGeo] = useState('United States (US)');
  const [language, setLanguage] = useState(() => adLanguagesForGeo('United States (US)')[0]);
  const [mode, setMode] = useState('1');
  const [errors, setErrors] = useState<{ topic: boolean; geo: boolean; geoMsg?: string; language: boolean }>({
    topic: false,
    geo: false,
    language: false,
  });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const articleStatus = useAppStore((s) => s.articleStatus);
  const articleHtml = useAppStore((s) => s.articleHtml);
  const articleError = useAppStore((s) => s.articleError);
  const generateArticle = useAppStore((s) => s.generateArticle);

  const isLoading = articleStatus === 'loading';

  // Live elapsed-time counter while a request is in flight — the strongest signal
  // that the code is actually doing something during the 1–2 minute generation.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!startedAt) return;
    if (articleStatus === 'loading') {
      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAt);
      }, 200);
      return () => {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      };
    }
    // Freeze the final elapsed on success/error so the user can still see how long it took.
    setElapsedMs(Date.now() - startedAt);
  }, [articleStatus, startedAt]);

  // Languages are restricted to the picked GEO — same logic as the Creatives tab.
  const langOptions = adLanguagesForGeo(geo);

  // When GEO changes, keep the language valid for the new country.
  const handleGeoChange = (v: string) => {
    setGeo(v);
    if (errors.geo) setErrors((p) => ({ ...p, geo: false, geoMsg: undefined }));
    const allowed = adLanguagesForGeo(v);
    if (!allowed.includes(language)) {
      setLanguage(allowed[0]);
      if (errors.language) setErrors((p) => ({ ...p, language: false }));
    }
  };

  const handleGenerate = () => {
    const trimmedTopic = topic.trim();
    const trimmedGeo = geo.trim();
    const trimmedLang = language.trim();

    const topicErr = !trimmedTopic;
    let geoErr = false;
    let geoMsg: string | undefined;
    if (!trimmedGeo) {
      geoErr = true;
      geoMsg = 'Required field';
    } else if (!VALID_GEO_SET.has(trimmedGeo)) {
      geoErr = true;
      geoMsg = 'Pick a GEO from the list';
    }
    const langErr = !trimmedLang;

    setErrors({ topic: topicErr, geo: geoErr, geoMsg, language: langErr });
    if (topicErr || geoErr || langErr) return;

    setStartedAt(Date.now());
    setElapsedMs(0);
    void generateArticle({ topic: trimmedTopic, geo: trimmedGeo, language: trimmedLang, mode });
  };

  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  const handleCopy = async () => {
    if (!articleHtml) return;
    const text = extractArticleText(articleHtml);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  };

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl mb-2">1. Input</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Article topic *</label>
              <Input
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  if (errors.topic) setErrors((p) => ({ ...p, topic: false }));
                }}
                placeholder="e.g. Reverse mortgage calculators"
                className={errors.topic ? 'border-red-500 focus-visible:ring-red-500' : ''}
                disabled={isLoading}
              />
              {errors.topic && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">GEO *</label>
              {/* Same typeahead UX as the Creatives page (Column1). Type "UK" → list narrows to UK. */}
              <Combobox
                value={geo}
                onChange={handleGeoChange}
                options={ARTICLE_GEOS}
                placeholder="Click to choose or type… e.g. United States (US)"
                inputClassName="text-sm rounded-md bg-white px-2"
                error={errors.geo}
              />
              {errors.geo && (
                <p className="text-[10px] text-red-500 mt-1">{errors.geoMsg ?? 'Required field'}</p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Language *</label>
              {/* Restricted to the picked GEO — same system as the Creatives tab. */}
              <Combobox
                value={language}
                onChange={(v) => {
                  setLanguage(v);
                  if (errors.language) setErrors((p) => ({ ...p, language: false }));
                }}
                options={langOptions}
                placeholder="Click to choose… e.g. English (US)"
                inputClassName="text-sm rounded-md bg-white px-2"
                error={errors.language}
              />
              {errors.language && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>

            <div>
              <label className="flex items-center gap-1 text-xs font-medium uppercase text-slate-500">
                Concept
                <InfoTooltip text={CONCEPT_HELP} />
              </label>
              {/* Picks which Basic LLM Chain prompt runs in n8n (the `mode` field). */}
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={isLoading}
                className="w-full text-sm border rounded-md px-2 py-1 bg-white"
              >
                {CONCEPT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                {CONCEPT_MODES.find((m) => m.value === mode)?.hint}
              </p>
            </div>
          </div>

          <Button onClick={handleGenerate} className="mt-4" disabled={isLoading}>
            {isLoading ? 'Generating…' : 'Generate Article'}
          </Button>
        </div>
      </div>

      {/* 2. Results */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <h2 className="font-bold text-xl">2. Results</h2>
            {articleStatus === 'success' && articleHtml && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                aria-label="Copy article text"
              >
                {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
              </Button>
            )}
          </div>

          {/* Status bar — color-coded, with a live elapsed-time counter while loading. */}
          <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center justify-between shrink-0">
            <span className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Status:</span>
              {isLoading && (
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"
                />
              )}
              <span className={`font-medium ${STATUS_COLOR[articleStatus]}`}>
                {STATUS_LABEL[articleStatus]}
              </span>
            </span>
            {startedAt && (
              <span className="text-xs text-slate-500 font-mono">
                {elapsedSec}s
              </span>
            )}
          </div>

          {/* Full new article — fills the remaining space. */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {articleStatus === 'idle' && (
              <div className="text-gray-400 italic">Waiting for input</div>
            )}
            {articleStatus === 'loading' && (
              <div className="text-slate-600 text-sm">
                Generating article — this typically takes 1–2 minutes (SERP scrape of the top 10 results + LLM rewrite).
              </div>
            )}
            {articleStatus === 'error' && (
              <div className="text-red-600 text-sm whitespace-pre-wrap">
                {articleError ?? 'Unknown error'}
              </div>
            )}
            {articleStatus === 'success' && articleHtml && (
              <iframe
                title="Full new article"
                srcDoc={articleHtml}
                sandbox="allow-same-origin"
                className="w-full h-full border-0 rounded-md bg-white"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

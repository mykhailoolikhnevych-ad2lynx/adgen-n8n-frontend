import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { KEYWORD_GEOS, KEYWORD_GEO_NAMES } from '@/lib/geos';
import { useAppStore, type ArticleStatus } from '@/store/useAppStore';

const ANCHOR_TRANSLATIONS: { label: string; value: 'auto' | 'none' }[] = [
  { label: 'Automatic', value: 'auto' },
  { label: 'None', value: 'none' },
];

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Researching…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

const sanitizeForFilename = (s: string): string =>
  s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);

// A trend cell is a short string that is *only* a signed percentage, e.g. "+307%", "0%",
// "-56%", "+604900%". The full-string anchors keep us from matching sentences that merely
// contain a "%", so we only touch the Trend column (the lone %-suffixed column in the report).
const TREND_CELL_RE = /^[+\-−]?\s*[\d.,\s]+%$/;

const parseTrendValue = (text: string): number | null => {
  const t = text.trim();
  if (t.length > 14 || !TREND_CELL_RE.test(t)) return null;
  const negative = /[-−]/.test(t);
  const num = parseFloat(t.replace(/[^\d.]/g, ''));
  if (Number.isNaN(num)) return null;
  return negative ? -num : num;
};

// Color a trend value so growth / flat / decline read at a glance. Saturation scales with
// magnitude: a small +12% gets a pale green, a +600900% gets solid green.
const trendBadgeStyle = (v: number): string => {
  let bg = '#f1f5f9';
  let fg = '#64748b'; // flat / 0%
  if (v > 0) {
    if (v >= 500) { bg = '#15803d'; fg = '#ffffff'; }
    else if (v >= 100) { bg = '#22c55e'; fg = '#ffffff'; }
    else if (v >= 20) { bg = '#bbf7d0'; fg = '#14532d'; }
    else { bg = '#dcfce7'; fg = '#166534'; }
  } else if (v < 0) {
    if (v <= -50) { bg = '#dc2626'; fg = '#ffffff'; }
    else if (v <= -20) { bg = '#f87171'; fg = '#ffffff'; }
    else { bg = '#fee2e2'; fg = '#991b1b'; }
  }
  return `background-color:${bg};color:${fg};font-weight:700;padding:2px 8px;border-radius:6px;display:inline-block;white-space:nowrap;`;
};

// A CPC cell holds a dollar range like "$1.78–$6.07" (or a single "$5.00"). We rank by the
// upper bound — the earning ceiling — and only touch cells that actually contain "$".
const parseCpcValue = (text: string): number | null => {
  const t = text.trim();
  if (t.length > 24 || !t.includes('$')) return null;
  const nums = (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => !Number.isNaN(n));
  if (!nums.length) return null;
  return Math.max(...nums);
};

const quantile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];

// Highlight the highest-CPC keywords. Coloring is relative to the table's own spread (CPC
// scale differs wildly by niche), so the top tier greens out and everything else stays black.
const cpcTextStyle = (v: number, p70: number, p88: number): string | null => {
  if (v >= p88) return 'color:#15803d;font-weight:700;';
  if (v >= p70) return 'color:#16a34a;font-weight:600;';
  return null; // low / default — leave as the report's default black
};

// Post-process the n8n report HTML: color the Trend % cells (badges) and high-value CPC cells.
// The iframe is sandboxed without scripts, so we transform the static markup here in the parent.
const colorizeKeywordHtml = (html: string): string => {
  if (typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cells = Array.from(doc.querySelectorAll('td'));

    const restyle = (cell: Element, text: string, style: string) => {
      const span = doc.createElement('span');
      span.setAttribute('style', style);
      span.textContent = text;
      cell.textContent = '';
      cell.appendChild(span);
    };

    // Pass 1 — Trend %.
    for (const cell of cells) {
      const text = (cell.textContent ?? '').trim();
      const v = parseTrendValue(text);
      if (v !== null) restyle(cell, text, trendBadgeStyle(v));
    }

    // Pass 2 — CPC, shaded relative to the column's own distribution.
    const cpc: { cell: Element; text: string; v: number }[] = [];
    for (const cell of cells) {
      const text = (cell.textContent ?? '').trim();
      const v = parseCpcValue(text);
      if (v !== null) cpc.push({ cell, text, v });
    }
    if (cpc.length >= 3) {
      const sorted = cpc.map((e) => e.v).sort((a, b) => a - b);
      const p70 = quantile(sorted, 0.7);
      const p88 = quantile(sorted, 0.88);
      for (const { cell, text, v } of cpc) {
        const style = cpcTextStyle(v, p70, p88);
        if (style) restyle(cell, text, style);
      }
    }

    return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
  } catch {
    return html;
  }
};

export const KeywordsPage = () => {
  const [geo, setGeo] = useState('United States');
  const [language, setLanguage] = useState('English');
  const [anchor, setAnchor] = useState('');
  const [anchorTranslation, setAnchorTranslation] = useState<'auto' | 'none'>('auto');
  const [errors, setErrors] = useState({ geo: false, language: false, anchor: false });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const keywordStatus = useAppStore((s) => s.keywordStatus);
  const keywordHtml = useAppStore((s) => s.keywordHtml);
  const keywordError = useAppStore((s) => s.keywordError);
  const generateKeywords = useAppStore((s) => s.generateKeywords);

  const isLoading = keywordStatus === 'loading';

  // Trend-colored version of the report — what we render and download.
  const styledHtml = useMemo(
    () => (keywordHtml ? colorizeKeywordHtml(keywordHtml) : null),
    [keywordHtml],
  );

  // Each GEO exposes only the languages valid for it (Switzerland → German/French/Italian),
  // and carries the locale-specific code KeywordTool needs (de-CH, pt-BR…). The language
  // dropdown is scoped to the selected GEO; picking a GEO resets it to that GEO's default.
  const geoEntry = KEYWORD_GEOS.find((g) => g.name === geo);
  const langOptions = geoEntry?.languages ?? [];
  const langEntry = langOptions.find((l) => l.name === language);

  // Live elapsed-time counter while a request is in flight — the run can take 1–3 min.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!startedAt) return;
    if (keywordStatus === 'loading') {
      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAt);
      }, 200);
      return () => {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      };
    }
    setElapsedMs(Date.now() - startedAt);
  }, [keywordStatus, startedAt]);

  const handleResearch = () => {
    const newErrors = {
      geo: !geoEntry,
      language: !langEntry,
      anchor: !anchor.trim(),
    };
    setErrors(newErrors);
    if (newErrors.geo || newErrors.language || newErrors.anchor || !geoEntry || !langEntry) return;

    setStartedAt(Date.now());
    setElapsedMs(0);
    void generateKeywords({
      country: geoEntry.country,
      countryName: geoEntry.name,
      language: langEntry.code,
      languageName: langEntry.name,
      anchor: anchor.trim(),
      translation: anchorTranslation,
    });
  };

  // Save the rendered research report (the iframe's HTML) to the user's PC, the same
  // download-a-Blob pattern the Creatives batches use.
  const handleDownload = () => {
    const html = styledHtml ?? keywordHtml;
    if (!html) return;
    const namePart = sanitizeForFilename(anchor) || 'keywords';
    const geoPart = sanitizeForFilename(geo);
    const fileName = `keywords_${namePart}${geoPart ? `_${geoPart}` : ''}.html`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input — narrow column matching Creatives layout */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl mb-2">1. Input</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">GEO *</label>
              <Combobox
                value={geo}
                onChange={(v) => {
                  setGeo(v);
                  if (errors.geo) setErrors((p) => ({ ...p, geo: false }));
                  // Reset language to the newly-picked GEO's default (first in its list).
                  const entry = KEYWORD_GEOS.find((g) => g.name === v);
                  if (entry) {
                    setLanguage(entry.languages[0].name);
                    if (errors.language) setErrors((p) => ({ ...p, language: false }));
                  }
                }}
                options={KEYWORD_GEO_NAMES}
                placeholder="Click to choose or type… e.g. United States"
                inputClassName="text-sm rounded-md bg-white px-2"
                error={errors.geo}
              />
              {errors.geo && <p className="text-[10px] text-red-500 mt-1">Pick a GEO from the list</p>}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Language *</label>
              <Combobox
                value={language}
                onChange={(v) => {
                  setLanguage(v);
                  if (errors.language) setErrors((p) => ({ ...p, language: false }));
                }}
                options={langOptions.map((l) => l.name)}
                placeholder="Click to choose or type… e.g. English"
                inputClassName="text-sm rounded-md bg-white px-2"
                error={errors.language}
              />
              {errors.language && <p className="text-[10px] text-red-500 mt-1">Pick a language from the list</p>}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Anchor *</label>
              <Input
                value={anchor}
                onChange={(e) => {
                  setAnchor(e.target.value);
                  if (errors.anchor) setErrors((p) => ({ ...p, anchor: false }));
                }}
                placeholder="Seed keyword"
                className={errors.anchor ? 'border-red-500 focus-visible:ring-red-500' : ''}
                disabled={isLoading}
              />
              {errors.anchor && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Anchor translation</label>
              <select
                value={anchorTranslation}
                onChange={(e) => setAnchorTranslation(e.target.value as 'auto' | 'none')}
                className="w-full text-sm border rounded-md px-2 py-1 bg-white"
                disabled={isLoading}
              >
                {ANCHOR_TRANSLATIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <Button onClick={handleResearch} className="mt-4" disabled={isLoading}>
            {isLoading ? 'Researching…' : 'Research'}
          </Button>
        </div>
      </div>

      {/* 2. Results — takes remaining width */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <h2 className="font-bold text-xl">2. Results</h2>
            <Button
              onClick={handleDownload}
              disabled={keywordStatus !== 'success' || !keywordHtml}
              size="sm"
              className="bg-black hover:bg-gray-800 text-white"
            >
              Download
            </Button>
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
              <span className={`font-medium ${STATUS_COLOR[keywordStatus]}`}>
                {STATUS_LABEL[keywordStatus]}
              </span>
            </span>
            {startedAt && (
              <span className="text-xs text-slate-500 font-mono">{elapsedSec}s</span>
            )}
          </div>

          {/* Deep research report (UA HTML) — fills the remaining space. */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {keywordStatus === 'idle' && (
              <div className="text-gray-400 italic">Waiting for input</div>
            )}
            {keywordStatus === 'loading' && (
              <div className="text-slate-600 text-sm">
                Researching keywords — this typically takes 1–3 minutes (KeywordTool sweep + drill expansion + LLM analysis).
              </div>
            )}
            {keywordStatus === 'error' && (
              <div className="text-red-600 text-sm whitespace-pre-wrap">
                {keywordError ?? 'Unknown error'}
              </div>
            )}
            {keywordStatus === 'success' && styledHtml && (
              <iframe
                title="Keyword research results"
                srcDoc={styledHtml}
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

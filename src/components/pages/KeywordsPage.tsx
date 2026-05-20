import { useEffect, useRef, useState } from 'react';
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
          <h2 className="font-bold text-xl mb-2 shrink-0">2. Results</h2>

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
            {keywordStatus === 'success' && keywordHtml && (
              <iframe
                title="Keyword research results"
                srcDoc={keywordHtml}
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

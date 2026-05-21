import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { KEYWORD_GEOS, KEYWORD_GEO_NAMES } from '@/lib/geos';
import { useAppStore, type ArticleStatus, type RsocHeadline } from '@/store/useAppStore';

const ANCHOR_TRANSLATIONS: { label: string; value: 'auto' | 'none' }[] = [
  { label: 'Automatic', value: 'auto' },
  { label: 'None', value: 'none' },
];

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Working…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

const INPUT_HELP =
  'Крок 1 пайплайну Angles. Вводимо якірний ключ, GEO та мову — n8n тягне реальну видачу Google і виділяє 3–5 аудиторних сегментів.';

const AUDIENCES_HELP =
  'Сегменти аудиторій з реальної видачі. Обери ті, під які хочеш заголовки (1–5), і тисни «Generate Headlines».';

const HEADLINES_HELP =
  'Топ-3 заголовки на кожну обрану аудиторію — вже відкуровані медіабайєром під твій ключ і GEO.';

const StatusBar = ({ status }: { status: ArticleStatus }) => (
  <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center gap-2 shrink-0">
    <span className="font-semibold text-slate-700">Status:</span>
    {status === 'loading' && (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"
      />
    )}
    <span className={`font-medium ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>
  </div>
);

export const AnglesPage = () => {
  const [geo, setGeo] = useState('United States');
  const [language, setLanguage] = useState('English');
  const [anchor, setAnchor] = useState('');
  const [anchorTranslation, setAnchorTranslation] = useState<'auto' | 'none'>('auto');
  const [errors, setErrors] = useState({ geo: false, language: false, anchor: false });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const rsocAudiencesStatus = useAppStore((s) => s.rsocAudiencesStatus);
  const rsocAudiencesError = useAppStore((s) => s.rsocAudiencesError);
  const rsocBundle = useAppStore((s) => s.rsocBundle);
  const rsocHeadlinesStatus = useAppStore((s) => s.rsocHeadlinesStatus);
  const rsocHeadlinesError = useAppStore((s) => s.rsocHeadlinesError);
  const rsocHeadlines = useAppStore((s) => s.rsocHeadlines);
  const generateRsocAudiences = useAppStore((s) => s.generateRsocAudiences);
  const generateRsocHeadlines = useAppStore((s) => s.generateRsocHeadlines);

  const isLoadingAudiences = rsocAudiencesStatus === 'loading';
  const isLoadingHeadlines = rsocHeadlinesStatus === 'loading';

  const geoEntry = KEYWORD_GEOS.find((g) => g.name === geo);
  const langOptions = geoEntry?.languages ?? [];
  const langEntry = langOptions.find((l) => l.name === language);

  const audiences = rsocBundle?.audiences ?? [];

  const handleGenerateAudiences = () => {
    const newErrors = {
      geo: !geoEntry,
      language: !langEntry,
      anchor: !anchor.trim(),
    };
    setErrors(newErrors);
    if (newErrors.geo || newErrors.language || newErrors.anchor || !geoEntry || !langEntry) return;

    setPicked(new Set());
    void generateRsocAudiences({
      anchor: anchor.trim(),
      geo: geoEntry.name,
      language: langEntry.name,
      translation: anchorTranslation,
    });
  };

  const togglePick = (segmentId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });
  };

  const handleGenerateHeadlines = () => {
    void generateRsocHeadlines([...picked]);
  };

  // Headlines arrive flat but pre-sorted by audience then rank — group for display.
  const groupedHeadlines = useMemo(() => {
    const groups: { audience: string; rows: RsocHeadline[] }[] = [];
    for (const h of rsocHeadlines) {
      const last = groups[groups.length - 1];
      if (last && last.audience === h.audience) last.rows.push(h);
      else groups.push({ audience: h.audience, rows: [h] });
    }
    return groups;
  }, [rsocHeadlines]);

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
            1. Input
            <InfoTooltip text={INPUT_HELP} />
          </h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">GEO *</label>
              <Combobox
                value={geo}
                onChange={(v) => {
                  setGeo(v);
                  if (errors.geo) setErrors((p) => ({ ...p, geo: false }));
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
              <label className="text-xs font-medium uppercase text-slate-500">Anchor (keyword) *</label>
              <Input
                value={anchor}
                onChange={(e) => {
                  setAnchor(e.target.value);
                  if (errors.anchor) setErrors((p) => ({ ...p, anchor: false }));
                }}
                placeholder="Seed keyword"
                className={errors.anchor ? 'border-red-500 focus-visible:ring-red-500' : ''}
                disabled={isLoadingAudiences}
              />
              {errors.anchor && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Anchor translation</label>
              <select
                value={anchorTranslation}
                onChange={(e) => setAnchorTranslation(e.target.value as 'auto' | 'none')}
                className="w-full text-sm border rounded-md px-2 py-1 bg-white"
                disabled={isLoadingAudiences}
              >
                {ANCHOR_TRANSLATIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <Button onClick={handleGenerateAudiences} className="mt-4" disabled={isLoadingAudiences}>
            {isLoadingAudiences ? 'Generating…' : 'Generate Audiences'}
          </Button>
        </div>
      </div>

      {/* 2. Audiences (webhook 1 output) */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2 shrink-0">
            2. Audiences
            <InfoTooltip text={AUDIENCES_HELP} />
          </h2>

          <StatusBar status={rsocAudiencesStatus} />

          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            {rsocAudiencesStatus === 'idle' && (
              <div className="text-gray-400 italic">Waiting for input</div>
            )}
            {rsocAudiencesStatus === 'loading' && (
              <div className="text-slate-600 text-sm">
                Fetching Google SERP for this keyword/GEO and excavating audience segments…
              </div>
            )}
            {rsocAudiencesStatus === 'error' && (
              <div className="text-red-600 text-sm whitespace-pre-wrap">
                {rsocAudiencesError ?? 'Unknown error'}
              </div>
            )}
            {rsocAudiencesStatus === 'success' && audiences.length === 0 && (
              <div className="text-gray-400 italic">No audiences returned</div>
            )}
            {audiences.map((a) => {
              const isPicked = picked.has(a.segment_id);
              return (
                <button
                  key={a.segment_id}
                  type="button"
                  onClick={() => togglePick(a.segment_id)}
                  aria-pressed={isPicked}
                  className={`w-full text-left rounded-lg border bg-white p-3 transition-colors ${
                    isPicked ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                        isPicked ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 bg-white text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white">
                          {a.segment_id}
                        </span>
                        <span className="font-semibold text-sm leading-snug">{a.segment_name}</span>
                      </div>
                      {a.description && (
                        <p className="text-xs leading-relaxed text-slate-900">{a.description}</p>
                      )}
                      {a.pain_points?.length > 0 && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Pain points</p>
                          <ul className="mt-1 space-y-0.5">
                            {a.pain_points.map((p, i) => (
                              <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-slate-900">
                                <span className="text-slate-400" aria-hidden="true">•</span>
                                <span>{p}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {a.desires?.length > 0 && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Desires</p>
                          <ul className="mt-1 space-y-0.5">
                            {a.desires.map((d, i) => (
                              <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-slate-900">
                                <span className="text-slate-400" aria-hidden="true">•</span>
                                <span>{d}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {a.vocab_to_use?.length > 0 && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Vocab</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {a.vocab_to_use.map((v, i) => (
                              <span
                                key={i}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700"
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {audiences.length > 0 && (
            <Button
              onClick={handleGenerateHeadlines}
              className="mt-2 shrink-0"
              disabled={isLoadingHeadlines || picked.size === 0}
            >
              {isLoadingHeadlines
                ? 'Generating…'
                : `Generate Headlines${picked.size ? ` (${picked.size})` : ''}`}
            </Button>
          )}
        </div>
      </div>

      {/* 3. Top-Pick Headlines (webhook 2 output) */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2 shrink-0">
            3. Top-Pick Headlines
            <InfoTooltip text={HEADLINES_HELP} />
          </h2>

          <StatusBar status={rsocHeadlinesStatus} />

          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            {rsocHeadlinesStatus === 'idle' && (
              <div className="text-gray-400 italic">Pick audiences and generate</div>
            )}
            {rsocHeadlinesStatus === 'loading' && (
              <div className="text-slate-600 text-sm">
                Generating and curating the top-3 headlines per audience…
              </div>
            )}
            {rsocHeadlinesStatus === 'error' && (
              <div className="text-red-600 text-sm whitespace-pre-wrap">
                {rsocHeadlinesError ?? 'Unknown error'}
              </div>
            )}
            {rsocHeadlinesStatus === 'success' && rsocHeadlines.length === 0 && (
              <div className="text-gray-400 italic">No headlines returned</div>
            )}
            {groupedHeadlines.map((group) => (
              <div key={group.audience}>
                <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">{group.audience}</h3>
                <div className="space-y-2">
                  {group.rows.map((h) => (
                    <div key={h.headline_id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          #{h.rank}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                          {h.angle_formula}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                          {h.headline_kernel}
                        </span>
                      </div>
                      <p className="text-sm font-medium leading-snug">{h.headline}</p>
                      {h.translation_ua && (
                        <div className="mt-2 flex items-start gap-1.5 border-t border-dashed border-slate-200 pt-2">
                          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                            UA
                          </span>
                          <p className="text-xs leading-relaxed text-slate-500">{h.translation_ua}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

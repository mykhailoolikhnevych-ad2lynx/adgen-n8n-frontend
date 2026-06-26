import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { ARTICLE_GEOS, adLanguagesForGeo } from '@/lib/geos';
import { useAppStore, type ArticleStatus } from '@/store/useAppStore';

const KEY_COUNT = 3;

const REFERENCES_HELP =
  'The generated article preview always shows a "References" section with the top 3 '
  + 'source URLs (plain text, no hyperlinks). This checkbox decides whether that '
  + 'section is also carried into the Offer Article body when you press Create Offer Article.';

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

  // References block: the webhook renders URLs as plain-text <li> entries inside
  // <section class="article-card references"> — no <a> tags.
  const refUrls = Array.from(doc.querySelectorAll('section.article-card.references li'))
    .map((li) => (li.textContent ?? '').trim())
    .filter(Boolean);

  const parts: string[] = [];
  const body = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body) parts.push(body);
  if (refUrls.length > 0) parts.push('References\n' + refUrls.join('\n'));
  return parts.join('\n\n');
};

interface ArticlePageProps {
  /** Reveal the "Offer Article" tab and switch the active page to it. The tab
   *  isn't part of the static nav — it only appears after the operator presses
   *  Create Offer Article on a successfully generated article. */
  onCreateOffer?: () => void;
}

export const ArticlePage = ({ onCreateOffer }: ArticlePageProps = {}) => {
  // Form state is lifted into the Zustand store so it survives navigating
  // away from this tab. Local component state is only for ephemeral UI
  // (errors, elapsed timer, copy feedback).
  const form = useAppStore((s) => s.articleForm);
  const setArticleForm = useAppStore((s) => s.setArticleForm);
  const resetArticleForm = useAppStore((s) => s.resetArticleForm);
  const { topic, keys, geo, language, addReferences } = form;
  const setTopic = (v: string) => setArticleForm({ topic: v });
  const setKeys = (v: string[]) => setArticleForm({ keys: v });
  const setAddReferences = (v: boolean) => setArticleForm({ addReferences: v });

  const [errors, setErrors] = useState<{ topic: boolean; keys: boolean; geo: boolean; geoMsg?: string; language: boolean }>({
    topic: false,
    keys: false,
    geo: false,
    language: false,
  });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const articleStatus = useAppStore((s) => s.articleStatus);
  const articleHtml = useAppStore((s) => s.articleHtml);
  const articleError = useAppStore((s) => s.articleError);
  const articleTranslatedHtml = useAppStore((s) => s.articleTranslatedHtml);
  const articleIsTranslating = useAppStore((s) => s.articleIsTranslating);
  const articleShowTranslation = useAppStore((s) => s.articleShowTranslation);
  const generateArticle = useAppStore((s) => s.generateArticle);
  const toggleArticleTranslation = useAppStore((s) => s.toggleArticleTranslation);

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
    if (errors.geo) setErrors((p) => ({ ...p, geo: false, geoMsg: undefined }));
    const allowed = adLanguagesForGeo(v);
    if (allowed.includes(language)) {
      setArticleForm({ geo: v });
    } else {
      setArticleForm({ geo: v, language: allowed[0] });
      if (errors.language) setErrors((p) => ({ ...p, language: false }));
    }
  };

  const handleReset = () => {
    resetArticleForm();
    setErrors({ topic: false, keys: false, geo: false, geoMsg: undefined, language: false });
  };

  const handleGenerate = () => {
    const trimmedTopic = topic.trim();
    const trimmedKeys = keys.map((k) => k.trim());
    const trimmedGeo = geo.trim();
    const trimmedLang = language.trim();

    const topicErr = !trimmedTopic;
    // At least one of the 3 key fields must be filled.
    const keysErr = !trimmedKeys.some(Boolean);
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

    setErrors({ topic: topicErr, keys: keysErr, geo: geoErr, geoMsg, language: langErr });
    if (topicErr || keysErr || geoErr || langErr) return;

    setStartedAt(Date.now());
    setElapsedMs(0);
    void generateArticle({
      topic: trimmedTopic,
      keys: trimmedKeys,
      geo: trimmedGeo,
      language: trimmedLang,
      addReferences,
    });
  };

  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  // Copy reflects what the user is currently looking at — UA if they've toggled
  // the translation on, otherwise the original.
  const displayedHtml =
    articleShowTranslation && articleTranslatedHtml ? articleTranslatedHtml : articleHtml;

  const handleCopy = async () => {
    if (!displayedHtml) return;
    const text = extractArticleText(displayedHtml);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  };

  let translateLabel = '🇺🇦 Translate';
  if (articleIsTranslating) translateLabel = 'Translating…';
  else if (articleShowTranslation && articleTranslatedHtml) translateLabel = '🇺🇸 Original';

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
              <p className="text-[10px] text-slate-400 mt-1">
                Used verbatim as the article title when 5+ words long. Always pulls 5 source URLs.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">
                Keywords <span className="text-slate-400 normal-case">(up to 3, at least one required)</span>
              </label>
              <div className="space-y-1.5">
                {keys.map((value, idx) => (
                  <Input
                    key={idx}
                    value={value}
                    onChange={(e) => {
                      const next = [...keys];
                      next[idx] = e.target.value;
                      setKeys(next);
                      if (errors.keys) setErrors((p) => ({ ...p, keys: false }));
                    }}
                    placeholder={`Keyword ${idx + 1}${idx === 0 ? ' *' : ' (optional)'}`}
                    className={errors.keys ? 'border-red-500 focus-visible:ring-red-500' : ''}
                    disabled={isLoading}
                  />
                ))}
              </div>
              {errors.keys && (
                <p className="text-[10px] text-red-500 mt-1">Fill at least one keyword</p>
              )}
              <p className="text-[10px] text-slate-400 mt-1">
                Per-keyword SERP results: 1 keyword → 5 each · 2 → 4 each · 3 → 3 each.
              </p>
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
                  setArticleForm({ language: v });
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
              <label className="flex items-center gap-2 text-xs font-medium uppercase text-slate-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addReferences}
                  onChange={(e) => setAddReferences(e.target.checked)}
                  disabled={isLoading}
                  className="h-3.5 w-3.5"
                />
                Add References
                <InfoTooltip text={REFERENCES_HELP} />
              </label>
              <p className="text-[10px] text-slate-400 mt-1">
                Article preview always shows References (top 3). When checked, they
                also get copied into the Offer Article body.
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              onClick={handleGenerate}
              className="flex-1"
              disabled={isLoading || !topic.trim() || !keys[0].trim()}
            >
              {isLoading ? 'Generating…' : 'Generate Article'}
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isLoading}
              aria-label="Clear all input fields"
            >
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* 2. Results */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <h2 className="font-bold text-xl">2. Results</h2>
            {articleStatus === 'success' && articleHtml && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void toggleArticleTranslation()}
                  disabled={articleIsTranslating}
                  aria-label="Translate article to Ukrainian"
                >
                  {translateLabel}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  aria-label="Copy article text"
                >
                  {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
                </Button>
                {onCreateOffer && (
                  <Button
                    size="sm"
                    onClick={onCreateOffer}
                    aria-label="Open the Offer Article tab to publish this article"
                  >
                    📤 Create Offer Article
                  </Button>
                )}
              </div>
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
            {articleStatus === 'success' && displayedHtml && (
              <iframe
                title="Full new article"
                srcDoc={displayedHtml}
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

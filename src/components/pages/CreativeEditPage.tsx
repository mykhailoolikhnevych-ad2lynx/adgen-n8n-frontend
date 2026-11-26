import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { HOOK_HELP, ACCENT_HELP, CTA_HELP } from '@/components/ImageGenSettings';
import { Combobox } from '@/components/ui/Combobox';
import { CopyNameButton } from '@/components/ui/CopyNameButton';
import { FeedbackButtons, type FeedbackContext } from '@/components/ui/FeedbackButtons';
import { AD_LANGUAGES } from '@/lib/geos';
import { logEvent } from '@/lib/usage';
import { makeUniqueCopy, type Brightness, type UniqueCopy } from '@/lib/imageUnique';
import { pollExecutionResult } from '@/store/useAppStore';

const CREATIVE_EDIT_HELP =
  'Завантаж статичний банер (PNG / JPG / WebP), заповни Hook / Accent / CTA та (опційно) опиши, ' +
  'як скоригувати сам зображення. Отримаєш відредагований варіант банера.';

const IMAGE_PROMPT_HELP =
  'Опційно: підказки для модифікації зображення — наприклад, "зміни фон на синій", ' +
  '"прибери логотип", "зроби CTA-кнопку червоною". Залиш порожнім, якщо хочеш лише оновити тексти.';

const LANGUAGE_TOOLTIP =
  'Якою мовою рендерити текст на банері. За замовчуванням мова не змінюється — модель залишає її такою ж, як на оригінальному зображенні. Вибери конкретну мову, якщо хочеш переклад.';

const MODE_HELP =
  'Change Image — редагує завантажений банер, підмінюючи Hook/Accent/CTA. ' +
  'Change Approach — на основі статті пропонує нові ідеї (Hook/Accent/CTA/Title/Description), ' +
  'потім рендерить банер із обраною ідеєю. Title/Description показуються під зображенням окремим текстом. ' +
  'Unique Copy — не змінює картинку: робить копію з іншим хешем файлу (brightness ±1 + унікальний штамп).';

const UNIQUE_HELP =
  'Робить копію креативу, візуально ідентичну оригіналу, але з іншим хешем файлу. ' +
  'Зсув яскравості ±1 з 255 (менше 0.5% — око не бачить) плюс унікальний коментар-штамп у файлі, ' +
  'щоб кожен клік давав новий хеш. Працює повністю в браузері — без n8n і без витрат.';

const BRIGHTNESS_HELP =
  '+1 робить кожен піксель на одиницю світлішим, −1 — темнішим (з 255). ' +
  'Обидва варіанти непомітні; тримай два значення, щоб з одного оригіналу зробити дві різні копії.';

const IDEAS_HELP =
  'Модель пропонує кілька повних наборів (Hook / Accent / CTA / Title / Description) під статтю. Обери один — і згенеруємо банер із ним.';

const RESULT_HELP =
  'Готовий банер із обраної ідеї. Title/Description показуються під зображенням окремим текстом, а не рендеряться на самому банері.';

const LANGUAGE_OPTIONS = ['Keep original language', ...AD_LANGUAGES];

const ASPECT_RATIOS: string[] = ['1:1', '16:9', '9:16', '4:5'];

// Verified against OpenRouter's image catalog (GET /api/v1/images/models) — NOT the
// chat catalog at /api/v1/models, which does not list Qwen/Seedream/GPT Image 2.
// All seven take `input_references`, so they can edit the uploaded creative, and all
// seven are reached through POST /api/v1/images.
const IMAGE_MODELS: { label: string; value: string }[] = [
  { label: 'Nano banana 2', value: 'google/gemini-3.1-flash-image' },
  { label: 'Nano banana pro', value: 'google/gemini-3-pro-image' },
  { label: 'GPT Image 2', value: 'openai/gpt-image-2' },
  { label: 'GPT Image 2.5 Flare', value: 'openai/gpt-image-2.5-flare' },
  { label: 'GPT Image 2.5 Sunburst', value: 'openai/gpt-image-2.5-sunburst' },
  { label: 'Qwen Image 3 Pro', value: 'qwen/qwen-image-3-pro' },
  { label: 'Seedream 5.0 Pro', value: 'bytedance-seed/seedream-5-0-pro' },
];

// The GPT Image models have no 4:5 in their aspect_ratio enum
// (1:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16, 21:9, auto).
const MODELS_WITHOUT_4_5 = new Set([
  'openai/gpt-image-2',
  'openai/gpt-image-2.5-flare',
  'openai/gpt-image-2.5-sunburst',
]);

const MODEL_HELP =
  'Модель, якою рендериться банер. Nano banana pro — найкраща якість і текст на банері; ' +
  'Nano banana 2 — вдвічі дешевша й швидша; GPT Image 2 / 2.5 Flare / 2.5 Sunburst, Qwen Image 3 Pro та ' +
  'Seedream 5.0 Pro — альтернативні стилі. Впливає лише на генерацію зображення, ' +
  'не на Analyze image і не на тексти.';

const FLAG_STYLES: Record<string, { label: string; tooltip: string; className: string }> = {
  'story-risk': {
    label: 'story',
    tooltip: 'F5 Story format — elevated §14 invention risk. Vet the copy for made-up names/places/amounts.',
    className: 'bg-amber-100 text-amber-800 border border-amber-300',
  },
  'clickbait-review': {
    label: 'clickbait',
    tooltip: '"Truth about X" / "What They Don\'t Tell You" phrasing — may trigger Facebook manual review on cold accounts.',
    className: 'bg-orange-100 text-orange-800 border border-orange-300',
  },
  default: {
    label: 'flag',
    tooltip: 'Compliance flag from Agent 3.',
    className: 'bg-slate-100 text-slate-800 border border-slate-300',
  },
};

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Unique Copy runs at brightness +1 only for now, so the picker is hidden rather
// than removed — flip to true to bring the −1 option back.
const SHOW_BRIGHTNESS_FILTER: boolean = false;

const WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_EDIT_URL as string | undefined;
const ANALYZE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_EDIT_ANALYZE_URL as string | undefined;
const APPROACH_IDEAS_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_APPROACH_IDEAS_URL as
  | string
  | undefined;
const APPROACH_GENERATE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_APPROACH_GENERATE_URL as
  | string
  | undefined;
const TRANSLATE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_TRANSLATE_URL as string | undefined;

type Mode = 'image' | 'approach' | 'unique';

// Change Image takes up to MAX_IMAGES banners; each one is a separate call to
// the same single-image webhook. The other modes only ever use the first image.
const MAX_IMAGES = 3;
type TextField = 'hook' | 'accent' | 'cta';
type Texts = Record<TextField, string>;
const EMPTY_TEXTS: Texts = { hook: '', accent: '', cta: '' };

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('FileReader returned non-string result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });

interface ResultItem {
  url: string;
  fileName?: string;
  /** 1-based source image number, set only for multi-image runs. */
  source?: number;
  /** Feedback context snapshot — undefined only for legacy code paths that
   *  can't build it (there are none currently; kept optional for safety). */
  feedback?: FeedbackContext;
}

interface IdeaTexts {
  hook: string;
  accent: string;
  cta: string;
  title: string;
  description: string;
}

interface Idea extends IdeaTexts {
  id: string;
  complianceFlags?: string[];
  translation?: IdeaTexts;
  isTranslating?: boolean;
  showTranslation?: boolean;
}

interface ApproachResult {
  url: string;
  fileName?: string;
  title: string;
  description: string;
}

export const CreativeEditPage = () => {
  const [mode, setMode] = useState<Mode>('image');

  const [files, setFiles] = useState<File[]>([]);
  const file = files[0] ?? null;
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  // Per-image Hook/Accent/CTA (aligned with `files`), used for a field whose
  // "Same for all" box is unticked. Ticked fields use hook/accent/cta below.
  const [perImage, setPerImage] = useState<Texts[]>([]);
  const [same, setSame] = useState<Record<TextField, boolean>>({ hook: true, accent: true, cta: true });
  const [pendingCount, setPendingCount] = useState(0);
  const [hook, setHook] = useState('');
  const [accent, setAccent] = useState('');
  const [cta, setCta] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [language, setLanguage] = useState('Keep original language');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  // Local, not the shared store — picking a model here must not silently change
  // what Creative Gen is set to.
  const [imageModel, setImageModel] = useState('openai/gpt-image-2.5-sunburst');
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Change Approach — extra input fields.
  const [articleUrl, setArticleUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Change Approach — section 2 state.
  const [isLoadingIdeas, setIsLoadingIdeas] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [pickedIdeaId, setPickedIdeaId] = useState<string | null>(null);

  // Change Approach — section 3 state.
  const [isLoadingApproach, setIsLoadingApproach] = useState(false);
  const [approachError, setApproachError] = useState<string | null>(null);
  const [approachResults, setApproachResults] = useState<ApproachResult[]>([]);

  // Unique Copy state. Runs entirely in the browser — no webhook.
  const [brightness, setBrightness] = useState<Brightness>(1);
  const [isMakingUnique, setIsMakingUnique] = useState(false);
  const [uniqueError, setUniqueError] = useState<string | null>(null);
  const [uniqueResults, setUniqueResults] = useState<UniqueCopy[]>([]);

  const dragCounter = useRef(0);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // Change Image with 2+ images: Hook/Accent/CTA can differ per image.
  const multi = mode === 'image' && files.length > 1;
  const shared: Texts = { hook, accent, cta };
  const setShared: Record<TextField, (v: string) => void> = { hook: setHook, accent: setAccent, cta: setCta };
  const textFor = (i: number, f: TextField): string =>
    !multi || same[f] ? shared[f] : (perImage[i]?.[f] ?? '');

  // Swapping the source image never touches what was already generated —
  // results only go away when the operator presses "Clear results". Generations
  // append, so a batch built from several source images stays side by side.
  // Change Image adds images (up to MAX_IMAGES); the other modes replace the one image.
  const acceptFiles = (picked: File[]) => {
    if (!picked.length) return;
    if (picked.some((p) => !ACCEPTED_TYPES.includes(p.type))) {
      setErrorMessage('Unsupported file type. Use PNG, JPG, or WebP.');
      return;
    }
    setErrorMessage(null);
    setAnalyzeError(null);
    if (mode !== 'image') {
      setFiles([picked[0]]);
      setPerImage([{ ...EMPTY_TEXTS }]);
      return;
    }
    const room = MAX_IMAGES - files.length;
    const added = picked.slice(0, Math.max(room, 0));
    if (added.length < picked.length) setErrorMessage(`Up to ${MAX_IMAGES} images — the extra ones were not added.`);
    setFiles([...files, ...added]);
    setPerImage([...perImage.slice(0, files.length), ...added.map(() => ({ ...EMPTY_TEXTS }))]);
  };

  const removeFile = (i: number) => {
    setFiles(files.filter((_, k) => k !== i));
    setPerImage(perImage.filter((_, k) => k !== i));
    setErrorMessage(null);
    setAnalyzeError(null);
  };

  // Ticking uses one text for every image (seeded from image #1 if empty).
  // Unticking shows each image's own text (from Analyze); only when no image has
  // one yet are the boxes seeded with the shared text — an empty box after
  // Analyze means "not on this image" and must stay empty.
  const toggleSame = (f: TextField, on: boolean) => {
    if (on) {
      if (!shared[f].trim()) setShared[f](perImage[0]?.[f] ?? '');
    } else if (files.every((_, i) => !(perImage[i]?.[f] ?? '').trim())) {
      setPerImage(files.map((_, i) => ({ ...(perImage[i] ?? EMPTY_TEXTS), [f]: shared[f] })));
    }
    setSame((s) => ({ ...s, [f]: on }));
  };

  const setPerImageText = (i: number, f: TextField, v: string) =>
    setPerImage((prev) => files.map((_, k) => (k === i ? { ...(prev[k] ?? EMPTY_TEXTS), [f]: v } : (prev[k] ?? EMPTY_TEXTS))));

  // Reads Hook/Accent/CTA off one banner. Throws with a user-facing message.
  const analyzeOne = async (target: File): Promise<Texts> => {
    // meta describes the *input* — never the image bytes (the file can be MBs;
    // meta is capped at 2 KB). The image itself is omitted by design.
    const meta = { fileName: target.name, fileType: target.type, fileSizeKB: Math.round(target.size / 1024) };
    try {
      const imageDataUrl = await fileToDataUrl(target);
      const response = await axios.post<unknown>(ANALYZE_WEBHOOK as string, { image: imageDataUrl });
      const data = response.data;

      if (data === null || typeof data !== 'object') {
        console.error('[CreativeEdit] analyze: unexpected response', data);
        logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, metaOut: data, errorMessage: 'Unexpected analyze response shape' });
        throw new Error('Unexpected analyze response shape');
      }

      const obj = data as Record<string, unknown>;
      const pick = (k: string): string => (typeof obj[k] === 'string' ? (obj[k] as string) : '');
      const texts: Texts = { hook: pick('hook'), accent: pick('accent'), cta: pick('cta') };

      if (!texts.hook && !texts.accent && !texts.cta) {
        console.error('[CreativeEdit] analyze: no hook/accent/cta in response', data);
        logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, metaOut: data, errorMessage: 'Analyze returned no Hook / Accent / CTA' });
        throw new Error('Analyze returned no Hook / Accent / CTA');
      }
      logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, metaOut: data });
      return texts;
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      if (!axios.isAxiosError(err)) throw err; // shape errors are logged above
      const msg = axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Analyze failed';
      logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, metaOut: axiosErr?.response?.data, errorMessage: msg });
      throw new Error(msg);
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    const targets = mode === 'image' ? files : [file];

    if (!ANALYZE_WEBHOOK) {
      const msg = 'PUBLIC_WEBHOOK_CREATIVE_EDIT_ANALYZE_URL is not configured. Set it in .env.';
      setAnalyzeError(msg);
      logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta: { fileName: file.name }, errorMessage: msg });
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeError(null);
    try {
      const settled = await Promise.allSettled(targets.map((t) => analyzeOne(t)));
      const got = settled.map((s) => (s.status === 'fulfilled' ? s.value : null));
      setPerImage(targets.map((_, i) => got[i] ?? perImage[i] ?? { ...EMPTY_TEXTS }));
      // The shared (ticked) fields take image #1's text, as with a single image.
      const firstOk = got.find((g): g is Texts => !!g);
      if (firstOk) {
        setHook(firstOk.hook);
        setAccent(firstOk.accent);
        setCta(firstOk.cta);
      }
      const errors = settled
        .map((s, i) => (s.status === 'rejected' ? `${targets.length > 1 ? `#${i + 1}: ` : ''}${(s.reason as Error)?.message ?? 'Analyze failed'}` : ''))
        .filter(Boolean);
      if (errors.length) setAnalyzeError(errors.join(' · '));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    acceptFiles(Array.from(e.dataTransfer.files ?? []));
  };

  // Webhook response -> result list; null when the shape is unknown.
  const parseEditResponse = (data: unknown): { url: string; fileName?: string }[] | null => {
    if (typeof data === 'string') return [{ url: data }];
    if (data !== null && typeof data === 'object' && 'images' in data && Array.isArray((data as { images: unknown }).images)) {
      return (data as { images: unknown[] }).images.filter(
        (item): item is { url: string; fileName?: string } =>
          item !== null && typeof item === 'object' && 'url' in item && typeof (item as { url: unknown }).url === 'string',
      );
    }
    if (data !== null && typeof data === 'object' && 'url' in data && typeof (data as { url: unknown }).url === 'string') {
      const d = data as { url: string; fileName?: string };
      return [{ url: d.url, fileName: d.fileName }];
    }
    return null;
  };

  // One image -> one webhook call. Results are appended as soon as they arrive.
  // Logging is left to handleGenerate so a multi-image run is ONE usage event
  // (the Dashboard then shows "See N images" on a single row).
  // Throws an Error with a user-facing message and the raw response as `data`.
  const generateOne = async (target: File, texts: Texts, source?: number) => {
    const lang = language === 'Keep original language' ? '' : language;
    const t = { hook: texts.hook.trim(), accent: texts.accent.trim(), cta: texts.cta.trim() };
    const imageDataUrl = await fileToDataUrl(target);

    // Snapshot for the feedback buttons — captured now so a later form edit
    // never changes what a vote is attributed to.
    const promptSource = imagePrompt.trim() ? 'custom' : 'none';
    const buildFeedbackCtx = (outputUrl: string): FeedbackContext => ({
      feedbackId: crypto.randomUUID(),
      tab: 'creative_edit',
      operation: 'editCreative',
      model: imageModel,
      promptSource,
      promptText: imagePrompt.trim(),
      input: { ...t, language: lang, aspectRatio },
      inputImage: imageDataUrl,
      outputImage: outputUrl,
    });

    let data: unknown;
    try {
      const response = await axios.post<unknown>(WEBHOOK as string, {
        image: imageDataUrl,
        ...t,
        imagePrompt: imagePrompt.trim(),
        language: lang,
        aspectRatio,
        imageModel,
      });
      data = response.data;
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const e = new Error(axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Generation failed');
      (e as Error & { data?: unknown }).data = axiosErr?.response?.data;
      throw e;
    }
    const items = parseEditResponse(data);
    if (!items) {
      console.error('[CreativeEdit] unexpected response', data);
      const e = new Error('Unexpected response shape');
      (e as Error & { data?: unknown }).data = data;
      throw e;
    }
    setResults((prev) => [...prev, ...items.map((it) => ({ ...it, source, feedback: buildFeedbackCtx(it.url) }))]);
    return { items, data };
  };

  const handleGenerate = async () => {
    if (!files.length || hookMissing) return;

    const jobs = files.map((f, i) => ({
      f,
      texts: { hook: textFor(i, 'hook'), accent: textFor(i, 'accent'), cta: textFor(i, 'cta') },
      source: files.length > 1 ? i + 1 : undefined,
    }));
    const common = {
      imagePrompt: imagePrompt.trim(),
      language: language === 'Keep original language' ? '' : language,
      aspectRatio,
      imageModel,
    };
    const trimmed = (t: Texts) => ({ hook: t.hook.trim(), accent: t.accent.trim(), cta: t.cta.trim() });
    // Single image keeps the old meta shape; a batch lists each image's texts.
    const meta = jobs.length === 1
      ? { fileName: jobs[0].f.name, ...trimmed(jobs[0].texts), ...common }
      : { images: jobs.length, items: jobs.map((j) => ({ fileName: j.f.name, ...trimmed(j.texts) })), ...common };

    if (!WEBHOOK) {
      const msg = 'PUBLIC_WEBHOOK_CREATIVE_EDIT_URL is not configured. Set it in .env.';
      setErrorMessage(msg);
      logEvent({ tab: 'creative-edit', action: 'editCreative', meta, errorMessage: msg });
      return;
    }

    setIsLoading(true);
    setPendingCount(jobs.length);
    setErrorMessage(null);
    try {
      const settled = await Promise.allSettled(
        jobs.map((j) => generateOne(j.f, j.texts, j.source).finally(() => setPendingCount((n) => n - 1))),
      );
      const errors = settled
        .map((s, i) => (s.status === 'rejected' ? `${jobs[i].source ? `Image #${jobs[i].source}: ` : ''}${(s.reason as Error)?.message ?? 'Generation failed'}` : ''))
        .filter(Boolean);
      if (errors.length) setErrorMessage(errors.join(' · '));

      if (jobs.length === 1) {
        const s = settled[0];
        if (s.status === 'fulfilled') logEvent({ tab: 'creative-edit', action: 'editCreative', meta, metaOut: s.value.data });
        else logEvent({ tab: 'creative-edit', action: 'editCreative', meta, metaOut: (s.reason as { data?: unknown })?.data, errorMessage: errors[0] });
      } else {
        // One event for the whole batch: every output image in one `images` list.
        const images = settled.flatMap((s, i) =>
          s.status === 'fulfilled' ? s.value.items.map((it) => ({ source: i + 1, url: it.url, fileName: it.fileName })) : [],
        );
        logEvent({
          tab: 'creative-edit',
          action: 'editCreative',
          meta,
          metaOut: { images },
          errorMessage: errors.length ? errors.join(' · ') : undefined,
        });
      }
    } finally {
      setIsLoading(false);
      setPendingCount(0);
    }
  };

  // ---------------------------------------------------------------- Change Approach
  const approachInputsMissing =
    !file || !articleUrl.trim() || !title.trim() || !description.trim();

  const handleGenerateIdeas = async () => {
    if (approachInputsMissing || !file) return;

    const meta = {
      fileName: file.name,
      articleUrl: articleUrl.trim(),
      title: title.trim(),
      description: description.trim(),
      hook: hook.trim(),
      accent: accent.trim(),
      cta: cta.trim(),
      language: language === 'Keep original language' ? '' : language,
      aspectRatio,
    };

    if (!APPROACH_IDEAS_WEBHOOK) {
      const msg = 'PUBLIC_WEBHOOK_CREATIVE_APPROACH_IDEAS_URL is not configured. Set it in .env.';
      setIdeasError(msg);
      logEvent({ tab: 'creative-edit', action: 'approachIdeas', meta, errorMessage: msg });
      return;
    }

    setIsLoadingIdeas(true);
    setIdeasError(null);
    // The idea list is an input picker, so a new run replaces it (pickedIdeaId
    // points into the old list). Already-generated creatives are output and stay
    // until the operator clears them by hand.
    setIdeas([]);
    setPickedIdeaId(null);

    try {
      const imageDataUrl = await fileToDataUrl(file);

      const response = await axios.post<unknown>(APPROACH_IDEAS_WEBHOOK, {
        image: imageDataUrl,
        articleUrl: articleUrl.trim(),
        title: title.trim(),
        description: description.trim(),
        hook: hook.trim(),
        accent: accent.trim(),
        cta: cta.trim(),
        language: language === 'Keep original language' ? '' : language,
        aspectRatio,
      });
      let data = response.data;

      // The workflow returns immediately with { job_id } (or execution_id / id) so the
      // request never times out past 300s. Poll the n8n executions API until the run
      // finishes, then read the final node's JSON — which is Shape to ideas[]'s
      // { ideas: [...], detectedLanguage: "..." }. Falls through to synchronous parsing
      // if the response already contains the ideas array (older workflow version).
      const jobId = extractJobId(data);
      if (jobId) {
        // Explicit preferred node: the workflow fans out at Agent 3 (Shape branch +
        // cost-log branch), so lastNodeExecuted often points at the cost log. Ask for
        // Shape's output directly.
        data = await pollExecutionResult(jobId, 'creativeApproachIdeas', 'Shape to ideas[]');
      }

      const raw = extractIdeasArray(data);
      if (!raw) {
        console.error('[CreativeEdit] ideas: unexpected response', data);
        setIdeasError('Unexpected ideas response shape');
        logEvent({ tab: 'creative-edit', action: 'approachIdeas', meta, metaOut: data, errorMessage: 'Unexpected ideas response shape' });
        return;
      }

      const parsed: Idea[] = raw.map((item, i) => {
        const o = item as Record<string, unknown>;
        const s = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
        const rawId = s('id');
        return {
          id: rawId || `idea-${i + 1}`,
          hook: s('hook'),
          accent: s('accent'),
          cta: s('cta'),
          title: s('title'),
          description: s('description'),
          complianceFlags: Array.isArray(o.complianceFlags)
            ? (o.complianceFlags as unknown[])
                .filter((f): f is string => typeof f === 'string')
            : undefined,
        };
      });

      setIdeas(parsed);
      logEvent({ tab: 'creative-edit', action: 'approachIdeas', meta, metaOut: data });
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const msg = axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Ideas request failed';
      setIdeasError(msg);
      logEvent({ tab: 'creative-edit', action: 'approachIdeas', meta, metaOut: axiosErr?.response?.data, errorMessage: msg });
    } finally {
      setIsLoadingIdeas(false);
    }
  };

  // Toggle Ukrainian translation on one idea card. First call fetches via /translate_uk
  // and caches on the idea. Subsequent calls just flip showTranslation. Card render picks
  // between article-native fields (idea.hook/…) and translation.* based on the flag.
  const toggleIdeaTranslation = async (ideaId: string) => {
    const idea = ideas.find((i) => i.id === ideaId);
    if (!idea || idea.isTranslating) return;

    // Already cached — just flip the flag.
    if (idea.translation) {
      setIdeas((prev) =>
        prev.map((i) =>
          i.id === ideaId ? { ...i, showTranslation: !i.showTranslation } : i,
        ),
      );
      return;
    }

    if (!TRANSLATE_WEBHOOK) {
      const msg = 'PUBLIC_WEBHOOK_TRANSLATE_URL is not configured. Set it in .env.';
      setIdeasError(msg);
      return;
    }

    setIdeas((prev) =>
      prev.map((i) => (i.id === ideaId ? { ...i, isTranslating: true } : i)),
    );

    try {
      const payload = {
        hook: idea.hook,
        accent: idea.accent,
        cta: idea.cta,
        title: idea.title,
        description: idea.description,
      };
      const response = await axios.post<unknown>(TRANSLATE_WEBHOOK, payload);
      const raw = response.data;
      const outer = Array.isArray(raw) ? raw[0] : raw;
      const wrapped = outer && typeof outer === 'object' && 'json' in outer
        ? (outer as { json: unknown }).json
        : outer;
      const obj = (wrapped && typeof wrapped === 'object') ? (wrapped as Record<string, unknown>) : {};
      const pick = (k: keyof IdeaTexts): string =>
        typeof obj[k] === 'string' ? (obj[k] as string) : idea[k];
      const translation: IdeaTexts = {
        hook: pick('hook'),
        accent: pick('accent'),
        cta: pick('cta'),
        title: pick('title'),
        description: pick('description'),
      };
      setIdeas((prev) =>
        prev.map((i) =>
          i.id === ideaId
            ? { ...i, translation, showTranslation: true, isTranslating: false }
            : i,
        ),
      );
      logEvent({
        tab: 'creative-edit',
        action: 'translateIdea',
        meta: { ideaId },
        metaOut: translation,
      });
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const msg = axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Translate failed';
      setIdeas((prev) =>
        prev.map((i) => (i.id === ideaId ? { ...i, isTranslating: false } : i)),
      );
      logEvent({
        tab: 'creative-edit',
        action: 'translateIdea',
        meta: { ideaId },
        errorMessage: msg,
      });
    }
  };

  const handleGenerateApproachImage = async () => {
    if (!file || !pickedIdeaId) return;
    const picked = ideas.find((i) => i.id === pickedIdeaId);
    if (!picked) return;

    // `original` = what the operator sees in the current Hook/Accent/CTA fields
    // (filled by Analyze image). Any field that's empty is treated as NOT present
    // on the uploaded image — the backend must NOT add it to the edited banner.
    const original = {
      hook: hook.trim(),
      accent: accent.trim(),
      cta: cta.trim(),
    };
    // All three empty = image was never analysed, not "image has no text".
    // Treat every slot as present so the banner still gets the idea's copy.
    const notAnalysed = !original.hook && !original.accent && !original.cta;
    const presentSlots = {
      hook: notAnalysed || original.hook.length > 0,
      accent: notAnalysed || original.accent.length > 0,
      cta: notAnalysed || original.cta.length > 0,
    };

    const meta = {
      fileName: file.name,
      ideaId: picked.id,
      hook: picked.hook,
      accent: picked.accent,
      cta: picked.cta,
      title: picked.title,
      description: picked.description,
      articleUrl: articleUrl.trim(),
      language: language === 'Keep original language' ? '' : language,
      aspectRatio,
      imageModel,
      presentSlots,
    };

    if (!APPROACH_GENERATE_WEBHOOK) {
      const msg = 'PUBLIC_WEBHOOK_CREATIVE_APPROACH_GENERATE_URL is not configured. Set it in .env.';
      setApproachError(msg);
      logEvent({ tab: 'creative-edit', action: 'approachGenerate', meta, errorMessage: msg });
      return;
    }

    setIsLoadingApproach(true);
    setApproachError(null);

    try {
      const imageDataUrl = await fileToDataUrl(file);

      const response = await axios.post<unknown>(APPROACH_GENERATE_WEBHOOK, {
        image: imageDataUrl,
        articleUrl: articleUrl.trim(),
        idea: {
          id: picked.id,
          hook: picked.hook,
          accent: picked.accent,
          cta: picked.cta,
          title: picked.title,
          description: picked.description,
        },
        original,
        presentSlots,
        language: language === 'Keep original language' ? '' : language,
        aspectRatio,
        imageModel,
      });
      const data = response.data;

      const items = extractApproachResults(data, picked);
      if (items.length === 0) {
        console.error('[CreativeEdit] approach generate: unexpected response', data);
        setApproachError('Unexpected response shape');
        logEvent({ tab: 'creative-edit', action: 'approachGenerate', meta, metaOut: data, errorMessage: 'Unexpected response shape' });
        return;
      }

      setApproachResults((prev) => [...prev, ...items]);
      logEvent({ tab: 'creative-edit', action: 'approachGenerate', meta, metaOut: data });
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const msg = axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Generation failed';
      setApproachError(msg);
      logEvent({ tab: 'creative-edit', action: 'approachGenerate', meta, metaOut: axiosErr?.response?.data, errorMessage: msg });
    } finally {
      setIsLoadingApproach(false);
    }
  };

  // ------------------------------------------------------------------ Unique Copy
  // Each click appends one copy. The stamp inside makeUniqueCopy is what keeps
  // repeat clicks at the same brightness from producing an identical file.
  const handleMakeUnique = async () => {
    if (!file) return;

    const meta = {
      fileName: file.name,
      fileType: file.type,
      fileSizeKB: Math.round(file.size / 1024),
      brightness,
    };

    setIsMakingUnique(true);
    setUniqueError(null);
    try {
      const copy = await makeUniqueCopy(file, brightness);
      setUniqueResults((prev) => [...prev, copy]);
      logEvent({
        tab: 'creative-edit',
        action: 'uniqueCopy',
        meta,
        metaOut: { fileName: copy.fileName, hash: copy.hash, bytes: copy.bytes },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not build a unique copy';
      setUniqueError(msg);
      logEvent({ tab: 'creative-edit', action: 'uniqueCopy', meta, errorMessage: msg });
    } finally {
      setIsMakingUnique(false);
    }
  };

  // Results hold object URLs, so dropping them without revoking leaks the blobs.
  const clearUniqueResults = () => {
    setUniqueResults((prev) => {
      prev.forEach((r) => URL.revokeObjectURL(r.url));
      return [];
    });
  };

  const uniqueResultsRef = useRef<UniqueCopy[]>([]);
  uniqueResultsRef.current = uniqueResults;
  useEffect(
    () => () => uniqueResultsRef.current.forEach((r) => URL.revokeObjectURL(r.url)),
    [],
  );

  const noFile = !file;
  const hookMissing = multi ? files.some((_, i) => !textFor(i, 'hook').trim()) : !hook.trim();

  let buttonLabel = multi ? `Generate ${files.length} creatives` : 'Generate Edited Creative';
  if (isLoading) buttonLabel = 'Generating...';
  else if (noFile) buttonLabel = 'Upload a creative first';
  else if (hookMissing) buttonLabel = 'Enter a Hook first';

  const modeToggle = (
    <div>
      <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400 block mb-1">
        Mode <span className="text-red-500">*</span>
        <InfoTooltip text={MODE_HELP} iconSize={11} />
      </label>
      {/* Three modes no longer fit side by side at the 400px sidebar width,
          so the toggle is a grid with tighter type. */}
      <div className="grid grid-cols-3 gap-1.5">
        {([
          ['image', 'Change Image'],
          ['approach', 'Change Approach'],
          ['unique', 'Unique Copy'],
        ] as [Mode, string][]).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-md border px-2 py-2 text-xs leading-tight transition ${
              mode === value
                ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                : 'border-input bg-white hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  const imageMode = mode === 'image';
  const uploadFull = imageMode && files.length >= MAX_IMAGES;
  let uploadLabel = file ? 'Replace creative' : 'Upload creative';
  if (imageMode) uploadLabel = uploadFull ? `${MAX_IMAGES} images max — remove one to add` : file ? 'Add creative' : 'Upload creatives';

  const uploadBlock = (
    <div>
      <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
        {imageMode ? `Creative images (${files.length} / ${MAX_IMAGES})` : 'Creative image'}
      </label>
      <label
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed px-3 py-4 text-sm font-medium transition-colors w-full text-center ${
          uploadFull
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
            : isDragging
              ? 'cursor-pointer border-blue-500 bg-blue-50 text-blue-700'
              : 'cursor-pointer border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
        }`}
      >
        <span>{uploadLabel}</span>
        {!uploadFull && (
          <span className="mt-0.5 text-[11px] font-normal text-slate-500">
            or drag & drop here{imageMode ? ` — up to ${MAX_IMAGES}` : ''}
          </span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple={imageMode}
          disabled={uploadFull}
          className="hidden"
          onChange={handleFileChange}
        />
      </label>
      {imageMode && files.length > 1 ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="relative">
              <img
                src={previewUrls[i]}
                alt={`Creative #${i + 1}`}
                title={f.name}
                className="h-24 w-full object-contain rounded border bg-slate-50"
              />
              <span className="absolute left-1 top-1 rounded bg-slate-900/70 px-1 text-[10px] font-bold text-white">#{i + 1}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                disabled={isLoading || isAnalyzing}
                className="absolute right-1 top-1 rounded bg-white/90 px-1 text-xs leading-4 text-slate-700 shadow hover:bg-red-50 hover:text-red-700"
                title="Remove this image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        file && (
          <>
            <div className="mt-1 flex items-center gap-2">
              <p className="flex-1 text-xs text-slate-500 truncate">{file.name}</p>
              {imageMode && (
                <button type="button" onClick={() => removeFile(0)} disabled={isLoading || isAnalyzing} className="text-xs text-slate-400 hover:text-red-600">
                  Remove
                </button>
              )}
            </div>
            {previewUrls[0] && (
              <img
                src={previewUrls[0]}
                alt="Preview"
                className="mt-2 max-h-40 w-full object-contain rounded border"
              />
            )}
          </>
        )
      )}
    </div>
  );

  // Mirrors the Settings card in Creative Gen (ImageGenSettings). Shown in both
  // generating modes; Unique Copy does not call a model at all.
  const settingsBlock = (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="text-[10px] font-bold uppercase text-gray-500">Settings</div>
      <div>
        <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400 mb-1">
          Image model
          <InfoTooltip text={MODEL_HELP} iconSize={11} />
        </label>
        <select
          value={imageModel}
          onChange={(e) => setImageModel(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1 bg-white"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {MODELS_WITHOUT_4_5.has(imageModel) && aspectRatio === '4:5' && (
          <p className="mt-1 text-[11px] text-amber-700">
            This model does not support 4:5 — pick another ratio or another model.
          </p>
        )}
      </div>
    </div>
  );

  const creativeTextBlock = (includeImagePrompt: boolean) => (
    <>
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase text-gray-500">Creative text</div>
          {isAnalyzing && (
            <div className="text-[10px] uppercase text-blue-600 animate-pulse">Reading…</div>
          )}
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
            Aspect ratio
          </label>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1 bg-white"
          >
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        {mode === 'image' && (
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Language
              <InfoTooltip text={LANGUAGE_TOOLTIP} iconSize={11} />
            </label>
            <Combobox
              value={language}
              onChange={setLanguage}
              options={LANGUAGE_OPTIONS}
              placeholder="Keep original language"
            />
          </div>
        )}
        {([
          ['hook', 'Hook', HOOK_HELP, 'Main banner line, 40–55 chars…'],
          ['accent', 'Accent', ACCENT_HELP, 'Second, smaller line under the hook…'],
          ['cta', 'CTA', CTA_HELP, 'Learn More, Read More, Discover More…'],
        ] as [TextField, string, string, string][]).map(([f, label, help, placeholder]) => {
          const perImageMode = multi && !same[f];
          return (
            <div key={f}>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                  {label}
                  <InfoTooltip text={help} iconSize={11} />
                  {f === 'hook' && mode === 'image' && hookMissing && (
                    <span className="ml-1 normal-case font-normal text-red-500">— required</span>
                  )}
                </label>
                {multi && (
                  <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none">
                    <input type="checkbox" checked={same[f]} onChange={(e) => toggleSame(f, e.target.checked)} />
                    Same for all
                  </label>
                )}
              </div>
              {perImageMode ? (
                <div className="space-y-1.5">
                  {files.map((_, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <img src={previewUrls[i]} alt={`#${i + 1}`} className="mt-1 h-8 w-8 shrink-0 rounded border object-cover" />
                      <div className="flex-1">
                        <div className="text-[10px] font-bold text-slate-400">#{i + 1}</div>
                        <Textarea
                          value={perImage[i]?.[f] ?? ''}
                          onChange={(e) => setPerImageText(i, f, e.target.value)}
                          placeholder={f === 'hook' ? placeholder : 'Empty = not on this image'}
                          className="bg-white text-sm resize-none min-h-[44px]"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Textarea
                  value={shared[f]}
                  onChange={(e) => setShared[f](e.target.value)}
                  placeholder={placeholder}
                  className="bg-white text-sm resize-none"
                />
              )}
            </div>
          );
        })}
      </div>

      {includeImagePrompt && (
        <div>
          <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
            Image prompt adjustments
            <InfoTooltip text={IMAGE_PROMPT_HELP} iconSize={11} />
            <span className="ml-1 normal-case font-normal text-slate-400">— optional</span>
          </label>
          <Textarea
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Change background to blue, remove logo, make the CTA button red. Leave empty to only update texts."
            className="bg-white text-sm resize-none"
          />
        </div>
      )}
    </>
  );

  const analyzeBlock = (
    <>
      <Button
        onClick={handleAnalyze}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        disabled={noFile || isAnalyzing}
      >
        {isAnalyzing
          ? `Analyzing ${multi ? `${files.length} images` : 'image'}...`
          : multi ? `Analyze ${files.length} images` : 'Analyze image'}
      </Button>
      {analyzeError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {analyzeError}
        </div>
      )}
    </>
  );

  // --------------------------------------------------------------- Unique Copy layout
  if (mode === 'unique') {
    return (
      <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
        <div className="w-[400px] shrink-0 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          <div className="flex flex-col gap-4">
            <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
              Creative Edit
              <InfoTooltip text={CREATIVE_EDIT_HELP} />
            </h2>

            {modeToggle}
            {uploadBlock}

            {SHOW_BRIGHTNESS_FILTER && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-500">
                Filter
                <InfoTooltip text={UNIQUE_HELP} iconSize={11} />
              </div>
              <div>
                <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400 mb-1">
                  Brightness
                  <InfoTooltip text={BRIGHTNESS_HELP} iconSize={11} />
                </label>
                <div className="flex gap-2">
                  {([1, -1] as Brightness[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBrightness(value)}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                        brightness === value
                          ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                          : 'border-input bg-white hover:bg-slate-50'
                      }`}
                    >
                      Brightness {value > 0 ? '+1' : '−1'}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Pixels change by 1 of 255 — invisible. The image itself is not edited.
                </p>
              </div>
            </div>
            )}

            <Button
              onClick={handleMakeUnique}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              disabled={isMakingUnique || noFile}
            >
              {isMakingUnique
                ? 'Creating…'
                : noFile
                  ? 'Upload a creative first'
                  : 'Create New Copy'}
            </Button>
            <p className="text-[11px] text-slate-500">
              Every click makes one more copy with a different file hash — click twice for two.
            </p>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="font-bold text-xl">Result</h2>
            {uniqueResults.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={clearUniqueResults}
                disabled={isMakingUnique}
                title="Remove every copy from this panel"
              >
                Clear results ({uniqueResults.length})
              </Button>
            )}
          </div>

          {uniqueError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {uniqueError}
            </div>
          )}

          {uniqueResults.length === 0 && !isMakingUnique && !uniqueError && (
            <p className="text-sm text-slate-400">
              Upload a creative, then click Create New Copy.
            </p>
          )}

          {uniqueResults.length > 0 && (
            <div className="flex flex-col gap-6">
              {uniqueResults.map((item, i) => (
                <div key={item.hash} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase text-gray-400">
                      Copy #{i + 1}
                    </span>
                    {/* The hash is the whole point of this mode — surface it so the
                        operator can confirm at a glance that copies really differ. */}
                    <span
                      title="SHA-256 prefix — every copy must show a different value"
                      className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white"
                    >
                      {item.hash}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {item.width}×{item.height} · {Math.round(item.bytes / 1024)} KB
                    </span>
                  </div>
                  <div className="w-full flex items-center justify-center bg-slate-50 rounded border">
                    <img
                      src={item.url}
                      alt={`Unique copy ${i + 1}`}
                      className="max-h-[480px] w-full object-contain rounded"
                    />
                  </div>
                  <p className="text-xs text-slate-500 truncate">{item.fileName}</p>
                  <div className="flex items-center gap-2">
                    <a
                      href={item.url}
                      download={item.fileName}
                      className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors w-fit"
                    >
                      Download
                    </a>
                    <CopyNameButton fileName={item.fileName} className="px-3 py-1.5 text-sm" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {isMakingUnique && (
            <div className={`flex flex-col gap-3 ${uniqueResults.length > 0 ? 'mt-6' : ''}`}>
              <Skeleton className="h-6 w-48 rounded" />
              <Skeleton className="h-64 w-full rounded" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------- Change Image layout
  if (mode === 'image') {
    return (
      <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
        <div className="w-[400px] shrink-0 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          <div className="flex flex-col gap-4">
            <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
              Creative Edit
              <InfoTooltip text={CREATIVE_EDIT_HELP} />
            </h2>

            {modeToggle}
            {uploadBlock}
            {analyzeBlock}
            {settingsBlock}
            {creativeTextBlock(true)}

            <Button
              onClick={handleGenerate}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              disabled={isLoading || noFile || hookMissing}
            >
              {buttonLabel}
            </Button>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          {/* Clearing the batch is a deliberate, explicit action — nothing else
              in this tab removes generated images. */}
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="font-bold text-xl">Result</h2>
            {results.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setResults([])}
                disabled={isLoading}
                title="Remove every generated image from this panel"
              >
                Clear results ({results.length})
              </Button>
            )}
          </div>

          {errorMessage && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          {results.length === 0 && !isLoading && !errorMessage && (
            <p className="text-sm text-slate-400">
              Upload a creative and describe the changes, then click Generate.
            </p>
          )}

          {results.length > 0 && (
            <div className="flex flex-col gap-6">
              {results.map((item, i) => {
                const rawName = item.fileName ?? `creative-edit-${i + 1}.png`;
                const name = rawName.startsWith('aiimg_') ? rawName : `aiimg_${rawName}`;
                return (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="text-[10px] font-bold uppercase text-gray-400">
                      Generation #{i + 1}{item.source ? ` · from image #${item.source}` : ''}
                    </div>
                    <div className="w-full flex items-center justify-center bg-slate-50 rounded border">
                      <img
                        src={item.url}
                        alt={`Generated creative ${i + 1}`}
                        className="max-h-[480px] w-full object-contain rounded"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={item.url}
                        download={name}
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors w-fit"
                      >
                        Download
                      </a>
                      <CopyNameButton fileName={name} className="px-3 py-1.5 text-sm" />
                    </div>
                    {item.feedback && <FeedbackButtons ctx={item.feedback} />}
                  </div>
                );
              })}
            </div>
          )}

          {isLoading &&
            Array.from({ length: Math.max(pendingCount, 1) }, (_, k) => (
              <div key={k} className={`flex flex-col gap-3 ${results.length > 0 || k > 0 ? 'mt-6' : ''}`}>
                <Skeleton className="h-6 w-48 rounded" />
                <Skeleton className="h-64 w-full rounded" />
              </div>
            ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------- Change Approach layout
  const pickedIdea = ideas.find((i) => i.id === pickedIdeaId) ?? null;

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
            1. Input
            <InfoTooltip text={CREATIVE_EDIT_HELP} />
          </h2>

          {modeToggle}
          {uploadBlock}
          {analyzeBlock}
          {settingsBlock}

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
            <div className="text-[10px] font-bold uppercase text-gray-500">Article</div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                Article URL <span className="text-red-500">*</span>
              </label>
              <Input
                value={articleUrl}
                onChange={(e) => setArticleUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                Ad title <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                rows={2}
                placeholder="Ad title"
                className="bg-white text-sm resize-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Short ad description"
                className="bg-white text-sm resize-none"
              />
            </div>
          </div>

          {creativeTextBlock(false)}

          <Button
            onClick={handleGenerateIdeas}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            disabled={isLoadingIdeas || approachInputsMissing}
          >
            {isLoadingIdeas ? 'Generating…' : 'Generate New Ideas'}
          </Button>
          {approachInputsMissing && (
            <p className="text-[11px] text-slate-500">
              Upload a creative and fill Article URL / Title / Description.
            </p>
          )}
        </div>
      </div>

      {/* 2. New Ideas */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2 shrink-0">
            2. New Ideas
            <InfoTooltip text={IDEAS_HELP} />
          </h2>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            {isLoadingIdeas && (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-24 w-full rounded" />
                <Skeleton className="h-24 w-full rounded" />
                <Skeleton className="h-24 w-full rounded" />
              </div>
            )}
            {ideasError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">
                {ideasError}
              </div>
            )}
            {!isLoadingIdeas && !ideasError && ideas.length === 0 && (
              <div className="text-gray-400 italic text-sm">
                Fill inputs on the left and click Generate New Ideas.
              </div>
            )}
            {ideas.map((idea) => {
              const isPicked = pickedIdeaId === idea.id;
              const isUk = !!idea.showTranslation && !!idea.translation;
              const view: IdeaTexts = isUk
                ? (idea.translation as IdeaTexts)
                : {
                    hook: idea.hook,
                    accent: idea.accent,
                    cta: idea.cta,
                    title: idea.title,
                    description: idea.description,
                  };
              let translateLabel = '🇺🇦 Translate';
              if (idea.isTranslating) translateLabel = 'Translating…';
              else if (isUk) translateLabel = '🇺🇸 Original';
              return (
                <div
                  key={idea.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isPicked}
                  onClick={() => setPickedIdeaId(isPicked ? null : idea.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPickedIdeaId(isPicked ? null : idea.id);
                    }
                  }}
                  className={`w-full cursor-pointer text-left rounded-lg border bg-white p-3 transition-colors ${
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
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white">
                            {idea.id}
                          </span>
                          {idea.complianceFlags?.map((flag) => {
                            const style = FLAG_STYLES[flag] ?? FLAG_STYLES.default;
                            return (
                              <span
                                key={flag}
                                title={style.tooltip}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.className}`}
                              >
                                {style.label}
                              </span>
                            );
                          })}
                        </div>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleIdeaTranslation(idea.id);
                          }}
                          disabled={idea.isTranslating}
                        >
                          {translateLabel}
                        </Button>
                      </div>
                      {view.hook && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Hook</p>
                          <p className="text-xs leading-relaxed text-slate-900">{view.hook}</p>
                        </div>
                      )}
                      {view.accent && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Accent</p>
                          <p className="text-xs leading-relaxed text-slate-900">{view.accent}</p>
                        </div>
                      )}
                      {view.cta && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">CTA</p>
                          <p className="text-xs leading-relaxed text-slate-900">{view.cta}</p>
                        </div>
                      )}
                      {view.title && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Title</p>
                          <p className="text-xs leading-relaxed text-slate-900">{view.title}</p>
                        </div>
                      )}
                      {view.description && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Description</p>
                          <p className="text-xs leading-relaxed text-slate-900">{view.description}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {ideas.length > 0 && (
            <Button
              onClick={handleGenerateApproachImage}
              className="mt-2 shrink-0"
              disabled={isLoadingApproach || !pickedIdeaId}
            >
              {isLoadingApproach ? 'Generating…' : 'Generate Creative'}
            </Button>
          )}
        </div>
      </div>

      {/* 3. Generated Creatives */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Same rule as Change Image: generations accumulate, and only this
              button removes them. */}
          <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
            <h2 className="flex items-center gap-1.5 font-bold text-xl">
              3. Generated Creatives
              <InfoTooltip text={RESULT_HELP} />
            </h2>
            {approachResults.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setApproachResults([])}
                disabled={isLoadingApproach}
                title="Remove every generated image from this panel"
              >
                Clear results ({approachResults.length})
              </Button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
            {approachError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">
                {approachError}
              </div>
            )}

            {isLoadingApproach && (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-6 w-48 rounded" />
                <Skeleton className="h-64 w-full rounded" />
              </div>
            )}

            {!isLoadingApproach && !approachError && approachResults.length === 0 && (
              <div className="text-gray-400 italic text-sm">
                {pickedIdea
                  ? 'Click Generate Creative to render an image for the picked idea.'
                  : 'Pick an idea in the middle column, then generate.'}
              </div>
            )}

            {approachResults.map((item, i) => {
              const rawName = item.fileName ?? `creative-approach-${i + 1}.png`;
              const name = rawName.startsWith('aiimg_') ? rawName : `aiimg_${rawName}`;
              return (
                <div key={i} className="flex flex-col gap-2">
                  <div className="text-[10px] font-bold uppercase text-gray-400">
                    Generation #{i + 1}
                  </div>
                  <div className="w-full flex items-center justify-center bg-slate-50 rounded border">
                    <img
                      src={item.url}
                      alt={`Generated creative ${i + 1}`}
                      className="max-h-[480px] w-full object-contain rounded"
                    />
                  </div>
                  {(item.title || item.description) && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                      {item.title && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Title</p>
                          <p className="text-sm text-slate-900">{item.title}</p>
                        </div>
                      )}
                      {item.description && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Description</p>
                          <p className="text-sm text-slate-900 whitespace-pre-wrap">{item.description}</p>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <a
                      href={item.url}
                      download={name}
                      className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors w-fit"
                    >
                      Download
                    </a>
                    <CopyNameButton fileName={name} className="px-3 py-1.5 text-sm" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// Extract an n8n execution id from a webhook response for long-poll pattern. The
// "Respond to FE with execution_id" node returns { job_id: "..." }; older setups may
// use execution_id or id. Returns null when the response is the final result (not a
// job pointer) — then caller parses inline.
function extractJobId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const cand = o.job_id ?? o.execution_id ?? o.id;
  if (typeof cand === 'string' && cand.trim().length > 0) return cand.trim();
  if (typeof cand === 'number') return String(cand);
  return null;
}

// Accepts { ideas: [...] } | { data: [...] } | [...] and returns the raw
// array of idea objects, or null if none of the shapes matched.
function extractIdeasArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.ideas)) return o.ideas as unknown[];
    if (Array.isArray(o.data)) return o.data as unknown[];
  }
  return null;
}

// Accepts a string data-URL, { url, fileName? }, or { images: [{url, ...}] }.
// Falls back to the picked idea's title/description when the response omits them.
function extractApproachResults(data: unknown, picked: Idea): ApproachResult[] {
  const fallbackTitle = picked.title;
  const fallbackDescription = picked.description;

  if (typeof data === 'string') {
    return [{ url: data, title: fallbackTitle, description: fallbackDescription }];
  }
  if (data === null || typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;

  if (typeof o.url === 'string') {
    return [{
      url: o.url,
      fileName: typeof o.fileName === 'string' ? o.fileName : undefined,
      title: typeof o.title === 'string' ? o.title : fallbackTitle,
      description: typeof o.description === 'string' ? o.description : fallbackDescription,
    }];
  }

  if (Array.isArray(o.images)) {
    return (o.images as unknown[])
      .filter((it): it is Record<string, unknown> =>
        it !== null && typeof it === 'object' && typeof (it as Record<string, unknown>).url === 'string',
      )
      .map((it) => ({
        url: it.url as string,
        fileName: typeof it.fileName === 'string' ? it.fileName : undefined,
        title: typeof it.title === 'string' ? (it.title as string) : fallbackTitle,
        description: typeof it.description === 'string' ? (it.description as string) : fallbackDescription,
      }));
  }
  return [];
}

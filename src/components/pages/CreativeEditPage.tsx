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
import { AD_LANGUAGES } from '@/lib/geos';
import { logEvent } from '@/lib/usage';
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
  'потім рендерить банер із обраною ідеєю. Title/Description показуються під зображенням окремим текстом.';

const IDEAS_HELP =
  'Модель пропонує кілька повних наборів (Hook / Accent / CTA / Title / Description) під статтю. Обери один — і згенеруємо банер із ним.';

const RESULT_HELP =
  'Готовий банер із обраної ідеї. Title/Description показуються під зображенням окремим текстом, а не рендеряться на самому банері.';

const LANGUAGE_OPTIONS = ['Keep original language', ...AD_LANGUAGES];

const ASPECT_RATIOS: string[] = ['1:1', '16:9', '9:16', '4:5'];

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

const WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_EDIT_URL as string | undefined;
const ANALYZE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_EDIT_ANALYZE_URL as string | undefined;
const APPROACH_IDEAS_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_APPROACH_IDEAS_URL as
  | string
  | undefined;
const APPROACH_GENERATE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_APPROACH_GENERATE_URL as
  | string
  | undefined;
const TRANSLATE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_TRANSLATE_URL as string | undefined;

type Mode = 'image' | 'approach';

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

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hook, setHook] = useState('');
  const [accent, setAccent] = useState('');
  const [cta, setCta] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [language, setLanguage] = useState('Keep original language');
  const [aspectRatio, setAspectRatio] = useState('1:1');
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

  const prevPreviewUrl = useRef<string | null>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    if (prevPreviewUrl.current) {
      URL.revokeObjectURL(prevPreviewUrl.current);
    }
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      prevPreviewUrl.current = url;
    } else {
      setPreviewUrl(null);
      prevPreviewUrl.current = null;
    }

    return () => {
      if (prevPreviewUrl.current) {
        URL.revokeObjectURL(prevPreviewUrl.current);
        prevPreviewUrl.current = null;
      }
    };
  }, [file]);

  const acceptFile = (picked: File | null) => {
    if (!picked) {
      setFile(null);
      setErrorMessage(null);
      setAnalyzeError(null);
      setResults([]);
      return;
    }
    if (!ACCEPTED_TYPES.includes(picked.type)) {
      setErrorMessage('Unsupported file type. Use PNG, JPG, or WebP.');
      return;
    }
    setFile(picked);
    setErrorMessage(null);
    setAnalyzeError(null);
    setResults([]);
  };

  const handleAnalyze = async () => {
    if (!file) return;

    // meta describes the *input* — never the image bytes (the file can be MBs;
    // meta is capped at 2 KB). The image itself is omitted by design.
    const meta = { fileName: file.name, fileType: file.type, fileSizeKB: Math.round(file.size / 1024) };

    if (!ANALYZE_WEBHOOK) {
      const msg = 'PUBLIC_WEBHOOK_CREATIVE_EDIT_ANALYZE_URL is not configured. Set it in .env.';
      setAnalyzeError(msg);
      logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, errorMessage: msg });
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const imageDataUrl = await fileToDataUrl(file);

      const response = await axios.post<unknown>(ANALYZE_WEBHOOK, {
        image: imageDataUrl,
      });
      const data = response.data;

      if (data === null || typeof data !== 'object') {
        console.error('[CreativeEdit] analyze: unexpected response', data);
        setAnalyzeError('Unexpected analyze response shape');
        logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, metaOut: data, errorMessage: 'Unexpected analyze response shape' });
        return;
      }

      const obj = data as Record<string, unknown>;
      const pick = (k: string): string => (typeof obj[k] === 'string' ? (obj[k] as string) : '');

      const nextHook = pick('hook');
      const nextAccent = pick('accent');
      const nextCta = pick('cta');

      if (!nextHook && !nextAccent && !nextCta) {
        console.error('[CreativeEdit] analyze: no hook/accent/cta in response', data);
        setAnalyzeError('Analyze returned no Hook / Accent / CTA');
        logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, metaOut: data, errorMessage: 'Analyze returned no Hook / Accent / CTA' });
        return;
      }

      setHook(nextHook);
      setAccent(nextAccent);
      setCta(nextCta);
      logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, metaOut: data });
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const msg = axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Analyze failed';
      setAnalyzeError(msg);
      logEvent({ tab: 'creative-edit', action: 'analyzeCreative', meta, metaOut: axiosErr?.response?.data, errorMessage: msg });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0] ?? null);
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
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  };

  const handleGenerate = async () => {
    if (!file || !hook.trim()) return;

    const meta = {
      fileName: file.name,
      hook: hook.trim(),
      accent: accent.trim(),
      cta: cta.trim(),
      imagePrompt: imagePrompt.trim(),
      language: language === 'Keep original language' ? '' : language,
      aspectRatio,
    };

    if (!WEBHOOK) {
      const msg = 'PUBLIC_WEBHOOK_CREATIVE_EDIT_URL is not configured. Set it in .env.';
      setErrorMessage(msg);
      logEvent({ tab: 'creative-edit', action: 'editCreative', meta, errorMessage: msg });
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const imageDataUrl = await fileToDataUrl(file);

      const response = await axios.post<unknown>(WEBHOOK, {
        image: imageDataUrl,
        hook: hook.trim(),
        accent: accent.trim(),
        cta: cta.trim(),
        imagePrompt: imagePrompt.trim(),
        language: language === 'Keep original language' ? '' : language,
        aspectRatio,
      });
      const data = response.data;

      if (typeof data === 'string') {
        setResults((prev) => [...prev, { url: data }]);
        logEvent({ tab: 'creative-edit', action: 'editCreative', meta, metaOut: data });
      } else if (
        data !== null &&
        typeof data === 'object' &&
        'images' in data &&
        Array.isArray((data as { images: unknown }).images)
      ) {
        const raw = (data as { images: unknown[] }).images;
        const items: ResultItem[] = raw
          .filter((item): item is { url: string; fileName?: string } =>
            item !== null && typeof item === 'object' && 'url' in item && typeof (item as { url: unknown }).url === 'string',
          )
          .map((item) => ({ url: item.url, fileName: item.fileName }));
        setResults((prev) => [...prev, ...items]);
        logEvent({ tab: 'creative-edit', action: 'editCreative', meta, metaOut: data });
      } else if (
        data !== null &&
        typeof data === 'object' &&
        'url' in data &&
        typeof (data as { url: unknown }).url === 'string'
      ) {
        const d = data as { url: string; fileName?: string };
        setResults((prev) => [...prev, { url: d.url, fileName: d.fileName }]);
        logEvent({ tab: 'creative-edit', action: 'editCreative', meta, metaOut: data });
      } else {
        console.error('[CreativeEdit] unexpected response', data);
        setErrorMessage('Unexpected response shape');
        logEvent({ tab: 'creative-edit', action: 'editCreative', meta, metaOut: data, errorMessage: 'Unexpected response shape' });
      }
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const msg = axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Generation failed';
      setErrorMessage(msg);
      logEvent({ tab: 'creative-edit', action: 'editCreative', meta, metaOut: axiosErr?.response?.data, errorMessage: msg });
    } finally {
      setIsLoading(false);
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
    setIdeas([]);
    setPickedIdeaId(null);
    setApproachResults([]);

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
        data = await pollExecutionResult(jobId, 'creativeApproachIdeas');
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
    const presentSlots = {
      hook: original.hook.length > 0,
      accent: original.accent.length > 0,
      cta: original.cta.length > 0,
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

  const noFile = !file;
  const hookMissing = !hook.trim();

  let buttonLabel = 'Generate Edited Creative';
  if (isLoading) buttonLabel = 'Generating...';
  else if (noFile) buttonLabel = 'Upload a creative first';
  else if (hookMissing) buttonLabel = 'Enter a Hook first';

  const modeToggle = (
    <div>
      <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400 block mb-1">
        Mode <span className="text-red-500">*</span>
        <InfoTooltip text={MODE_HELP} iconSize={11} />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('image')}
          className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
            mode === 'image'
              ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
              : 'border-input bg-white hover:bg-slate-50'
          }`}
        >
          Change Image
        </button>
        <button
          type="button"
          onClick={() => setMode('approach')}
          className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
            mode === 'approach'
              ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
              : 'border-input bg-white hover:bg-slate-50'
          }`}
        >
          Change Approach
        </button>
      </div>
    </div>
  );

  const uploadBlock = (
    <div>
      <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
        Creative image
      </label>
      <label
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`cursor-pointer flex flex-col items-center justify-center rounded-md border-2 border-dashed px-3 py-4 text-sm font-medium transition-colors w-full text-center ${
          isDragging
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
        }`}
      >
        <span>{file ? 'Replace creative' : 'Upload creative'}</span>
        <span className="mt-0.5 text-[11px] font-normal text-slate-500">
          or drag & drop here
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>
      {file && (
        <p className="mt-1 text-xs text-slate-500 truncate">{file.name}</p>
      )}
      {previewUrl && (
        <img
          src={previewUrl}
          alt="Preview"
          className="mt-2 max-h-40 w-full object-contain rounded border"
        />
      )}
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
        <div>
          <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
            Hook
            <InfoTooltip text={HOOK_HELP} iconSize={11} />
            {mode === 'image' && hookMissing && (
              <span className="ml-1 normal-case font-normal text-red-500">— required</span>
            )}
          </label>
          <Textarea
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            placeholder="Main banner line, 40–55 chars…"
            className="bg-white text-sm resize-none"
          />
        </div>
        <div>
          <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
            Accent
            <InfoTooltip text={ACCENT_HELP} iconSize={11} />
          </label>
          <Textarea
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            placeholder="Second, smaller line under the hook…"
            className="bg-white text-sm resize-none"
          />
        </div>
        <div>
          <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
            CTA
            <InfoTooltip text={CTA_HELP} iconSize={11} />
          </label>
          <Textarea
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            placeholder="Learn More, Read More, Discover More…"
            className="bg-white text-sm resize-none"
          />
        </div>
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
        {isAnalyzing ? 'Analyzing image...' : 'Analyze image'}
      </Button>
      {analyzeError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {analyzeError}
        </div>
      )}
    </>
  );

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
          <h2 className="font-bold text-xl mb-4">Result</h2>

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
                      Generation #{i + 1}
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
                  </div>
                );
              })}
            </div>
          )}

          {isLoading && (
            <div className={`flex flex-col gap-3 ${results.length > 0 ? 'mt-6' : ''}`}>
              <Skeleton className="h-6 w-48 rounded" />
              <Skeleton className="h-64 w-full rounded" />
            </div>
          )}
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
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2 shrink-0">
            3. Generated Creatives
            <InfoTooltip text={RESULT_HELP} />
          </h2>

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

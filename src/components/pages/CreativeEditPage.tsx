import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { HOOK_HELP, ACCENT_HELP, CTA_HELP } from '@/components/ImageGenSettings';

const CREATIVE_EDIT_HELP =
  'Завантаж статичний банер (PNG / JPG / WebP), заповни Hook / Accent / CTA та (опційно) опиши, ' +
  'як скоригувати сам зображення. Отримаєш відредагований варіант банера.';

const IMAGE_PROMPT_HELP =
  'Опційно: підказки для модифікації зображення — наприклад, "зміни фон на синій", ' +
  '"прибери логотип", "зроби CTA-кнопку червоною". Залиш порожнім, якщо хочеш лише оновити тексти.';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_EDIT_URL as string | undefined;
const ANALYZE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_CREATIVE_EDIT_ANALYZE_URL as string | undefined;

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

export const CreativeEditPage = () => {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hook, setHook] = useState('');
  const [accent, setAccent] = useState('');
  const [cta, setCta] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

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

    if (!ANALYZE_WEBHOOK) {
      setAnalyzeError('PUBLIC_WEBHOOK_CREATIVE_EDIT_ANALYZE_URL is not configured. Set it in .env.');
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
        return;
      }

      setHook(nextHook);
      setAccent(nextAccent);
      setCta(nextCta);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      setAnalyzeError(
        axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Analyze failed',
      );
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

    if (!WEBHOOK) {
      setErrorMessage('PUBLIC_WEBHOOK_CREATIVE_EDIT_URL is not configured. Set it in .env.');
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
      });
      const data = response.data;

      if (typeof data === 'string') {
        setResults((prev) => [...prev, { url: data }]);
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
      } else if (
        data !== null &&
        typeof data === 'object' &&
        'url' in data &&
        typeof (data as { url: unknown }).url === 'string'
      ) {
        const d = data as { url: string; fileName?: string };
        setResults((prev) => [...prev, { url: d.url, fileName: d.fileName }]);
      } else {
        console.error('[CreativeEdit] unexpected response', data);
        setErrorMessage('Unexpected response shape');
      }
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      setErrorMessage(
        axiosErr?.response?.data?.message ?? axiosErr?.message ?? 'Generation failed',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const noFile = !file;
  const hookMissing = !hook.trim();

  let buttonLabel = 'Generate Edited Creative';
  if (isLoading) buttonLabel = 'Generating...';
  else if (noFile) buttonLabel = 'Upload a creative first';
  else if (hookMissing) buttonLabel = 'Enter a Hook first';

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      <div className="w-[400px] shrink-0 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
            Creative Edit
            <InfoTooltip text={CREATIVE_EDIT_HELP} />
          </h2>

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

          <Button
            onClick={handleAnalyze}
            variant="outline"
            className="w-full"
            disabled={noFile || isAnalyzing}
          >
            {isAnalyzing ? 'Analyzing image...' : 'Analyze image'}
          </Button>
          {analyzeError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {analyzeError}
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase text-gray-500">Creative text</div>
              {isAnalyzing && (
                <div className="text-[10px] uppercase text-blue-600 animate-pulse">Reading…</div>
              )}
            </div>
            <div>
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                Hook
                <InfoTooltip text={HOOK_HELP} iconSize={11} />
                {hookMissing && (
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
              const name = item.fileName ?? `creative-edit-${i + 1}.png`;
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
                  <a
                    href={item.url}
                    download={name}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors w-fit"
                  >
                    Download
                  </a>
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
};

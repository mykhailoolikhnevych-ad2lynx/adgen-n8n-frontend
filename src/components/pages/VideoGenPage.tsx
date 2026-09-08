import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import {
  MAX_LINE_WORDS, FRAME_COUNT, PROMPT_MODEL, IMAGE_MODEL, VIDEO_MODEL,
  VIDEO_DURATION_SEC, VIDEO_ASPECT_RATIO, VIDEO_RESOLUTION, LEONARDO_VIDEO_MODEL,
  ANIMATE_ASPECT_RATIOS, ANIMATE_VIDEO_MODELS, ANIMATE_MODEL_DEFAULT,
  ANIMATE_PROMPT, animateModelFor, bestResolutionFor, clampResolution,
  nearestAspectRatio, type VideoGenMode,
} from '@/lib/videoGenPrompts';
import { cueAt, toSrt } from '@/lib/captions';
import { burnCaptions, downloadAs, saveBlob } from '@/lib/videoExport';
import { videoGenFileName } from '@/lib/creativeFilename';

type Status = 'idle' | 'loading' | 'success' | 'error';

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Idle',
  loading: 'Working…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<Status, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

const INPUT_HELP =
  'Репліка для ліпсінку + URL статті. Зі статті модель пише 4 різні сцени — різні люди, локації та кадрування.';

const FRAME_HELP =
  'Чотири варіанти першого кадру. Обери той, що подобається, і тисни «Generate video from selected».';

const VIDEO_HELP = 'Обраний кадр, оживлений з твоєю реплікою. Seedance генерує ~5 хвилин.';

const MODE_HELP =
  'From article — модель пише 4 сцени зі статті, рендерить кадри й оживляє обраний з реплікою (ліпсінк). ' +
  'Animate image — завантажуєш готовий статичний банер, і він оживає як є: текст і композиція не змінюються, ' +
  'додається лише легкий рух, підсвітка та фонова музика.';

const ANIMATE_HELP =
  'Завантаж готовий банер (PNG / JPG / WebP) і тисни Generate. Промпт універсальний — ' +
  'нічого описувати не треба, модель дивиться на саме зображення. За потреби промпт можна відредагувати.';

const ANIMATE_RESULT_HELP =
  'Оживлені банери з фоновою музикою, зациклені. Seedance генерує ~5 хвилин. ' +
  'Нові відео додаються знизу й не стирають попередні — прибрати їх можна лише кнопкою Clear results.';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Seedance is picky about the start frame — it wants a direct, non-redirecting
// JPEG or PNG and has rejected WebP outright. Re-encode anything else to PNG
// here rather than discovering it as an opaque provider error five minutes in.
const toFrameDataUrl = async (file: File): Promise<{ dataUrl: string; width: number; height: number }> => {
  const bitmap = await createImageBitmap(file);
  try {
    if (file.type === 'image/png' || file.type === 'image/jpeg') {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('FileReader returned non-string result'));
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(file);
      });
      return { dataUrl, width: bitmap.width, height: bitmap.height };
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
};

const StatusBar = ({ status }: { status: Status }) => (
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

const countWords = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export const VideoGenPage = () => {
  const videoGenLine = useAppStore((s) => s.videoGenLine);
  const videoGenArticleUrl = useAppStore((s) => s.videoGenArticleUrl);
  const videoGenFrames = useAppStore((s) => s.videoGenFrames);
  const videoGenFramesStatus = useAppStore((s) => s.videoGenFramesStatus);
  const videoGenFramesError = useAppStore((s) => s.videoGenFramesError);
  const videoGenSelectedFrameId = useAppStore((s) => s.videoGenSelectedFrameId);
  const videoGenStatus = useAppStore((s) => s.videoGenStatus);
  const videoGenError = useAppStore((s) => s.videoGenError);
  const videoGenResult = useAppStore((s) => s.videoGenResult);
  const setVideoGenLine = useAppStore((s) => s.setVideoGenLine);
  const setVideoGenArticleUrl = useAppStore((s) => s.setVideoGenArticleUrl);
  const selectVideoGenFrame = useAppStore((s) => s.selectVideoGenFrame);
  const generateVideoFrames = useAppStore((s) => s.generateVideoFrames);
  const generateVideo = useAppStore((s) => s.generateVideo);
  const videoGenProvider = useAppStore((s) => s.videoGenProvider);
  const setVideoGenProvider = useAppStore((s) => s.setVideoGenProvider);

  const videoGenCaptions = useAppStore((s) => s.videoGenCaptions);
  const videoGenCaptionsStatus = useAppStore((s) => s.videoGenCaptionsStatus);
  const videoGenCaptionsError = useAppStore((s) => s.videoGenCaptionsError);
  const fetchVideoCaptions = useAppStore((s) => s.fetchVideoCaptions);

  const animateUploadedImage = useAppStore((s) => s.animateUploadedImage);
  const videoGenAnimateStatus = useAppStore((s) => s.videoGenAnimateStatus);
  const videoGenAnimateError = useAppStore((s) => s.videoGenAnimateError);
  const videoGenAnimateResults = useAppStore((s) => s.videoGenAnimateResults);
  const clearVideoGenAnimateResults = useAppStore((s) => s.clearVideoGenAnimateResults);

  const [showPrompt, setShowPrompt] = useState(false);

  // ------------------------------------------------------------- Animate mode
  // Local, not the store: the tab is kept alive across switches, so component
  // state survives just as well, and the File itself has no business in zustand.
  const [mode, setMode] = useState<VideoGenMode>('scene');
  const [animateFile, setAnimateFile] = useState<File | null>(null);
  const [animatePreview, setAnimatePreview] = useState<string | null>(null);
  const [animateDims, setAnimateDims] = useState<{ w: number; h: number } | null>(null);
  const [animateAspect, setAnimateAspect] = useState<string>('9:16');
  const [animateModel, setAnimateModel] = useState<string>(ANIMATE_MODEL_DEFAULT);
  const [animateResolution, setAnimateResolution] = useState<string>(
    bestResolutionFor(animateModelFor(ANIMATE_MODEL_DEFAULT)),
  );

  // The tiers differ per model (2.0-fast has no 1080p, Wan 2.7 has no 480p), so
  // switching models has to move the picked resolution somewhere the new model
  // actually accepts.
  const pickAnimateModel = (value: string) => {
    setAnimateModel(value);
    setAnimateResolution((r) => clampResolution(r, animateModelFor(value)));
  };
  const [animatePrompt, setAnimatePrompt] = useState(ANIMATE_PROMPT);
  const [animateFileError, setAnimateFileError] = useState<string | null>(null);
  // Which clips have their prompt expanded, by execution id — one flag per card
  // rather than one for the whole panel.
  const [shownPrompts, setShownPrompts] = useState<Set<string>>(new Set());
  const toggleClipPrompt = (jobId: string) =>
    setShownPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const prevAnimatePreview = useRef<string | null>(null);

  useEffect(() => {
    if (prevAnimatePreview.current) URL.revokeObjectURL(prevAnimatePreview.current);
    if (animateFile) {
      const url = URL.createObjectURL(animateFile);
      setAnimatePreview(url);
      prevAnimatePreview.current = url;
    } else {
      setAnimatePreview(null);
      prevAnimatePreview.current = null;
    }
    return () => {
      if (prevAnimatePreview.current) {
        URL.revokeObjectURL(prevAnimatePreview.current);
        prevAnimatePreview.current = null;
      }
    };
  }, [animateFile]);

  const acceptAnimateFile = (picked: File | null) => {
    if (!picked) return;
    if (!ACCEPTED_TYPES.includes(picked.type)) {
      setAnimateFileError('Unsupported file type. Use PNG, JPG, or WebP.');
      return;
    }
    setAnimateFileError(null);
    setAnimateFile(picked);
    // Read the real pixels so the ratio sent to the video model matches the
    // banner instead of whatever was last picked.
    void createImageBitmap(picked)
      .then((bmp) => {
        setAnimateDims({ w: bmp.width, h: bmp.height });
        setAnimateAspect(nearestAspectRatio(bmp.width, bmp.height));
        bmp.close();
      })
      .catch(() => setAnimateFileError('Could not read the image dimensions.'));
  };

  const runAnimate = async () => {
    if (!animateFile) return;
    setAnimateFileError(null);
    try {
      const { dataUrl } = await toFrameDataUrl(animateFile);
      await animateUploadedImage({
        imageDataUrl: dataUrl,
        prompt: animatePrompt,
        videoModel: animateModel,
        aspectRatio: animateAspect,
        resolution: animateResolution,
        fileName: animateFile.name,
      });
    } catch (e) {
      setAnimateFileError(e instanceof Error ? e.message : String(e));
    }
  };


  // Driven off the player's own clock so the overlay matches what you hear.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playhead, setPlayhead] = useState(0);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => setPlayhead(el.currentTime);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('seeked', onTime);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('seeked', onTime);
    };
  }, [videoGenResult?.videoUrl]);

  const activeCue = cueAt(videoGenCaptions, playhead);

  const [exportPct, setExportPct] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const downloadSrt = () => {
    const name = videoGenFileName('video', videoGenResult?.jobId ?? 'clip');
    saveBlob(new Blob([toSrt(videoGenCaptions)], { type: 'text/plain;charset=utf-8' }), `${name}.srt`);
  };

  // Animate mode ships the clip as it comes back — there is no spoken line, so
  // nothing to burn in.
  const downloadVideo = async (clip: { videoUrl: string; jobId: string }) => {
    setExportError(null);
    try {
      await downloadAs(clip.videoUrl, `${videoGenFileName('video', clip.jobId)}.mp4`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  };

  const downloadStill = async (url: string, frameId: string) => {
    setExportError(null);
    try {
      await downloadAs(url, `${videoGenFileName('image', frameId)}.png`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  };

  // Real-time render — an 8s clip takes 8s, and the page must stay open.
  const downloadVideoWithCaptions = async () => {
    if (!videoGenResult) return;
    setExportError(null);
    setExportPct(0);
    try {
      const { blob, extension } = await burnCaptions(
        videoGenResult.videoUrl, videoGenCaptions, setExportPct,
      );
      saveBlob(blob, `${videoGenFileName('video', videoGenResult.jobId)}.${extension}`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportPct(null);
    }
  };

  const framesLoading = videoGenFramesStatus === 'loading';
  const videoLoading = videoGenStatus === 'loading';
  const animateLoading = videoGenAnimateStatus === 'loading';
  const busy = framesLoading || videoLoading || animateLoading;
  const animateSpec = animateModelFor(animateModel);

  const words = countWords(videoGenLine);
  const tooLong = words > MAX_LINE_WORDS;
  const urlOk = /^https?:\/\/\S+$/i.test(videoGenArticleUrl.trim());

  let framesLabel = `Generate ${FRAME_COUNT} variants`;
  if (framesLoading) framesLabel = 'Reading article, drawing…';
  else if (words === 0) framesLabel = 'Enter the line to lip-sync';
  else if (!urlOk) framesLabel = 'Paste the article URL';

  const selected = videoGenFrames.find((f) => f.frameId === videoGenSelectedFrameId);

  let videoLabel = 'Generate video from selected';
  if (videoLoading) videoLabel = 'Generating… (~5 min)';
  else if (!selected) videoLabel = 'Pick an image first';

  const modeToggle = (
    <div>
      <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400 mb-1">
        Mode
        <InfoTooltip text={MODE_HELP} iconSize={11} />
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        {([
          ['scene', 'From article'],
          ['animate', 'Animate image'],
        ] as [VideoGenMode, string][]).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            disabled={busy}
            className={`rounded-md border px-2 py-2 text-xs leading-tight transition disabled:opacity-50 ${
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

  // ------------------------------------------------------- Animate image layout
  if (mode === 'animate') {
    let animateLabel = 'Generate video';
    if (animateLoading) animateLabel = 'Generating… (~5 min)';
    else if (!animateFile) animateLabel = 'Upload a creative first';

    return (
      <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
        {/* 1. Input */}
        <div className="w-[400px] shrink-0 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          <div className="flex flex-col gap-4">
            <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
              1. Input
              <InfoTooltip text={ANIMATE_HELP} />
            </h2>

            {modeToggle}

            <div>
              <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                Creative image
              </label>
              <label
                onDragEnter={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  dragCounter.current += 1;
                  if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  dragCounter.current -= 1;
                  if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragging(false); }
                }}
                onDragOver={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  dragCounter.current = 0;
                  setIsDragging(false);
                  acceptAnimateFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={`cursor-pointer flex flex-col items-center justify-center rounded-md border-2 border-dashed px-3 py-4 text-sm font-medium transition-colors w-full text-center ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>{animateFile ? 'Replace creative' : 'Upload creative'}</span>
                <span className="mt-0.5 text-[11px] font-normal text-slate-500">
                  or drag &amp; drop here
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    acceptAnimateFile(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </label>
              {animateFile && (
                <p className="mt-1 text-xs text-slate-500 truncate">
                  {animateFile.name}
                  {animateDims && ` · ${animateDims.w}×${animateDims.h}`}
                </p>
              )}
              {animatePreview && (
                <img
                  src={animatePreview}
                  alt="Preview"
                  className="mt-2 max-h-52 w-full object-contain rounded border bg-slate-50"
                />
              )}
              {animateFileError && (
                <p className="mt-1 text-xs text-red-600">{animateFileError}</p>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span>Model</span>
                <select
                  value={animateModel}
                  onChange={(e) => pickAnimateModel(e.target.value)}
                  disabled={busy}
                  className="text-xs border rounded-md px-2 py-1 bg-white disabled:opacity-50"
                >
                  {ANIMATE_VIDEO_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-between gap-3">
                <span />
                <span className="font-mono text-[10px] text-slate-400 truncate">{animateModel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Aspect ratio</span>
                <select
                  value={animateAspect}
                  onChange={(e) => setAnimateAspect(e.target.value)}
                  disabled={busy}
                  className="text-xs border rounded-md px-2 py-1 bg-white disabled:opacity-50"
                >
                  {ANIMATE_ASPECT_RATIOS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Resolution</span>
                <select
                  value={animateResolution}
                  onChange={(e) => setAnimateResolution(e.target.value)}
                  disabled={busy}
                  className="text-xs border rounded-md px-2 py-1 bg-white disabled:opacity-50"
                >
                  {animateSpec.resolutions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              {/* Duration is not shown: it is always 8s and there is nothing to
                  decide. It still goes to the API as VIDEO_DURATION_SEC. */}
              <p className="text-[11px] text-slate-500 pt-1">
                {animateResolution === bestResolutionFor(animateSpec)
                  ? `The highest ${animateSpec.label} offers — best for keeping banner text sharp.`
                  : 'Cheaper, but softens small text — use it for test runs.'}
              </p>
              {!animateSpec.supportsLastFrame && (
                <p className="text-[11px] text-amber-700">
                  {animateSpec.label} accepts a first frame only, so the loop is asked for in the
                  prompt instead of being pinned by a matching last frame — expect a softer loop.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-[10px] font-bold uppercase text-gray-400">
                  Animation prompt
                </label>
                {animatePrompt !== ANIMATE_PROMPT && (
                  <button
                    type="button"
                    onClick={() => setAnimatePrompt(ANIMATE_PROMPT)}
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    Reset to default
                  </button>
                )}
              </div>
              <Textarea
                value={animatePrompt}
                onChange={(e) => setAnimatePrompt(e.target.value)}
                rows={10}
                className="text-[11px] font-mono leading-relaxed resize-y"
                disabled={busy}
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Universal — it never names what is in the banner, so the same prompt fits any creative.
              </p>
            </div>

            <Button
              onClick={() => void runAnimate()}
              disabled={!animateFile || busy}
              className="w-full"
            >
              {animateLabel}
            </Button>
          </div>
        </div>

        {/* 2. Video */}
        <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
          <div className="flex flex-col gap-4 flex-1 min-h-0">
            {/* Clips accumulate; only this button removes them. Same rule as the
                generated batches in Creative Gen and Creative Edit. */}
            <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
              <h2 className="flex items-center gap-1.5 font-bold text-xl">
                2. Video
                <InfoTooltip text={ANIMATE_RESULT_HELP} />
              </h2>
              {videoGenAnimateResults.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={clearVideoGenAnimateResults}
                  disabled={animateLoading}
                  title="Remove every generated clip from this panel"
                >
                  Clear results ({videoGenAnimateResults.length})
                </Button>
              )}
            </div>

            <StatusBar status={videoGenAnimateStatus} />

            <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
              {videoGenAnimateStatus === 'error' && videoGenAnimateError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap">
                  {videoGenAnimateError}
                </div>
              )}

              {videoGenAnimateResults.length === 0 && !animateLoading && videoGenAnimateStatus !== 'error' && (
                <div className="text-gray-400 italic">Upload a creative and press Generate</div>
              )}

              {videoGenAnimateResults.map((clip, i) => (
                <div key={clip.jobId} className="flex flex-col gap-2">
                  <div className="text-[10px] font-bold uppercase text-gray-400">
                    Generation #{i + 1}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>
                      Video <span className="font-mono text-slate-900">${clip.videoCost.toFixed(4)}</span>
                    </span>
                    <span>Execution <span className="font-mono text-slate-900">{clip.jobId}</span></span>
                    <a href={clip.videoUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                      Open mp4
                    </a>
                  </div>

                  {/* Only the newest clip autoplays — a stack of them all playing
                      at once is unusable. */}
                  <video
                    src={clip.videoUrl}
                    controls
                    loop
                    autoPlay={i === videoGenAnimateResults.length - 1}
                    className="rounded-lg border bg-black w-full max-w-[300px] block"
                  />

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => void downloadVideo(clip)}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      Download video
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleClipPrompt(clip.jobId)}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      {shownPrompts.has(clip.jobId) ? 'Hide' : 'Show'} prompt
                    </button>
                  </div>
                  {shownPrompts.has(clip.jobId) && (
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600 bg-slate-50 border rounded-lg p-2">
                      {clip.prompt}
                    </pre>
                  )}
                </div>
              ))}

              {animateLoading && (
                <div className="text-gray-400 italic">
                  Animating the uploaded banner — Seedance takes about 5 minutes.
                </div>
              )}

              {exportError && <div className="text-xs text-red-600">{exportError}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
            1. Input
            <InfoTooltip text={INPUT_HELP} />
          </h2>

          {modeToggle}

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
            <div className="flex justify-between gap-3"><span>Scenes</span><span className="font-mono text-slate-800 truncate">{PROMPT_MODEL}</span></div>
            <div className="flex justify-between gap-3"><span>Image</span><span className="font-mono text-slate-800 truncate">{IMAGE_MODEL}</span></div>
            <div className="flex justify-between gap-3">
              <span>Video</span>
              <span className="font-mono text-slate-800 truncate">
                {videoGenProvider === 'leonardo' ? LEONARDO_VIDEO_MODEL : VIDEO_MODEL}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <span>Provider</span>
              <div className="flex rounded-md border border-slate-300 overflow-hidden">
                {(['openrouter', 'leonardo'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setVideoGenProvider(p)}
                    disabled={busy}
                    className={`px-2 py-0.5 text-[11px] capitalize transition ${
                      videoGenProvider === p
                        ? 'bg-slate-800 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-100'
                    } disabled:opacity-50`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-between"><span>Format</span><span className="font-mono text-slate-800">{VIDEO_ASPECT_RATIO} · {VIDEO_RESOLUTION} · {VIDEO_DURATION_SEC}s</span></div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Line to lip-sync</label>
            <Textarea
              value={videoGenLine}
              onChange={(e) => setVideoGenLine(e.target.value)}
              placeholder="There are roof repair grants for seniors that many people may not be aware of. Learn more."
              rows={4}
              className="resize-none"
              disabled={busy}
            />
            <p className={`text-xs mt-1 ${tooLong ? 'text-amber-600' : 'text-slate-500'}`}>
              {words} words{tooLong && ` — over ~${MAX_LINE_WORDS}, the model will rush or cut the line off in ${VIDEO_DURATION_SEC}s`}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Article URL</label>
            <Input
              value={videoGenArticleUrl}
              onChange={(e) => setVideoGenArticleUrl(e.target.value)}
              placeholder="https://…/your-advertorial"
              disabled={busy}
            />
            {videoGenArticleUrl.trim() && !urlOk && (
              <p className="text-xs text-amber-600 mt-1">Must be a full http(s) URL.</p>
            )}
          </div>

          <Button
            onClick={() => void generateVideoFrames()}
            disabled={!urlOk || words === 0 || busy}
            className="w-full"
          >
            {framesLabel}
          </Button>

          {videoGenFramesStatus === 'error' && videoGenFramesError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap">
              {videoGenFramesError}
            </div>
          )}
        </div>
      </div>

      {/* 2. First frame (webhook 1 output) */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2 shrink-0">
            2. First frame
            <InfoTooltip text={FRAME_HELP} />
          </h2>

          <StatusBar status={videoGenFramesStatus} />

          <div className="flex-1 min-h-0 overflow-y-auto">
            {videoGenFramesStatus === 'idle' && (
              <div className="text-gray-400 italic">Waiting for input</div>
            )}
            {framesLoading && videoGenFrames.length === 0 && (
              <div className="text-gray-400 italic">
                Reading the article and drawing {FRAME_COUNT} scenes…
              </div>
            )}

            {/* Sized off viewport height, not a fixed width, so all four stay on
                one screen on any monitor: at 9:16 a thumb is 0.5625× its height,
                so two columns of ~34vh-tall stills need ~38vh of width. They are
                pickers, not previews — full size is one click away. */}
            <div className="grid grid-cols-2 gap-2 max-w-[min(38vh,360px)]">
              {videoGenFrames.map((f) => {
                const isSelected = f.frameId === videoGenSelectedFrameId;
                return (
                  <button
                    key={f.frameId}
                    type="button"
                    onClick={() => selectVideoGenFrame(f.frameId)}
                    disabled={busy}
                    title={f.label}
                    className={`text-left rounded-lg border-2 overflow-hidden transition ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-200'
                        : 'border-slate-200 hover:border-slate-400'
                    } disabled:opacity-60`}
                  >
                    <img
                      src={f.url}
                      alt={f.label}
                      className="w-full aspect-[9/16] object-cover bg-slate-50 block"
                    />
                    <span className="block px-1.5 py-1 text-[11px] leading-tight text-slate-600 truncate">
                      {f.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {selected && (
              <div className="mt-2 flex items-center gap-4 text-xs">
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Open selected full size
                </a>
                <button
                  type="button"
                  onClick={() => void downloadStill(selected.url, selected.frameId)}
                  className="text-blue-600 hover:underline"
                >
                  Download still
                </button>
              </div>
            )}
          </div>

          {videoGenFrames.length > 0 && (
            <div className="shrink-0 space-y-2">
              <Button
                onClick={() => void generateVideo()}
                disabled={!selected || busy}
                className="w-full"
              >
                {videoLabel}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Video (webhook 2 output) */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2 shrink-0">
            3. Video
            <InfoTooltip text={VIDEO_HELP} />
          </h2>

          <StatusBar status={videoGenStatus} />

          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            {videoGenStatus === 'idle' && (
              <div className="text-gray-400 italic">Waiting for a picked frame</div>
            )}
            {videoLoading && (
              <div className="text-gray-400 italic">
                Animating the selected still — Seedance takes about 5 minutes.
              </div>
            )}
            {videoGenStatus === 'error' && videoGenError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap">
                {videoGenError}
              </div>
            )}

            {videoGenResult && (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>
                    Video{' '}
                    <span className="font-mono text-slate-900">
                      {videoGenResult.provider === 'leonardo'
                        ? `${videoGenResult.credits} credits`
                        : `$${videoGenResult.videoCost.toFixed(4)}`}
                    </span>
                  </span>
                  <span>Execution <span className="font-mono text-slate-900">{videoGenResult.jobId}</span></span>
                  <a href={videoGenResult.videoUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    Open mp4
                  </a>
                </div>

                {/* Captions sit at ~62% down — clear of TikTok's UI, which
                    covers roughly the bottom quarter of a 9:16 frame. */}
                <div className="relative w-full max-w-[300px]">
                  <video
                    ref={videoRef}
                    src={videoGenResult.videoUrl}
                    controls
                    autoPlay
                    loop
                    className="rounded-lg border bg-black w-full block"
                  />
                  {activeCue && (
                    <div className="pointer-events-none absolute inset-x-0 top-[62%] flex justify-center px-4">
                      <span
                        className="text-center font-extrabold uppercase leading-tight text-white text-[15px] tracking-tight"
                        style={{ textShadow: '0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 0 6px rgba(0,0,0,.9)' }}
                      >
                        {activeCue.text}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {videoGenCaptionsStatus === 'loading' && (
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
                      Reading captions…
                    </span>
                  )}
                  {videoGenCaptionsStatus === 'success' && (
                    <>
                      <span className="text-slate-600">{videoGenCaptions.length} caption lines</span>
                      <button
                        type="button"
                        onClick={() => void downloadVideoWithCaptions()}
                        disabled={exportPct !== null}
                        className="font-medium text-blue-600 hover:underline disabled:text-slate-400"
                      >
                        {exportPct === null
                          ? 'Download video with subtitles'
                          : `Rendering ${Math.round(exportPct * 100)}%…`}
                      </button>
                      <button type="button" onClick={downloadSrt} className="text-blue-600 hover:underline">
                        .srt only
                      </button>
                    </>
                  )}
                  {exportError && <span className="text-red-600">{exportError}</span>}
                  {videoGenCaptionsStatus === 'error' && (
                    <>
                      <span className="text-red-600">{videoGenCaptionsError}</span>
                      <button
                        type="button"
                        onClick={() => void fetchVideoCaptions()}
                        className="text-blue-600 hover:underline"
                      >
                        Retry captions
                      </button>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowPrompt((v) => !v)}
                  className="text-xs text-slate-600 hover:text-slate-900"
                >
                  {showPrompt ? 'Hide' : 'Show'} the video prompt that was sent
                </button>
                {showPrompt && (
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600 bg-slate-50 border rounded-lg p-2">
                    {videoGenResult.prompt}
                  </pre>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import {
  MAX_LINE_WORDS, FRAME_COUNT, PROMPT_MODEL, IMAGE_MODEL, VIDEO_MODEL,
  VIDEO_DURATION_SEC, VIDEO_ASPECT_RATIO, VIDEO_RESOLUTION, LEONARDO_VIDEO_MODEL,
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

  const [showPrompt, setShowPrompt] = useState(false);
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
  const busy = framesLoading || videoLoading;

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

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
            1. Input
            <InfoTooltip text={INPUT_HELP} />
          </h2>

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

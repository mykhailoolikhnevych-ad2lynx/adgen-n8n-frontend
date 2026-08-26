import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  SOURCE_PHOTO_PROMPT, MAX_LINE_WORDS, IMAGE_MODEL, VIDEO_MODEL,
  VIDEO_DURATION_SEC, VIDEO_ASPECT_RATIO, VIDEO_RESOLUTION,
} from '@/lib/videoGenPrompts';

const countWords = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export const VideoGenPage = () => {
  const videoGenLine = useAppStore((s) => s.videoGenLine);
  const videoGenStatus = useAppStore((s) => s.videoGenStatus);
  const videoGenError = useAppStore((s) => s.videoGenError);
  const videoGenResult = useAppStore((s) => s.videoGenResult);
  const setVideoGenLine = useAppStore((s) => s.setVideoGenLine);
  const generateVideo = useAppStore((s) => s.generateVideo);

  const [showPrompt, setShowPrompt] = useState(false);

  const isLoading = videoGenStatus === 'loading';
  const words = countWords(videoGenLine);
  const tooLong = words > MAX_LINE_WORDS;

  let buttonLabel = 'Generate Video';
  if (isLoading) buttonLabel = 'Generating… (~5 min)';
  else if (words === 0) buttonLabel = 'Enter the line to lip-sync';

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* Left: the one input + the hardcoded recipe */}
      <div className="w-[440px] shrink-0 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Video generator</h2>
          <p className="text-xs text-slate-500 mt-1">
            Prototype. One run generates the still from the hardcoded scene prompt, then
            animates it with your line. You only supply the line.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
          <div className="flex justify-between gap-3"><span>Image</span><span className="font-mono text-slate-800 truncate">{IMAGE_MODEL}</span></div>
          <div className="flex justify-between gap-3"><span>Video</span><span className="font-mono text-slate-800 truncate">{VIDEO_MODEL}</span></div>
          <div className="flex justify-between"><span>Duration</span><span className="font-mono text-slate-800">{VIDEO_DURATION_SEC}s</span></div>
          <div className="flex justify-between"><span>Aspect</span><span className="font-mono text-slate-800">{VIDEO_ASPECT_RATIO}</span></div>
          <div className="flex justify-between"><span>Resolution</span><span className="font-mono text-slate-800">{VIDEO_RESOLUTION}</span></div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Line to lip-sync</label>
          <Textarea
            value={videoGenLine}
            onChange={(e) => setVideoGenLine(e.target.value)}
            placeholder="There are roof repair grants for seniors that many people may not be aware of. Learn more."
            rows={4}
            className="resize-none"
            disabled={isLoading}
          />
          <p className={`text-xs mt-1 ${tooLong ? 'text-amber-600' : 'text-slate-500'}`}>
            {words} words{tooLong && ` — over ~${MAX_LINE_WORDS}, the model will rush or cut the line off in ${VIDEO_DURATION_SEC}s`}
          </p>
        </div>

        <Button onClick={() => void generateVideo()} disabled={words === 0 || isLoading} className="w-full">
          {buttonLabel}
        </Button>

        {videoGenStatus === 'error' && videoGenError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap">
            {videoGenError}
          </div>
        )}

        <details className="text-xs">
          <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
            Scene prompt (hardcoded)
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600 bg-slate-50 border rounded-lg p-2">
            {SOURCE_PHOTO_PROMPT}
          </pre>
        </details>
      </div>

      {/* Right: still + clip */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        {videoGenStatus === 'idle' && (
          <p className="text-sm text-slate-400">Nothing generated yet.</p>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
            Generating the still, then the {VIDEO_DURATION_SEC}s clip — Seedance alone takes about 5 minutes.
          </div>
        )}

        {videoGenResult && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
              <span>Image <span className="font-mono text-slate-900">${videoGenResult.imageCost.toFixed(4)}</span></span>
              <span>Video <span className="font-mono text-slate-900">${videoGenResult.videoCost.toFixed(4)}</span></span>
              <span>Total <span className="font-mono text-slate-900 font-semibold">${(videoGenResult.imageCost + videoGenResult.videoCost).toFixed(4)}</span></span>
              <span>Execution <span className="font-mono text-slate-900">{videoGenResult.jobId}</span></span>
            </div>

            <div className="flex flex-wrap gap-4 items-start">
              {videoGenResult.imageUrl && (
                <figure className="space-y-1">
                  <figcaption className="text-xs text-slate-500">Source still</figcaption>
                  <img
                    src={videoGenResult.imageUrl}
                    alt="generated still"
                    className="rounded-lg border bg-slate-50 max-h-[60vh]"
                  />
                </figure>
              )}
              <figure className="space-y-1">
                <figcaption className="text-xs text-slate-500">Clip</figcaption>
                <video
                  src={videoGenResult.videoUrl}
                  controls
                  autoPlay
                  loop
                  className="rounded-lg border bg-black max-h-[60vh]"
                />
              </figure>
            </div>

            <div className="flex gap-4">
              <a
                href={videoGenResult.videoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                Open mp4
              </a>
              {videoGenResult.imageUrl && (
                <a
                  href={videoGenResult.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Open still
                </a>
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
          </div>
        )}
      </div>
    </div>
  );
};

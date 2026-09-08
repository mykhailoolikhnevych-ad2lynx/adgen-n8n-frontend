// Burning captions into the downloaded clip, client-side.
//
// The pipeline has no video encoder anywhere — no ffmpeg, no Execute Command in
// any workflow — so this happens in the browser: play the clip onto a canvas,
// draw the caption over each frame, and record the canvas plus the original
// audio track back out as a file.
//
// The clip is pulled through `fetch` and played from a `blob:` URL rather than
// pointed at directly with `crossOrigin = 'anonymous'`. A blob URL is
// same-origin, so the canvas is never tainted — and, unlike a CORS media load,
// it cannot be poisoned by the opaque cache entry the on-page preview player
// (which sets no `crossOrigin`) leaves behind for the very same URL. That cache
// collision is why the export worked on a dev machine and failed for users.
// `Respond Video` still needs `Access-Control-Allow-Origin` for the fetch, but
// a failure there now surfaces as an HTTP status instead of a bare media error.
//
// Recording is real-time — an 8s clip takes 8s. That is fine at this length and
// buys us the audio track for free, which the alternatives (WebCodecs, mp4box
// demuxing) would each make us reassemble by hand.

import { cueAt, type CaptionCue } from '@/lib/captions';
import { createResampler } from '@/lib/videoResample';

const once = (el: HTMLMediaElement, ev: string): Promise<void> =>
  new Promise((res, rej) => {
    el.addEventListener(ev, () => res(), { once: true });
    el.addEventListener('error', () => {
      // MediaError separates "network died" (2) from "cannot decode" (3) from
      // "nothing here I can play" (4) — without it every cause reads the same.
      const err = el.error;
      const detail = err ? ` — MediaError ${err.code}${err.message ? `: ${err.message}` : ''}` : '';
      rej(new Error(`video failed to load (${ev})${detail}`));
    }, { once: true });
  });

/** First container the browser will actually record. Chrome takes mp4/H.264
 *  these days; everything else falls back to WebM. */
const pickMimeType = (): string => {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
};

export const extensionFor = (mimeType: string): string =>
  mimeType.includes('mp4') ? 'mp4' : 'webm';

// Same look as the on-screen overlay: bold uppercase, white, heavy black
// outline, sitting at 62% of the frame — clear of TikTok's bottom-quarter UI.
const drawCaption = (
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  h: number,
): void => {
  let fontSize = Math.round(h * 0.045);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Shrink rather than wrap — cues are capped at 22 chars, so one line always fits.
  const maxWidth = w * 0.86;
  for (let i = 0; i < 8; i++) {
    ctx.font = `800 ${fontSize}px Inter, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    fontSize = Math.round(fontSize * 0.92);
  }

  const x = w / 2;
  const y = h * 0.62;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, fontSize * 0.22);
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
};

export interface ExportResult {
  blob: Blob;
  extension: string;
}

interface RenderOptions {
  cues?: CaptionCue[];
  /** Resample so the SHORT side lands on this many pixels — "1080p" on a 9:16
   *  clip means 1080x1920, on a 16:9 clip 1920x1080. Omit to keep source size. */
  shortSidePx?: number;
  /** Edge emphasis override. Omit for the scale-aware default. */
  sharpen?: number;
}

const renderToCanvas = async (
  videoUrl: string,
  { cues = [], shortSidePx, sharpen }: RenderOptions,
  onProgress?: (fraction: number) => void,
): Promise<ExportResult> => {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error('This browser cannot record video (MediaRecorder unsupported)');

  const video = document.createElement('video');
  video.src = videoUrl;
  video.playsInline = true;
  await once(video, 'loadedmetadata');

  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) throw new Error('Could not read the clip dimensions');

  // Never scale down and never scale to nothing — a clip already at or above the
  // target is re-encoded at its own size rather than resampled twice.
  const scale = shortSidePx ? Math.max(1, shortSidePx / Math.min(srcW, srcH)) : 1;
  // H.264 wants even dimensions; an odd one makes the encoder pad or refuse.
  const even = (n: number): number => Math.round(n / 2) * 2;
  const w = even(srcW * scale);
  const h = even(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not open a 2D canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // On a genuine upscale, resample on the GPU with a sharper kernel than
  // drawImage's. Captions are drawn with the 2D API, so they keep the canvas
  // path — the two never combine today (an animated banner has no speech), and
  // this stays correct if they ever do. Null means no WebGL2: fall back rather
  // than fail the export.
  const resampler =
    scale > 1 && cues.length === 0 ? createResampler(srcW, srcH, w, h, sharpen) : null;
  const surface = resampler ? resampler.canvas : canvas;

  // Route audio through Web Audio and NOT to the speakers, so exporting stays
  // silent while the recorded stream still carries the voice track.
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(video);
  const destination = audioCtx.createMediaStreamDestination();
  source.connect(destination);

  const stream = new MediaStream([
    ...surface.captureStream(30).getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  // Upscaled output needs the headroom or the resample gets re-crushed by the
  // encoder; ~0.004 bits per pixel-second, floored at the old 8 Mbps.
  const bitrate = Math.max(8_000_000, Math.round(w * h * 30 * 0.004));
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((res) => { recorder.onstop = () => res(); });

  let frame = 0;
  const draw = () => {
    if (video.ended) return;
    if (resampler) {
      resampler.draw(video);
    } else {
      ctx.drawImage(video, 0, 0, w, h);
      const cue = cueAt(cues, video.currentTime);
      if (cue) drawCaption(ctx, cue.text, w, h);
    }
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (++frame % 5 === 0 && dur) onProgress?.(Math.min(1, video.currentTime / dur));
  };

  // Deliberately NOT requestAnimationFrame: rAF stops entirely in a tab that
  // isn't compositing, and the canvas keeps being captured — so switching tabs
  // mid-render silently produces a fully black clip. requestVideoFrameCallback
  // fires per decoded frame where supported, and the interval is the safety net
  // that keeps frames flowing (throttled, but never black) if either stalls.
  const anyVideo = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  let ticking = true;
  const pump = () => {
    if (!ticking) return;
    draw();
    anyVideo.requestVideoFrameCallback?.(pump);
  };
  const timer = window.setInterval(draw, 1000 / 30);

  try {
    recorder.start();
    await video.play();
    pump();
    await once(video, 'ended');
    draw(); // final frame, so the last cue is never clipped
    recorder.stop();
    await stopped;
  } finally {
    ticking = false;
    window.clearInterval(timer);
    void audioCtx.close();
    resampler?.dispose();
  }

  onProgress?.(1);
  return { blob: new Blob(chunks, { type: mimeType }), extension: extensionFor(mimeType) };
};

// Both exports go through a blob: URL rather than the remote one — see the file
// header for why (canvas taint, and the opaque cache entry the preview player
// leaves behind for the same URL).
const renderFromUrl = async (
  videoUrl: string,
  options: RenderOptions,
  onProgress?: (fraction: number) => void,
): Promise<ExportResult> => {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Could not fetch the clip: HTTP ${res.status}`);
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    return await renderToCanvas(objectUrl, options, onProgress);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

/** Renders `videoUrl` with `cues` burned in and resolves with the encoded file.
 *  `onProgress` receives 0..1 as playback advances. */
export const burnCaptions = (
  videoUrl: string,
  cues: CaptionCue[],
  onProgress?: (fraction: number) => void,
): Promise<ExportResult> => renderFromUrl(videoUrl, { cues }, onProgress);

/**
 * Re-renders `videoUrl` so its short side is `shortSidePx`, for delivering a
 * clip that was generated at a cheaper tier.
 *
 * This is a resample, not a restoration: it adds pixels, not detail. A 480p
 * render upscaled to 1080p meets the 1080x1920 the ad platforms ask for, but
 * small banner text will still look soft, because the sharpness was never in
 * the source. To actually get sharp text, generate at 1080p.
 */
export const upscaleVideo = (
  videoUrl: string,
  shortSidePx: number,
  onProgress?: (fraction: number) => void,
  sharpen?: number,
): Promise<ExportResult> => renderFromUrl(videoUrl, { shortSidePx, sharpen }, onProgress);

/** Fetches a cross-origin asset as a blob so the download can carry our own
 *  file name — a plain `<a download>` on another origin is ignored and the
 *  browser just navigates to it instead. */
export const downloadAs = async (url: string, filename: string): Promise<void> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  saveBlob(await res.blob(), filename);
};

export const saveBlob = (blob: Blob, filename: string): void => {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
};

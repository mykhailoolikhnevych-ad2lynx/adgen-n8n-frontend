// Burning captions into the downloaded clip, client-side.
//
// The pipeline has no video encoder anywhere — no ffmpeg, no Execute Command in
// any workflow — so this happens in the browser: play the clip onto a canvas,
// draw the caption over each frame, and record the canvas plus the original
// audio track back out as a file.
//
// REQUIRES CORS on the clip URL. `crossOrigin = 'anonymous'` fails to load
// without `Access-Control-Allow-Origin`, and without it a canvas that has drawn
// the video is tainted and refuses to be captured. The n8n `Respond Video` node
// sends that header for exactly this reason.
//
// Recording is real-time — an 8s clip takes 8s. That is fine at this length and
// buys us the audio track for free, which the alternatives (WebCodecs, mp4box
// demuxing) would each make us reassemble by hand.

import { cueAt, type CaptionCue } from '@/lib/captions';

const once = (el: EventTarget, ev: string): Promise<void> =>
  new Promise((res, rej) => {
    el.addEventListener(ev, () => res(), { once: true });
    el.addEventListener('error', () => rej(new Error(`video failed to load (${ev})`)), { once: true });
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

/** Renders `videoUrl` with `cues` burned in and resolves with the encoded file.
 *  `onProgress` receives 0..1 as playback advances. */
export const burnCaptions = async (
  videoUrl: string,
  cues: CaptionCue[],
  onProgress?: (fraction: number) => void,
): Promise<ExportResult> => {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error('This browser cannot record video (MediaRecorder unsupported)');

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = videoUrl;
  video.playsInline = true;
  await once(video, 'loadedmetadata');

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error('Could not read the clip dimensions');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not open a 2D canvas');

  // Route audio through Web Audio and NOT to the speakers, so exporting stays
  // silent while the recorded stream still carries the voice track.
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(video);
  const destination = audioCtx.createMediaStreamDestination();
  source.connect(destination);

  const stream = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((res) => { recorder.onstop = () => res(); });

  let frame = 0;
  const draw = () => {
    if (video.ended) return;
    ctx.drawImage(video, 0, 0, w, h);
    const cue = cueAt(cues, video.currentTime);
    if (cue) drawCaption(ctx, cue.text, w, h);
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
  }

  onProgress?.(1);
  return { blob: new Blob(chunks, { type: mimeType }), extension: extensionFor(mimeType) };
};

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

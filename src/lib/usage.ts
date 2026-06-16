// Fire-and-forget usage logger. Every async action in the store calls logEvent
// to record what happened. Failures to log NEVER throw — the user's flow is more
// important than the analytics.

import axios from 'axios';
import { getAuthEmail } from '@/lib/identity';

export interface UsageEvent {
  /** Which tab the action lives in: "creatives" | "article" | "keywords" | "angles" | "dashboard". */
  tab: string;
  /** Action name, mirrors the store function: "generateAngles", "generateCreative", etc. */
  action: string;
  /** Lightweight context describing the *input*: geo, language, mode, length, etc.
   *  Keep it small — JSON-stringified into one column. */
  meta?: Record<string, unknown>;
  /** What came back from the webhook (or any other "what did we get"). JSON-stringified
   *  and capped at META_LIMIT chars. If the serialized payload would exceed the limit,
   *  a "[meta_out limit reached: N chars]" notice is sent in place of the content. */
  metaOut?: unknown;
  /** Optional human-readable error message. Trimmed before sending. */
  errorMessage?: string;
}

const LOG_URL = import.meta.env.PUBLIC_WEBHOOK_LOG_EVENT_URL as string | undefined;

// Input context — stays tight; only summary fields.
const META_LIMIT = 2000;
// Webhook response — capped after thumbnailing. At 480 px / q0.6 a thumbnail is
// ~30-60 KB base64, so 300 KB holds a handful of images plus surrounding JSON.
// n8n's data-table reads scale with stored byte count (no column projection),
// so this cap doubles as the list-events speed lever: bigger = sharper images
// but slower reads. The old 20 MB blobs were wedging list-events for 18+ min.
// NOTE: keep this in sync with the n8n "Normalize log row" trim limit.
const META_OUT_LIMIT = 300_000;
const ERROR_LIMIT = 500;

// Target thumbnail dimensions and quality. 480 px gives a crisp lightbox preview
// (the 48×48 grid just downscales it in the browser) while keeping each image to
// ~30-60 KB. Bump to 720 for sharper full-screen at roughly 2x the bytes — and
// raise META_OUT_LIMIT + the n8n Normalize trim to match if you do.
const THUMB_MAX_PX = 480;
const THUMB_QUALITY = 0.6;

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) : s;

// Regex shared between the strip fallback and the thumbnail replacer.
const BASE64_IMG_RE = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g;

// Downscale one base64 data URL to a small JPEG thumbnail using an offscreen
// canvas. Returns the thumbnail data URL on success, or null on any failure
// (corrupt data, canvas unavailable, etc.) so the caller can fall back gracefully.
const downscaleToThumb = (dataUrl: string): Promise<string | null> =>
  new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, THUMB_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight, 1));
          const w = Math.max(1, Math.round(img.naturalWidth  * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width  = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });

// Replace every UNIQUE full-res base64 image in `s` with a ~128 px JPEG
// thumbnail. n8n writes each image twice in the response (once in `images:[]`
// and once in `image_a_url` / `image_b_url`), so we dedupe the source set and
// replace all occurrences of each original in one pass.
//
// Per-image failures are non-fatal: a failing image is replaced with
// '[image_bytes_omitted]' so the rest still go through. This function is only
// called in browser context (typeof document !== 'undefined' is checked before
// calling it).
const thumbnailBase64ImagesInMetaOut = async (s: string): Promise<string> => {
  if (!s.includes('data:image/')) return s;
  const allMatches = s.match(BASE64_IMG_RE) ?? [];
  const uniqueOriginals = Array.from(new Set(allMatches));
  if (uniqueOriginals.length === 0) return s;

  // Build a map of original -> thumbnail (or null on failure) for each unique image.
  const thumbMap = new Map<string, string | null>();
  await Promise.all(
    uniqueOriginals.map(async (orig) => {
      const thumb = await downscaleToThumb(orig);
      thumbMap.set(orig, thumb);
    }),
  );

  // Replace all occurrences of each original with its thumbnail. Images whose
  // conversion failed fall back to a marker so the JSON stays valid and the
  // count is still observable.
  let result = s;
  for (const [orig, thumb] of thumbMap.entries()) {
    // Escape special regex chars in the original data URL (only + and = can
    // appear in base64, neither needs escaping in a character class, but the
    // data: prefix and slashes are safe as literals too). Use a replaceAll via
    // split-join to avoid the regex cost for long strings.
    result = result.split(orig).join(thumb ?? '[image_bytes_omitted]');
  }
  return result;
};

// Serialize an arbitrary value into one Data-Table column. JSON over `limit` is
// dropped in favour of a "limit reached" sentinel — a truncated JSON blob is
// invalid and harder to read than an explicit notice.
// For meta_out the image-replacement step is async and must be done BEFORE
// calling this function (see logEvent below).
const serializeForColumn = (label: string, v: unknown, limit: number): string => {
  if (v == null) return '';
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s.length > limit) {
    return `[${label} limit reached: ${s.length} chars, max ${limit}]`;
  }
  return s;
};

// Prepare the meta_out string for storage: thumbnail full-res images in
// browser context; strip them (old behaviour) in non-browser context (SSR /
// server-side rendering) where the canvas API is unavailable.
const prepareMetaOut = async (raw: string): Promise<string> => {
  if (typeof document === 'undefined') {
    // Non-browser fallback: strip base64 blobs rather than thumbnailing.
    if (!raw.includes('data:image/')) return raw;
    const matches = raw.match(BASE64_IMG_RE) ?? [];
    const unique = new Set(matches).size;
    if (unique === 0) return raw;
    const stripped = raw.replace(BASE64_IMG_RE, '[image_bytes_omitted]');
    return `[base64_images_omitted: ${unique}]\n${stripped}`;
  }
  return thumbnailBase64ImagesInMetaOut(raw);
};

/** Fire a single usage event. Never throws, never blocks the caller. */
export const logEvent = (e: UsageEvent): void => {
  if (!LOG_URL) return; // logger not configured — silently skip
  // Async-but-not-awaited; caller proceeds immediately.
  (async () => {
    try {
      const ident = await getAuthEmail();

      // Serialize meta_out first so we can await the async thumbnail step.
      // All other columns are synchronous and can be built inline below.
      let rawMetaOut = '';
      if (e.metaOut != null) {
        try {
          rawMetaOut = typeof e.metaOut === 'string' ? e.metaOut : JSON.stringify(e.metaOut);
        } catch {
          rawMetaOut = String(e.metaOut);
        }
      }
      // thumbnailBase64ImagesInMetaOut replaces full-res blobs with ~128 px
      // JPEG thumbnails so the dashboard's image preview works without storing
      // megabytes of pixel data in the usage_log data table.
      const thumbnailedMetaOut = await prepareMetaOut(rawMetaOut);
      // Cap AFTER thumbnailing — tiny thumbnails should fit easily within
      // META_OUT_LIMIT, but the sentinel guards against unexpectedly large payloads.
      const meta_out = thumbnailedMetaOut.length > META_OUT_LIMIT
        ? `[meta_out limit reached: ${thumbnailedMetaOut.length} chars, max ${META_OUT_LIMIT}]`
        : thumbnailedMetaOut;

      const body = {
        ts: new Date().toISOString(),
        email: ident?.email ?? 'unknown@unknown',
        tab: e.tab,
        action: e.action,
        meta: serializeForColumn('meta', e.meta, META_LIMIT),
        meta_out,
        error_message: e.errorMessage ? truncate(e.errorMessage, ERROR_LIMIT) : '',
      };
      await axios.post(LOG_URL, body, { timeout: 10_000 });
    } catch {
      // intentionally swallow — analytics must never disrupt UX
    }
  })();
};

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
// Webhook response — capped tight (was 20 MB). Base64 image bytes are
// stripped BEFORE this cap is checked (see stripBase64ImagesFromMetaOut),
// so 100 KB easily fits any realistic JSON/error/log payload. n8n's
// data-table reads scale with stored byte count; a bloated meta_out column
// was wedging list-events for 18+ minutes per fetch.
const META_OUT_LIMIT = 100_000;
const ERROR_LIMIT = 500;

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) : s;

// Strip every `data:image/...;base64,...` blob from meta_out before storing it.
// The dashboard's "See N images" button has no use for these bytes inline —
// they're never displayed unless an admin explicitly clicks expand, and even
// then we'd rather they fetch from n8n's execution log via execution_id than
// duplicate them in the usage_log data table. A leading marker preserves the
// count so analytics can still surface "this event generated N images".
const BASE64_IMG_RE = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g;
const stripBase64ImagesFromMetaOut = (s: string): string => {
  if (!s.includes('data:image/')) return s;
  const matches = s.match(BASE64_IMG_RE) ?? [];
  const unique = new Set(matches).size;
  if (unique === 0) return s;
  const stripped = s.replace(BASE64_IMG_RE, '[image_bytes_omitted]');
  return `[base64_images_omitted: ${unique}]\n${stripped}`;
};

// Serialize an arbitrary value into one Data-Table column. JSON over `limit` is
// dropped in favour of a "limit reached" sentinel — a truncated JSON blob is
// invalid and harder to read than an explicit notice. For meta_out, base64
// image bytes are stripped FIRST so they never count against the limit.
const serializeForColumn = (label: string, v: unknown, limit: number): string => {
  if (v == null) return '';
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (label === 'meta_out') {
    s = stripBase64ImagesFromMetaOut(s);
  }
  if (s.length > limit) {
    return `[${label} limit reached: ${s.length} chars, max ${limit}]`;
  }
  return s;
};

/** Fire a single usage event. Never throws, never blocks the caller. */
export const logEvent = (e: UsageEvent): void => {
  if (!LOG_URL) return; // logger not configured — silently skip
  // Async-but-not-awaited; caller proceeds immediately.
  (async () => {
    try {
      const ident = await getAuthEmail();
      const body = {
        ts: new Date().toISOString(),
        email: ident?.email ?? 'unknown@unknown',
        tab: e.tab,
        action: e.action,
        meta: serializeForColumn('meta', e.meta, META_LIMIT),
        meta_out: serializeForColumn('meta_out', e.metaOut, META_OUT_LIMIT),
        error_message: e.errorMessage ? truncate(e.errorMessage, ERROR_LIMIT) : '',
      };
      await axios.post(LOG_URL, body, { timeout: 10_000 });
    } catch {
      // intentionally swallow — analytics must never disrupt UX
    }
  })();
};

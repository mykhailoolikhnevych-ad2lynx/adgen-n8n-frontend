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

const META_LIMIT = 2000;
const ERROR_LIMIT = 500;

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) : s;

// Serialize an arbitrary value into one Data-Table column. JSON > 2000 chars is
// dropped in favour of a "limit reached" sentinel — a truncated JSON blob is
// invalid and harder to read than an explicit notice.
const serializeForColumn = (label: string, v: unknown): string => {
  if (v == null) return '';
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s.length > META_LIMIT) {
    return `[${label} limit reached: ${s.length} chars, max ${META_LIMIT}]`;
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
        meta: serializeForColumn('meta', e.meta),
        meta_out: serializeForColumn('meta_out', e.metaOut),
        error_message: e.errorMessage ? truncate(e.errorMessage, ERROR_LIMIT) : '',
      };
      await axios.post(LOG_URL, body, { timeout: 10_000 });
    } catch {
      // intentionally swallow — analytics must never disrupt UX
    }
  })();
};

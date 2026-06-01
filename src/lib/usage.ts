// Fire-and-forget usage logger. Every async action in the store wraps itself
// with logEvent(start) on entry and logEvent(success|error) on exit. Failures
// to log NEVER throw — the user's flow is more important than the analytics.

import axios from 'axios';
import { getAuthEmail } from '@/lib/identity';

export type UsageStatus = 'start' | 'success' | 'error';

export interface UsageEvent {
  /** Which tab the action lives in: "creatives" | "article" | "keywords" | "angles" | "dashboard". */
  tab: string;
  /** Action name, mirrors the store function: "generateAngles", "generateCreative", etc. */
  action: string;
  /** Lifecycle marker. "start" fires when the action begins; "success"/"error" when it ends. */
  status: UsageStatus;
  /** Wall-clock duration of the action; only meaningful on success/error. Omit on "start". */
  durationMs?: number;
  /** Whatever lightweight context is useful: geo, language, mode, length, etc.
   *  Keep it small — JSON-stringified into one column. */
  meta?: Record<string, unknown>;
  /** Optional human-readable error message. Trimmed before sending. */
  errorMessage?: string;
}

const LOG_URL = import.meta.env.PUBLIC_WEBHOOK_LOG_EVENT_URL as string | undefined;

const truncate = (s: string, max = 500): string =>
  s.length > max ? s.slice(0, max) : s;

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
        status: e.status,
        duration_ms: e.durationMs ?? null,
        meta: e.meta ? truncate(JSON.stringify(e.meta), 2000) : '',
        error_message: e.errorMessage ? truncate(e.errorMessage) : '',
      };
      await axios.post(LOG_URL, body, { timeout: 10_000 });
    } catch {
      // intentionally swallow — analytics must never disrupt UX
    }
  })();
};

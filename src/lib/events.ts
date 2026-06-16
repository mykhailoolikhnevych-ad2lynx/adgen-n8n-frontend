// On-demand fetcher for a single usage_log row's full meta_out. The list
// endpoint (dev-list-events) deliberately strips base64 payloads to keep the
// response small; this companion endpoint (dev-get-event) returns one row in
// full so the Dashboard's "See N images" button can lazy-load thumbnails.

import axios from 'axios';

const GET_EVENT_URL = import.meta.env.PUBLIC_WEBHOOK_GET_EVENT_URL as string | undefined;
const REQUEST_TIMEOUT = 30_000;

// Identifier for the row. execution_id is preferred (unique per row); ts +
// email are the legacy fallback for rows logged before that column existed.
export interface EventLookup {
  execution_id?: string;
  ts?: string;
  email?: string;
  action?: string;
}

const unwrap = (data: unknown): any => {
  const outer = Array.isArray(data) ? data[0] : data;
  if (outer && typeof outer === 'object' && 'json' in outer) return (outer as any).json;
  return outer;
};

/** Fetch both meta AND meta_out for one usage_log row in a single network call.
 *  Returns empty strings for either field if the row isn't found, so callers
 *  can render an empty state instead of throwing. This is the single source of
 *  truth — both MetaCell and MetaOutCell route through this function so the row
 *  is never fetched twice when both columns are expanded. */
export const fetchEvent = async (
  lookup: EventLookup,
): Promise<{ meta: string; meta_out: string }> => {
  if (!GET_EVENT_URL) {
    throw new Error('PUBLIC_WEBHOOK_GET_EVENT_URL is not set in .env');
  }
  const { data } = await axios.post(GET_EVENT_URL, lookup, { timeout: REQUEST_TIMEOUT });
  const payload = unwrap(data);
  const event = payload?.event ?? payload?.rows?.[0] ?? payload;
  if (!event || typeof event !== 'object') return { meta: '', meta_out: '' };
  return {
    meta:     String(event.meta     ?? ''),
    meta_out: String(event.meta_out ?? ''),
  };
};

/** Fetch the full meta_out for one usage_log row. Delegates to fetchEvent so
 *  there is one source of truth. Kept exported for any external callers that
 *  only need meta_out. */
export const fetchEventMetaOut = async (lookup: EventLookup): Promise<string> =>
  (await fetchEvent(lookup)).meta_out;

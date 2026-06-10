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

/** Fetch the full meta_out for one usage_log row. Resolves to '' if the row
 *  isn't found (so the caller can render an empty state instead of throwing). */
export const fetchEventMetaOut = async (lookup: EventLookup): Promise<string> => {
  if (!GET_EVENT_URL) {
    throw new Error('PUBLIC_WEBHOOK_GET_EVENT_URL is not set in .env');
  }
  const { data } = await axios.post(GET_EVENT_URL, lookup, { timeout: REQUEST_TIMEOUT });
  const payload = unwrap(data);
  const event = payload?.event ?? payload?.rows?.[0] ?? payload;
  if (!event || typeof event !== 'object') return '';
  return String(event.meta_out ?? '');
};

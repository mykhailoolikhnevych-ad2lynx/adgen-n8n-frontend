// Like/dislike feedback on generated creative images (Creative Gen + Creative
// Edit "Change Image" mode). Unlike logEvent (fire-and-forget), saveFeedback
// is awaited so the UI can show success/failure per image.

import axios from 'axios';
import { getAuthEmail } from '@/lib/identity';
import { downscaleToThumb } from '@/lib/usage';

const LOG_URL  = import.meta.env.PUBLIC_WEBHOOK_LOG_FEEDBACK_URL  as string | undefined;
const LIST_URL = import.meta.env.PUBLIC_WEBHOOK_LIST_FEEDBACK_URL as string | undefined;

const REQUEST_TIMEOUT = 15_000;
const LIST_TIMEOUT = 30_000;
const COMMENT_LIMIT = 2000;

export type FeedbackTab = 'creative_gen' | 'creative_edit';
export type FeedbackRating = 'like' | 'dislike';

export interface SaveFeedbackInput {
  /** Stable per-image id, generated client-side when the result appears
   *  (crypto.randomUUID()). Re-votes on the same image upsert this row. */
  feedback_id: string;
  tab: FeedbackTab;
  /** Store action name for this flow: "generateCreativeOnly" | "editCreative". */
  operation: string;
  /** Image model id used for that run. */
  model: string;
  /** e.g. "preset:A", "preset:E2", "custom", "saved:<name>" (Creative Gen), or
   *  "custom" / "none" (Creative Edit). */
  prompt_source: string;
  /** Custom/saved prompt body; empty for standard presets. */
  prompt_text: string;
  /** User's inputs for that run (hook/accent/cta, aspect ratio, etc — NOT
   *  full-size images). Object gets JSON-stringified; string passed through. */
  input: Record<string, unknown> | string;
  /** Creative Edit only — full-res data URL of the uploaded source image.
   *  Thumbnailed here before sending. */
  input_image?: string;
  /** Full-res data URL (thumbnailed here) or a remote https URL (sent as-is)
   *  of the rated image. */
  output_image: string;
  rating: FeedbackRating;
  comment?: string;
}

/** Save (upsert) one feedback row. Awaited — returns true/false so the caller
 *  can show state. Never throws; a missing env var or network failure both
 *  resolve to false. */
export const saveFeedback = async (f: SaveFeedbackInput): Promise<boolean> => {
  if (!LOG_URL) {
    console.warn('[feedback] PUBLIC_WEBHOOK_LOG_FEEDBACK_URL is not set in .env');
    return false;
  }
  try {
    const ident = await getAuthEmail();

    const prepImage = async (img: string | undefined): Promise<string> => {
      if (!img) return '';
      if (!img.startsWith('data:')) return img; // remote URL — send as-is
      return (await downscaleToThumb(img)) ?? '';
    };

    const [output_image, input_image] = await Promise.all([
      prepImage(f.output_image),
      prepImage(f.input_image),
    ]);

    const body = {
      feedback_id: f.feedback_id,
      ts: new Date().toISOString(),
      email: ident?.email ?? 'unknown@unknown',
      tab: f.tab,
      operation: f.operation,
      model: f.model || '',
      prompt_source: f.prompt_source || '',
      prompt_text: f.prompt_text || '',
      input: typeof f.input === 'string' ? f.input : JSON.stringify(f.input ?? {}),
      input_image,
      output_image,
      rating: f.rating,
      comment: (f.comment ?? '').trim().slice(0, COMMENT_LIMIT),
    };
    await axios.post(LOG_URL, body, { timeout: REQUEST_TIMEOUT });
    return true;
  } catch (e) {
    console.warn('[feedback] saveFeedback failed:', e);
    return false;
  }
};

export interface FeedbackRow {
  feedback_id: string;
  ts: string;
  email: string;
  tab: string;
  operation: string;
  model: string;
  prompt_source: string;
  prompt_text: string;
  input: string;
  input_image: string;
  output_image: string;
  rating: string;
  comment: string;
}

/** Row shape returned by listFeedback — images are stripped server-side to
 *  keep the list payload small; has_output_image says whether one exists. */
export type FeedbackListRow = Omit<FeedbackRow, 'input_image' | 'output_image'> & {
  has_output_image: boolean;
};

export interface ListFeedbackParams {
  since?: string;
  until?: string;
  limit?: number;
}

const unwrap = (data: unknown): any => {
  const outer = Array.isArray(data) ? data[0] : data;
  if (outer && typeof outer === 'object' && 'json' in outer) return (outer as any).json;
  return outer;
};

export const listFeedback = async (params: ListFeedbackParams = {}): Promise<FeedbackListRow[]> => {
  if (!LIST_URL) throw new Error('PUBLIC_WEBHOOK_LIST_FEEDBACK_URL is not set in .env');
  const { data } = await axios.post(LIST_URL, params, { timeout: LIST_TIMEOUT });
  const payload = unwrap(data);
  const rows: any[] = Array.isArray(payload?.rows) ? payload.rows
    : Array.isArray(payload) ? payload
    : [];
  return rows;
};

/** Fetch one feedback row in full (including input_image/output_image). */
export const getFeedback = async (feedback_id: string): Promise<FeedbackRow | null> => {
  if (!LIST_URL) throw new Error('PUBLIC_WEBHOOK_LIST_FEEDBACK_URL is not set in .env');
  const { data } = await axios.post(LIST_URL, { id: feedback_id }, { timeout: LIST_TIMEOUT });
  const payload = unwrap(data);
  const row = payload?.row ?? payload?.rows?.[0] ?? payload;
  if (!row || typeof row !== 'object' || !row.feedback_id) return null;
  return row as FeedbackRow;
};

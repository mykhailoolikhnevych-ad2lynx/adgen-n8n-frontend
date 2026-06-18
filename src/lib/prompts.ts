// Shared prompt library. Backed by the DEV Prompt Bases n8n workflow:
//   - PUBLIC_WEBHOOK_LIST_PROMPTS_URL  → returns { prompts: SavedPrompt[] }
//   - PUBLIC_WEBHOOK_SAVE_PROMPT_URL   → upserts one row, returns { ok, prompt }
//   - PUBLIC_WEBHOOK_DELETE_PROMPT_URL → deletes by id, returns { ok }
// All prompts live in n8n's `prompt_bases` Data Table — shared across users so
// what one operator saves, everyone else sees on next list.

import axios from 'axios';
import { getAuthEmail } from '@/lib/identity';

// n8n's Data Table auto-assigns `id` as an integer on insert. We keep the type
// as `string | number` because the user only ever roundtrips it back to the
// save webhook — no client-side arithmetic needed.
export interface SavedPrompt {
  id: string | number;
  name: string;
  prompt: string;
  /** Free-form Ukrainian summary the admin writes by hand. Surfaced as the
   *  InfoTooltip text next to each saved prompt in Column3 so operators see
   *  what the prompt does at a glance, without having to read the body. */
  ua_description?: string;
  /** Optional reference image stored as a downscaled JPEG data URL (max 480 px).
   *  Empty/undefined when no image is set. */
  image?: string;
  updated_at?: string;
  updated_by?: string;
}

const LIST_URL = import.meta.env.PUBLIC_WEBHOOK_LIST_PROMPTS_URL as string | undefined;
const SAVE_URL = import.meta.env.PUBLIC_WEBHOOK_SAVE_PROMPT_URL as string | undefined;
const DELETE_URL = import.meta.env.PUBLIC_WEBHOOK_DELETE_PROMPT_URL as string | undefined;

const REQUEST_TIMEOUT = 15_000;

const missingUrl = (label: string): never => {
  throw new Error(`${label} is not set in .env`);
};

// Helper: n8n returns either { events: [...] } directly, or wrapped as
// [{ json: {...} }] depending on responseMode. Unwrap either case.
const unwrap = (data: unknown): any => {
  const outer = Array.isArray(data) ? data[0] : data;
  if (outer && typeof outer === 'object' && 'json' in outer) return (outer as any).json;
  return outer;
};

/** Fetch the full list of shared prompts, newest first. */
export const listPrompts = async (): Promise<SavedPrompt[]> => {
  if (!LIST_URL) missingUrl('PUBLIC_WEBHOOK_LIST_PROMPTS_URL');
  const { data } = await axios.post(LIST_URL!, {}, { timeout: REQUEST_TIMEOUT });
  const payload = unwrap(data);
  const list: any[] = Array.isArray(payload?.prompts) ? payload.prompts
    : Array.isArray(payload?.rows) ? payload.rows
    : Array.isArray(payload) ? payload
    : [];
  return list
    .filter((r) => r && typeof r === 'object' && r.id != null)
    .map((r) => ({
      id: typeof r.id === 'number' ? r.id : String(r.id),
      name: String(r.name ?? ''),
      prompt: String(r.prompt ?? ''),
      ua_description: r.ua_description ? String(r.ua_description) : undefined,
      image: r.image ? String(r.image) : undefined,
      updated_at: r.updated_at ? String(r.updated_at) : undefined,
      updated_by: r.updated_by ? String(r.updated_by) : undefined,
    }));
};

/** Save (insert or update) a prompt. If `id` is omitted, the workflow lets the
 *  Data Table auto-assign the next integer. Returns the row the server stored
 *  (incl. the assigned id) so the caller can drop it straight into state. */
export const savePrompt = async (input: {
  id?: string | number;
  name: string;
  prompt: string;
  ua_description?: string;
  image?: string;
}): Promise<SavedPrompt> => {
  if (!SAVE_URL) missingUrl('PUBLIC_WEBHOOK_SAVE_PROMPT_URL');
  const ident = await getAuthEmail();
  // Send `id` ONLY when editing — for new prompts we omit it so n8n's auto-id
  // kicks in. Sending `""` would otherwise hit the Upsert's `id` matcher with
  // an empty string and silently misbehave.
  const body: Record<string, unknown> = {
    name: input.name,
    prompt: input.prompt,
    ua_description: input.ua_description ?? '',
    image: input.image ?? '',
    email: ident?.email ?? 'unknown@unknown',
  };
  if (input.id != null && String(input.id).trim() !== '') {
    body.id = input.id;
  }
  const { data } = await axios.post(SAVE_URL!, body, { timeout: REQUEST_TIMEOUT });
  const payload = unwrap(data);
  // With responseMode=lastNode the Upsert prompt node is the terminal, so the
  // response IS the saved row. Older wiring nested it as { prompt: {...} } —
  // we tolerate either shape.
  const saved = payload?.prompt ?? payload ?? {};
  return {
    id: saved.id ?? input.id ?? '',
    name: String(saved.name ?? input.name),
    prompt: String(saved.prompt ?? input.prompt),
    ua_description: saved.ua_description != null
      ? String(saved.ua_description)
      : input.ua_description,
    image: saved.image ?? input.image ?? undefined,
    updated_at: saved.updated_at ? String(saved.updated_at) : undefined,
    updated_by: saved.updated_by ? String(saved.updated_by) : undefined,
  };
};

/** Delete a prompt by id. Resolves on success; rejects with the axios error on failure. */
export const deletePrompt = async (id: string | number): Promise<void> => {
  if (!DELETE_URL) missingUrl('PUBLIC_WEBHOOK_DELETE_PROMPT_URL');
  await axios.post(DELETE_URL!, { id }, { timeout: REQUEST_TIMEOUT });
};

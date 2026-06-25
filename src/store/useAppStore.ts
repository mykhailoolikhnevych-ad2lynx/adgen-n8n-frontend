import { create } from 'zustand';
import axios from 'axios';
import { buildCreativeFilename, type CreativeFileMeta } from '@/lib/creativeFilename';
import { logEvent } from '@/lib/usage';
import { listPrompts, type SavedPrompt } from '@/lib/prompts';
import { getAuthEmail } from '@/lib/identity';

interface FormData {
  articleUrl: string;
  keyword1: string;
  keyword2: string;
  keyword3: string;
  geo: string;
  buyer: string;
  campaignName: string;
}

interface AngleTranslation {
  direction: string;
  hookSeed: string;
  whyWorks: string;
}
interface Angle {
  id: string;
  slot: number;
  direction: string;
  whyWorks: string;
  hookSeed: string;
  code: string;
  trigger: string;
  awarenessLevel: string;
  emotionalAnchor: string;
  raw?: any;
  translation?: AngleTranslation;
  isTranslating?: boolean;
  showTranslation?: boolean;
}
interface ConceptTranslation {
  hook: string;
  accent: string;
  cta: string;
  metaTitle: string;
  metaCopy: string;
}
interface Concept {
  id: string;
  hook: string;
  accent: string;
  cta: string;
  metaTitle: string;
  metaCopy: string;
  formula: string;
  formulaName: string;
  aspectTested: string;
  aspectCategory: string;
  compliant: boolean;
  complianceType: string;
  complianceDescription: string;
  policyReference: string;
  sourceAngle?: Angle;
  raw?: any;
  translation?: ConceptTranslation;
  isTranslating?: boolean;
  showTranslation?: boolean;
}
export interface ImageVariant {
  url: string;
  style: string;
  metaTitle: string;
  metaCopy: string;
  cta: string;
  fileName?: string;
  /** Per-image compliance verdict from the Compliance Agent (Image) — n8n only
   *  runs this for Preset Custom / Saved variants. Standard presets (A/B/C/D)
   *  default to compliant: true with empty reason fields. */
  compliant?: boolean;
  complianceType?: string;
  complianceDescription?: string;
  policyReference?: string;
  /** True if this variant was actually audited (Custom / Saved). False when
   *  the variant bypassed the check (A/B/C/D). Lets the UI distinguish
   *  'checked & passed' from 'never checked' so we don't claim every standard
   *  preset is compliant when no audit happened. */
  complianceChecked?: boolean;
}
interface CreativeTranslation {
  metaTitle: string;
  metaCopy: string;
  cta: string;
}
export interface Creative {
  id: string;
  metaTitle: string;
  metaCopy: string;
  cta: string;
  images: ImageVariant[];
  isLoading?: boolean;
  isSending?: boolean;
  isSent?: boolean;
  chosenAngle?: any;
  chosenCreative?: any;
  translation?: CreativeTranslation;
  isTranslating?: boolean;
  showTranslation?: boolean;
  fileMeta?: CreativeFileMeta;
  /** Where the batch came from. 'creativeOnly' = the Creative Gen tab (typed
   *  Hook/Accent/CTA, no pipeline); undefined = the classic Creatives tab.
   *  Column4 filters on this so the two tabs never show each other's batches. */
  origin?: 'creativeOnly';
}

// === Angles tab — RSOC Audiences & Top-Pick Headlines (two-step HITL flow) ===
export interface RsocAudienceTranslation {
  segment_name: string;
  description: string;
  pain_points: string[];
  desires: string[];
  vocab_to_use: string[];
}
export interface RsocAudience {
  segment_id: string;
  segment_name: string;
  description: string;
  demographics: string;
  psychographics: string;
  pain_points: string[];
  desires: string[];
  objections: string[];
  vocab_to_use: string[];
  notes: string;
  translation?: RsocAudienceTranslation;
  isTranslating?: boolean;
  showTranslation?: boolean;
}
// Everything webhook 1 hands back — passed verbatim into webhook 2 alongside `picked`.
export interface RsocBundle {
  keyword: string;
  geo: string;
  language: string;
  research: string;
  audiences: RsocAudience[];
}
export interface RsocHeadline {
  rank: number;
  audience: string;
  angle_formula: string;
  headline_kernel: string;
  headline: string;
  translation_ua: string;
  headline_id: string;
}
export interface RsocAudiencesInput {
  anchor: string;
  geo: string;
  gl: string; // Google SERP country code (e.g. "us", "ca", "gb") — drives the SearchApi fetch.
  language: string;
  translation: 'auto' | 'none';
}

interface ErrorBanner { message: string; count: number; }
interface NoticeBanner { message: string; }

export type ArticleStatus = 'idle' | 'loading' | 'success' | 'error';

// MEGATOOL — FB Campaign Reader. Mirrors the n8n workflow's success payload
// (data field of `{ ok: true, tokenIndex, data: {...}, totalAds }`).
export interface FbCreativeLinkData {
  link?: string;
  message?: string;
  name?: string;
  image_hash?: string;
  picture?: string;
  call_to_action?: { type?: string; value?: { link?: string } };
}
export interface FbCreative {
  id: string;
  name?: string;
  thumbnail_url?: string;
  image_url?: string;
  title?: string;
  body?: string;
  call_to_action_type?: string;
  link_url?: string;
  object_story_spec?: { link_data?: FbCreativeLinkData; video_data?: any };
  url_tags?: string;
  effective_object_story_id?: string;
}
export interface FbAd {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  creative: FbCreative;
}
export interface FbAdset {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  targeting?: any;
  promoted_object?: any;
  start_time?: string;
  end_time?: string;
  ads: FbAd[];
}
export interface FbCampaign {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  account_id?: string;
  [key: string]: any;
}
export interface FbCampaignData {
  campaign: FbCampaign;
  adsets: FbAdset[];
  totalAds: number;
  tokenIndex?: number;
}

// MEGATOOL — selected ad snapshot, kept at store level so it survives sub-tab
// switches between FB Campaign Reader and Create Binom Offer.
export interface SelectedFbAd {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  trackingUrl: string;
  thumbnailUrl: string;
  creativeTitle: string;
  creativeBody: string;
}

// MEGATOOL — Create Binom Offer response shape (success branch of the n8n webhook).
export interface BinomOfferResult {
  ok: true;
  tracker?: string;
  domain?: string;
  binomOfferIds: string[];
  binomCampaignId: string;
  binomCampaignUrl: string;
  binomCampaignName?: string;
  originalCampaignId?: string;
  originalKey?: string;
  [key: string]: any;
}

export interface CreateBinomOfferInput {
  trackingUrl: string;
  newAmoDomain: string;
  newAmoChannel: string;
  newBinomGroup: string;
  isRoas?: boolean;
}

// MEGATOOL — Create NB Campaign response shape (success branch).
export interface NbCampaignResult {
  nbAccountId: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  campaignName: string;
  assetUrl: string;
}

export interface CreateNbCampaignInput {
  nbAccountId: string;
  campaignName: string;
  headline: string;
  body: string;
  callToAction: string;
  brandName: string;
  assetUrl: string;
  clickThroughUrl: string;
  budget: number;
  startDate: 'now' | 'tomorrow' | 'tomorrow+1' | 'tomorrow+2';
  trackingId?: string;
  roas?: number | null;
}

interface AppState {
  formData: FormData;
  angles: Angle[];
  agent1Output: string;
  operatorNote: string;
  article: string;
  imageGenerationModel: string;
  adLanguage: string;
  aspectRatio: string;
  /** Which image presets to generate. n8n filters by these IDs:
   *  'A' YT Thumbnail · 'B' Organic Social · 'C' Highlight Block · 'D' Illustrated · 'Custom' */
  selectedPresets: string[];
  /** Optional user-authored prompt; only used when 'Custom' is in selectedPresets. */
  customPrompt: string;
  /** Which scaffolding blocks to include in the Custom preset prompt. n8n's Preset
   *  Custom node assembles the final prompt as: [TR][Scene][user design direction]
   *  [Hook][Accent][CTA][UF] — each block included only if its flag is true. Default
   *  is all true so a fresh user gets the same building blocks as Presets A/B/C/D. */
  customBlocks: CustomBlocks;
  /** Pre-authored prompts pulled from the shared `prompt_bases` library — one
   *  per row in the Docs → Prompt Bases tab. Loaded on demand from Column3. */
  savedPrompts: SavedPrompt[];
  savedPromptsStatus: ArticleStatus;
  /** IDs of saved prompts the operator picked in Column3's Image presets — each
   *  selected entry produces its own image in the n8n batch, with {hook} /
   *  {accent} / {cta} substituted from chosen_creative. Stored as strings even
   *  when n8n's id is an integer, for stable Set semantics. */
  selectedSavedPromptIds: string[];
  concepts: Concept[];
  creatives: Creative[];
  isLoadingAngles: boolean;
  isLoadingConcepts: boolean;
  isLoadingCreatives: boolean;
  /** Creative Gen tab — the three typed inputs that drive generateCreativeOnly. */
  creativeOnlyHook: string;
  creativeOnlyAccent: string;
  creativeOnlyCta: string;
  /** Loading flag for the Creative Gen tab — separate from isLoadingCreatives so
   *  a run here never disables the classic Creatives tab's buttons (and vice versa). */
  isLoadingCreativeOnly: boolean;
  articleHtml: string | null;
  articleStatus: ArticleStatus;
  articleError: string | null;
  /** Snapshot of the inputs that produced articleHtml — used by the Offer Article
   *  tab to pre-fill `name` (topic), `offer_country_code` (geo) etc. without
   *  making the operator re-type them. */
  articleInputs: { topic: string; geo: string; language: string } | null;
  /** Controls whether the "Offer Article" tab is shown in the nav. Set to true
   *  when the operator presses "Create Offer Article" on the Article tab; reset
   *  by the new tab's close button. */
  offerArticleOpen: boolean;
  /** Live RSOC API options (pixels, campaign groups, amo domains, layouts)
   *  per the authenticated user. Cached for the session — loadOfferOptions is
   *  a no-op once we have a non-null value. Falls back to hardcoded constants
   *  in OfferArticlePage when null/empty. */
  offerOptions: OfferOptions | null;
  offerOptionsStatus: ArticleStatus;
  offerOptionsError: string | null;
  /** Cached UA version of articleHtml, built on first toggle by translating the
   *  h1/h2/h3/p/li text via the shared /translate_uk webhook. Null until requested. */
  articleTranslatedHtml: string | null;
  articleIsTranslating: boolean;
  articleShowTranslation: boolean;
  keywordHtml: string | null;
  keywordStatus: ArticleStatus;
  keywordError: string | null;
  // MEGATOOL — FB Campaign Reader state.
  fbCampaignStatus: ArticleStatus;
  fbCampaignData: FbCampaignData | null;
  fbCampaignError: string | null;
  // MEGATOOL — Selected ad (from FB Campaign Reader) + Create Binom Offer flow.
  selectedFbAd: SelectedFbAd | null;
  binomOfferOpen: boolean;
  binomOfferStatus: ArticleStatus;
  binomOfferResult: BinomOfferResult | null;
  binomOfferError: string | null;
  // MEGATOOL — Create NB Campaign flow (third sub-tab, gated on binomOfferResult).
  nbCampaignOpen: boolean;
  nbCampaignStatus: ArticleStatus;
  nbCampaignResult: NbCampaignResult | null;
  nbCampaignError: string | null;
  nbAccountsStatus: ArticleStatus;
  nbAccountsList: { name: string; id: string }[];
  nbAccountsError: string | null;
  rsocBundle: RsocBundle | null;
  rsocAudiencesStatus: ArticleStatus;
  rsocAudiencesError: string | null;
  rsocHeadlines: RsocHeadline[];
  rsocHeadlinesStatus: ArticleStatus;
  rsocHeadlinesError: string | null;
  errorBanner: ErrorBanner | null;
  noticeBanner: NoticeBanner | null;
  updateFormData: (field: keyof FormData, value: string) => void;
  updateAngle: (id: string, field: keyof Angle, value: string) => void;
  updateConcept: (id: string, field: keyof Concept, value: string) => void;
  updateCreative: (id: string, field: keyof Creative, value: string) => void;
  deleteCreative: (id: string) => void;
  clearConcepts: () => void;
  generateAngles: () => Promise<void>;
  generateArticle: (input: { topic: string; geo: string; language: string; mode: string }) => Promise<void>;
  generateKeywords: (input: KeywordStudioInput) => Promise<void>;
  fetchFbCampaign: (campaignId: string) => Promise<void>;
  resetFbCampaign: () => void;
  setSelectedFbAd: (ad: SelectedFbAd | null) => void;
  clearSelectedFbAd: () => void;
  openBinomOffer: () => void;
  closeBinomOffer: () => void;
  resetBinomOffer: () => void;
  createBinomOffer: (input: CreateBinomOfferInput) => Promise<void>;
  openNbCampaign: () => void;
  closeNbCampaign: () => void;
  resetNbCampaign: () => void;
  createNbCampaign: (input: CreateNbCampaignInput) => Promise<void>;
  fetchNbAccounts: () => Promise<void>;
  generateRsocAudiences: (input: RsocAudiencesInput) => Promise<void>;
  generateRsocHeadlines: (pickedIds: string[]) => Promise<void>;
  toggleRsocAudienceTranslation: (segmentId: string) => Promise<void>;
  generateConcept: (angleId: string) => Promise<void>;
  generateCreative: (conceptId: string) => Promise<void>;
  setCreativeOnlyHook: (value: string) => void;
  setCreativeOnlyAccent: (value: string) => void;
  setCreativeOnlyCta: (value: string) => void;
  /** Creative Gen tab — generate a batch straight from the typed Hook/Accent/CTA
   *  + the shared image settings, via the dedicated creative-only n8n workflow. */
  generateCreativeOnly: () => Promise<void>;
  sendToTelegram: (creativeId: string) => Promise<void>;
  toggleAngleTranslation: (angleId: string) => Promise<void>;
  toggleConceptTranslation: (conceptId: string) => Promise<void>;
  toggleCreativeTranslation: (creativeId: string) => Promise<void>;
  /** Article tab — translate the rendered article HTML to UA on first toggle,
   *  cache, then just flip visibility on later toggles. Same UX as the angle/
   *  concept/creative cards. */
  toggleArticleTranslation: () => Promise<void>;
  /** Article tab → reveal the "Offer Article" tab in the nav. Called when the
   *  operator presses "Create Offer Article" after a successful generation. */
  openOfferArticle: () => void;
  /** Hide the "Offer Article" tab again (X button on that tab). */
  closeOfferArticle: () => void;
  /** Fetch /api/rsoc-articles/options via the n8n proxy and cache for the
   *  session. Safe to call on every Offer Article mount — no-ops when we
   *  already have a cached result. */
  loadOfferOptions: () => Promise<void>;
  showError: (message: string) => void;
  dismissError: () => void;
  showWarning: (message: string) => void;
  dismissNotice: () => void;
  setImageGenerationModel: (value: string) => void;
  setAdLanguage: (value: string) => void;
  setAspectRatio: (value: string) => void;
  setSelectedPresets: (value: string[]) => void;
  setCustomPrompt: (value: string) => void;
  setCustomBlocks: (value: CustomBlocks) => void;
  setSelectedSavedPromptIds: (value: string[]) => void;
  /** Fetch the shared prompt library and cache it on the store. Safe to call
   *  multiple times — re-fetches on every call so a fresh save in Docs becomes
   *  visible in Column3 without a hard refresh. */
  loadSavedPrompts: () => Promise<void>;
}

export interface CustomBlocks {
  textRules: boolean;
  scene: boolean;
  hook: boolean;
  accent: boolean;
  cta: boolean;
  forbidden: boolean;
}

let _noticeTimer: ReturnType<typeof setTimeout> | null = null;

const isRetryableError = (e: any): boolean => {
  if (e?.response?.status === 504) return true;
  if (e instanceof SyntaxError) return true;
  if (e instanceof Error && /missing|invalid|parse|unexpected/i.test(e.message)) return true;
  return false;
};

const humanizeError = (e: any): string => {
  if (e?.response?.status === 504) return '504 Gateway Timeout';
  if (e instanceof SyntaxError) return 'Invalid JSON in response';
  if (e instanceof Error) return e.message;
  return String(e);
};

const WEBHOOKS = {
  angles: import.meta.env.PUBLIC_WEBHOOK_ANGLES_URL,
  concept: import.meta.env.PUBLIC_WEBHOOK_CONCEPT_URL,
  creative: import.meta.env.PUBLIC_WEBHOOK_CREATIVE_URL,
  // Creative Gen tab — separate n8n workflow (same image logic, no pipeline context).
  creativeOnly: import.meta.env.PUBLIC_WEBHOOK_CREATIVE_ONLY_URL,
  telegram: import.meta.env.PUBLIC_WEBHOOK_TELEGRAM_URL,
  translate: import.meta.env.PUBLIC_WEBHOOK_TRANSLATE_URL,
  article: import.meta.env.PUBLIC_WEBHOOK_ARTICLE_URL,
  keywords: import.meta.env.PUBLIC_WEBHOOK_KEYWORDS_URL,
  rsocAudiences: import.meta.env.PUBLIC_WEBHOOK_RSOC_AUDIENCES_URL,
  rsocHeadlines: import.meta.env.PUBLIC_WEBHOOK_RSOC_HEADLINES_URL,
  rsocOptions: import.meta.env.PUBLIC_WEBHOOK_RSOC_OPTIONS_URL,
  fbCampaignReader: import.meta.env.PUBLIC_WEBHOOK_FB_CAMPAIGN_READER_URL,
  binomOfferCreator: import.meta.env.PUBLIC_WEBHOOK_BINOM_OFFER_CREATOR_URL,
  nbCampaignCreator: import.meta.env.PUBLIC_WEBHOOK_NB_CAMPAIGN_CREATOR_URL,
  nbAccountsList: import.meta.env.PUBLIC_WEBHOOK_NB_ACCOUNTS_LIST_URL,
};

export interface KeywordStudioInput {
  country: string;
  countryName: string;
  language: string;
  languageName: string;
  anchor: string;
  translation: 'auto' | 'none';
}

// Shape mirrors response_1782144242145.json under .data
export interface OfferOptions {
  base_fields?: {
    traffic_source_slug?: Record<string, string>;
    article_source?: Record<string, string>;
    provider_slugs?: Record<string, string>;
  };
  tracker_fields?: {
    campaign_pixel?: Record<string, string>;
    campaign_conversion_event?: Record<string, string>;
    offer_country_code?: Record<string, string>;
    campaign_source?: Record<string, string>;
    campaign_group_uuid?: Record<string, string>;
  };
  provider_fields?: {
    amo?: {
      domain?: Record<string, Record<string, string>>;
      tracker_offer_url_layout?: Record<string, string>;
    };
  };
  status?: Record<string, string>;
}

// Shared helper — POSTs an object of strings to /translate_uk, returns translated object.
const postTranslateUk = async <T extends Record<string, string>>(payload: T): Promise<T> => {
  if (!WEBHOOKS.translate) {
    throw new Error('PUBLIC_WEBHOOK_TRANSLATE_URL is not set in .env');
  }
  const { data } = await axios.post(WEBHOOKS.translate, payload);
  const outer = Array.isArray(data) ? data[0] : data;
  // n8n may wrap as { json: {...} } when responseMode=lastNode passes through structured output
  const result = (outer && typeof outer === 'object' && 'json' in outer && outer.json) ? outer.json : outer;
  return result as T;
};

const N8N_EXECUTIONS_URL = import.meta.env.PUBLIC_N8N_EXECUTIONS_URL;
const N8N_EXECUTIONS_API_KEY = import.meta.env.PUBLIC_N8N_EXECUTIONS_API;
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60; // 5 minutes

// Treat an execution as "done" for both success and failure. n8n 1.x sets
// finished=true on errored runs too, but older versions left finished=false and
// only populated stoppedAt — so we OR both signals together to avoid polling
// the full 300s on a workflow that already errored out 3 seconds in.
const isExecutionDone = (meta: any): boolean => {
  if (!meta) return false;
  if (meta.finished === true) return true;
  const s = String(meta.status ?? '').toLowerCase();
  if (s === 'error' || s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'crashed') return true;
  if (meta.stoppedAt && s !== 'running' && s !== 'new') return true;
  return false;
};

// Pull a human-readable error out of an n8n execution payload. Returns null when
// the execution actually succeeded.
const extractExecutionError = (full: any): string | null => {
  const status = String(full?.status ?? '').toLowerCase();
  if (status === 'success') return null;
  const r = full?.data?.resultData;
  const err: any = r?.error;
  const nodeMsg: string | undefined =
    err?.message ?? err?.description ?? err?.cause?.message ?? err?.stack?.split('\n')[0];
  const nodeName: string | undefined = err?.node?.name ?? err?.node?.type;
  if (nodeMsg) {
    return nodeName ? `${nodeMsg} — in node "${nodeName}"` : nodeMsg;
  }
  // No structured error → fall back to whatever status n8n reported.
  return `Execution ${status || 'failed'}`;
};

// Shared helper for the "Respond job_id" async pattern: poll the n8n executions
// API until the run finishes, then return the JSON of the last node that ran.
// Used by RSOC Audiences / Headlines and (soon) any other long-running webhook
// that would otherwise hit Cloudflare's ~100s edge cap.
const pollExecutionResult = async (jobId: string, label: string): Promise<any> => {
  if (!N8N_EXECUTIONS_URL) {
    throw new Error('PUBLIC_N8N_EXECUTIONS_URL is not set in .env');
  }
  const apiHeaders = N8N_EXECUTIONS_API_KEY
    ? { 'X-N8N-API-KEY': N8N_EXECUTIONS_API_KEY }
    : undefined;
  const metaUrl = `${N8N_EXECUTIONS_URL}/${jobId}`;
  const fullUrl = `${N8N_EXECUTIONS_URL}/${jobId}?includeData=true`;

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let meta: any;
    try {
      const res = await axios.get(metaUrl, { headers: apiHeaders });
      meta = res.data;
    } catch (e) {
      // transient poll failure — log and try again on the next tick
      console.warn(`[${label}] poll error (will keep polling):`, e);
      continue;
    }
    if (!isExecutionDone(meta)) continue;

    const res = await axios.get(fullUrl, { headers: apiHeaders });
    const full = res.data;
    const errMessage = extractExecutionError(full);
    if (errMessage) throw new Error(errMessage);
    const lastNode = full?.data?.resultData?.lastNodeExecuted;
    const json = full?.data?.resultData?.runData?.[lastNode]?.[0]?.data?.main?.[0]?.[0]?.json;
    if (!json) {
      throw new Error('Execution finished but the last node returned no result');
    }
    return json;
  }
  throw new Error(
    `Polling timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
  );
};

// === Creative-batch helpers — shared by generateCreative (Creatives tab) and
// === generateCreativeOnly (Creative Gen tab). Both workflows end in the same
// === Aggregate Images node shape, so polling and image extraction are identical.

// Poll one creative execution until it finishes, then merge the output of
// "Aggregate Images" (or, failing that, lastNodeExecuted) into a single result
// object. Walks every run of the chosen node so per-item Code-node executions
// don't lose images. Returns null when shouldAbort() reports the owning card
// was deleted mid-poll. Throws on execution error / missing result / timeout;
// when n8n supplied a structured error body it's attached as `responseBody`
// so the caller can forward it to the usage log.
const pollCreativeExecution = async (
  jobId: string,
  shouldAbort: () => boolean,
): Promise<any | null> => {
  const apiHeaders = { 'X-N8N-API-KEY': N8N_EXECUTIONS_API_KEY };
  const metaUrl = `${N8N_EXECUTIONS_URL}/${jobId}`;
  const fullUrl = `${N8N_EXECUTIONS_URL}/${jobId}?includeData=true`;

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (shouldAbort()) return null;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    let meta: any;
    try {
      const res = await axios.get(metaUrl, { headers: apiHeaders });
      meta = res.data;
    } catch (e) {
      // transient poll failure — log but keep polling, the next tick may succeed
      console.warn('[pollCreativeExecution] poll error (will keep polling):', e);
      continue;
    }
    if (!isExecutionDone(meta)) continue;

    // Finished — fetch the full execution data once
    const full = (await axios.get(fullUrl, { headers: apiHeaders })).data;

    const errMessage = extractExecutionError(full);
    if (errMessage) {
      console.error('[pollCreativeExecution] execution failed:', errMessage, full?.data?.resultData?.error);
      const err: any = new Error(errMessage);
      err.responseBody = full?.data?.resultData?.error;
      throw err;
    }

    const runData = full?.data?.resultData?.runData ?? {};
    const lastNode = full?.data?.resultData?.lastNodeExecuted;
    const pickResultsFor = (nodeName?: string): any[] => {
      if (!nodeName) return [];
      const runs = runData[nodeName] ?? [];
      return runs.flatMap((r: any) => (r?.data?.main?.[0] ?? []).map((it: any) => it?.json).filter(Boolean));
    };
    const aggregateResults = pickResultsFor('Aggregate Images');
    const lastNodeResults  = pickResultsFor(lastNode);
    // Merge into one result. Aggregate Images is the authoritative source if it ran.
    const sources = aggregateResults.length ? aggregateResults : lastNodeResults;
    const result: any = sources.reduce((acc: any, j: any) => {
      if (!j || typeof j !== 'object') return acc;
      if (Array.isArray(j.images)) acc.images = [...(acc.images ?? []), ...j.images];
      for (const [k, v] of Object.entries(j)) {
        if (k === 'images') continue;
        if (!(k in acc)) acc[k] = v;
      }
      return acc;
    }, {});
    if (!result || Object.keys(result).length === 0) {
      console.error('[pollCreativeExecution] no result data in execution. lastNode=%s, runData keys=%o', lastNode, Object.keys(runData));
      const err: any = new Error('Creative generation finished but returned no result');
      err.responseBody = { lastNode, runDataKeys: Object.keys(runData) };
      throw err;
    }
    return result;
  }

  console.error('[pollCreativeExecution] polling timed out after', POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000, 'seconds');
  throw new Error(`Creative generation timed out after ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
};

// Turn a merged execution result into the ImageVariant[] shown on a batch card,
// with standardized file names derived from fileMeta.
const parseCreativeImages = (result: any, fileMeta: CreativeFileMeta): ImageVariant[] => {
  const readString = (key: string): string => typeof result[key] === 'string' ? result[key] : '';

  // n8n's Aggregate Images keys every image by preset_id: image_a_url / image_b_url /
  // image_c_url / image_d_url / image_custom_url. The same node also emits a flat
  // `images: [...]` array in response order, but that order loses which preset each
  // image came from — so a partial run like {A, D} would otherwise get filenamed _1, _2
  // instead of _1, _4. Prefer the keyed entries so the trailing slot matches the preset.
  const PRESET_ORDER = ['a', 'b', 'c', 'd', 'custom'] as const;
  const PRESET_SLOT: Record<string, number | string> = {
    a: 1, b: 2, c: 3, d: 4, custom: 'custom',
  };

  // Per-key compliance reader. Defaults to compliant=true when the field
  // is missing (A/B/C/D bypass the Compliance Agent (Image), legacy
  // responses don't carry these fields at all).
  const readCompliance = (suffix: string) => {
    const compliantField = result[`compliant_${suffix}`];
    const checkedField = result[`compliance_checked_${suffix}`];
    const compliant = typeof compliantField === 'boolean' ? compliantField : true;
    const complianceChecked = checkedField === true;
    return {
      compliant,
      complianceType: readString(`compliance_type_${suffix}`),
      complianceDescription: readString(`compliance_description_${suffix}`),
      policyReference: readString(`compliance_policy_${suffix}`),
      complianceChecked,
    };
  };

  let images: ImageVariant[] = [];
  const keyed = Object.entries(result)
    .filter(([k, v]) => /^image_[a-z0-9]+_url$/i.test(k) && typeof v === 'string')
    .map(([k, v]) => {
      const suffix = (k.match(/^image_([a-z0-9]+)_url$/i)?.[1] ?? '').toLowerCase();
      const styleFromResponse = readString(`style_${suffix}`);
      const style = styleFromResponse.trim() || suffix.toUpperCase();
      const metaTitle = readString(`meta_title_${suffix}`) || readString('meta_ad_title');
      const metaCopy  = readString(`meta_copy_${suffix}`)  || readString('meta_ad_copy');
      const cta       = readString(`banner_cta_${suffix}`);
      const compliance = readCompliance(suffix);
      return { suffix, url: v as string, style, metaTitle, metaCopy, cta, ...compliance };
    });

  if (keyed.length > 0) {
    // Display order: A -> B -> C -> D -> Custom, anything unknown at the end.
    keyed.sort((a, b) => {
      const ai = PRESET_ORDER.indexOf(a.suffix as typeof PRESET_ORDER[number]);
      const bi = PRESET_ORDER.indexOf(b.suffix as typeof PRESET_ORDER[number]);
      return (ai === -1 ? PRESET_ORDER.length : ai) - (bi === -1 ? PRESET_ORDER.length : bi);
    });
    images = keyed.map(({ suffix, url, style, metaTitle, metaCopy, cta, compliant, complianceType, complianceDescription, policyReference, complianceChecked }) => ({
      url, style, metaTitle, metaCopy, cta,
      fileName: buildCreativeFilename(fileMeta, PRESET_SLOT[suffix] ?? suffix),
      compliant, complianceType, complianceDescription, policyReference, complianceChecked,
    }));
  } else if (Array.isArray(result.images)) {
    // Legacy fallback — older n8n versions only returned the flat array. Numbers
    // 1..N stay in response order; partial selections will be misnumbered, which is
    // the original behaviour we accept only when keyed entries are unavailable.
    images = result.images
      .filter((s: any) => typeof s === 'string')
      .map((url: string, i: number) => ({
        url,
        style: String.fromCharCode(65 + i),
        metaTitle: '',
        metaCopy: '',
        cta: '',
        fileName: buildCreativeFilename(fileMeta, i + 1),
      }));
  } else if (typeof result.image_url === 'string') {
    images = [{
      url: result.image_url,
      style: readString('style'),
      metaTitle: readString('meta_title') || readString('meta_ad_title'),
      metaCopy: readString('meta_copy') || readString('meta_ad_copy'),
      cta: readString('banner_cta'),
      fileName: buildCreativeFilename(fileMeta, 1),
    }];
  }
  return images;
};

export const useAppStore = create<AppState>((set, get) => ({
  formData: { articleUrl: '', keyword1: '', keyword2: '', keyword3: '', geo: 'United States (US)', buyer: '', campaignName: '' },
  angles: [], agent1Output: '', operatorNote: '', article: '', concepts: [], creatives: [],
  isLoadingAngles: false, isLoadingConcepts: false, isLoadingCreatives: false,
  creativeOnlyHook: '', creativeOnlyAccent: '', creativeOnlyCta: '',
  isLoadingCreativeOnly: false,
  articleHtml: null, articleStatus: 'idle', articleError: null,
  articleInputs: null, offerArticleOpen: false,
  offerOptions: null, offerOptionsStatus: 'idle', offerOptionsError: null,
  articleTranslatedHtml: null, articleIsTranslating: false, articleShowTranslation: false,
  keywordHtml: null, keywordStatus: 'idle', keywordError: null,
  fbCampaignStatus: 'idle', fbCampaignData: null, fbCampaignError: null,
  selectedFbAd: null,
  binomOfferOpen: false,
  binomOfferStatus: 'idle', binomOfferResult: null, binomOfferError: null,
  nbCampaignOpen: false,
  nbCampaignStatus: 'idle', nbCampaignResult: null, nbCampaignError: null,
  nbAccountsStatus: 'idle', nbAccountsList: [], nbAccountsError: null,
  rsocBundle: null, rsocAudiencesStatus: 'idle', rsocAudiencesError: null,
  rsocHeadlines: [], rsocHeadlinesStatus: 'idle', rsocHeadlinesError: null,
  imageGenerationModel: 'google/gemini-3-pro-image-preview',
  adLanguage: 'English (US)',
  aspectRatio: '1:1',
  // Default: nothing pre-selected. Operators explicitly opt into the standard
  // presets (A/B/C/D), Custom, or any saved prompts they want — avoids
  // silently spending image-gen calls on the four standard variants when the
  // operator only meant to test, say, one saved prompt.
  selectedPresets: [],
  customPrompt: '',
  // Default Custom blocks. textRules + forbidden are forced ON (no UI toggle —
  // they're guard rails; see Column3.tsx CUSTOM_BLOCK_DEFS). Scene defaults OFF
  // so the user's design direction isn't fighting the concept's scene.
  customBlocks: { textRules: true, scene: false, hook: true, accent: true, cta: true, forbidden: true },
  savedPrompts: [],
  savedPromptsStatus: 'idle',
  selectedSavedPromptIds: [],
  setImageGenerationModel: (value) => set({ imageGenerationModel: value }),
  setAdLanguage: (value) => set({ adLanguage: value }),
  setAspectRatio: (value) => set({ aspectRatio: value }),
  setSelectedPresets: (value) => set({ selectedPresets: value }),
  setCustomPrompt: (value) => set({ customPrompt: value }),
  setCustomBlocks: (value) => set({ customBlocks: value }),
  setSelectedSavedPromptIds: (value) => set({ selectedSavedPromptIds: value }),
  setCreativeOnlyHook: (value) => set({ creativeOnlyHook: value }),
  setCreativeOnlyAccent: (value) => set({ creativeOnlyAccent: value }),
  setCreativeOnlyCta: (value) => set({ creativeOnlyCta: value }),
  loadSavedPrompts: async () => {
    set({ savedPromptsStatus: 'loading' });
    try {
      const list = await listPrompts();
      set({ savedPrompts: list, savedPromptsStatus: 'success' });
    } catch (e) {
      console.warn('[loadSavedPrompts]', e);
      // Fall back to whatever was previously cached instead of clearing — the
      // operator can still pick from the last known list while we're offline.
      set({ savedPromptsStatus: 'error' });
    }
  },
  errorBanner: null,
  noticeBanner: null,

  showError: (message) => set((state) => {
    const trimmed = (message ?? '').toString().slice(0, 500);
    if (!trimmed) return {};
    if (state.errorBanner && state.errorBanner.message === trimmed) {
      return { errorBanner: { message: trimmed, count: state.errorBanner.count + 1 } };
    }
    return { errorBanner: { message: trimmed, count: 1 } };
  }),
  dismissError: () => set({ errorBanner: null }),

  showWarning: (message) => {
    const trimmed = (message ?? '').toString().slice(0, 500);
    if (!trimmed) return;
    if (_noticeTimer) clearTimeout(_noticeTimer);
    set({ noticeBanner: { message: trimmed } });
    _noticeTimer = setTimeout(() => {
      set({ noticeBanner: null });
      _noticeTimer = null;
    }, 5000);
  },
  dismissNotice: () => {
    if (_noticeTimer) { clearTimeout(_noticeTimer); _noticeTimer = null; }
    set({ noticeBanner: null });
  },

  updateFormData: (field, value) => set((state) => ({ formData: { ...state.formData, [field]: value } })),
  updateAngle: (id, field, value) => set((state) => ({ angles: state.angles.map(a => a.id === id ? { ...a, [field]: value } : a) })),
  updateConcept: (id, field, value) => set((state) => ({ concepts: state.concepts.map(c => c.id === id ? { ...c, [field]: value } : c) })),
  updateCreative: (id, field, value) => set((state) => ({ creatives: state.creatives.map(c => c.id === id ? { ...c, [field]: value } : c) })),
  deleteCreative: (id) => set((state) => ({ creatives: state.creatives.filter(c => c.id !== id) })),
  clearConcepts: () => set({ concepts: [] }),

  generateAngles: async () => {
    // Capture every field of the "1. Input Data" panel — same shape as formData
    // so the dashboard can show the full kickoff context, not just geo + buyer.
    const meta = { ...get().formData };
    set({ isLoadingAngles: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const formData = get().formData;
        console.log('[generateAngles] request payload:', formData);
        const { data } = await axios.post(WEBHOOKS.angles, formData);
        console.log('[generateAngles] raw response:', data);
        const outer = Array.isArray(data) ? data[0] : data;
        const agent1Output: string = outer?.agent1_output ?? '';
        const article: string = outer?.article ?? '';
        let anglesPayload: any = outer?.angles;
        while (typeof anglesPayload === 'string') anglesPayload = JSON.parse(anglesPayload);
        const anglesArray = Array.isArray(anglesPayload) ? anglesPayload : anglesPayload?.angles;
        const operatorNote: string = (anglesPayload && !Array.isArray(anglesPayload) ? anglesPayload.operator_note : null) ?? '';
        if (!Array.isArray(anglesArray)) {
          console.error('[generateAngles] unexpected payload shape:', outer);
          throw new Error('Webhook response missing angles[]');
        }
        const anglesWithIds: Angle[] = anglesArray.map((item: any, index: number) => ({
          id: crypto.randomUUID(),
          slot: Number(item.slot) || (index + 1),
          direction: item.direction ?? '',
          whyWorks: item.why_works ?? '',
          hookSeed: item.hook_seed ?? '',
          code: item.code ?? '',
          trigger: item.trigger ?? '',
          awarenessLevel: item.awareness_level ?? '',
          emotionalAnchor: item.emotional_anchor ?? '',
          raw: item,
        }));
        set({ angles: anglesWithIds, agent1Output, operatorNote, article, concepts: [], creatives: [], isLoadingAngles: false });
        logEvent({ tab: 'creatives', action: 'generateAngles', meta, metaOut: data });
        return;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        set({ isLoadingAngles: false });
        logEvent({ tab: 'creatives', action: 'generateAngles', meta, metaOut: (e as any)?.response?.data, errorMessage: humanizeError(e) });
        return;
      }
    }
  },

  generateArticle: async ({ topic, geo, language, mode }) => {
    const meta = { topic, geo, language, mode };
    if (!WEBHOOKS.article) {
      const msg = 'PUBLIC_WEBHOOK_ARTICLE_URL is not set in .env';
      set({
        articleStatus: 'error', articleError: msg, articleHtml: null,
        articleTranslatedHtml: null, articleShowTranslation: false, articleIsTranslating: false,
      });
      get().showError(msg);
      logEvent({ tab: 'article', action: 'generateArticle', meta, errorMessage: msg });
      return;
    }
    set({
      articleStatus: 'loading', articleError: null, articleHtml: null,
      articleInputs: { topic, geo, language },
      articleTranslatedHtml: null, articleShowTranslation: false, articleIsTranslating: false,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // GEO drives the SERP fetch; `language` is used only by the article-writing
        // chains (after Aggregate); `mode` picks which Basic LLM Chain prompt runs.
        const payload = { 'Article topic': topic, GEO: geo, language, mode };
        console.log('[generateArticle] request payload:', payload);
        // The n8n workflow scrapes the SERP top-10 + LLM rewrite — can run ~60-120s.
        const { data } = await axios.post(WEBHOOKS.article, payload, {
          timeout: 300_000,
          responseType: 'text',
          transformResponse: (v) => v,
        });
        const html = typeof data === 'string' ? data : String(data ?? '');
        if (!html.trim()) throw new Error('Webhook returned empty response');
        set({ articleHtml: html, articleStatus: 'success', articleError: null });
        logEvent({ tab: 'article', action: 'generateArticle', meta, metaOut: html });
        return;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        const msg = humanizeError(e);
        set({
          articleStatus: 'error', articleError: msg, articleHtml: null,
          articleTranslatedHtml: null, articleShowTranslation: false, articleIsTranslating: false,
        });
        get().showError(`Article generation failed: ${msg}`);
        logEvent({ tab: 'article', action: 'generateArticle', meta, metaOut: (e as any)?.response?.data, errorMessage: msg });
        return;
      }
    }
  },

  generateKeywords: async (input) => {
    // Async pattern (the KeywordTool run takes ~120-180s, past Cloudflare's 100s cap):
    // the webhook returns a job_id immediately, then we poll the n8n executions API
    // until the run finishes and pull the final HTML out of the last node. Mirrors
    // generateCreative — same executions-API plumbing.
    const logMeta = { country: input.country, language: input.language, anchor: input.anchor };
    if (!WEBHOOKS.keywords) {
      const msg = 'PUBLIC_WEBHOOK_KEYWORDS_URL is not set in .env';
      set({ keywordStatus: 'error', keywordError: msg, keywordHtml: null });
      get().showError(msg);
      logEvent({ tab: 'keywords', action: 'generateKeywords', meta: logMeta, errorMessage: msg });
      return;
    }
    if (!N8N_EXECUTIONS_URL) {
      const msg = 'PUBLIC_N8N_EXECUTIONS_URL is not set in .env';
      set({ keywordStatus: 'error', keywordError: msg, keywordHtml: null });
      get().showError(msg);
      logEvent({ tab: 'keywords', action: 'generateKeywords', meta: logMeta, errorMessage: msg });
      return;
    }
    set({ keywordStatus: 'loading', keywordError: null, keywordHtml: null });

    const t0 = Date.now();
    const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);

    const fail = (msg: string, responseBody?: unknown) => {
      set({ keywordStatus: 'error', keywordError: msg, keywordHtml: null });
      get().showError(`Keyword research failed: ${msg}`);
      logEvent({ tab: 'keywords', action: 'generateKeywords', meta: logMeta, metaOut: responseBody, errorMessage: msg });
    };

    // Step 1: kick off the run and grab the execution id (job_id) returned immediately.
    let jobId: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log('[generateKeywords] request payload:', input);
        const { data } = await axios.post(WEBHOOKS.keywords, input);
        const startPayload = Array.isArray(data) ? data[0] : data;
        jobId = (startPayload?.job_id ?? startPayload?.execution_id ?? startPayload?.id) ?? null;
        if (!jobId) throw new Error('Webhook did not return a job_id');
        break;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        fail(humanizeError(e), (e as any)?.response?.data);
        return;
      }
    }
    if (!jobId) { fail('Webhook did not return a job_id'); return; }

    // Step 2: poll the executions API until the run finishes.
    const apiHeaders = { 'X-N8N-API-KEY': N8N_EXECUTIONS_API_KEY };
    const metaUrl = `${N8N_EXECUTIONS_URL}/${jobId}`;
    const fullUrl = `${N8N_EXECUTIONS_URL}/${jobId}?includeData=true`;
    console.log(
      '[generateKeywords] kicked off in %ss — job_id=%s, polling every %ss (max %ss)',
      elapsed(), jobId, POLL_INTERVAL_MS / 1000, (POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000,
    );

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      let meta: any;
      try {
        meta = (await axios.get(metaUrl, { headers: apiHeaders })).data;
      } catch (e) {
        // transient poll failure — keep going, the next tick may succeed
        console.warn(`[generateKeywords] poll #${attempt + 1} @${elapsed()}s errored (will keep polling):`, humanizeError(e));
        continue;
      }
      console.log(
        '[generateKeywords] poll #%d @%ss — finished=%s status=%s',
        attempt + 1, elapsed(), meta?.finished ?? false, meta?.status ?? '(running)',
      );
      if (!isExecutionDone(meta)) continue;

      let full: any;
      try {
        full = (await axios.get(fullUrl, { headers: apiHeaders })).data;
      } catch (e) {
        console.error(e);
        fail(humanizeError(e), (e as any)?.response?.data);
        return;
      }

      const errMessage = extractExecutionError(full);
      if (errMessage) {
        console.error('[generateKeywords] execution failed:', errMessage, full?.data?.resultData?.error);
        fail(errMessage, full?.data?.resultData?.error);
        return;
      }

      // Pull the HTML out of the final node ("Final Output (Haiku)"), with a fallback
      // to whatever node ran last.
      const runData = full?.data?.resultData?.runData;
      const lastNode = full?.data?.resultData?.lastNodeExecuted;

      // Dev-only: break down where the run spent its time, slowest node first.
      if (import.meta.env.DEV && runData) {
        const rows = Object.entries(runData)
          .map(([node, runs]: [string, any]) => ({
            node,
            runs: Array.isArray(runs) ? runs.length : 0,
            seconds: +(
              (Array.isArray(runs) ? runs : []).reduce((s: number, r: any) => s + (r?.executionTime ?? 0), 0) / 1000
            ).toFixed(2),
          }))
          .sort((a, b) => b.seconds - a.seconds);
        console.log(`[generateKeywords] execution ${jobId} finished — wall ${elapsed()}s. Per-node time (slowest first):`);
        console.table(rows);
      }
      const readNode = (name?: string) =>
        name ? runData?.[name]?.[0]?.data?.main?.[0]?.[0]?.json : undefined;
      const result = readNode('Final Output (Haiku)') ?? readNode(lastNode);
      const html =
        typeof result?.text === 'string' ? result.text
        : typeof result?.response === 'string' ? result.response
        : typeof result === 'string' ? result
        : '';
      if (!html.trim()) {
        fail('Run finished but returned no HTML', result);
        return;
      }
      set({ keywordHtml: html, keywordStatus: 'success', keywordError: null });
      logEvent({ tab: 'keywords', action: 'generateKeywords', meta: logMeta, metaOut: html });
      return;
    }

    fail(`timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
  },

  // MEGATOOL — FB Campaign Reader. Synchronous POST (FB API itself returns in
  // ~5-30s — well under any edge cap), so no executions polling needed.
  fetchFbCampaign: async (campaignId) => {
    const logMeta = { campaignId };
    if (!WEBHOOKS.fbCampaignReader) {
      const msg = 'PUBLIC_WEBHOOK_FB_CAMPAIGN_READER_URL is not set in .env';
      set({ fbCampaignStatus: 'error', fbCampaignError: msg, fbCampaignData: null });
      get().showError(msg);
      logEvent({ tab: 'megatool-fb', action: 'fetchFbCampaign', meta: logMeta, errorMessage: msg });
      return;
    }
    set({ fbCampaignStatus: 'loading', fbCampaignError: null, fbCampaignData: null });
    try {
      const { data } = await axios.post(WEBHOOKS.fbCampaignReader, { campaignId }, { timeout: 120_000 });
      // n8n may wrap as a one-element array depending on Respond mode.
      const payload = Array.isArray(data) ? data[0] : data;
      if (!payload || payload.ok === false) {
        const msg = payload?.error || 'FB Campaign Reader returned an error';
        set({ fbCampaignStatus: 'error', fbCampaignError: msg, fbCampaignData: null });
        get().showError(`FB Campaign Reader: ${msg}`);
        logEvent({ tab: 'megatool-fb', action: 'fetchFbCampaign', meta: logMeta, metaOut: payload, errorMessage: msg });
        return;
      }
      const inner = payload.data;
      if (!inner?.campaign) {
        const msg = 'FB Campaign Reader returned no campaign data';
        set({ fbCampaignStatus: 'error', fbCampaignError: msg, fbCampaignData: null });
        get().showError(msg);
        logEvent({ tab: 'megatool-fb', action: 'fetchFbCampaign', meta: logMeta, metaOut: payload, errorMessage: msg });
        return;
      }
      const fbData: FbCampaignData = {
        campaign: inner.campaign,
        adsets: Array.isArray(inner.adsets) ? inner.adsets : [],
        totalAds: typeof inner.totalAds === 'number' ? inner.totalAds : 0,
        tokenIndex: payload.tokenIndex,
      };
      set({ fbCampaignStatus: 'success', fbCampaignData: fbData, fbCampaignError: null });
      logEvent({ tab: 'megatool-fb', action: 'fetchFbCampaign', meta: logMeta, metaOut: { totalAds: fbData.totalAds, adsets: fbData.adsets.length } });
    } catch (e) {
      console.error('[fetchFbCampaign]', e);
      const msg = humanizeError(e);
      set({ fbCampaignStatus: 'error', fbCampaignError: msg, fbCampaignData: null });
      get().showError(`FB Campaign Reader failed: ${msg}`);
      logEvent({ tab: 'megatool-fb', action: 'fetchFbCampaign', meta: logMeta, metaOut: (e as any)?.response?.data, errorMessage: msg });
    }
  },
  resetFbCampaign: () => set({ fbCampaignStatus: 'idle', fbCampaignData: null, fbCampaignError: null }),

  // MEGATOOL — Selected ad (from FB Campaign Reader).
  setSelectedFbAd: (ad) => set({ selectedFbAd: ad }),
  clearSelectedFbAd: () => set({ selectedFbAd: null }),

  // MEGATOOL — Create Binom Offer sub-tab visibility + run state.
  openBinomOffer: () => set({ binomOfferOpen: true }),
  closeBinomOffer: () => set({ binomOfferOpen: false }),
  resetBinomOffer: () => set({ binomOfferStatus: 'idle', binomOfferResult: null, binomOfferError: null }),

  // MEGATOOL — Create NB Campaign sub-tab visibility + run state.
  openNbCampaign: () => set({ nbCampaignOpen: true }),
  closeNbCampaign: () => set({ nbCampaignOpen: false }),
  resetNbCampaign: () => set({ nbCampaignStatus: 'idle', nbCampaignResult: null, nbCampaignError: null }),

  createBinomOffer: async (input) => {
    const logMeta = {
      trackingUrl: input.trackingUrl,
      newAmoDomain: input.newAmoDomain,
      newAmoChannel: input.newAmoChannel,
      newBinomGroup: input.newBinomGroup,
      isRoas: input.isRoas ?? false,
    };
    if (!WEBHOOKS.binomOfferCreator) {
      const msg = 'PUBLIC_WEBHOOK_BINOM_OFFER_CREATOR_URL is not set in .env';
      set({ binomOfferStatus: 'error', binomOfferError: msg, binomOfferResult: null });
      get().showError(msg);
      logEvent({ tab: 'megatool-binom', action: 'createBinomOffer', meta: logMeta, errorMessage: msg });
      return;
    }
    set({ binomOfferStatus: 'loading', binomOfferError: null, binomOfferResult: null });
    try {
      const payload = {
        trackingUrl: input.trackingUrl,
        newAmoDomain: input.newAmoDomain,
        newAmoChannel: input.newAmoChannel,
        newBinomGroup: input.newBinomGroup,
        isRoas: input.isRoas ?? false,
      };
      console.log('[createBinomOffer] request payload:', payload);
      const { data } = await axios.post(WEBHOOKS.binomOfferCreator, payload, { timeout: 180_000 });
      const outer = Array.isArray(data) ? data[0] : data;
      if (!outer || outer.ok === false) {
        const msg = outer?.error || 'Binom Offer Creator returned an error';
        const step = outer?.step ? ` (step: ${outer.step})` : '';
        const full = `${msg}${step}`;
        set({ binomOfferStatus: 'error', binomOfferError: full, binomOfferResult: null });
        get().showError(`Binom Offer Creator: ${full}`);
        logEvent({ tab: 'megatool-binom', action: 'createBinomOffer', meta: logMeta, metaOut: outer, errorMessage: full });
        return;
      }
      const result: BinomOfferResult = {
        ok: true,
        tracker: outer.tracker,
        domain: outer.domain,
        binomOfferIds: Array.isArray(outer.binomOfferIds) ? outer.binomOfferIds.map(String) : [],
        binomCampaignId: String(outer.binomCampaignId ?? ''),
        binomCampaignUrl: String(outer.binomCampaignUrl ?? ''),
        binomCampaignName: outer.binomCampaignName,
        originalCampaignId: outer.originalCampaignId,
        originalKey: outer.originalKey,
        ...outer,
      };
      set({ binomOfferStatus: 'success', binomOfferResult: result, binomOfferError: null });
      logEvent({ tab: 'megatool-binom', action: 'createBinomOffer', meta: logMeta, metaOut: result });
    } catch (e) {
      console.error('[createBinomOffer]', e);
      const msg = humanizeError(e);
      set({ binomOfferStatus: 'error', binomOfferError: msg, binomOfferResult: null });
      get().showError(`Binom Offer Creator failed: ${msg}`);
      logEvent({ tab: 'megatool-binom', action: 'createBinomOffer', meta: logMeta, metaOut: (e as any)?.response?.data, errorMessage: msg });
    }
  },

  createNbCampaign: async (input) => {
    const logMeta = { nbAccountId: input.nbAccountId, campaignName: input.campaignName, budget: input.budget, startDate: input.startDate };
    if (!WEBHOOKS.nbCampaignCreator) {
      const msg = 'PUBLIC_WEBHOOK_NB_CAMPAIGN_CREATOR_URL is not set in .env';
      set({ nbCampaignStatus: 'error', nbCampaignError: msg, nbCampaignResult: null });
      get().showError(msg);
      logEvent({ tab: 'megatool-nb', action: 'createNbCampaign', meta: logMeta, errorMessage: msg });
      return;
    }
    set({ nbCampaignStatus: 'loading', nbCampaignError: null, nbCampaignResult: null });
    try {
      console.log('[createNbCampaign] request payload:', input);
      const { data } = await axios.post(WEBHOOKS.nbCampaignCreator, input, { timeout: 180_000 });
      const outer = Array.isArray(data) ? data[0] : data;
      if (!outer || outer.ok === false) {
        const msg = outer?.error || 'NB Campaign Creator returned an error';
        const step = outer?.step ? ` (step: ${outer.step})` : '';
        const full = `${msg}${step}`;
        set({ nbCampaignStatus: 'error', nbCampaignError: full, nbCampaignResult: null });
        get().showError(`NB Campaign Creator: ${full}`);
        logEvent({ tab: 'megatool-nb', action: 'createNbCampaign', meta: logMeta, metaOut: outer, errorMessage: full });
        return;
      }
      const result: NbCampaignResult = {
        nbAccountId: String(outer.nbAccountId ?? ''),
        campaignId: String(outer.campaignId ?? ''),
        adsetId: String(outer.adsetId ?? ''),
        adId: String(outer.adId ?? ''),
        campaignName: String(outer.campaignName ?? ''),
        assetUrl: String(outer.assetUrl ?? ''),
      };
      set({ nbCampaignStatus: 'success', nbCampaignResult: result, nbCampaignError: null });
      logEvent({ tab: 'megatool-nb', action: 'createNbCampaign', meta: logMeta, metaOut: result });
    } catch (e) {
      console.error('[createNbCampaign]', e);
      const msg = humanizeError(e);
      set({ nbCampaignStatus: 'error', nbCampaignError: msg, nbCampaignResult: null });
      get().showError(`NB Campaign Creator failed: ${msg}`);
      logEvent({ tab: 'megatool-nb', action: 'createNbCampaign', meta: logMeta, metaOut: (e as any)?.response?.data, errorMessage: msg });
    }
  },

  // Megatool — pull the NB Accounts list straight from the n8n `nb_accounts`
  // datatable. We don't bundle the (~400+) rows in the frontend any more — that
  // would freeze the renderer on dropdown open.
  fetchNbAccounts: async () => {
    const url = (WEBHOOKS as any).nbAccountsList as string | undefined;
    if (!url) {
      const msg = 'PUBLIC_WEBHOOK_NB_ACCOUNTS_LIST_URL is not set in .env';
      set({ nbAccountsStatus: 'error', nbAccountsError: msg, nbAccountsList: [] });
      return;
    }
    set({ nbAccountsStatus: 'loading', nbAccountsError: null });
    try {
      const { data } = await axios.post(url, {}, { timeout: 30_000 });
      // n8n's "Respond with allIncomingItems" sends the rows as a top-level
      // array — DON'T collapse to data[0] (that would pick a single row).
      // Also handle wrapper shapes (Code-formatter output) and the n8n
      // {json:{...}} envelope just in case the workflow shape changes.
      const rawRows: any[] = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.items)
          ? (data as any).items
          : Array.isArray((data as any)?.data)
            ? (data as any).data
            : [];
      const items = rawRows
        .map((rawRow) => {
          // Unwrap n8n's {json:{...}} envelope if present.
          const row = rawRow && typeof rawRow === 'object' && 'json' in rawRow && rawRow.json && typeof rawRow.json === 'object'
            ? rawRow.json
            : rawRow;
          const name = String(row.Account_Name ?? row['Account Name'] ?? row.account_name ?? row.name ?? '').trim();
          const id = String(row.Account_ID ?? row['Account ID'] ?? row.account_id ?? row.id ?? '').trim();
          return { name, id };
        })
        .filter((r) => r.name && r.id && /^\d+$/.test(r.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      // Dedupe by display name — the datatable allows two rows with the same
      // "Account Name" (different IDs). The Combobox keys options by string,
      // so a dup causes a React "two children with the same key" flood that
      // makes the renderer unresponsive. Disambiguate by appending the trailing
      // 5 digits of the ID so each option is unique AND identifiable.
      const nameCounts = new Map<string, number>();
      for (const r of items) nameCounts.set(r.name, (nameCounts.get(r.name) || 0) + 1);
      const dedupedItems = items.map((r) =>
        (nameCounts.get(r.name) || 0) > 1
          ? { ...r, name: `${r.name} (…${r.id.slice(-5)})` }
          : r,
      );
      const finalItems = dedupedItems;
      if (finalItems.length === 0) {
        set({ nbAccountsStatus: 'error', nbAccountsError: 'No NB accounts returned from datatable', nbAccountsList: [] });
        return;
      }
      set({ nbAccountsStatus: 'success', nbAccountsList: finalItems, nbAccountsError: null });
    } catch (e) {
      console.error('[fetchNbAccounts]', e);
      const msg = humanizeError(e);
      set({ nbAccountsStatus: 'error', nbAccountsError: msg, nbAccountsList: [] });
    }
  },

  // Angles tab — step 1: anchor/geo/language/translation -> SERP research -> audience segments.
  // Synchronous webhook (responseMode=lastNode), returns the full bundle we feed back in step 2.
  generateRsocAudiences: async (input) => {
    const logMeta = { geo: (input as any)?.geo, language: (input as any)?.language, anchor: (input as any)?.anchor };
    if (!WEBHOOKS.rsocAudiences) {
      const msg = 'PUBLIC_WEBHOOK_RSOC_AUDIENCES_URL is not set in .env';
      set({ rsocAudiencesStatus: 'error', rsocAudiencesError: msg });
      get().showError(msg);
      logEvent({ tab: 'angles', action: 'generateRsocAudiences', meta: logMeta, errorMessage: msg });
      return;
    }
    set({
      rsocAudiencesStatus: 'loading', rsocAudiencesError: null, rsocBundle: null,
      rsocHeadlines: [], rsocHeadlinesStatus: 'idle', rsocHeadlinesError: null,
    });
    try {
      console.log('[generateRsocAudiences] request payload:', input);
      // Step 1 — kick off the run; n8n's Respond job_id node returns instantly.
      const kickoff = await axios.post(WEBHOOKS.rsocAudiences, input, { timeout: 30_000 });
      const startPayload = Array.isArray(kickoff.data) ? kickoff.data[0] : kickoff.data;
      const jobId = startPayload?.job_id ?? startPayload?.execution_id ?? startPayload?.id;
      if (!jobId) throw new Error('Webhook did not return a job_id');
      // Step 2 — poll the executions API; survives Cloudflare's ~100s edge cap.
      const bundle: any = await pollExecutionResult(String(jobId), 'generateRsocAudiences');
      if (!bundle || !Array.isArray(bundle.audiences)) {
        console.error('[generateRsocAudiences] unexpected payload shape:', bundle);
        throw new Error('Webhook response missing audiences[]');
      }
      set({
        rsocBundle: {
          keyword: bundle.keyword ?? input.anchor,
          geo: bundle.geo ?? input.geo,
          language: bundle.language ?? input.language,
          research: bundle.research ?? '',
          audiences: bundle.audiences,
        },
        rsocAudiencesStatus: 'success', rsocAudiencesError: null,
      });
      logEvent({ tab: 'angles', action: 'generateRsocAudiences', meta: logMeta, metaOut: bundle });
    } catch (e) {
      console.error(e);
      const msg = humanizeError(e);
      set({ rsocAudiencesStatus: 'error', rsocAudiencesError: msg });
      get().showError(`Audience generation failed: ${msg}`);
      logEvent({ tab: 'angles', action: 'generateRsocAudiences', meta: logMeta, metaOut: (e as any)?.response?.data, errorMessage: msg });
    }
  },

  // Angles tab — step 2: operator picks audience segment_ids, we send them back with the
  // step-1 bundle to get the curated top-3 headlines per audience.
  generateRsocHeadlines: async (pickedIds) => {
    const logMeta = { picked: pickedIds.join(','), pickedCount: pickedIds.length };
    const bundle = get().rsocBundle;
    if (!bundle) {
      const msg = 'Generate audiences first';
      get().showError(msg);
      logEvent({ tab: 'angles', action: 'generateRsocHeadlines', meta: logMeta, errorMessage: msg });
      return;
    }
    if (!pickedIds.length) {
      const msg = 'Pick at least one audience';
      get().showError(msg);
      logEvent({ tab: 'angles', action: 'generateRsocHeadlines', meta: logMeta, errorMessage: msg });
      return;
    }
    if (!WEBHOOKS.rsocHeadlines) {
      const msg = 'PUBLIC_WEBHOOK_RSOC_HEADLINES_URL is not set in .env';
      set({ rsocHeadlinesStatus: 'error', rsocHeadlinesError: msg });
      get().showError(msg);
      logEvent({ tab: 'angles', action: 'generateRsocHeadlines', meta: logMeta, errorMessage: msg });
      return;
    }
    set({ rsocHeadlinesStatus: 'loading', rsocHeadlinesError: null, rsocHeadlines: [] });
    const payload = {
      picked: pickedIds.join(','),
      keyword: bundle.keyword,
      geo: bundle.geo,
      language: bundle.language,
      research: bundle.research,
      audiences: bundle.audiences,
    };
    try {
      console.log('[generateRsocHeadlines] request payload:', { ...payload, research: '…', audiences: `${bundle.audiences.length} items` });
      // Step 1 — kick off; the Respond job_id node returns instantly.
      const kickoff = await axios.post(WEBHOOKS.rsocHeadlines, payload, { timeout: 30_000 });
      const startPayload = Array.isArray(kickoff.data) ? kickoff.data[0] : kickoff.data;
      const jobId = startPayload?.job_id ?? startPayload?.execution_id ?? startPayload?.id;
      if (!jobId) throw new Error('Webhook did not return a job_id');
      // Step 2 — poll until finished; survives Cloudflare's ~100s edge cap.
      const result: any = await pollExecutionResult(String(jobId), 'generateRsocHeadlines');
      const rows = result?.top_picks;
      if (!Array.isArray(rows)) {
        console.error('[generateRsocHeadlines] unexpected payload shape:', result);
        throw new Error('Webhook response missing top_picks[]');
      }
      const headlines: RsocHeadline[] = rows.map((r: any) => ({
        rank: Number(r.rank) || 0,
        audience: r.audience ?? '',
        angle_formula: r.angle_formula ?? '',
        headline_kernel: r.headline_kernel ?? '',
        headline: r.headline ?? '',
        translation_ua: r.translation_ua ?? '',
        headline_id: r.headline_id ?? '',
      }));
      set({ rsocHeadlines: headlines, rsocHeadlinesStatus: 'success', rsocHeadlinesError: null });
      logEvent({ tab: 'angles', action: 'generateRsocHeadlines', meta: logMeta, metaOut: result });
    } catch (e) {
      console.error(e);
      const msg = humanizeError(e);
      set({ rsocHeadlinesStatus: 'error', rsocHeadlinesError: msg });
      get().showError(`Headline generation failed: ${msg}`);
      logEvent({ tab: 'angles', action: 'generateRsocHeadlines', meta: logMeta, metaOut: (e as any)?.response?.data, errorMessage: msg });
    }
  },

  // Angles tab — translate one audience card to UA (reuses the shared /translate_uk webhook,
  // same cache-and-toggle behaviour as toggleAngleTranslation). Arrays are sent as numbered
  // keys (pain_0, desire_0…) so the generic translator round-trips them, then reassembled.
  toggleRsocAudienceTranslation: async (segmentId) => {
    const bundle = get().rsocBundle;
    if (!bundle) return;
    const audience = bundle.audiences.find((a) => a.segment_id === segmentId);
    if (!audience) return;

    const patch = (updater: (a: RsocAudience) => RsocAudience) =>
      set((state) => (state.rsocBundle ? {
        rsocBundle: {
          ...state.rsocBundle,
          audiences: state.rsocBundle.audiences.map((a) => (a.segment_id === segmentId ? updater(a) : a)),
        },
      } : {}));

    // Cache hit — just flip visibility, no network call.
    if (audience.translation) {
      patch((a) => ({ ...a, showTranslation: !a.showTranslation }));
      return;
    }

    patch((a) => ({ ...a, isTranslating: true }));
    try {
      const pains = audience.pain_points ?? [];
      const desires = audience.desires ?? [];
      const vocab = audience.vocab_to_use ?? [];
      const payload: Record<string, string> = {
        segment_name: audience.segment_name ?? '',
        description: audience.description ?? '',
      };
      pains.forEach((p, i) => { payload[`pain_${i}`] = p; });
      desires.forEach((d, i) => { payload[`desire_${i}`] = d; });
      vocab.forEach((v, i) => { payload[`vocab_${i}`] = v; });

      const tr = await postTranslateUk(payload);
      patch((a) => ({
        ...a,
        translation: {
          segment_name: tr.segment_name ?? '',
          description: tr.description ?? '',
          pain_points: pains.map((_, i) => tr[`pain_${i}`] ?? ''),
          desires: desires.map((_, i) => tr[`desire_${i}`] ?? ''),
          vocab_to_use: vocab.map((_, i) => tr[`vocab_${i}`] ?? ''),
        },
        isTranslating: false,
        showTranslation: true,
      }));
    } catch (e) {
      console.error('[toggleRsocAudienceTranslation]', e);
      patch((a) => ({ ...a, isTranslating: false }));
      get().showError(`Translation failed: ${humanizeError(e)}`);
    }
  },

  generateConcept: async (angleId) => {
    set({ isLoadingConcepts: true });
    const angle = get().angles.find(a => a.id === angleId);
    // Capture WHAT was picked, not just an opaque id — angle direction / code /
    // hook seed + ad language + the GEO/buyer context that drives the concept run.
    const logMeta = {
      angleId,
      angleSlot: angle?.slot,
      angleDirection: angle?.direction,
      angleCode: angle?.code,
      angleHookSeed: angle?.hookSeed,
      angleTrigger: angle?.trigger,
      angleAwarenessLevel: angle?.awarenessLevel,
      angleEmotionalAnchor: angle?.emotionalAnchor,
      adLanguage: get().adLanguage,
      geo: get().formData.geo,
      buyer: get().formData.buyer,
      campaignName: get().formData.campaignName,
    };
    const angleForWebhook = angle ? {
      ...(angle.raw ?? {}),
      direction: angle.direction,
      why_works: angle.whyWorks,
      hook_seed: angle.hookSeed,
    } : null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const conceptPayload = {
          formData: get().formData,
          angle: angleForWebhook,
          agent1_output: get().agent1Output,
          operator_note: get().operatorNote,
          article: get().article,
          ad_language: get().adLanguage,
        };
        console.log('[generateConcept] request payload:', conceptPayload);
        const { data } = await axios.post(WEBHOOKS.concept, conceptPayload);
        console.log('[generateConcept] raw response:', data);
        let payload: any = data;
        if (Array.isArray(payload)) payload = payload[0];
        if (payload && typeof payload === 'object' && typeof payload.text === 'string') {
          payload = payload.text;
        }
        while (typeof payload === 'string') payload = JSON.parse(payload);
        const items: any[] = Array.isArray(payload)
          ? payload
          : payload?.creatives ?? payload?.concepts ?? [payload];
        const newConcepts: Concept[] = items.map((item: any) => {
          const formulaRaw: string = (item.formula ?? '').toString().trim();
          const [formulaCode, ...rest] = formulaRaw.split(/\s+/);
          const formulaNameFromSplit = rest.join(' ').trim();
          return {
            id: crypto.randomUUID(),
            hook: item.banner_hook ?? item.hook ?? '',
            accent: item.banner_accent ?? item.accent ?? '',
            cta: item.banner_cta ?? item.cta ?? '',
            metaTitle: item.meta_ad_title ?? item.metaTitle ?? item.meta_title ?? '',
            metaCopy: item.meta_ad_copy ?? item.metaCopy ?? item.meta_copy ?? '',
            formula: formulaCode || formulaRaw,
            formulaName: item.formula_name ?? formulaNameFromSplit ?? '',
            aspectTested: item.aspect_tested ?? '',
            aspectCategory: item.aspect_category ?? '',
            compliant: item.compliant === true,
            complianceType: typeof item.type === 'string' ? item.type : '',
            complianceDescription: typeof item.description === 'string' ? item.description : '',
            policyReference: typeof item.policy_reference === 'string' ? item.policy_reference : '',
            sourceAngle: angle,
            raw: item,
          };
        });
        set((state) => ({ concepts: [...state.concepts, ...newConcepts], isLoadingConcepts: false }));
        logEvent({ tab: 'creatives', action: 'generateConcept', meta: logMeta, metaOut: data });
        return;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        set({ isLoadingConcepts: false });
        logEvent({ tab: 'creatives', action: 'generateConcept', meta: logMeta, metaOut: (e as any)?.response?.data, errorMessage: humanizeError(e) });
        return;
      }
    }
  },

  generateCreative: async (conceptId) => {
    const concept = get().concepts.find(c => c.id === conceptId);
    if (!concept) return;
    // Mirror the generateConcept treatment: capture the actual concept content
    // (hook / accent / cta / meta copy / formula) + the source angle's identity
    // + every generation setting that affects the output. That way the dashboard
    // can answer "what did this run produce, and from what?" without an id lookup.
    const logMeta = {
      conceptId,
      hook: concept.hook,
      accent: concept.accent,
      cta: concept.cta,
      metaTitle: concept.metaTitle,
      metaCopy: concept.metaCopy,
      formula: concept.formula,
      formulaName: concept.formulaName,
      aspectTested: concept.aspectTested,
      aspectCategory: concept.aspectCategory,
      angleSlot: concept.sourceAngle?.slot,
      angleDirection: concept.sourceAngle?.direction,
      angleCode: concept.sourceAngle?.code,
      adLanguage: get().adLanguage,
      aspectRatio: get().aspectRatio,
      imageModel: get().imageGenerationModel,
      geo: get().formData.geo,
      buyer: get().formData.buyer,
      campaignName: get().formData.campaignName,
      presets: get().selectedPresets,
    };

    const chosen_angle = concept.sourceAngle
      ? {
          ...(concept.sourceAngle.raw ?? {}),
          direction: concept.sourceAngle.direction,
          why_works: concept.sourceAngle.whyWorks,
          hook_seed: concept.sourceAngle.hookSeed,
        }
      : null;
    const chosen_creative = {
      ...(concept.raw ?? {}),
      banner_hook: concept.hook,
      banner_accent: concept.accent,
      banner_cta: concept.cta,
      meta_ad_title: concept.metaTitle,
      meta_ad_copy: concept.metaCopy,
    };

    const creativeId = crypto.randomUUID();
    // Snapshot everything the standardized file name needs. batchNumber stays 0 for now —
    // it is set to the n8n execution id once the job is kicked off (see below), so the
    // file name's batch number matches the "batch_<id>" shown in Telegram.
    let fileMeta: CreativeFileMeta = {
      campaignName: get().formData.campaignName,
      geo: get().formData.geo,
      batchNumber: 0,
      angleSlot: concept.sourceAngle?.slot ?? 1,
      angleCode: concept.sourceAngle?.code ?? '',
      formula: concept.formula ?? '',
      adLanguage: get().adLanguage,
      aspectRatio: get().aspectRatio,
      imageModel: get().imageGenerationModel,
    };
    const placeholder: Creative = {
      id: creativeId,
      metaTitle: concept.metaTitle,
      metaCopy: concept.metaCopy,
      cta: concept.cta,
      images: [],
      isLoading: true,
      chosenAngle: chosen_angle,
      chosenCreative: chosen_creative,
      fileMeta,
    };
    set((state) => ({
      creatives: [...state.creatives, placeholder],
      isLoadingCreatives: true,
    }));

    // Resolve which shared prompts the operator picked. Filter by current store
    // state in case admins deleted one between the load and the click.
    const selectedSavedPromptIds = new Set(get().selectedSavedPromptIds);
    const savedPromptsPayload = get().savedPrompts
      .filter((p) => selectedSavedPromptIds.has(String(p.id)))
      .map((p) => ({ id: p.id, name: p.name, prompt: p.prompt }));

    const payload = {
      agent1_output: get().agent1Output,
      article: get().article,
      chosen_angle,
      chosen_creative,
      image_generation_model: get().imageGenerationModel,
      ad_language: get().adLanguage,
      aspect_ratio: get().aspectRatio,
      // Target country — Agent 3 / Agent 3 Patch use this to pick the right currency,
      // local programmes, and regional references. Currency follows GEO, not ad_language.
      geo: get().formData.geo,
      // n8n side filters its 5 preset branches by these IDs ('A','B','C','D','Custom').
      // Custom only contributes if the user also typed a custom_prompt.
      presets: get().selectedPresets,
      custom_prompt: get().customPrompt,
      // Toggleable scaffolding for Preset Custom — see Build Image Context / Preset Custom in n8n.
      custom_blocks: get().customBlocks,
      // Pre-authored prompts from Docs → Prompt Bases. Each entry will run as
      // its own image variant in the n8n workflow with {hook}/{accent}/{cta}
      // substituted from chosen_creative.
      saved_prompts: savedPromptsPayload,
    };

    const cleanupOnFailure = (errorMessage?: string, responseBody?: unknown) => {
      set((state) => ({
        creatives: state.creatives.filter(c => c.id !== creativeId),
        isLoadingCreatives: false,
      }));
      logEvent({ tab: 'creatives', action: 'generateCreative', meta: logMeta, metaOut: responseBody, errorMessage });
    };

    // Step 1: kick off the job. n8n returns:
    //   job_id        - the real n8n execution id, needed to poll the executions API
    //   batch_number  - optional, legacy workflow counter (1, 2, 3 …).
    let jobId: string | null = null;
    let batchNumberRaw: number | string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data } = await axios.post(WEBHOOKS.creative, payload);
        const startPayload = Array.isArray(data) ? data[0] : data;
        jobId = (startPayload?.job_id ?? startPayload?.execution_id ?? startPayload?.id) ?? null;
        if (!jobId) throw new Error('Webhook did not return a job_id');
        // Take batch_number verbatim if the workflow returns it; otherwise we'll
        // fall back to jobId below. Don't coerce — a non-numeric id (UUID,
        // "exec-abc-…") would NaN out to 0 and collide with every other run.
        batchNumberRaw = startPayload?.batch_number ?? null;
        break;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        cleanupOnFailure(humanizeError(e), (e as any)?.response?.data);
        return;
      }
    }
    if (!jobId) { cleanupOnFailure('Webhook did not return a job_id'); return; }

    // The execution id IS the batch number. Each Generate click produces a new
    // run with a unique id, so the standardized file name carries it through
    // and two batches never collide on the same "batch_<n>" — even when the
    // operator re-downloads the same one twice (browser appends "(copy)",
    // which is correct: same content, same id).
    const batchNumber: number | string = batchNumberRaw ?? jobId;
    fileMeta = { ...fileMeta, batchNumber };
    set((state) => ({
      creatives: state.creatives.map(c => c.id === creativeId ? { ...c, fileMeta } : c),
    }));

    // Step 2: poll the executions API until the job finishes, then extract the images.
    let result: any;
    try {
      result = await pollCreativeExecution(jobId, () => !get().creatives.some(c => c.id === creativeId));
    } catch (e) {
      const msg = humanizeError(e);
      get().showError(msg.startsWith('Creative generation') ? msg : `Creative generation failed: ${msg}`);
      cleanupOnFailure(msg, (e as any)?.responseBody ?? (e as any)?.response?.data);
      return;
    }
    if (result === null) return; // the user deleted this creative card mid-poll

    // Extract images + per-variant texts (style, meta_title, meta_copy, banner_cta)
    const fallbackConcept = get().concepts.find(c => c.id === conceptId);
    const readString = (key: string): string => typeof result[key] === 'string' ? result[key] : '';
    const images = parseCreativeImages(result, fileMeta);

    // Card-level fields take values from the first variant; if it has none, fall back to the concept.
    const firstVariant = images[0];
    const cardMetaTitle = firstVariant?.metaTitle || readString('meta_ad_title') || fallbackConcept?.metaTitle || '';
    const cardMetaCopy = firstVariant?.metaCopy || readString('meta_ad_copy') || fallbackConcept?.metaCopy || '';
    const cardCta = firstVariant?.cta || fallbackConcept?.cta || '';

    // Final check: creative still in state (user might have deleted while we were fetching)
    if (!get().creatives.some(c => c.id === creativeId)) return;

    set((state) => ({
      creatives: state.creatives.map(c => c.id === creativeId
        ? {
            ...c,
            metaTitle: cardMetaTitle,
            metaCopy: cardMetaCopy,
            cta: cardCta,
            images,
            isLoading: false,
            // Refresh the snapshot that goes to send_to_tg: keep banner_hook/banner_accent
            // and other concept-side fields, but overwrite meta_ad_title / meta_ad_copy /
            // banner_cta with the actual webhook output (which may be translated to ad_language).
            chosenCreative: {
              ...(c.chosenCreative ?? {}),
              meta_ad_title: cardMetaTitle,
              meta_ad_copy: cardMetaCopy,
              banner_cta: cardCta,
            },
          }
        : c),
      isLoadingCreatives: false,
    }));
    logEvent({ tab: 'creatives', action: 'generateCreative', meta: logMeta, metaOut: result });
  },

  // Creative Gen tab — generate a batch straight from the typed Hook / Accent /
  // CTA. Same kickoff → poll → parse plumbing as generateCreative, but with no
  // pipeline context (no angle, no concept, no article) and its own n8n workflow.
  generateCreativeOnly: async () => {
    const hook = get().creativeOnlyHook.trim();
    const accent = get().creativeOnlyAccent.trim();
    const cta = get().creativeOnlyCta.trim();
    if (!hook) {
      get().showError('Hook is required');
      return;
    }
    if (!WEBHOOKS.creativeOnly) {
      get().showError('PUBLIC_WEBHOOK_CREATIVE_ONLY_URL is not set in .env');
      return;
    }

    const logMeta = {
      hook,
      accent,
      cta,
      aspectRatio: get().aspectRatio,
      imageModel: get().imageGenerationModel,
      presets: get().selectedPresets,
    };

    const chosen_creative = {
      banner_hook: hook,
      banner_accent: accent,
      banner_cta: cta,
    };

    const creativeId = crypto.randomUUID();
    // creativeOnly flags the standardized file name: the stage segments
    // (campaign / geo / angle / formula / language) are replaced by a single
    // "creativeonly" marker. batchNumber is filled in with the n8n execution
    // id once the job is kicked off, same as generateCreative.
    let fileMeta: CreativeFileMeta = {
      campaignName: '',
      geo: '',
      batchNumber: 0,
      angleSlot: 0,
      angleCode: '',
      formula: '',
      adLanguage: '',
      aspectRatio: get().aspectRatio,
      imageModel: get().imageGenerationModel,
      creativeOnly: true,
    };
    const placeholder: Creative = {
      id: creativeId,
      metaTitle: '',
      metaCopy: '',
      cta,
      images: [],
      isLoading: true,
      chosenAngle: null,
      chosenCreative: chosen_creative,
      fileMeta,
      origin: 'creativeOnly',
    };
    set((state) => ({
      creatives: [...state.creatives, placeholder],
      isLoadingCreativeOnly: true,
    }));

    const selectedSavedPromptIds = new Set(get().selectedSavedPromptIds);
    const savedPromptsPayload = get().savedPrompts
      .filter((p) => selectedSavedPromptIds.has(String(p.id)))
      .map((p) => ({ id: p.id, name: p.name, prompt: p.prompt }));

    const payload = {
      mode: 'creative_only',
      chosen_creative,
      image_generation_model: get().imageGenerationModel,
      aspect_ratio: get().aspectRatio,
      presets: get().selectedPresets,
      custom_prompt: get().customPrompt,
      custom_blocks: get().customBlocks,
      saved_prompts: savedPromptsPayload,
    };

    const cleanupOnFailure = (errorMessage?: string, responseBody?: unknown) => {
      set((state) => ({
        creatives: state.creatives.filter(c => c.id !== creativeId),
        isLoadingCreativeOnly: false,
      }));
      logEvent({ tab: 'creative_gen', action: 'generateCreativeOnly', meta: logMeta, metaOut: responseBody, errorMessage });
    };

    // Step 1: kick off the job — n8n's Respond job_id node returns the execution id instantly.
    let jobId: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log('[generateCreativeOnly] request payload:', payload);
        const { data } = await axios.post(WEBHOOKS.creativeOnly, payload);
        const startPayload = Array.isArray(data) ? data[0] : data;
        jobId = (startPayload?.job_id ?? startPayload?.execution_id ?? startPayload?.id) ?? null;
        if (!jobId) throw new Error('Webhook did not return a job_id');
        break;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        get().showError(`Creative generation failed: ${humanizeError(e)}`);
        cleanupOnFailure(humanizeError(e), (e as any)?.response?.data);
        return;
      }
    }
    if (!jobId) { cleanupOnFailure('Webhook did not return a job_id'); return; }

    // The execution id IS the batch number — carried into the file name.
    fileMeta = { ...fileMeta, batchNumber: jobId };
    set((state) => ({
      creatives: state.creatives.map(c => c.id === creativeId ? { ...c, fileMeta } : c),
    }));

    // Step 2: poll until the run finishes, then extract the images.
    let result: any;
    try {
      result = await pollCreativeExecution(jobId, () => !get().creatives.some(c => c.id === creativeId));
    } catch (e) {
      const msg = humanizeError(e);
      get().showError(msg.startsWith('Creative generation') ? msg : `Creative generation failed: ${msg}`);
      cleanupOnFailure(msg, (e as any)?.responseBody ?? (e as any)?.response?.data);
      return;
    }
    if (result === null) return; // the user deleted this creative card mid-poll

    const readString = (key: string): string => typeof result[key] === 'string' ? result[key] : '';
    const images = parseCreativeImages(result, fileMeta);

    // Card-level fields: there is no concept behind this run, so fall back to
    // the typed CTA when the workflow returns none.
    const firstVariant = images[0];
    const cardMetaTitle = firstVariant?.metaTitle || readString('meta_ad_title') || '';
    const cardMetaCopy = firstVariant?.metaCopy || readString('meta_ad_copy') || '';
    const cardCta = firstVariant?.cta || cta;

    if (!get().creatives.some(c => c.id === creativeId)) return;

    set((state) => ({
      creatives: state.creatives.map(c => c.id === creativeId
        ? {
            ...c,
            metaTitle: cardMetaTitle,
            metaCopy: cardMetaCopy,
            cta: cardCta,
            images,
            isLoading: false,
            chosenCreative: {
              ...(c.chosenCreative ?? {}),
              meta_ad_title: cardMetaTitle,
              meta_ad_copy: cardMetaCopy,
              banner_cta: cardCta,
            },
          }
        : c),
      isLoadingCreativeOnly: false,
    }));
    logEvent({ tab: 'creative_gen', action: 'generateCreativeOnly', meta: logMeta, metaOut: result });
  },

  sendToTelegram: async (creativeId) => {
    const logMeta = { creativeId };
    const creative = get().creatives.find(c => c.id === creativeId);
    if (!creative) return;

    set((state) => ({
      creatives: state.creatives.map(c => c.id === creativeId
        ? { ...c, isSending: true, isSent: false }
        : c),
    }));

    const { chosenAngle, chosenCreative, isLoading: _isLoading, isSending: _isSending, isSent: _isSent, ...creativeForPayload } = creative;
    const payload = {
      creative: creativeForPayload,
      chosen_angle: chosenAngle ?? null,
      chosen_creative: chosenCreative ?? null,
    };
    try {
      const { data } = await axios.post(WEBHOOKS.telegram, payload);
      set((state) => ({
        creatives: state.creatives.map(c => c.id === creativeId
          ? { ...c, isSending: false, isSent: true }
          : c),
      }));
      logEvent({ tab: 'creatives', action: 'sendToTelegram', meta: logMeta, metaOut: data });
    } catch (e) {
      console.error('Ошибка отправки', e);
      set((state) => ({
        creatives: state.creatives.map(c => c.id === creativeId
          ? { ...c, isSending: false, isSent: false }
          : c),
      }));
      logEvent({ tab: 'creatives', action: 'sendToTelegram', meta: logMeta, metaOut: (e as any)?.response?.data, errorMessage: humanizeError(e) });
    }
  },

  toggleAngleTranslation: async (angleId) => {
    const angle = get().angles.find(a => a.id === angleId);
    if (!angle) return;
    // Cache hit — just flip the visibility flag, no network call.
    if (angle.translation) {
      set((state) => ({
        angles: state.angles.map(a => a.id === angleId ? { ...a, showTranslation: !a.showTranslation } : a),
      }));
      return;
    }
    // First request — translate and store.
    set((state) => ({
      angles: state.angles.map(a => a.id === angleId ? { ...a, isTranslating: true } : a),
    }));
    try {
      const translation = await postTranslateUk({
        direction: angle.direction ?? '',
        hookSeed: angle.hookSeed ?? '',
        whyWorks: angle.whyWorks ?? '',
      });
      set((state) => ({
        angles: state.angles.map(a => a.id === angleId ? {
          ...a,
          translation: {
            direction: translation.direction ?? '',
            hookSeed: translation.hookSeed ?? '',
            whyWorks: translation.whyWorks ?? '',
          },
          isTranslating: false,
          showTranslation: true,
        } : a),
      }));
    } catch (e) {
      console.error('[toggleAngleTranslation]', e);
      set((state) => ({
        angles: state.angles.map(a => a.id === angleId ? { ...a, isTranslating: false } : a),
      }));
      get().showError(`Translation failed: ${humanizeError(e)}`);
    }
  },

  toggleConceptTranslation: async (conceptId) => {
    const concept = get().concepts.find(c => c.id === conceptId);
    if (!concept) return;
    if (concept.translation) {
      set((state) => ({
        concepts: state.concepts.map(c => c.id === conceptId ? { ...c, showTranslation: !c.showTranslation } : c),
      }));
      return;
    }
    set((state) => ({
      concepts: state.concepts.map(c => c.id === conceptId ? { ...c, isTranslating: true } : c),
    }));
    try {
      const translation = await postTranslateUk({
        hook: concept.hook ?? '',
        accent: concept.accent ?? '',
        cta: concept.cta ?? '',
        metaTitle: concept.metaTitle ?? '',
        metaCopy: concept.metaCopy ?? '',
      });
      set((state) => ({
        concepts: state.concepts.map(c => c.id === conceptId ? {
          ...c,
          translation: {
            hook: translation.hook ?? '',
            accent: translation.accent ?? '',
            cta: translation.cta ?? '',
            metaTitle: translation.metaTitle ?? '',
            metaCopy: translation.metaCopy ?? '',
          },
          isTranslating: false,
          showTranslation: true,
        } : c),
      }));
    } catch (e) {
      console.error('[toggleConceptTranslation]', e);
      set((state) => ({
        concepts: state.concepts.map(c => c.id === conceptId ? { ...c, isTranslating: false } : c),
      }));
      get().showError(`Translation failed: ${humanizeError(e)}`);
    }
  },

  toggleCreativeTranslation: async (creativeId) => {
    const creative = get().creatives.find(c => c.id === creativeId);
    if (!creative) return;
    if (creative.translation) {
      set((state) => ({
        creatives: state.creatives.map(c => c.id === creativeId ? { ...c, showTranslation: !c.showTranslation } : c),
      }));
      return;
    }
    set((state) => ({
      creatives: state.creatives.map(c => c.id === creativeId ? { ...c, isTranslating: true } : c),
    }));
    try {
      const translation = await postTranslateUk({
        metaTitle: creative.metaTitle ?? '',
        metaCopy: creative.metaCopy ?? '',
        cta: creative.cta ?? '',
      });
      set((state) => ({
        creatives: state.creatives.map(c => c.id === creativeId ? {
          ...c,
          translation: {
            metaTitle: translation.metaTitle ?? '',
            metaCopy: translation.metaCopy ?? '',
            cta: translation.cta ?? '',
          },
          isTranslating: false,
          showTranslation: true,
        } : c),
      }));
    } catch (e) {
      console.error('[toggleCreativeTranslation]', e);
      set((state) => ({
        creatives: state.creatives.map(c => c.id === creativeId ? { ...c, isTranslating: false } : c),
      }));
      get().showError(`Translation failed: ${humanizeError(e)}`);
    }
  },

  // Article tab — translate the rendered article (h1/h2/h3/p/li text inside
  // article.article-card) to UA via the shared /translate_uk webhook. Cached on
  // first call; later toggles just flip articleShowTranslation. Mirrors the
  // angle/concept/creative card UX.
  toggleArticleTranslation: async () => {
    const { articleHtml, articleTranslatedHtml, articleShowTranslation, articleIsTranslating } = get();
    if (!articleHtml || articleIsTranslating) return;

    // Cache hit — flip visibility, no network call.
    if (articleTranslatedHtml) {
      set({ articleShowTranslation: !articleShowTranslation });
      return;
    }

    set({ articleIsTranslating: true });
    try {
      const doc = new DOMParser().parseFromString(articleHtml, 'text/html');
      // The article body is the first article.article-card; the second card on
      // this page is the References block (built from <a> tags, no prose).
      const articleNode = doc.querySelector('article.article-card');
      if (!articleNode) throw new Error('Article body not found in HTML');

      const nodes = Array.from(
        articleNode.querySelectorAll('h1, h2, h3, p, li')
      ) as HTMLElement[];
      const payload: Record<string, string> = {};
      const keys: string[] = [];
      nodes.forEach((el, i) => {
        const text = (el.textContent ?? '').trim();
        if (!text) return;
        const key = `t_${i}`;
        payload[key] = text;
        keys.push(key);
      });
      if (keys.length === 0) throw new Error('No translatable text in article');

      const tr = await postTranslateUk(payload);

      nodes.forEach((el, i) => {
        const key = `t_${i}`;
        if (!(key in payload)) return;
        const translated = tr[key];
        if (typeof translated === 'string' && translated.length > 0) {
          el.textContent = translated;
        }
      });

      const translatedHtml = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
      set({
        articleTranslatedHtml: translatedHtml,
        articleIsTranslating: false,
        articleShowTranslation: true,
      });
    } catch (e) {
      console.error('[toggleArticleTranslation]', e);
      set({ articleIsTranslating: false });
      get().showError(`Translation failed: ${humanizeError(e)}`);
    }
  },

  openOfferArticle: () => set({ offerArticleOpen: true }),
  closeOfferArticle: () => set({ offerArticleOpen: false }),

  loadOfferOptions: async () => {
    // Session cache — no point refetching if we already have data or a fetch
    // is already in flight. The Offer Article page calls this on every mount,
    // so this guard keeps the UI snappy after the first successful fetch.
    const s = get();
    if (s.offerOptions || s.offerOptionsStatus === 'loading') return;
    if (!WEBHOOKS.rsocOptions) {
      set({ offerOptionsStatus: 'error', offerOptionsError: 'PUBLIC_WEBHOOK_RSOC_OPTIONS_URL is not set in .env' });
      return;
    }
    set({ offerOptionsStatus: 'loading', offerOptionsError: null });
    try {
      const ident = await getAuthEmail();
      const email = ident?.email ?? 'unknown@unknown';
      const { data } = await axios.post(WEBHOOKS.rsocOptions, { email }, { timeout: 30_000 });
      // API wraps as { data: { ... } }; n8n forwards verbatim.
      const outer = Array.isArray(data) ? data[0] : data;
      const opts: OfferOptions | null = outer?.data ?? outer ?? null;
      if (!opts || typeof opts !== 'object') {
        throw new Error('Options response missing .data');
      }
      set({ offerOptions: opts, offerOptionsStatus: 'success', offerOptionsError: null });
    } catch (e) {
      console.warn('[loadOfferOptions]', e);
      // Keep any previously cached options so the form still works on a refetch
      // failure (e.g. transient network blip).
      set({ offerOptionsStatus: 'error', offerOptionsError: humanizeError(e) });
    }
  },
}));

// Dev-only: expose the store on window so it can be inspected/mutated from
// the browser console (e.g. during manual QA without running the full pipeline).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __appStore: typeof useAppStore }).__appStore = useAppStore;
}
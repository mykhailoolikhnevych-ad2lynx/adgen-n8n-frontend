import { create } from 'zustand';
import axios from 'axios';
import { buildCreativeFilename, type CreativeFileMeta } from '@/lib/creativeFilename';

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
}

interface ErrorBanner { message: string; count: number; }
interface NoticeBanner { message: string; }

export type ArticleStatus = 'idle' | 'loading' | 'success' | 'error';

interface AppState {
  formData: FormData;
  angles: Angle[];
  agent1Output: string;
  operatorNote: string;
  article: string;
  imageGenerationModel: string;
  adLanguage: string;
  aspectRatio: string;
  concepts: Concept[];
  creatives: Creative[];
  isLoadingAngles: boolean;
  isLoadingConcepts: boolean;
  isLoadingCreatives: boolean;
  articleHtml: string | null;
  articleStatus: ArticleStatus;
  articleError: string | null;
  keywordHtml: string | null;
  keywordStatus: ArticleStatus;
  keywordError: string | null;
  errorBanner: ErrorBanner | null;
  noticeBanner: NoticeBanner | null;
  updateFormData: (field: keyof FormData, value: string) => void;
  updateAngle: (id: string, field: keyof Angle, value: string) => void;
  updateConcept: (id: string, field: keyof Concept, value: string) => void;
  updateCreative: (id: string, field: keyof Creative, value: string) => void;
  deleteCreative: (id: string) => void;
  clearConcepts: () => void;
  generateAngles: () => Promise<void>;
  generateArticle: (input: { topic: string; geo: string }) => Promise<void>;
  generateKeywords: (input: KeywordStudioInput) => Promise<void>;
  generateConcept: (angleId: string) => Promise<void>;
  generateCreative: (conceptId: string) => Promise<void>;
  sendToTelegram: (creativeId: string) => Promise<void>;
  toggleAngleTranslation: (angleId: string) => Promise<void>;
  toggleConceptTranslation: (conceptId: string) => Promise<void>;
  toggleCreativeTranslation: (creativeId: string) => Promise<void>;
  showError: (message: string) => void;
  dismissError: () => void;
  showWarning: (message: string) => void;
  dismissNotice: () => void;
  setImageGenerationModel: (value: string) => void;
  setAdLanguage: (value: string) => void;
  setAspectRatio: (value: string) => void;
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
  telegram: import.meta.env.PUBLIC_WEBHOOK_TELEGRAM_URL,
  translate: import.meta.env.PUBLIC_WEBHOOK_TRANSLATE_URL,
  article: import.meta.env.PUBLIC_WEBHOOK_ARTICLE_URL,
  keywords: import.meta.env.PUBLIC_WEBHOOK_KEYWORDS_URL,
};

export interface KeywordStudioInput {
  country: string;
  countryName: string;
  language: string;
  languageName: string;
  anchor: string;
  translation: 'auto' | 'none';
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

export const useAppStore = create<AppState>((set, get) => ({
  formData: { articleUrl: '', keyword1: '', keyword2: '', keyword3: '', geo: 'United States (US)', buyer: '', campaignName: '' },
  angles: [], agent1Output: '', operatorNote: '', article: '', concepts: [], creatives: [],
  isLoadingAngles: false, isLoadingConcepts: false, isLoadingCreatives: false,
  articleHtml: null, articleStatus: 'idle', articleError: null,
  keywordHtml: null, keywordStatus: 'idle', keywordError: null,
  imageGenerationModel: 'google/gemini-3-pro-image-preview',
  adLanguage: 'English (US)',
  aspectRatio: '1:1',
  setImageGenerationModel: (value) => set({ imageGenerationModel: value }),
  setAdLanguage: (value) => set({ adLanguage: value }),
  setAspectRatio: (value) => set({ aspectRatio: value }),
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
        return;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        set({ isLoadingAngles: false });
        return;
      }
    }
  },

  generateArticle: async ({ topic, geo }) => {
    if (!WEBHOOKS.article) {
      const msg = 'PUBLIC_WEBHOOK_ARTICLE_URL is not set in .env';
      set({ articleStatus: 'error', articleError: msg, articleHtml: null });
      get().showError(msg);
      return;
    }
    set({ articleStatus: 'loading', articleError: null, articleHtml: null });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const payload = { 'Article topic': topic, GEO: geo };
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
        return;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        const msg = humanizeError(e);
        set({ articleStatus: 'error', articleError: msg, articleHtml: null });
        get().showError(`Article generation failed: ${msg}`);
        return;
      }
    }
  },

  generateKeywords: async (input) => {
    // Async pattern (the KeywordTool run takes ~120-180s, past Cloudflare's 100s cap):
    // the webhook returns a job_id immediately, then we poll the n8n executions API
    // until the run finishes and pull the final HTML out of the last node. Mirrors
    // generateCreative — same executions-API plumbing.
    if (!WEBHOOKS.keywords) {
      const msg = 'PUBLIC_WEBHOOK_KEYWORDS_URL is not set in .env';
      set({ keywordStatus: 'error', keywordError: msg, keywordHtml: null });
      get().showError(msg);
      return;
    }
    if (!N8N_EXECUTIONS_URL) {
      const msg = 'PUBLIC_N8N_EXECUTIONS_URL is not set in .env';
      set({ keywordStatus: 'error', keywordError: msg, keywordHtml: null });
      get().showError(msg);
      return;
    }
    set({ keywordStatus: 'loading', keywordError: null, keywordHtml: null });

    const t0 = Date.now();
    const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);

    const fail = (msg: string) => {
      set({ keywordStatus: 'error', keywordError: msg, keywordHtml: null });
      get().showError(`Keyword research failed: ${msg}`);
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
        fail(humanizeError(e));
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
      if (!meta?.finished) continue;

      let full: any;
      try {
        full = (await axios.get(fullUrl, { headers: apiHeaders })).data;
      } catch (e) {
        console.error(e);
        fail(humanizeError(e));
        return;
      }

      if (full?.status !== 'success') {
        fail(`execution ${full?.status ?? 'failed'}`);
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
        fail('Run finished but returned no HTML');
        return;
      }
      set({ keywordHtml: html, keywordStatus: 'success', keywordError: null });
      return;
    }

    fail(`timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
  },

  generateConcept: async (angleId) => {
    set({ isLoadingConcepts: true });
    const angle = get().angles.find(a => a.id === angleId);
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
        return;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        set({ isLoadingConcepts: false });
        return;
      }
    }
  },

  generateCreative: async (conceptId) => {
    const concept = get().concepts.find(c => c.id === conceptId);
    if (!concept) return;

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

    const payload = {
      agent1_output: get().agent1Output,
      article: get().article,
      chosen_angle,
      chosen_creative,
      image_generation_model: get().imageGenerationModel,
      ad_language: get().adLanguage,
      aspect_ratio: get().aspectRatio,
    };

    const cleanupOnFailure = () => {
      set((state) => ({
        creatives: state.creatives.filter(c => c.id !== creativeId),
        isLoadingCreatives: false,
      }));
    };

    // Step 1: kick off the job. n8n returns:
    //   job_id        - the real n8n execution id, needed to poll the executions API
    //   batch_number  - our own resettable workflow counter (1, 2, 3 …), used for file names
    let jobId: string | null = null;
    let batchNumber = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data } = await axios.post(WEBHOOKS.creative, payload);
        const startPayload = Array.isArray(data) ? data[0] : data;
        jobId = (startPayload?.job_id ?? startPayload?.execution_id ?? startPayload?.id) ?? null;
        if (!jobId) throw new Error('Webhook did not return a job_id');
        batchNumber = Number(startPayload?.batch_number) || 0;
        break;
      } catch (e) {
        if (attempt === 0 && isRetryableError(e)) {
          get().showWarning(`${humanizeError(e)}. Retrying...`);
          continue;
        }
        console.error(e);
        cleanupOnFailure();
        return;
      }
    }
    if (!jobId) { cleanupOnFailure(); return; }

    // batch_number drives the file names + the Telegram "batch_<n>" label.
    // Fall back to the raw execution id only if n8n didn't return batch_number (legacy).
    fileMeta = { ...fileMeta, batchNumber: batchNumber || Number(jobId) || 0 };
    set((state) => ({
      creatives: state.creatives.map(c => c.id === creativeId ? { ...c, fileMeta } : c),
    }));

    // Step 2: poll the executions API until the job finishes
    const apiHeaders = { 'X-N8N-API-KEY': N8N_EXECUTIONS_API_KEY };
    const metaUrl = `${N8N_EXECUTIONS_URL}/${jobId}`;
    const fullUrl = `${N8N_EXECUTIONS_URL}/${jobId}?includeData=true`;

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      // Stop polling if the user deleted this creative card.
      if (!get().creatives.some(c => c.id === creativeId)) return;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      let meta: any;
      try {
        const res = await axios.get(metaUrl, { headers: apiHeaders });
        meta = res.data;
      } catch (e) {
        // transient poll failure — log but keep polling, the next tick may succeed
        console.warn('[generateCreative] poll error (will keep polling):', e);
        continue;
      }

      if (!meta?.finished) continue;

      // Finished — fetch the full execution data once
      let full: any;
      try {
        const res = await axios.get(fullUrl, { headers: apiHeaders });
        full = res.data;
      } catch (e) {
        console.error(e);
        cleanupOnFailure();
        return;
      }

      if (full?.status !== 'success') {
        console.error('[generateCreative] execution failed with status:', full?.status);
        get().showError(`Creative generation failed: ${full?.status ?? 'unknown error'}`);
        cleanupOnFailure();
        return;
      }

      const lastNode = full?.data?.resultData?.lastNodeExecuted;
      const result = full?.data?.resultData?.runData?.[lastNode]?.[0]?.data?.main?.[0]?.[0]?.json;
      if (!result) {
        console.error('[generateCreative] no result data in execution:', full);
        get().showError('Creative generation finished but returned no result');
        cleanupOnFailure();
        return;
      }
      // Extract images + per-variant texts (style, meta_title, meta_copy, banner_cta)
      const fallbackConcept = get().concepts.find(c => c.id === conceptId);
      const readString = (key: string): string => typeof result[key] === 'string' ? result[key] : '';

      let images: ImageVariant[] = [];
      if (Array.isArray(result.images)) {
        images = result.images
          .filter((s: any) => typeof s === 'string')
          .map((url: string, i: number) => ({
            url,
            style: String.fromCharCode(65 + i),
            metaTitle: '',
            metaCopy: '',
            cta: '',
          }));
      } else {
        images = Object.entries(result)
          .filter(([k, v]) => /^image[_a-z0-9]*url$/i.test(k) && typeof v === 'string')
          .map(([k, v]) => {
            const match = k.match(/^image_?([a-z0-9]+)?_?url$/i);
            const suffix = (match?.[1] ?? '').toLowerCase();

            const styleFromResponse = readString(suffix ? `style_${suffix}` : 'style');
            const style = styleFromResponse.trim() || suffix.toUpperCase();

            const metaTitle = readString(suffix ? `meta_title_${suffix}` : 'meta_title')
              || readString('meta_ad_title');
            const metaCopy = readString(suffix ? `meta_copy_${suffix}` : 'meta_copy')
              || readString('meta_ad_copy');
            const cta = readString(suffix ? `banner_cta_${suffix}` : 'banner_cta');

            return { url: v as string, style, metaTitle, metaCopy, cta };
          });
        if (images.length === 0 && typeof result.image_url === 'string') {
          images = [{
            url: result.image_url,
            style: readString('style'),
            metaTitle: readString('meta_title') || readString('meta_ad_title'),
            metaCopy: readString('meta_copy') || readString('meta_ad_copy'),
            cta: readString('banner_cta'),
          }];
        }
      }

      // Stamp the standardized file name on every variant (A/B/C/D -> _1/_2/_3/_4).
      images = images.map((img, i) => ({
        ...img,
        fileName: buildCreativeFilename(fileMeta, i),
      }));

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
      return;
    }

    // Polling exhausted without success
    console.error('[generateCreative] polling timed out after', POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000, 'seconds');
    get().showError(`Creative generation timed out after ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
    cleanupOnFailure();
  },

  sendToTelegram: async (creativeId) => {
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
      await axios.post(WEBHOOKS.telegram, payload);
      set((state) => ({
        creatives: state.creatives.map(c => c.id === creativeId
          ? { ...c, isSending: false, isSent: true }
          : c),
      }));
    } catch (e) {
      console.error('Ошибка отправки', e);
      set((state) => ({
        creatives: state.creatives.map(c => c.id === creativeId
          ? { ...c, isSending: false, isSent: false }
          : c),
      }));
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
}));
import { create } from 'zustand';
import axios from 'axios';

interface FormData {
  articleUrl: string;
  keyword1: string;
  keyword2: string;
  keyword3: string;
  geo: string;
  buyer: string;
}

interface Angle {
  id: string;
  direction: string;
  whyWorks: string;
  hookSeed: string;
  code: string;
  trigger: string;
  awarenessLevel: string;
  emotionalAnchor: string;
  raw?: any;
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
}
export interface ImageVariant {
  url: string;
  style: string;
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
}

interface ErrorBanner { message: string; count: number; }
interface NoticeBanner { message: string; }

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
  errorBanner: ErrorBanner | null;
  noticeBanner: NoticeBanner | null;
  updateFormData: (field: keyof FormData, value: string) => void;
  updateAngle: (id: string, field: keyof Angle, value: string) => void;
  updateConcept: (id: string, field: keyof Concept, value: string) => void;
  updateCreative: (id: string, field: keyof Creative, value: string) => void;
  deleteCreative: (id: string) => void;
  clearConcepts: () => void;
  generateAngles: () => Promise<void>;
  generateConcept: (angleId: string) => Promise<void>;
  generateCreative: (conceptId: string) => Promise<void>;
  sendToTelegram: (creativeId: string) => Promise<void>;
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
};

const N8N_EXECUTIONS_URL = import.meta.env.PUBLIC_N8N_EXECUTIONS_URL;
const N8N_EXECUTIONS_API_KEY = import.meta.env.PUBLIC_N8N_EXECUTIONS_API;
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60; // 5 minutes

export const useAppStore = create<AppState>((set, get) => ({
  formData: { articleUrl: '', keyword1: '', keyword2: '', keyword3: '', geo: 'US', buyer: '' },
  angles: [], agent1Output: '', operatorNote: '', article: '', concepts: [], creatives: [],
  isLoadingAngles: false, isLoadingConcepts: false, isLoadingCreatives: false,
  imageGenerationModel: 'google/gemini-3.1-flash-image-preview',
  adLanguage: 'English',
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
        const anglesWithIds: Angle[] = anglesArray.map((item: any) => ({
          id: crypto.randomUUID(),
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
    const placeholder: Creative = {
      id: creativeId,
      metaTitle: concept.metaTitle,
      metaCopy: concept.metaCopy,
      cta: concept.cta,
      images: [],
      isLoading: true,
      chosenAngle: chosen_angle,
      chosenCreative: chosen_creative,
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

    // Step 1: kick off the job and get the execution id
    let jobId: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data } = await axios.post(WEBHOOKS.creative, payload);
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
        cleanupOnFailure();
        return;
      }
    }
    if (!jobId) { cleanupOnFailure(); return; }

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
  }
}));
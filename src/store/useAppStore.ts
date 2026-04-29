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

interface Angle { id: string; direction: string; whyWorks: string; raw?: any; }
interface Concept { id: string; hook: string; accent: string; cta: string; metaTitle: string; metaCopy: string; sourceAngle?: Angle; raw?: any; }
export interface ImageVariant { url: string; style: string; }
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

interface AppState {
  formData: FormData;
  angles: Angle[];
  agent1Output: string;
  operatorNote: string;
  concepts: Concept[];
  creatives: Creative[];
  isLoadingAngles: boolean;
  isLoadingConcepts: boolean;
  isLoadingCreatives: boolean;
  errorBanner: ErrorBanner | null;
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
}

const WEBHOOKS = {
  angles: import.meta.env.PUBLIC_WEBHOOK_ANGLES_URL,
  concept: import.meta.env.PUBLIC_WEBHOOK_CONCEPT_URL,
  creative: import.meta.env.PUBLIC_WEBHOOK_CREATIVE_URL,
  telegram: import.meta.env.PUBLIC_WEBHOOK_TELEGRAM_URL,
};

export const useAppStore = create<AppState>((set, get) => ({
  formData: { articleUrl: '', keyword1: '', keyword2: '', keyword3: '', geo: 'US', buyer: '' },
  angles: [], agent1Output: '', operatorNote: '', concepts: [], creatives: [],
  isLoadingAngles: false, isLoadingConcepts: false, isLoadingCreatives: false,
  errorBanner: null,

  showError: (message) => set((state) => {
    const trimmed = (message ?? '').toString().slice(0, 500);
    if (!trimmed) return {};
    if (state.errorBanner && state.errorBanner.message === trimmed) {
      return { errorBanner: { message: trimmed, count: state.errorBanner.count + 1 } };
    }
    return { errorBanner: { message: trimmed, count: 1 } };
  }),
  dismissError: () => set({ errorBanner: null }),

  updateFormData: (field, value) => set((state) => ({ formData: { ...state.formData, [field]: value } })),
  updateAngle: (id, field, value) => set((state) => ({ angles: state.angles.map(a => a.id === id ? { ...a, [field]: value } : a) })),
  updateConcept: (id, field, value) => set((state) => ({ concepts: state.concepts.map(c => c.id === id ? { ...c, [field]: value } : c) })),
  updateCreative: (id, field, value) => set((state) => ({ creatives: state.creatives.map(c => c.id === id ? { ...c, [field]: value } : c) })),
  deleteCreative: (id) => set((state) => ({ creatives: state.creatives.filter(c => c.id !== id) })),
  clearConcepts: () => set({ concepts: [] }),

  generateAngles: async () => {
    set({ isLoadingAngles: true });
    try {
      const { data } = await axios.post(WEBHOOKS.angles, get().formData);
      const outer = Array.isArray(data) ? data[0] : data;
      const agent1Output: string = outer?.agent1_output ?? '';
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
        direction: item.direction,
        whyWorks: item.why_works,
        raw: item,
      }));
      set({ angles: anglesWithIds, agent1Output, operatorNote, concepts: [], creatives: [], isLoadingAngles: false });
    } catch (e) {
      console.error(e); set({ isLoadingAngles: false });
    }
  },

  generateConcept: async (angleId) => {
    set({ isLoadingConcepts: true });
    const angle = get().angles.find(a => a.id === angleId);
    const angleForWebhook = angle ? {
      ...(angle.raw ?? {}),
      direction: angle.direction,
      why_works: angle.whyWorks,
    } : null;
    try {
      const { data } = await axios.post(WEBHOOKS.concept, {
        formData: get().formData,
        angle: angleForWebhook,
        agent1_output: get().agent1Output,
        operator_note: get().operatorNote,
      });
      let payload: any = data;
      if (Array.isArray(payload)) payload = payload[0];
      if (payload && typeof payload === 'object' && typeof payload.text === 'string') {
        payload = payload.text;
      }
      while (typeof payload === 'string') payload = JSON.parse(payload);
      const items: any[] = Array.isArray(payload)
        ? payload
        : payload?.creatives ?? payload?.concepts ?? [payload];
      const newConcepts: Concept[] = items.map((item: any) => ({
        id: crypto.randomUUID(),
        hook: item.banner_hook ?? item.hook ?? '',
        accent: item.banner_accent ?? item.accent ?? '',
        cta: item.banner_cta ?? item.cta ?? '',
        metaTitle: item.meta_ad_title ?? item.metaTitle ?? item.meta_title ?? '',
        metaCopy: item.meta_ad_copy ?? item.metaCopy ?? item.meta_copy ?? '',
        sourceAngle: angle,
        raw: item,
      }));
      set((state) => ({ concepts: [...state.concepts, ...newConcepts], isLoadingConcepts: false }));
    } catch (e) {
      console.error(e); set({ isLoadingConcepts: false });
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
      chosen_angle,
      chosen_creative,
    };
    console.log('[generateCreative] request payload:', payload);
    try {
      const { data } = await axios.post(WEBHOOKS.creative, payload);
      console.log('[generateCreative] raw response:', data);
      let parsed: any = data;
      if (Array.isArray(parsed)) parsed = parsed[0];
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        parsed = parsed.text;
      }
      while (typeof parsed === 'string') parsed = JSON.parse(parsed);
      let images: ImageVariant[] = [];
      if (Array.isArray(parsed?.images)) {
        images = parsed.images
          .filter((s: any) => typeof s === 'string')
          .map((url: string, i: number) => ({ url, style: String.fromCharCode(65 + i) }));
      } else if (parsed && typeof parsed === 'object') {
        images = Object.entries(parsed)
          .filter(([k, v]) => /^image[_a-z0-9]*url$/i.test(k) && typeof v === 'string')
          .map(([k, v]) => {
            const match = k.match(/^image_?([a-z0-9]+)?_?url$/i);
            const suffix = (match?.[1] ?? '').toLowerCase();
            const styleKey = suffix ? `style_${suffix}` : 'style';
            const styleFromResponse = (parsed as any)[styleKey];
            const style = typeof styleFromResponse === 'string' && styleFromResponse.trim()
              ? styleFromResponse.trim()
              : suffix.toUpperCase();
            return { url: v as string, style };
          });
        if (images.length === 0 && typeof parsed.image_url === 'string') {
          const fallbackStyle = typeof (parsed as any).style === 'string' ? (parsed as any).style : '';
          images = [{ url: parsed.image_url, style: fallbackStyle }];
        }
      }
      set((state) => ({
        creatives: state.creatives.map(c => c.id === creativeId
          ? {
              ...c,
              metaTitle: parsed?.meta_ad_title ?? parsed?.metaTitle ?? c.metaTitle,
              metaCopy: parsed?.meta_ad_copy ?? parsed?.metaCopy ?? c.metaCopy,
              images,
              isLoading: false,
            }
          : c),
        isLoadingCreatives: false,
      }));
    } catch (e) {
      console.error(e);
      set((state) => ({
        creatives: state.creatives.filter(c => c.id !== creativeId),
        isLoadingCreatives: false,
      }));
    }
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
    console.log('[sendToTelegram] request payload:', payload);
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
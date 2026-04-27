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

interface Angle { id: string; direction: string; whyWorks: string; }
interface Concept { id: string; hook: string; accent: string; cta: string; metaTitle: string; metaCopy: string; }
interface Creative { id: string; metaTitle: string; metaCopy: string; images: string[]; }

interface AppState {
  formData: FormData;
  angles: Angle[];
  concepts: Concept[];
  creatives: Creative[];
  isLoadingAngles: boolean;
  isLoadingConcepts: boolean;
  isLoadingCreatives: boolean;
  updateFormData: (field: keyof FormData, value: string) => void;
  updateAngle: (id: string, field: keyof Angle, value: string) => void;
  updateConcept: (id: string, field: keyof Concept, value: string) => void;
  updateCreative: (id: string, field: keyof Creative, value: string) => void;
  deleteCreative: (id: string) => void;
  generateAngles: () => Promise<void>;
  generateConcept: (angleId: string) => Promise<void>;
  generateCreative: (conceptId: string) => Promise<void>;
  sendToTelegram: (creativeId: string) => Promise<void>;
}

const WEBHOOK_BASE = import.meta.env.PUBLIC_WEBHOOK_BASE_URL;
const WEBHOOK_ENDPOINTS = {
  angles: import.meta.env.PUBLIC_WEBHOOK_ENDPOINT_ANGLES,
  concept: import.meta.env.PUBLIC_WEBHOOK_ENDPOINT_CONCEPT,
  creative: import.meta.env.PUBLIC_WEBHOOK_ENDPOINT_CREATIVE,
  telegram: import.meta.env.PUBLIC_WEBHOOK_ENDPOINT_TELEGRAM,
};

export const useAppStore = create<AppState>((set, get) => ({
  formData: { articleUrl: '', keyword1: '', keyword2: '', keyword3: '', geo: 'US', buyer: '' },
  angles: [], concepts: [], creatives: [],
  isLoadingAngles: false, isLoadingConcepts: false, isLoadingCreatives: false,

  updateFormData: (field, value) => set((state) => ({ formData: { ...state.formData, [field]: value } })),
  updateAngle: (id, field, value) => set((state) => ({ angles: state.angles.map(a => a.id === id ? { ...a, [field]: value } : a) })),
  updateConcept: (id, field, value) => set((state) => ({ concepts: state.concepts.map(c => c.id === id ? { ...c, [field]: value } : c) })),
  updateCreative: (id, field, value) => set((state) => ({ creatives: state.creatives.map(c => c.id === id ? { ...c, [field]: value } : c) })),
  deleteCreative: (id) => set((state) => ({ creatives: state.creatives.filter(c => c.id !== id) })),

  generateAngles: async () => {
    set({ isLoadingAngles: true });
    try {
      const { data } = await axios.post(`${WEBHOOK_BASE}/${WEBHOOK_ENDPOINTS.angles}`, get().formData);
      const anglesWithIds = data.map((item: any) => ({ ...item, id: crypto.randomUUID() }));
      set({ angles: anglesWithIds, concepts: [], creatives: [], isLoadingAngles: false });
    } catch (e) {
      console.error(e); set({ isLoadingAngles: false });
    }
  },

  generateConcept: async (angleId) => {
    set({ isLoadingConcepts: true });
    const angle = get().angles.find(a => a.id === angleId);
    try {
      const { data } = await axios.post(`${WEBHOOK_BASE}/${WEBHOOK_ENDPOINTS.concept}`, { formData: get().formData, angle });
      const newConcept = { ...data, id: crypto.randomUUID() };
      set((state) => ({ concepts: [...state.concepts, newConcept], isLoadingConcepts: false }));
    } catch (e) {
      console.error(e); set({ isLoadingConcepts: false });
    }
  },

  generateCreative: async (conceptId) => {
    set({ isLoadingCreatives: true });
    const concept = get().concepts.find(c => c.id === conceptId);
    try {
      const { data } = await axios.post(`${WEBHOOK_BASE}/${WEBHOOK_ENDPOINTS.creative}`, { concept });
      const newCreative = { ...data, id: crypto.randomUUID() };
      set((state) => ({ creatives: [...state.creatives, newCreative], isLoadingCreatives: false }));
    } catch (e) {
      console.error(e); set({ isLoadingCreatives: false });
    }
  },

  sendToTelegram: async (creativeId) => {
    const creative = get().creatives.find(c => c.id === creativeId);
    try {
      await axios.post(`${WEBHOOK_BASE}/${WEBHOOK_ENDPOINTS.telegram}`, { creative });
      alert('Отправлено в Telegram!');
    } catch (e) {
      console.error('Ошибка отправки', e);
    }
  }
}));
// Builds the standardized creative file name, e.g.
//   aiimg_housing_help_us_0025_a1cg_f2_en_11_nbp_1
//
// Segment breakdown:
//   aiimg        - static tool identifier ("ai image generator")
//   housing_help - Campaign Name (slugified)
//   us           - GEO country code
//   0025         - batch sequence number (4-digit, zero-padded)
//   a1cg         - Angle slot + trigger code   (Angle 1, Curiosity Gap)
//   f2           - Concept formula id
//   en           - creative language code
//   11           - aspect ratio (1:1 -> 11, 16:9 -> 169, 9:16 -> 916, 4:5 -> 45)
//   nbp          - image model code (nbp / nb2 / gi2 / sd45)
//   1            - variant number (A/B/C/D -> 1/2/3/4)

export interface CreativeFileMeta {
  campaignName: string; // "Housing Help"
  geo: string;          // "United States (US)"
  batchNumber: number;  // 25
  angleSlot: number;    // 1
  angleCode: string;    // "CG"
  formula: string;      // "F2"
  adLanguage: string;   // "English (US)"
  aspectRatio: string;  // "1:1"
  imageModel: string;   // "google/gemini-3-pro-image-preview"
}

// Display label -> ISO-ish 2-letter language code.
const AD_LANGUAGE_CODES: Record<string, string> = {
  'English (US)': 'en',
  'English (UK)': 'en',
  'Spanish (Latin America)': 'es',
  'Spanish (Spain)': 'es',
  'Portuguese (Brazil)': 'pt',
  'Portuguese (Portugal)': 'pt',
  Arabic: 'ar',
  French: 'fr',
  Indonesian: 'id',
  German: 'de',
  Japanese: 'ja',
  Turkish: 'tr',
  Vietnamese: 'vi',
  Italian: 'it',
  Korean: 'ko',
  Polish: 'pl',
  Ukrainian: 'uk',
  Malay: 'ms',
  Dutch: 'nl',
  Romanian: 'ro',
  Hungarian: 'hu',
  Greek: 'el',
  Czech: 'cs',
  Serbian: 'sr',
  Swedish: 'sv',
  Catalan: 'ca',
  Bulgarian: 'bg',
  Albanian: 'sq',
  Danish: 'da',
  Finnish: 'fi',
  Norwegian: 'no',
  Slovak: 'sk',
  Belarusian: 'be',
  Croatian: 'hr',
  Lithuanian: 'lt',
  Slovenian: 'sl',
  Latvian: 'lv',
  Macedonian: 'mk',
  Estonian: 'et',
};

// Image model value -> short code.
const IMAGE_MODEL_CODES: Record<string, string> = {
  'google/gemini-3-pro-image-preview': 'nbp',     // Nano banana pro
  'google/gemini-3.1-flash-image-preview': 'nb2', // Nano banana 2
  'openai/gpt-5.4-image-2': 'gi2',                // GPT-image2
  'bytedance-seed/seedream-4.5': 'sd45',          // Seedream 4.5
};

// Lowercase, collapse non-alphanumerics to single underscore, trim underscores.
const slug = (s: string): string =>
  (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// "United States (US)" -> "us"; free text -> slugged.
const geoCode = (geo: string): string => {
  const m = (geo || '').match(/\(([^)]+)\)\s*$/);
  if (m) return m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug(geo) || 'xx';
};

const langCode = (adLanguage: string): string =>
  AD_LANGUAGE_CODES[adLanguage] || slug(adLanguage).slice(0, 2) || 'xx';

const modelCode = (model: string): string => IMAGE_MODEL_CODES[model] || 'unk';

// "1:1" -> "11", "16:9" -> "169", "9:16" -> "916", "4:5" -> "45"
const ratioCode = (aspectRatio: string): string =>
  (aspectRatio || '').replace(/[^0-9]/g, '') || '11';

// Batch-level name (no variant suffix). Used for the ZIP file name.
export const buildBatchFilename = (meta: CreativeFileMeta): string =>
  [
    'aiimg',
    slug(meta.campaignName) || 'untitled',
    geoCode(meta.geo),
    String(meta.batchNumber).padStart(4, '0'),
    `a${meta.angleSlot}${(meta.angleCode || '').toLowerCase()}`,
    (meta.formula || '').toLowerCase() || 'fx',
    langCode(meta.adLanguage),
    ratioCode(meta.aspectRatio),
    modelCode(meta.imageModel),
  ].join('_');

// Full per-variant name. variantIndex 0..3 -> trailing 1..4.
export const buildCreativeFilename = (meta: CreativeFileMeta, variantIndex: number): string =>
  `${buildBatchFilename(meta)}_${variantIndex + 1}`;

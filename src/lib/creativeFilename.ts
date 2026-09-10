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
//   1            - preset slot: A/B/C/D -> 1/2/3/4, Creative E fans out to
//                  5a/5b/5c/5d (one per ideator idea), Custom preset -> 'custom'

export interface CreativeFileMeta {
  campaignName: string;            // "Housing Help"
  geo: string;                     // "United States (US)"
  /** The n8n execution id of this creative run. Usually an integer (e.g. 25),
   *  but kept as `number | string` so non-numeric ids (UUIDs, "exec-…") are
   *  preserved verbatim instead of collapsing to 0 via NaN coercion. */
  batchNumber: number | string;
  angleSlot: number;               // 1
  angleCode: string;               // "CG"
  formula: string;                 // "F2"
  adLanguage: string;              // "English (US)"
  aspectRatio: string;             // "1:1"
  imageModel: string;              // "google/gemini-3-pro-image-preview"
  /** Creative Gen tab — the batch was generated straight from a typed
   *  Hook/Accent/CTA, with no campaign / angle / concept pipeline behind it.
   *  The file name swaps the stage segments (campaign, geo, angle, formula,
   *  language) for a single "creativeonly" marker right after the tool id. */
  creativeOnly?: boolean;
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
// Creative Gen batches have no pipeline stages (campaign / angle / formula /
// language), so those segments are omitted and a "creativeonly" marker takes
// their place: aiimg_creativeonly_0042_11_nbp.
export const buildBatchFilename = (meta: CreativeFileMeta): string =>
  meta.creativeOnly
    ? [
        'aiimg',
        'creativeonly',
        String(meta.batchNumber).padStart(4, '0'),
        ratioCode(meta.aspectRatio),
        modelCode(meta.imageModel),
      ].join('_')
    : [
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

// Full per-variant name. `variant` is the preset slot — pass 1..4 for A/B/C/D,
// '5a'..'5d' for the four Creative-E ideas, or the literal 'custom' for the
// Custom preset. The trailing token is appended verbatim, so the caller is
// responsible for picking the right slot (not the array index — that breaks
// when the user runs a partial selection like A+D).
export const buildCreativeFilename = (meta: CreativeFileMeta, variant: number | string): string =>
  `${buildBatchFilename(meta)}_${variant}`;

// Video model value -> short code, the same idea as IMAGE_MODEL_CODES above.
const VIDEO_MODEL_CODES: Record<string, string> = {
  'bytedance/seedance-2.0-fast': 'sd20f',
  'bytedance/seedance-1-5-pro': 'sd15p',
  'alibaba/wan-3.0': 'wan30',
};

const videoModelCode = (model: string): string => VIDEO_MODEL_CODES[model] || 'unk';

/** The tail segments that make an Animate-mode clip self-describing, mirroring
 *  the ratio / model / preset tail every image file already carries. */
export interface VideoGenFileMeta {
  aspectRatio: string;  // "1:1"
  videoModel: string;   // "alibaba/wan-3.0"
  /** The motion preset's visible label, or the saved prompt's name. */
  preset: string;       // "Animated text"
}

// Video Generator assets. That tab has no campaign / angle / concept behind it,
// so the stage segments collapse to a single "video_gen" marker, matching how
// Creative Gen collapses to "creativeonly". With `meta` the name then carries
// the same ratio / model / preset tail as an image file, so a folder of
// downloads still says which preset produced each clip:
//   aiimg_video_gen_16921_2   — still #2 from execution 16921
//   aivid_video_gen_16921     — a scene clip (no preset behind it)
//   aivid_video_gen_11_wan30_animated_text_53005
//                             — Animate: 1:1, Wan 3.0, "Animated text" preset
//
// The execution id goes LAST on an Animate clip, unlike the batch number in an
// image name. Deliberate: it is the only segment that changes between two runs
// of the same preset, so keeping it at the end makes a folder of downloads sort
// into preset groups — which is the question these names exist to answer.
export const videoGenFileName = (
  kind: 'image' | 'video',
  id: string | number,
  meta?: VideoGenFileMeta,
): string => {
  const prefix = `${kind === 'video' ? 'aivid' : 'aiimg'}_video_gen`;
  const execId = String(id).replace(/[^a-zA-Z0-9]+/g, '_');
  if (!meta) return `${prefix}_${execId}`;
  // Saved prompts are named by hand and can run long, so the preset token is
  // capped — trimmed back to a word boundary rather than cut mid-word.
  const preset = slug(meta.preset).slice(0, 40).replace(/_+$/, '') || 'preset';
  return [
    prefix,
    ratioCode(meta.aspectRatio),
    videoModelCode(meta.videoModel),
    preset,
    execId,
  ].join('_');
};

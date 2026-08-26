// Video Generator (admin prototype) — everything here is deliberately hardcoded.
// The point of this tab is to smoke-test OpenRouter's video endpoint and get the
// cost wiring in place; the operator only supplies the line the person speaks.
//
// Model choice: seedance-1-5-pro is the cheapest OpenRouter video model that
// still generates native audio (~$0.023/sec → ~$0.18 for an 8s clip), and the
// creative team's prompt templates are already tuned for Seedance.
export const VIDEO_MODEL = 'bytedance/seedance-1-5-pro';
export const VIDEO_DURATION_SEC = 8;
export const VIDEO_ASPECT_RATIO = '9:16';
export const VIDEO_RESOLUTION = '1080p';

// The still is generated in the same n8n run, from SOURCE_PHOTO_PROMPT below.
export const IMAGE_MODEL = 'openai/gpt-5.4-image-2';

// Roughly 2.5–3 spoken words per second, so an 8s clip fits ~24 words. Past that
// the model rushes the delivery or cuts the line off mid-sentence.
export const MAX_LINE_WORDS = 24;

// The first photo prompt from the creative team's archive. The n8n run generates
// this still with GPT-image-2, parks it in the `video_frames` datatable and hands
// Seedance a /webhook/frame/<id> URL for it — OpenRouter's image-to-video fetches
// the first frame server-side, so a base64 data URI cannot be passed directly.
export const SOURCE_PHOTO_PROMPT = `Realistic UGC-style photo shot on a smartphone, candid and natural. Medium shot of a construction worker on a house roof, turned side-on to the camera in profile, focused on his work — holding a hammer and driving a nail into the roof, mid-swing, kneeling or crouched over the surface. He does not look at the camera, absorbed in the job.

He is a man around 40 years old, ordinary everyday appearance (not a model), work-worn hands, a bit of stubble. He wears plain work clothes — a plain work shirt or t-shirt, sturdy work trousers, work gloves and a hard hat. Completely plain and unbranded — NO logos, NO brand names, NO company markings, NO text anywhere on his clothing or equipment.

Setting: the sloped roof of an ordinary American house — roof shingles, roofing materials and a few tools laid out nearby, the neighbourhood and sky visible around, bright natural daylight.

Style: shot on a phone camera, slightly imperfect framing, natural flat colors, mild grain and noise, no studio lighting, no retouching, candid authentic feel like a real photo taken on a job site. NOT stock photo, NOT a professional shoot, no smooth bokeh, documentary realism, realistic skin texture. No text anywhere in the image.`;

// Built from the creative team's VIDEO template skeleton, adapted to the roofer
// scene above. Carries the two modules that scene needs: the closed-grip block
// (the hammer, otherwise the generator opens his palm to gesture and the tool
// detaches) and an explicit no-on-screen-text negative.
export const buildVideoPrompt = (line: string): string =>
  `Animate this image into a realistic UGC-style video, handheld with slight natural shake, real-time natural motion. Keep his face, identity, appearance, his work clothes and the roof exactly as in the source image.

CRITICAL — LIP-SYNC: he is TALKING throughout — his mouth moves clearly and visibly, his lips actively form the words, full natural lip-sync matching every single word. He must clearly be seen speaking, not silent.

He pauses his work, lowers the hammer and turns toward the camera, saying calmly and warmly:
"${line.trim()}"

IMPORTANT — THE HAMMER: he keeps a firm, closed grip on the hammer the entire time — his fingers stay wrapped around the handle, never opening or releasing. It never floats, never sticks to an open hand, never detaches, and it moves together with the arm as one. He gestures only with his FREE hand as he talks.

Voice: a natural adult male voice matching a man around 40 — warm, calm, confident, sincere, natural American English, lively everyday conversational speed, not slow or over-articulated.

Camera: static, slight natural handheld feel, no zoom, no sharp moves. Real-time pacing.

Audio: natural outdoor ambience — light wind, quiet distant neighbourhood sounds. No music.

Style: authentic UGC, shot on a phone, slightly imperfect framing, natural flat colors, mild grain, bright natural daylight, candid documentary realism. NOT a polished ad, NOT stock footage. No on-screen text, no subtitles, no captions, no watermark. STRONG, CLEAR, ACCURATE LIP-SYNC.`;

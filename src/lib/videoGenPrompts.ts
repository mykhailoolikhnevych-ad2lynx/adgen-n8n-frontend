// Video Generator (admin prototype). The recipe lives here rather than in n8n so
// the whole thing is readable and tweakable in one file; n8n just executes it.
//
// Two phases: an article URL produces 4 different scene variants (prompt + still),
// the operator picks one, and that still is animated with their line.

// Seedance, because the creative team's prompt templates are tuned for it.
// 2.0-fast generates native audio and supports first-frame control, which the
// lip-sync and the caption pass both depend on.
//
// NOTE on price: OpenRouter's headline per-second rate is the 480p floor, and
// the real rate scales steeply with resolution — an 8s 1080p clip has billed
// around a dollar in practice, not the ~$0.18 the rate card implies. Dropping
// VIDEO_RESOLUTION to '720p' is the single biggest cost lever here.
export const VIDEO_MODEL = 'bytedance/seedance-1-5-pro';
export const VIDEO_DURATION_SEC = 8;
export const VIDEO_ASPECT_RATIO = '9:16';
// 480p is the cheapest tier and the rate card's floor — good for testing scenes
// and picking a winner. Too soft to actually ship: TikTok and Meta want
// 1080x1920, so bump this back to '1080p' for the final render of a keeper.
export const VIDEO_RESOLUTION = '480p';

export const IMAGE_MODEL = 'openai/gpt-5.4-image-2';
// Writes the 4 scene variants. The quality of these prompts drives everything
// downstream, so this is the one place worth spending on a bigger model.
export const PROMPT_MODEL = 'anthropic/claude-opus-5';

export const FRAME_COUNT = 4;

// Leonardo resells the same Seedance/Veo/Kling models, so output is comparable.
// It bills in opaque credits rather than dollars, and it will not fetch an
// external start-frame URL — the still has to be uploaded to their account
// first — so this stays a parallel path, not a replacement.
export type VideoProvider = 'openrouter' | 'leonardo';
export const LEONARDO_VIDEO_MODEL = 'seedance-2.0-fast';
// Leonardo takes explicit pixels rather than a resolution tier. Both values must
// divide by 16 — 480x854 is a true 9:16 ratio but 854 does not, and Leonardo
// rejects it with an opaque "An error occurred." validation error. 720x1280 is
// exactly 9:16 and verified to pass validation.
export const LEONARDO_WIDTH = 720;
export const LEONARDO_HEIGHT = 1280;

// Reads the finished clip's own audio back for caption timings. whisper-1 routes
// to OpenAI, which is where `timestamp_granularities: ["word"]` is supported —
// other providers reject that parameter. Pennies per clip.
export const TRANSCRIBE_MODEL = 'openai/whisper-1';

// Roughly 2.5–3 spoken words per second, so an 8s clip fits ~24 words. Past that
// the model rushes the delivery or cuts the line off mid-sentence.
export const MAX_LINE_WORDS = 24;

// ---------------------------------------------------------------- Animate mode
//
// The second mode of the tab: no article and no scene writing — the operator
// uploads a finished static banner and it gets animated as-is. Same video leg as
// the scene mode (the still is parked in `video_frames` and Seedance is handed
// its webhook URL), only the frame comes from an upload instead of a generation.
export type VideoGenMode = 'scene' | 'animate';

// The models Animate mode can run, with the capability differences that
// actually change the request. Values verified against OpenRouter's video
// catalog (GET /api/v1/videos/models) — note the slug punctuation is NOT
// consistent across Seedance generations: dots in 2.0, hyphens in 1-5.
//
// Scene mode deliberately stays on 1.5-pro whatever is picked here: 2.0's
// input-image moderation rejects its generated stills as "may contain real
// person". That filter reads the uploaded image here too, so a banner built
// around a large, frontal, unobstructed face may come back as
// InputImageSensitiveContentDetected — switching to 1.5 Pro is the way out.
export interface AnimateModel {
  label: string;
  value: string;
  /** Every tier the model accepts, cheapest first. Highest is the default,
   *  since a banner is mostly typography and low tiers smear the text. */
  resolutions: string[];
  /** wan-3.0 takes a first frame only. Without a last frame the loop stops
   *  being structural, so the prompt has to carry it instead. */
  supportsLastFrame: boolean;
}

export const ANIMATE_VIDEO_MODELS: AnimateModel[] = [
  {
    label: 'Seedance 2.0 Fast',
    value: 'bytedance/seedance-2.0-fast',
    resolutions: ['480p', '720p'],
    supportsLastFrame: true,
  },
  {
    label: 'Seedance 1.5 Pro',
    value: 'bytedance/seedance-1-5-pro',
    resolutions: ['480p', '720p', '1080p'],
    supportsLastFrame: true,
  },
  {
    label: 'Wan 3.0',
    value: 'alibaba/wan-3.0',
    resolutions: ['480p', '720p', '1080p'],
    supportsLastFrame: false,
  },
];

export const ANIMATE_MODEL_DEFAULT = 'bytedance/seedance-2.0-fast';

export const animateModelFor = (value: string): AnimateModel =>
  ANIMATE_VIDEO_MODELS.find((m) => m.value === value) ?? ANIMATE_VIDEO_MODELS[0];

// Whatever the banner is, one of these is what it actually is. Auto-detected
// from the uploaded file's own pixels, then overridable. These five are the
// intersection of all three models' aspect_ratio enums — Seedance also takes
// 21:9 and 9:21, which no banner needs. NOT 4:5: no model here accepts it.
export const ANIMATE_ASPECT_RATIOS = ['9:16', '3:4', '1:1', '4:3', '16:9'] as const;

/** Snap real pixel dimensions to the closest ratio the video API accepts. */
export const nearestAspectRatio = (width: number, height: number): string => {
  const r = width / height;
  const value = (s: string): number => {
    const [w, h] = s.split(':').map(Number);
    return w / h;
  };
  return [...ANIMATE_ASPECT_RATIOS].reduce((best, cand) =>
    Math.abs(value(cand) - r) < Math.abs(value(best) - r) ? cand : best,
  );
};

// One prompt for every banner, because the operator supplies no description of
// what is in the image — the model is looking at it and we are not. So instead
// of naming elements (the way the hand-written examples do: "the purple hearts",
// "the red fabric banner") this addresses them by CATEGORY, and each rule is
// conditional — "if there is fabric, it waves". A banner with none of a category
// simply skips that line.
//
// The two things that break these renders are the model redrawing the artwork
// and the model rewriting the text, so both come first. Everything else is
// deliberately small: shimmer, breeze, pulse. The failure mode of "too subtle"
// is a boring clip; the failure mode of "too much" is a garbled banner.
//
// Aspect ratio, duration and the loop are NOT mentioned here. The first two are
// real fields in the /api/v1/videos body, and the loop is enforced structurally
// — the same still is sent as both `first_frame` and `last_frame`, so the clip
// has to end where it started. Asking for it in prose as well only adds tokens
// the model can contradict.

// The blocks every preset shares. Preserving the artwork and preserving the text
// are non-negotiable whatever the motion is, so they are written once.
const TEXT_RULE =
  'TEXT NEVER CHANGES: every word, letter and number keeps its exact spelling, font, size, color and position. No new text, no translation, no subtitles. Letters never warp, slide, bounce or fade, and stay sharp and readable in every frame.';

const AUDIO_RULE =
  'AUDIO: quiet instrumental background music matching the mood of the image — soft piano, warm ambient pads, gentle and unobtrusive, mixed low. No vocals, no lyrics, no voiceover, no speech, no sound effects.';

const AVOID_BASE =
  'new or distorted letters, subtitles, watermarks, extra objects, things appearing or disappearing, morphing or melting shapes, flicker, colour shift, scene change';

// Motion rules by category rather than by name — the operator describes nothing,
// so a rule only fires if the image happens to contain that kind of thing.
const SUBTLE_MOTION = `- text and CTA buttons: a soft light shimmer sweeps across them every 2-3 seconds with a faint brightness pulse; the letters and shapes themselves stay still
- fabric, banners, flags, clothing: gentle realistic wind, shallow folds travelling across the surface, corners fluttering; printed text stays readable
- plants, flowers, leaves, hair: sway in a light breeze
- water, smoke, steam, fire: slow natural flow
- sky and clouds: drift very slowly; light and shadows shift subtly
- vehicles, buildings, furniture, products: completely still, at most a soft highlight passing along an edge
- icons, hearts, keys, arrows, sparkles: slight floating drift and a soft glow pulse, never covering text
- people and animals: micro-motion only — slow blinking, quiet breathing, a tiny shift of head or hand. Face, clothing and pose unchanged, mouth closed, nobody speaks or walks`;

export interface AnimatePreset {
  id: string;
  label: string;
  hint: string;
  /**
   * Whether the same still can be pinned as both first and last frame.
   *
   * False for anything with a travelling camera — a clip that ends where it
   * started cannot also have moved somewhere, so pinning both ends would fight
   * the motion the preset exists to produce.
   */
  loop: boolean;
  prompt: string;
}

export const ANIMATE_PRESETS: AnimatePreset[] = [
  {
    id: 'subtle',
    label: 'Subtle',
    hint: 'Locked camera, shimmer and micro-motion. Safest for text — start here.',
    loop: true,
    prompt: `PRESERVE EXACTLY: keep the composition, layout, crop, background, colors, lighting, style and every element exactly as in the source image. Nothing is redrawn, restyled, added, removed, resized or moved.

${TEXT_RULE}

MOTION — subtle, and only where it is physically natural. Apply only what matches the image:
${SUBTLE_MOTION}

CAMERA: locked-off and static, at most a barely perceptible handheld breath. No zoom, pan, tilt, orbit, cut or reframing.

${AUDIO_RULE}

AVOID: ${AVOID_BASE}, camera movement.`,
  },
  {
    id: 'kinetic',
    label: 'Animated text',
    hint: 'The headline itself moves — glow sweep, brightness pulse, a small springy settle. Loops.',
    loop: true,
    // The one preset where the text is allowed to move, which makes it the one
    // most likely to come back misspelled: a model that is redrawing letters
    // frame to frame will eventually redraw them wrong. Hence the split below —
    // a text block may move as a rigid piece, but the letterforms inside it are
    // as fixed as in every other preset.
    //
    // Pinning first == last frame forces the cycle to close, but it also tempts
    // a model to satisfy both endpoints by doing nothing at all, so the prompt
    // has to demand that the middle of the clip visibly differs.
    prompt: `PRESERVE EXACTLY: keep the composition, layout, crop, background, colors, lighting, style and every element exactly as in the source image. Nothing is redrawn, restyled, added, removed or replaced.

TEXT — IT MOVES, BUT IT IS NEVER REWRITTEN: every word, letter, number and punctuation mark keeps its exact spelling, font, weight, colour and proportions for the whole clip. A block of text may move as one rigid piece, but the letterforms inside it never warp, stretch, melt, wobble individually, swap, duplicate or disappear. No new text, no translation, no subtitles. The text stays sharp and fully readable in every single frame.

TEXT MOTION — this is the point of the shot. Animate each text block as one solid unit:
- a soft bright glow sweeps slowly across the lettering, edge to edge, about once every 2-3 seconds
- a gentle pulse of brightness follows the glow through
- the block rises and settles by a very small amount, or breathes in scale by a few percent — smooth and springy, never a hard or fast bounce
- separate lines may settle in sequence, the headline leading and the CTA following
- the CTA button gets a glossy highlight sweep and a soft brightness pulse; its shape and size do not change
- keep every movement small: no text travels more than a few percent of the frame, nothing leaves its own area, overlaps another element or touches the frame edge
- the motion is clearly visible — the middle of the clip must look different from the start, not almost identical
- the glow sweep and the settle each complete a whole number of cycles, ending exactly where they began

SCENE MOTION — kept minimal so the text stays the focus:
- background, photography and objects stay essentially still, with only a very subtle drift of light
- plants, fabric, water, smoke and clouds may move gently if the image contains them
- people and animals: micro-motion only — blinking, quiet breathing. Mouths stay closed, nobody speaks

CAMERA: locked-off and static. No zoom, pan, tilt, orbit, cut or reframing.

${AUDIO_RULE}

AVOID: ${AVOID_BASE}, letters changing shape or spelling, letters animating one by one, text flickering or vanishing, harsh or fast bouncing, text sliding off its area, camera movement.`,
  },
  {
    id: 'wind',
    label: 'Wind & fabric',
    hint: 'Camera still, but cloth, flags, foliage and sky move for real. For outdoor photo banners.',
    loop: true,
    prompt: `PRESERVE EXACTLY: keep the composition, layout, crop, background, colors, lighting, style and every element exactly as in the source image. Nothing is redrawn, restyled, added, removed, resized or moved.

${TEXT_RULE}

MOTION — the scene is outdoors in a light, steady wind. Apply only what matches the image:
- fabric banners, flags, awnings, curtains and clothing behave as real flexible cloth: the wind moves them from one side to the other, natural folds and shallow ripples travel across the surface, edges and corners flutter. They stay attached to their supports, never tear, stretch excessively or fold over
- text printed on moving fabric follows the surface with slight natural perspective deformation, but stays sharp, complete and readable — no letter is ever lost
- trees, plants, flowers, grass and hair sway in the same wind, in the same direction
- water ripples, smoke and steam drift with the wind
- sky and clouds move slowly across the frame; light and shadows shift subtly as they pass
- rigid objects — vehicles, buildings, poles, signage, products — do not move at all
- overlaid graphics, CTA buttons and captions are NOT part of the scene: they stay perfectly fixed, with only a soft light shimmer passing across them every 2-3 seconds
- people and animals: micro-motion only — blinking, quiet breathing, clothing and hair moving in the wind. Mouths stay closed, nobody speaks or walks

The wind is moderate and natural, never violent.

CAMERA: locked-off and static, at most a barely perceptible handheld breath. No zoom, pan, tilt, orbit, cut or reframing.

${AUDIO_RULE}

AVOID: ${AVOID_BASE}, camera movement.`,
  },
  {
    id: 'orbit',
    label: 'Cinematic orbit',
    hint: 'Slow arc around the scene for real parallax. Overlaid text stays pinned. Cannot loop.',
    loop: false,
    prompt: `PRESERVE THE ARTWORK: keep every element, its design, colours, lighting, style and text exactly as in the source image. Nothing is redrawn, restyled, added, removed or replaced. The viewpoint changes only because the camera moves — the artwork itself never changes.

${TEXT_RULE} All headline, CTA and overlaid graphic elements are pinned flat to the frame: they stay in exactly the same screen position at the same size for the whole clip, and the camera move does NOT drag, tilt, skew or parallax them.

MOTION:
- the camera arcs slowly and smoothly around the scene, revealing real parallax between foreground, subject and background
- everything in the photographed scene holds its own position; only the viewpoint changes
- plants, fabric, water, smoke and clouds add their own gentle natural movement on top
- people and animals: micro-motion only — blinking, quiet breathing, a small shift of head or hand. Mouths stay closed, nobody speaks
- headline text, CTA buttons and decorative overlays get only a soft glow shimmer and a faint brightness pulse, always in their fixed screen positions

CAMERA: one continuous, slow, smooth arc in a single direction. Gentle and cinematic, no acceleration, no sudden moves, no rotation of the horizon, no zoom, no cuts. The move is small — this is a subtle reveal, not a fly-around.

${AUDIO_RULE}

AVOID: ${AVOID_BASE}, fast or jerky camera motion, the camera passing through objects, overlaid text drifting or skewing with the camera.`,
  },
  {
    id: 'walkin',
    label: 'Walk-in (UGC)',
    hint: 'Handheld push forward, phone-footage feel. Overlaid text stays pinned. Cannot loop.',
    loop: false,
    prompt: `PRESERVE THE ARTWORK: keep every element, its design, colours, lighting, style and text exactly as in the source image. Nothing is redrawn, restyled, added, removed or replaced. The viewpoint changes only because the camera moves — the artwork itself never changes.

${TEXT_RULE} All headline, CTA and overlaid graphic elements are pinned flat to the frame: they stay in exactly the same screen position at the same size for the whole clip, and the camera move does NOT drag, tilt, skew or parallax them.

MOTION:
- the camera moves forward at a natural, moderately brisk walking pace, as if someone is walking into the scene filming on a phone
- make clear forward progress: by the end the subject is noticeably closer and larger than at the start
- mild, realistic handheld motion — small natural bounce and sway, never shaky or nauseating
- real parallax between the ground, the subject and the background as the camera advances
- plants, fabric, water, smoke and clouds add their own gentle natural movement
- people and animals: micro-motion only — blinking, quiet breathing, a small shift of head or hand. Mouths stay closed, nobody speaks
- headline text, CTA buttons and decorative overlays get only a soft glow shimmer and a faint brightness pulse, always in their fixed screen positions

CAMERA: continuous forward travel with a natural handheld feel. No digital zoom, no rotation, no cuts, no sudden reframing, no reversing.

${AUDIO_RULE}

AVOID: ${AVOID_BASE}, shaky or nauseating camera motion, digital zoom, the camera passing through objects, overlaid text drifting or skewing with the camera.`,
  },
];

export const ANIMATE_PRESET_DEFAULT = 'subtle';

export const animatePresetFor = (id: string): AnimatePreset =>
  ANIMATE_PRESETS.find((p) => p.id === id) ?? ANIMATE_PRESETS[0];

// Appended only when a preset wants a loop and the model cannot pin a last
// frame. Where the last frame IS pinned the loop is structural, and repeating it
// in prose would just be a rule the model can contradict.
export const ANIMATE_LOOP_RULE =
  '\n\nLOOP: the last frame matches the first in composition, lighting and animation phase, so it repeats with no visible jump.';

// Distilled from the creative team's PHOTO and VIDEO templates plus their system
// prompt doc, with the gaps those docs had filled in: an explicit 9:16 rule, a
// no-on-screen-text negative, and a hard requirement that the 4 variants differ.
export const SCENE_SYSTEM_PROMPT = `You write image and video prompts for UGC-style advertising creatives. You always write in English, whatever language the input is in.

You will be given an advertorial article and one line of dialogue. Produce EXACTLY 4 creative variants for a 9:16 vertical talking-head ad based on that article.

THE 4 VARIANTS MUST BE GENUINELY DIFFERENT FROM EACH OTHER:
- a different person each time — vary age, gender, ethnicity and occupation
- a different location and situation
- a different framing (for example: phone selfie, medium shot, wide shot, filmed from a propped phone)
Never produce four versions of the same idea. If the article suggests one obvious scene, use it for ONE variant only and invent three genuinely different angles for the rest.

=== PHOTO PROMPT RULES ===

Structure: [framing] of [person + what they are doing + where they look]. [person details]. Setting: [location + lighting]. Style: [anti-stock block].

- VERTICAL 9:16: the subject sits in the middle band of a tall frame. Keep the top ~10% and bottom ~25% clear of anything important. NEVER place two people side by side — stagger them in depth, one nearer the camera and one further back.
- NEVER a tight face close-up. Frame no closer than mid-chest, so the head occupies at most about a quarter of the frame height and the surroundings are clearly visible. Selfies are fine — an arm's-length selfie is a mid-chest shot, not a face close-up.
- NEVER a straight-on frontal portrait. The head is always turned slightly off-axis — a few degrees away from the lens, or a three-quarter angle. Describe it explicitly, e.g. "his head turned slightly to one side, not squared to the camera".
- The person is one element inside a scene, never the subject of a portrait. There is always visible context around them — room, street, furniture, tools, weather. Never write the words "portrait", "headshot" or "close-up".
- Natural partial occlusion ABOVE the mouth helps: reading glasses, a cap brim, hair falling across the temple, a raised hand near the ear. The mouth and jaw must stay completely visible and unobstructed — the video model has to lip-sync them.

WHY THOSE FOUR RULES EXIST: the video model runs a likeness check on the still and rejects anything that reads as a photograph of a real, identifiable individual ("may contain real person"), which kills the whole variant. It keys on a large, frontal, unobstructed face — not on realism. Following the rules above costs nothing in authenticity.
- Give the person's age as a number or range: "around 55", "around 68-72".
- Always include this phrase verbatim: "Ordinary everyday appearance (not a model)".
- Always END the photo prompt with this block verbatim: "Style: shot on a phone camera, slightly imperfect framing, natural flat colors, mild grain and noise, no studio lighting, no retouching, candid authentic feel. NOT stock photo, NOT a professional portrait, no smooth bokeh, documentary realism, realistic skin texture. No text anywhere in the image."
- Work clothes or a uniform: add "NO logos, NO brand names, NO company markings".
- Wide shot: add "full-body from head to toe, including their feet".
- Non-US location: add "No rugs on walls, no Soviet-style decor. NOT Eastern European." plus two or three local markers.
- Space above the head must show the natural continuation of the room (ceiling, lights), never an empty blank wall.

=== VIDEO PROMPT RULES ===

Follow this skeleton exactly:

"Animate this image into a realistic UGC-style video, [motion], real-time natural motion. Keep [his/her] face, identity, appearance and the [setting] exactly as in the source image.

CRITICAL — LIP-SYNC: [he/she] is TALKING throughout — [his/her] mouth moves clearly and visibly, [his/her] lips actively form the words, full natural lip-sync matching every single word. [He/She] must clearly be seen speaking, not silent.

[He/She] says, [tone]:
\\"[THE LINE]\\"

[action block — what they do while speaking]

Voice: a natural [age/gender] voice matching [description] — warm, calm, confident, sincere, [accent], lively everyday conversational speed, not slow or over-articulated.

Camera: static, slight natural handheld feel, no zoom, no sharp moves. Real-time pacing.

Audio: [ambience]. No music.

Style: authentic UGC, shot on a phone, slightly imperfect framing, natural flat colors, mild grain, [lighting], candid documentary realism. NOT a polished ad, NOT stock footage. No on-screen text, no subtitles, no captions, no watermark. STRONG, CLEAR, ACCURATE LIP-SYNC."

- Use the supplied line EXACTLY, word for word. Never rewrite, shorten or translate it.
- Object in hand (tool, keys, clipboard, cup, cane): add a closed-grip block — fingers stay wrapped around it, never opening or releasing, it never floats or detaches, it moves together with the arm as one; gestures come only from the FREE hand.
- Second person in frame: add that they stay quiet and calm WITHOUT speaking — occasional glances, a small nod, a soft smile, natural blinking, mouth stays closed, NOT frozen and NOT theatrical.
- Seated in a wheelchair: their legs do not move at all, only the upper body is alive. Call it "her chair" / "his chair", never "wheelchair".
- Driving: eyes stay on the road the WHOLE time, never looking at the camera, and the scenery outside the windows keeps moving.
- NEVER write "relaxed conversational pace" — it produces slow, over-articulated speech.
- Amounts as words ("fifty dollars", never "$50"). Abbreviations with dots ("S.S.I.").

=== MODERATION ===

Keep financially sensitive vocabulary OUT of the scene description — it belongs only in the spoken line. Write "a woman at a counter", not "a bank teller counting money". Avoid in scene text: can't afford, no credit check, low income, loans, disabilities, benefits, specific sums.

=== OUTPUT ===

Return ONLY a JSON array of exactly 4 objects. No markdown fence, no commentary, no explanation:

[{"label": "3-6 word description of the variant", "photo_prompt": "...", "video_prompt": "..."}]`;

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
// Leonardo takes explicit pixels rather than a resolution tier. 9:16 at the
// cheap tier, matching VIDEO_RESOLUTION on the OpenRouter side.
export const LEONARDO_WIDTH = 480;
export const LEONARDO_HEIGHT = 854;

// Reads the finished clip's own audio back for caption timings. whisper-1 routes
// to OpenAI, which is where `timestamp_granularities: ["word"]` is supported —
// other providers reject that parameter. Pennies per clip.
export const TRANSCRIBE_MODEL = 'openai/whisper-1';

// Roughly 2.5–3 spoken words per second, so an 8s clip fits ~24 words. Past that
// the model rushes the delivery or cuts the line off mid-sentence.
export const MAX_LINE_WORDS = 24;

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

# Motion preset samples

Thumbnails for the Video Generator → Animate image → **Motion preset** list.

A preset describes *motion*, so a still cannot show what it does. Each built-in
preset therefore gets a short silent loop of **the same reference banner**
rendered through that preset. Using one banner for all of them is the whole
point: side by side, the only thing that differs is the motion.

## Files

The picker looks for these paths — nothing to register, nothing to import:

| Preset            | Clip                | Poster (first frame) |
| ----------------- | ------------------- | -------------------- |
| Subtle            | `subtle.mp4`        | `subtle.jpg`         |
| Animated text     | `kinetic.mp4`       | `kinetic.jpg`        |
| Wind & fabric     | `wind.mp4`          | `wind.jpg`           |
| Cinematic orbit   | `orbit.mp4`         | `orbit.jpg`          |
| Walk-in (UGC)     | `walkin.mp4`        | `walkin.jpg`         |

The names are the preset `id`s in `src/lib/videoGenPrompts.ts`. A preset with no
clip yet simply shows an empty slot and its text hint — nothing breaks, so these
can be filled in one at a time. `Custom` never gets one.

## How to produce them

1. Pick ONE reference banner — an ordinary creative with a headline and a CTA
   button, so the text-preservation behaviour is visible. Use the same file for
   every preset. Shape does not matter (the current set is 640×640); the
   thumbnail is square and `object-cover`.
2. In Video Generator → Animate image, upload it and Generate once per preset.
3. Download each clip (`Download video`, not the upscaled one — these are 44 px
   thumbnails).
4. Mute and shrink each one. Keep the **full 8 seconds** — the slower presets
   (orbit, walk-in) only show what they do near the end, so a trimmed clip would
   misrepresent them:

```bash
ffmpeg -i subtle_raw.mp4 -an -vf "scale=-2:320" -c:v libx264 -crf 30 -movflags +faststart -pix_fmt yuv420p subtle.mp4
```

5. Pull the poster out of the encoded clip:

```bash
ffmpeg -i subtle.mp4 -frames:v 1 -q:v 6 subtle.jpg
```

Aim for ~250 KB per clip (the current set is 200–320 KB, ~1.5 MB in total). Only
the five posters (~12 KB each) load when the tab opens — the clips themselves are
`preload="none"` and are fetched the first time a row is hovered or selected.

The lightbox is capped at 640 px so a 480 px sample is never blown up into
mush; raise the encode height and that cap together if these ever need to be
inspected larger.

## When to regenerate

Whenever a preset's prompt changes materially in `videoGenPrompts.ts`. A clip
that no longer matches what the preset does is worse than no clip at all, since
the operator picks on the strength of it.

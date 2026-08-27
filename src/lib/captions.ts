// Turning Whisper word timings into ad-style captions.
//
// Grouping happens here rather than in n8n so the on-screen overlay and the
// downloaded .srt are always built from the same code — tweaking how the lines
// break is a one-file change, no workflow re-import.

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

// Short bursts read better than full sentences on a 9:16 ad — the eye catches
// 2–3 words per beat while the face keeps its attention.
const MAX_WORDS_PER_CUE = 3;
const MAX_CHARS_PER_CUE = 22;
// A cue that flashes for 200ms is unreadable; stretch it toward the next word.
const MIN_CUE_SEC = 0.4;

/** Whisper returns `{ word, start, end }`, but field names vary by provider —
 *  accept the common aliases rather than silently producing nothing. */
export const normalizeWords = (raw: unknown): CaptionWord[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((w: any) => ({
      word: String(w?.word ?? w?.text ?? '').trim(),
      start: Number(w?.start ?? w?.start_time ?? NaN),
      end: Number(w?.end ?? w?.end_time ?? NaN),
    }))
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
};

export const groupWordsIntoCues = (words: CaptionWord[]): CaptionCue[] => {
  const cues: CaptionCue[] = [];
  let bucket: CaptionWord[] = [];

  const flush = () => {
    if (!bucket.length) return;
    cues.push({
      start: bucket[0].start,
      end: bucket[bucket.length - 1].end,
      text: bucket.map((w) => w.word).join(' '),
    });
    bucket = [];
  };

  for (const w of words) {
    const wouldBe = [...bucket, w].map((x) => x.word).join(' ');
    if (bucket.length >= MAX_WORDS_PER_CUE || wouldBe.length > MAX_CHARS_PER_CUE) flush();
    bucket.push(w);
  }
  flush();

  // Pad anything too brief to read, without overlapping the next cue.
  return cues.map((c, i) => {
    if (c.end - c.start >= MIN_CUE_SEC) return c;
    const nextStart = cues[i + 1]?.start ?? c.start + MIN_CUE_SEC;
    return { ...c, end: Math.min(c.start + MIN_CUE_SEC, nextStart) };
  });
};

const srtTime = (sec: number): string => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
};

export const toSrt = (cues: CaptionCue[]): string =>
  cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`)
    .join('\n\n') + '\n';

export const cueAt = (cues: CaptionCue[], t: number): CaptionCue | null =>
  cues.find((c) => t >= c.start && t <= c.end) ?? null;

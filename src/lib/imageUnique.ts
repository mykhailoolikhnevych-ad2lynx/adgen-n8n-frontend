// Produce a visually identical copy of a creative that is a *different file*.
//
// Two independent steps, both needed:
//
//   1. Brightness shift (±1 of 255). Sub-perceptual — max delta is under 0.5% —
//      but it does change the decoded pixels, which a pure re-encode does not.
//   2. A unique comment segment stamped into the container. Without this, two
//      runs at the same brightness produce byte-identical output and therefore
//      the SAME hash, which defeats the whole point. The stamp guarantees every
//      copy is unique no matter how many times the operator clicks.
//
// Everything happens client-side; there is no webhook and no cost.

export type Brightness = 1 | -1;

export interface UniqueCopy {
  blob: Blob;
  /** Object URL for <img> / download. Caller owns it and must revoke. */
  url: string;
  fileName: string;
  /** SHA-256 prefix, shown in the UI so the operator can see copies differ. */
  hash: string;
  width: number;
  height: number;
  bytes: number;
}

// Canvas can only re-encode to these. WebP input is routed to JPEG output so the
// result is always something both Meta and TikTok ingest without transcoding.
const outputTypeFor = (inputType: string): 'image/jpeg' | 'image/png' =>
  inputType === 'image/png' ? 'image/png' : 'image/jpeg';

// Must be 1.0, not "high enough". Canvas cannot reuse the source's quantization
// tables, so anything below 1.0 re-quantizes and rings around the crisp text and
// CTA pills these banners are full of. Measured on a 1080x1080 banner, brightness +1:
//
//   q0.98 -> max delta 17, 0.49% of channels over 3
//   q1.00 -> max delta  4, 0.002% of channels over 3
//
// The 2x file size is irrelevant next to Meta/TikTok upload limits.
// Ignored for PNG (lossless).
const JPEG_QUALITY = 1.0;

/** Draw the file to a canvas and shift every RGB channel by `delta`. */
async function shiftBrightness(
  file: File,
  delta: Brightness,
  outType: 'image/jpeg' | 'image/png',
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data; // Uint8ClampedArray — clamps 0..255 on assignment for us
    for (let i = 0; i < d.length; i += 4) {
      d[i] += delta;
      d[i + 1] += delta;
      d[i + 2] += delta;
      // d[i + 3] is alpha — left alone.
    }
    ctx.putImageData(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outType, outType === 'image/jpeg' ? JPEG_QUALITY : undefined),
    );
    if (!blob) throw new Error('Canvas encoding failed');
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

/**
 * Insert a JPEG COM (comment) segment after the leading APPn segments. Decoders
 * skip COM entirely, and the entropy-coded scan data is never touched, so the
 * decoded image is bit-for-bit what it was before the stamp.
 *
 * It must NOT go directly after SOI, even though decoders accept that: JFIF
 * requires APP0 to be the first marker after SOI, so splicing a comment in front
 * of it moves the "JFIF" signature off byte 6. Content sniffers that key on that
 * offset — libmagic, and the hand-rolled checks ad platforms run on upload —
 * then stop identifying the file as a JPEG and reject it.
 */
function stampJpeg(buf: Uint8Array, text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const segLen = payload.length + 2; // length field counts itself
  if (segLen > 0xffff) throw new Error('comment too long');

  // Walk SOI, then every leading APPn (0xFFE0..0xFFEF) segment. Each carries a
  // big-endian length that covers itself but not the 2-byte marker.
  let at = 2;
  while (at + 4 <= buf.length && buf[at] === 0xff && buf[at + 1] >= 0xe0 && buf[at + 1] <= 0xef) {
    at += 2 + ((buf[at + 2] << 8) | buf[at + 3]);
  }

  const out = new Uint8Array(buf.length + 4 + payload.length);
  out.set(buf.subarray(0, at), 0);
  out[at] = 0xff;
  out[at + 1] = 0xfe; // COM marker
  out[at + 2] = segLen >> 8;
  out[at + 3] = segLen & 0xff;
  out.set(payload, at + 4);
  out.set(buf.subarray(at), at + 4 + payload.length);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * Insert a PNG tEXt chunk after IHDR. Offset 33 is fixed by the spec:
 * 8-byte signature + IHDR (4 length + 4 type + 13 data + 4 CRC = 25).
 */
function stampPng(buf: Uint8Array, keyword: string, text: string): Uint8Array {
  const body = new TextEncoder().encode(`${keyword}\0${text}`);
  const type = new TextEncoder().encode('tEXt');

  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(type, 4);
  chunk.set(body, 8);

  const crcInput = new Uint8Array(4 + body.length);
  crcInput.set(type, 0);
  crcInput.set(body, 4);
  view.setUint32(8 + body.length, crc32(crcInput));

  const at = 33;
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(buf.subarray(at), at + chunk.length);
  return out;
}

async function sha256Prefix(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** `photo.jpg` + `+1` -> `photo_b+1_a1b2c3.jpg` */
function buildName(original: string, delta: Brightness, token: string, outType: string): string {
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const ext = outType === 'image/png' ? 'png' : 'jpg';
  return `${stem}_b${delta > 0 ? '+' : ''}${delta}_${token}.${ext}`;
}

export async function makeUniqueCopy(file: File, delta: Brightness): Promise<UniqueCopy> {
  const outType = outputTypeFor(file.type);
  const { blob, width, height } = await shiftBrightness(file, delta, outType);

  const token = crypto.randomUUID();
  const note = `cid=${token} ts=${Date.now()} b=${delta}`;
  const raw = new Uint8Array(await blob.arrayBuffer());
  const stamped =
    outType === 'image/png' ? stampPng(raw, 'Comment', note) : stampJpeg(raw, note);

  const outBlob = new Blob([stamped as BufferSource], { type: outType });
  return {
    blob: outBlob,
    url: URL.createObjectURL(outBlob),
    fileName: buildName(file.name, delta, token.slice(0, 6), outType),
    hash: await sha256Prefix(stamped),
    width,
    height,
    bytes: outBlob.size,
  };
}

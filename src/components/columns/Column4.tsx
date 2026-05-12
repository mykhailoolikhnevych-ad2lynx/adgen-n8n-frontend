import { useEffect, useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { useAppStore } from '@/store/useAppStore';
import type { Creative } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

const CREATIVES_BATCHES_HELP =
  "Готові пакети креативів — кожен містить 4 варіанти банера (A / B / C / D) в різних візуальних стилях: YouTube-thumbnail, organic-social, highlight-block та illustrated. Усі 4 використовують той самий хук, акцент і CTA — тестуємо, як саме візуальний стиль впливає на CTR. Можна завантажити пакет ZIP-ом або одразу надіслати в Telegram-канал команди.";

type LightboxState = { creative: Creative; index: number } | null;

const sanitizeForFilename = (s: string): string =>
  s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

const downloadCreativeBatch = async (creative: Creative, batchIndex: number) => {
  const zip = new JSZip();

  creative.images.forEach((img, i) => {
    const variantLetter = String.fromCharCode(65 + i); // A, B, C, D
    if (!img.url.startsWith('data:')) return;
    const commaIdx = img.url.indexOf(',');
    if (commaIdx === -1) return;
    const header = img.url.slice(0, commaIdx);
    const base64 = img.url.slice(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch?.[1] ?? 'image/jpeg';
    const ext = mime.split('/')[1] || 'jpg';
    const styleSafe = sanitizeForFilename(img.style || variantLetter);
    zip.file(`${variantLetter}_${styleSafe}.${ext}`, base64, { base64: true });
  });

  const lines: string[] = [];
  lines.push(`Creatives batch ${batchIndex + 1}`);
  lines.push('='.repeat(40));
  lines.push('');
  creative.images.forEach((img, i) => {
    const variantLetter = String.fromCharCode(65 + i);
    lines.push(`--- Variant ${variantLetter} ---`);
    if (img.style) lines.push(`Style: ${img.style}`);
    if (img.metaTitle) lines.push(`Meta Ad Title: ${img.metaTitle}`);
    if (img.metaCopy) lines.push(`Meta Ad Copy: ${img.metaCopy}`);
    if (img.cta) lines.push(`CTA: ${img.cta}`);
    lines.push('');
  });
  zip.file('info.txt', lines.join('\n'));

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `creatives_batch_${batchIndex + 1}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const Column4 = () => {
  const { creatives, deleteCreative, sendToTelegram } = useAppStore();

  const [lightbox, setLightbox] = useState<LightboxState>(null);

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const showPrev = useCallback(() => {
    setLightbox((lb) => {
      if (!lb) return lb;
      const len = lb.creative.images.length;
      if (len === 0) return lb;
      return { ...lb, index: (lb.index - 1 + len) % len };
    });
  }, []);
  const showNext = useCallback(() => {
    setLightbox((lb) => {
      if (!lb) return lb;
      const len = lb.creative.images.length;
      if (len === 0) return lb;
      return { ...lb, index: (lb.index + 1) % len };
    });
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') showPrev();
      else if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, closeLightbox, showPrev, showNext]);

  const openLightbox = (creative: Creative, index: number) => {
    setLightbox({ creative, index });
  };

  // Smoothly scroll Column 4 to the bottom whenever a new creative is added.
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevCreativesCount = useRef(creatives.length);
  useEffect(() => {
    if (creatives.length > prevCreativesCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevCreativesCount.current = creatives.length;
  }, [creatives.length]);

  const currentImage = lightbox ? lightbox.creative.images[lightbox.index] : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
        4. Creatives batches
        <InfoTooltip text={CREATIVES_BATCHES_HELP} />
      </h2>

      {creatives.length === 0 && (
        <div className="text-gray-400 italic">Waiting for final creatives...</div>
      )}

      {creatives.map((creative, index) => (
        <Card
          key={creative.id}
          aria-busy={creative.isSending || undefined}
          className={`p-4 space-y-4 bg-white shadow-md border-green-200 border-2 transition-opacity ${
            creative.isSending ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm text-green-700">Creatives batch {index + 1}</h3>
            <Button variant="destructive" size="sm" onClick={() => deleteCreative(creative.id)}>
              Delete
            </Button>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Meta Ad Title</label>
            {creative.isLoading ? (
              <div className="bg-slate-50 rounded-md px-3 py-2 border">
                <Skeleton className="h-4 w-3/4 rounded" />
              </div>
            ) : (
              <p className="text-sm font-semibold whitespace-pre-wrap bg-slate-50 rounded-md px-3 py-2 border">
                {creative.metaTitle}
              </p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Meta Ad Copy</label>
            {creative.isLoading ? (
              <div className="bg-slate-50 rounded-md px-3 py-2 border min-h-[100px] space-y-2">
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-3 w-11/12 rounded" />
                <Skeleton className="h-3 w-4/5 rounded" />
                <Skeleton className="h-3 w-2/3 rounded" />
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap bg-slate-50 rounded-md px-3 py-2 border min-h-[100px]">
                {creative.metaCopy}
              </p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">CTA</label>
            {creative.isLoading ? (
              <div className="bg-slate-50 rounded-md px-3 py-2 border">
                <Skeleton className="h-4 w-1/3 rounded" />
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap bg-slate-50 rounded-md px-3 py-2 border">
                {creative.cta}
              </p>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400 mb-2 block">
              Generated Images
              {creative.isLoading && <span className="ml-2 text-gray-500 normal-case font-normal">— generating...</span>}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {creative.isLoading && creative.images.length === 0 && (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={`skeleton-${i}`} className="aspect-square rounded-md" />
                ))
              )}
              {creative.images.map((img, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => openLightbox(creative, i)}
                  className="relative aspect-square bg-slate-100 rounded-md overflow-hidden border cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-green-500"
                  aria-label={`Open image ${img.style || i + 1}`}
                >
                  <img src={img.url} alt={`Creative ${img.style || i + 1}`} className="w-full h-full object-cover" />
                  {img.style && (
                    <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                      {img.style}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={() => downloadCreativeBatch(creative, index)}
              disabled={creative.isLoading || creative.images.length === 0}
              className="w-full bg-black hover:bg-gray-800 text-white"
            >
              Download
            </Button>

            {(() => {
              let label = 'Send to Telegram';
              let bg = 'bg-[#0088cc] hover:bg-[#0077b3]';
              let disabled = false;
              if (creative.isLoading) {
                label = 'Generating images...';
                disabled = true;
              } else if (creative.isSending) {
                label = 'Sending...';
                disabled = true;
              } else if (creative.isSent) {
                label = 'Sent to Telegram';
                bg = 'bg-slate-500 hover:bg-slate-600';
              }
              return (
                <Button
                  onClick={() => sendToTelegram(creative.id)}
                  disabled={disabled}
                  className={`w-full text-white ${bg}`}
                >
                  {label}
                </Button>
              );
            })()}
          </div>
        </Card>
      ))}

      <div ref={bottomRef} aria-hidden="true" />

      {lightbox && currentImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={closeLightbox}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
            className="absolute top-4 right-4 text-white text-3xl leading-none w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full"
            aria-label="Close"
          >
            ×
          </button>

          {lightbox.creative.images.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); showPrev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-4xl w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full"
              aria-label="Previous image"
            >
              ‹
            </button>
          )}

          <div
            className="flex flex-col items-center max-w-[92vw] max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={currentImage.url}
              alt={`Image ${currentImage.style || lightbox.index + 1}`}
              className="max-w-full max-h-[68vh] object-contain rounded-md"
            />
            <div className="mt-4 bg-black/70 text-white px-5 py-4 rounded-md text-sm w-full max-w-2xl space-y-3 leading-relaxed">
              <div>
                <span className="font-bold">STYLE:</span>{' '}
                <span className="text-gray-200">{currentImage.style || '—'}</span>
              </div>
              <div>
                <span className="font-bold">Meta Ad Title:</span>{' '}
                <span className="text-gray-200">{currentImage.metaTitle || lightbox.creative.metaTitle}</span>
              </div>
              <div>
                <span className="font-bold">Meta Ad Copy:</span>{' '}
                <span className="text-gray-200 whitespace-pre-wrap">{currentImage.metaCopy || lightbox.creative.metaCopy}</span>
              </div>
              <div>
                <span className="font-bold">CTA:</span>{' '}
                <span className="text-gray-200">{currentImage.cta || lightbox.creative.cta}</span>
              </div>
            </div>
          </div>

          {lightbox.creative.images.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); showNext(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-4xl w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full"
              aria-label="Next image"
            >
              ›
            </button>
          )}

          {lightbox.creative.images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-3 py-1 rounded-full">
              {lightbox.index + 1} / {lightbox.creative.images.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

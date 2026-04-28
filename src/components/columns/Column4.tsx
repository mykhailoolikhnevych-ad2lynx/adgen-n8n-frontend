import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const Column4 = () => {
  const { creatives, deleteCreative, sendToTelegram } = useAppStore();

  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const closeLightbox = useCallback(() => setLightboxImages(null), []);
  const showPrev = useCallback(() => {
    setLightboxIndex((i) => {
      if (!lightboxImages) return 0;
      return (i - 1 + lightboxImages.length) % lightboxImages.length;
    });
  }, [lightboxImages]);
  const showNext = useCallback(() => {
    setLightboxIndex((i) => {
      if (!lightboxImages) return 0;
      return (i + 1) % lightboxImages.length;
    });
  }, [lightboxImages]);

  useEffect(() => {
    if (!lightboxImages) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') showPrev();
      else if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxImages, closeLightbox, showPrev, showNext]);

  const openLightbox = (images: string[], index: number) => {
    setLightboxImages(images);
    setLightboxIndex(index);
  };

  if (creatives.length === 0) {
    return <div className="text-gray-400 italic">Waiting for final creatives...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-xl mb-2">4. Creatives batches</h2>

      {creatives.map((creative, index) => (
        <Card key={creative.id} className="p-4 space-y-4 bg-white shadow-md border-green-200 border-2">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm text-green-700">Creatives batch {index + 1}</h3>
            <Button variant="destructive" size="sm" onClick={() => deleteCreative(creative.id)}>
              Delete
            </Button>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Meta Ad Title</label>
            <p className="text-sm font-semibold whitespace-pre-wrap bg-slate-50 rounded-md px-3 py-2 border">
              {creative.metaTitle}
            </p>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Meta Ad Copy</label>
            <p className="text-sm whitespace-pre-wrap bg-slate-50 rounded-md px-3 py-2 border min-h-[100px]">
              {creative.metaCopy}
            </p>
          </div>

          {creative.images && creative.images.length > 0 && (
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-400 mb-2 block">Generated Images</label>
              <div className="grid grid-cols-3 gap-2">
                {creative.images.map((imgUrl, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => openLightbox(creative.images, i)}
                    className="aspect-square bg-slate-100 rounded-md overflow-hidden border cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-green-500"
                    aria-label={`Open image ${i + 1}`}
                  >
                    <img src={imgUrl} alt={`Creative ${i + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={() => sendToTelegram(creative.id)}
            className="w-full bg-green-600 hover:bg-green-700 text-white"
          >
            Send to Telegram
          </Button>
        </Card>
      ))}

      {lightboxImages && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center"
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

          {lightboxImages.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); showPrev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-4xl w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full"
              aria-label="Previous image"
            >
              ‹
            </button>
          )}

          <img
            src={lightboxImages[lightboxIndex]}
            alt={`Image ${lightboxIndex + 1}`}
            className="max-w-[92vw] max-h-[92vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {lightboxImages.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); showNext(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-4xl w-12 h-12 flex items-center justify-center hover:bg-white/10 rounded-full"
              aria-label="Next image"
            >
              ›
            </button>
          )}

          {lightboxImages.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-3 py-1 rounded-full">
              {lightboxIndex + 1} / {lightboxImages.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import { useEffect, useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { useAppStore } from '@/store/useAppStore';
import type { Creative } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { CopyNameButton } from '@/components/ui/CopyNameButton';

const CREATIVES_BATCHES_HELP =
  "Готові пакети креативів — кожен містить 4 варіанти банера (A / B / C / D) в різних візуальних стилях: YouTube-thumbnail, organic-social, highlight-block та illustrated. Усі 4 використовують той самий хук, акцент і CTA — тестуємо, як саме візуальний стиль впливає на CTR. Можна завантажити пакет ZIP-ом або одразу надіслати в Telegram-канал команди.";

// Hard rule: every Facebook Ad name MUST be the creative's file name (so the
// standardized name carries through to Ads Manager). Surfaced as an amber alert
// on every card and repeated throughout the ZIP's info.txt for maximum visibility.
const FILE_NAME_REMINDER_UA =
  "Обов'язково! Ad name в Facebook маєш брати з назви файлу креатива!";

const IMAGE_COMPLIANCE_HELP =
  "Автоматична перевірка згенерованого зображення проти внутрішніх політик банерів (verbatim-рендер хука/акценту/CTA, заборонені UI-елементи, контент дорослої тематики, медичні гарантії, прямі продажі, локаційний таргетинг, бренди). " +
  "Виконується ТІЛЬКИ для варіантів Custom і Saved — стандартні пресети A/B/C/D написані тобою заздалегідь і не передаються до Compliance Agent. " +
  "Зелений = пройшов перевірку. Жовтий = знайдено можливе порушення; нижче в Type / Description / Policy Reference буде вказано, що саме не так. Без ретраю — рішення лишається за оператором.";

const IMAGE_COMPLIANCE_TYPE_HELP =
  "Категорія знайденого порушення в зображенні — наприклад: Verbatim mismatch, Fake UI, Adult content, Medical guarantee, Loan guarantee, Direct sales, Brand violation. Підказує, що саме vision-агент вважає проблемою.";

const IMAGE_COMPLIANCE_DESCRIPTION_HELP =
  "Короткий опис порушення на 5–15 слів — конкретно, що не так у зображенні або в тексті, що на ньому рендериться.";

const IMAGE_POLICY_REFERENCE_HELP =
  "Категорія політики, проти якої знайдено порушення: 1 Text rendering / 2 Fake UI / 3 Visual content / 4 Text content / 5 Brand.";

type LightboxState = { creative: Creative; index: number } | null;

const sanitizeForFilename = (s: string): string =>
  s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);

const downloadCreativeBatch = async (creative: Creative, batchIndex: number) => {
  // ZIP is named after the n8n execution id — same "batch_<id>" shown in Telegram.
  // Creative Gen batches carry the same "creativeonly" marker as their image files.
  const batchNumber = creative.fileMeta?.batchNumber;
  const batchPrefix = creative.fileMeta?.creativeOnly ? 'creativeonly_batch' : 'batch';
  const batchName = batchNumber
    ? `${batchPrefix}_${batchNumber}`
    : `creatives_batch_${batchIndex + 1}`;

  // Single-image batches download as a plain image — no zip wrapper, since
  // there's nothing to bundle and operators expect a direct file. Works for
  // both data:URL responses and remote URLs (we fetch the latter into a blob
  // so the browser respects the `download` attribute and the chosen name).
  const validImages = creative.images.filter((img) => typeof img.url === 'string' && img.url.length > 0);
  if (validImages.length === 1) {
    const img = validImages[0];
    let mime = 'image/jpeg';
    if (img.url.startsWith('data:')) {
      const header = img.url.slice(0, img.url.indexOf(','));
      mime = header.match(/data:([^;]+)/)?.[1] ?? mime;
    }
    let downloadHref = img.url;
    if (!img.url.startsWith('data:')) {
      try {
        const res = await fetch(img.url);
        const blob = await res.blob();
        if (blob.type) mime = blob.type;
        downloadHref = URL.createObjectURL(blob);
      } catch {
        // Fall back to direct href — browser may navigate instead of download.
      }
    }
    const ext = (mime.split('/')[1] || 'jpg').split('+')[0];
    const baseName = img.fileName
      ? sanitizeForFilename(img.fileName)
      : `A_${sanitizeForFilename(img.style || 'A')}`;
    const a = document.createElement('a');
    a.href = downloadHref;
    a.download = `${baseName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (downloadHref !== img.url) URL.revokeObjectURL(downloadHref);
    return;
  }

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
    // Standardized name, e.g. aiimg_housing_help_us_0025_a1cg_f2_en_11_nbp_1.jpg
    const baseName = img.fileName
      ? sanitizeForFilename(img.fileName)
      : `${variantLetter}_${sanitizeForFilename(img.style || variantLetter)}`;
    zip.file(`${baseName}.${ext}`, base64, { base64: true });
  });

  const lines: string[] = [];
  // Top-of-file reminder — first thing the buyer sees on opening the archive.
  lines.push(FILE_NAME_REMINDER_UA);
  lines.push('='.repeat(40));
  lines.push('');
  lines.push(`Creatives batch ${batchIndex + 1}`);
  lines.push(batchName);
  lines.push('='.repeat(40));
  lines.push('');
  creative.images.forEach((img, i) => {
    const variantLetter = String.fromCharCode(65 + i);
    lines.push(`--- Variant ${variantLetter} ---`);
    if (img.fileName) lines.push(`File: ${img.fileName}`);
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
  a.download = `${batchName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// `origin` decides which batches this instance shows: 'pipeline' (default) =
// the classic Creatives tab (angles → concepts → batch), 'creativeOnly' = the
// Creative Gen tab. The two tabs share the store array but never each other's cards.
export const Column4 = ({
  origin = 'pipeline',
  title = '4. Creatives batches',
}: {
  origin?: 'pipeline' | 'creativeOnly';
  title?: string;
}) => {
  const { creatives: allCreatives, deleteCreative, sendToTelegram, toggleCreativeTranslation } = useAppStore();
  const creatives = allCreatives.filter(
    (c) => (c.origin === 'creativeOnly') === (origin === 'creativeOnly'),
  );

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
        {title}
        <InfoTooltip text={CREATIVES_BATCHES_HELP} />
      </h2>

      {creatives.length === 0 && (
        <div className="text-gray-400 italic">Waiting for final creatives...</div>
      )}

      {creatives.map((creative, index) => {
        const isUk = !!creative.showTranslation && !!creative.translation;
        const metaTitleVal = isUk ? (creative.translation?.metaTitle ?? '') : creative.metaTitle;
        const metaCopyVal = isUk ? (creative.translation?.metaCopy ?? '') : creative.metaCopy;
        const ctaVal = isUk ? (creative.translation?.cta ?? '') : creative.cta;
        let translateLabel = '🇺🇦 Translate';
        if (creative.isTranslating) translateLabel = 'Translating…';
        else if (isUk) translateLabel = '🇺🇸 Original';
        return (
        <Card
          key={creative.id}
          aria-busy={creative.isSending || undefined}
          className={`p-4 space-y-4 bg-white shadow-md border-green-200 border-2 transition-opacity ${
            creative.isSending ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          <div className="flex justify-between items-center gap-2">
            <h3 className="font-bold text-sm text-green-700">Creatives batch {index + 1}</h3>
            <div className="flex items-center gap-1">
              {/* Translate only affects the Meta/CTA texts — hidden on Creative Gen cards. */}
              {origin !== 'creativeOnly' && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => toggleCreativeTranslation(creative.id)}
                  disabled={creative.isTranslating || creative.isLoading}
                >
                  {translateLabel}
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={() => deleteCreative(creative.id)}>
                Delete
              </Button>
            </div>
          </div>

          {/* Meta Ad Title / Copy / CTA — pipeline batches only. Creative Gen
              outputs just the images; its card goes straight to the grid. */}
          {origin !== 'creativeOnly' && (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase text-gray-400">Meta Ad Title</label>
                {creative.isLoading ? (
                  <div className="bg-slate-50 rounded-md px-3 py-2 border">
                    <Skeleton className="h-4 w-3/4 rounded" />
                  </div>
                ) : (
                  <p className="text-sm font-semibold whitespace-pre-wrap bg-slate-50 rounded-md px-3 py-2 border">
                    {metaTitleVal}
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
                    {metaCopyVal}
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
                    {ctaVal}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Hard rule — the Facebook Ad name MUST be the creative's file name. */}
          <div
            role="alert"
            className="flex items-start gap-2 bg-amber-100 border border-amber-400 text-amber-900 rounded-md px-3 py-2 text-sm font-semibold"
          >
            <span aria-hidden="true" className="text-base leading-none">⚠️</span>
            <span>{FILE_NAME_REMINDER_UA}</span>
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
              {creative.images.map((img, i) => {
                // Compliance Agent (Image) only runs for Custom / Saved
                // variants. For everyone else `compliant` defaults to true and
                // we draw no badge — only the failing case needs an indicator.
                const failedCompliance = img.compliant === false;
                return (
                  <div key={i} className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => openLightbox(creative, i)}
                      className={`relative aspect-square bg-slate-100 rounded-md overflow-hidden border cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-green-500 ${
                        failedCompliance ? 'border-amber-400 ring-1 ring-amber-300' : ''
                      }`}
                      aria-label={`Open image ${img.style || i + 1}`}
                      title={failedCompliance
                        ? `Not compliant — ${img.complianceType || 'flagged'}${img.complianceDescription ? `: ${img.complianceDescription}` : ''}`
                        : undefined}
                    >
                      <img src={img.url} alt={`Creative ${img.style || i + 1}`} className="w-full h-full object-cover" />
                      {img.style && (
                        <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          {img.style}
                        </span>
                      )}
                      {failedCompliance && (
                        <span
                          className="absolute top-1 right-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 border border-yellow-600 shadow"
                          aria-label="Not compliant"
                        >
                          <span className="text-[9px] font-bold text-yellow-900 leading-none">!</span>
                        </span>
                      )}
                    </button>
                    {/* One-click copy of the standardized file name -> Facebook Ad name. */}
                    {img.fileName && <CopyNameButton fileName={img.fileName} className="w-full" />}
                  </div>
                );
              })}
            </div>
          </div>

          {(() => {
            // Compliance Agent (Image) runs ONLY for Custom / Saved variants.
            // Only render this block when at least one variant was actually
            // audited — otherwise the operator would see "All variants compliant"
            // for an A/B/C/D batch where no audit took place, which is misleading.
            const checked = creative.images.filter((img) => img.complianceChecked);
            if (checked.length === 0) return null;
            const failed = checked.filter((img) => img.compliant === false);
            const allCompliant = failed.length === 0;
            return (
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[10px] font-bold uppercase text-gray-400">Compliance check:</span>
                  <InfoTooltip text={IMAGE_COMPLIANCE_HELP} iconSize={11} />
                  <span
                    className={`inline-block w-3 h-3 rounded-full ${allCompliant ? 'bg-green-500' : 'bg-yellow-500'}`}
                    title={allCompliant ? 'All audited variants compliant' : `${failed.length} of ${checked.length} flagged`}
                    aria-label={allCompliant ? 'All audited variants compliant' : 'Variants flagged'}
                  />
                  <span className={`text-xs ${allCompliant ? 'text-slate-600' : 'text-yellow-800'}`}>
                    {allCompliant
                      ? `${checked.length} variant${checked.length === 1 ? '' : 's'} audited, all compliant`
                      : `${failed.length} of ${checked.length} variant${checked.length === 1 ? '' : 's'} flagged`}
                  </span>
                </div>

                {failed.map((img) => {
                  // Pull the variant's display position so the operator can map
                  // the warning to the thumbnail above.
                  const variantIdx = creative.images.indexOf(img);
                  const variantLetter = variantIdx >= 0 ? String.fromCharCode(65 + variantIdx) : '?';
                  return (
                    <div key={variantIdx} className="ml-1 pl-3 border-l-2 border-yellow-300 space-y-1">
                      <div className="text-xs font-bold text-slate-700">
                        Variant {variantLetter}{img.style ? ` — ${img.style}` : ''}
                      </div>
                      {img.complianceType && (
                        <div className="text-xs">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                            Type:
                            <InfoTooltip text={IMAGE_COMPLIANCE_TYPE_HELP} iconSize={11} />
                          </span>{' '}
                          <span className="text-slate-700 whitespace-pre-wrap">{img.complianceType}</span>
                        </div>
                      )}
                      {img.complianceDescription && (
                        <div className="text-xs">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                            Description:
                            <InfoTooltip text={IMAGE_COMPLIANCE_DESCRIPTION_HELP} iconSize={11} />
                          </span>{' '}
                          <span className="text-slate-700 whitespace-pre-wrap">{img.complianceDescription}</span>
                        </div>
                      )}
                      {img.policyReference && (
                        <div className="text-xs">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                            Policy Reference:
                            <InfoTooltip text={IMAGE_POLICY_REFERENCE_HELP} iconSize={11} />
                          </span>{' '}
                          <span className="text-slate-700 whitespace-pre-wrap">{img.policyReference}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

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
        );
      })}

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
              {currentImage.fileName && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold">FILE NAME:</span>
                  <span className="text-gray-200 break-all">{currentImage.fileName}</span>
                  <CopyNameButton fileName={currentImage.fileName} />
                </div>
              )}
              {lightbox.creative.origin !== 'creativeOnly' && (
                <>
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
                </>
              )}

              {/* Compliance verdict — same shape as Concepts column. Only
                  shown when the Compliance Agent (Image) actually flagged
                  this variant (Custom / Saved). A/B/C/D bypass and stay
                  silent (compliant defaults to true, no badge, no row). */}
              {currentImage.compliant === false && (
                <div className="pt-2 mt-2 border-t border-white/15 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full bg-yellow-400 border border-yellow-600"
                      aria-label="Not compliant"
                    />
                    <span className="font-bold text-yellow-300">Not compliant</span>
                  </div>
                  {currentImage.complianceType && (
                    <div>
                      <span className="font-bold">Type:</span>{' '}
                      <span className="text-gray-200">{currentImage.complianceType}</span>
                    </div>
                  )}
                  {currentImage.complianceDescription && (
                    <div>
                      <span className="font-bold">Description:</span>{' '}
                      <span className="text-gray-200 whitespace-pre-wrap">{currentImage.complianceDescription}</span>
                    </div>
                  )}
                  {currentImage.policyReference && (
                    <div>
                      <span className="font-bold">Policy Reference:</span>{' '}
                      <span className="text-gray-200">{currentImage.policyReference}</span>
                    </div>
                  )}
                </div>
              )}
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

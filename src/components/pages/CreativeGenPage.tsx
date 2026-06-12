import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import {
  ImageGenSettings,
  useEffectivePresets,
  HOOK_HELP,
  ACCENT_HELP,
  CTA_HELP,
} from '@/components/ImageGenSettings';
import { Column4 } from '@/components/columns/Column4';

// Creative Gen — standalone creative generation, no pipeline behind it.
// The operator types the Hook / Accent / CTA by hand, picks the image settings
// (same shared panel as the Creatives tab) and gets a batch straight from the
// dedicated creative-only n8n workflow. Results render in the same batch cards
// as the Creatives tab (download ZIP / Telegram / lightbox), but the two tabs
// never show each other's batches.

const CREATIVE_GEN_HELP =
  'Швидка генерація креативів без пайплайна (Keywords → Angles → Concepts). ' +
  'Впиши Hook / Accent / CTA вручну, обери модель, формат і пресети — і одразу отримаєш батч банерів. ' +
  'Імена файлів позначаються маркером "creativeonly" замість сегментів кампанії/кута/формули.';

export const CreativeGenPage = () => {
  const {
    creativeOnlyHook,
    creativeOnlyAccent,
    creativeOnlyCta,
    setCreativeOnlyHook,
    setCreativeOnlyAccent,
    setCreativeOnlyCta,
    generateCreativeOnly,
    isLoadingCreativeOnly,
  } = useAppStore();

  const { effectivePresetCount, presetsInvalid } = useEffectivePresets();

  const hookMissing = creativeOnlyHook.trim().length === 0;

  let buttonLabel = `Generate Creative Batch (${effectivePresetCount})`;
  if (isLoadingCreativeOnly) buttonLabel = 'Generating Images...';
  else if (presetsInvalid) buttonLabel = 'Pick at least one preset';
  else if (hookMissing) buttonLabel = 'Enter a Hook first';

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* Left — settings + the three typed inputs */}
      <div className="w-[400px] shrink-0 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-1.5 font-bold text-xl mb-2">
            Creative Gen
            <InfoTooltip text={CREATIVE_GEN_HELP} />
          </h2>

          <ImageGenSettings />

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
            <div className="text-[10px] font-bold uppercase text-gray-500">Creative text</div>
            <div>
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                Hook
                <InfoTooltip text={HOOK_HELP} iconSize={11} />
                {hookMissing && (
                  <span className="ml-1 normal-case font-normal text-red-500">— required</span>
                )}
              </label>
              <Textarea
                value={creativeOnlyHook}
                onChange={(e) => setCreativeOnlyHook(e.target.value)}
                placeholder="Main banner line, 40–55 chars…"
                className="bg-white text-sm resize-none"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                Accent
                <InfoTooltip text={ACCENT_HELP} iconSize={11} />
              </label>
              <Textarea
                value={creativeOnlyAccent}
                onChange={(e) => setCreativeOnlyAccent(e.target.value)}
                placeholder="Second, smaller line under the hook…"
                className="bg-white text-sm resize-none"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                CTA
                <InfoTooltip text={CTA_HELP} iconSize={11} />
              </label>
              <Textarea
                value={creativeOnlyCta}
                onChange={(e) => setCreativeOnlyCta(e.target.value)}
                placeholder="Learn More, Read More, Discover More…"
                className="bg-white text-sm resize-none"
              />
            </div>
          </div>

          <Button
            onClick={() => generateCreativeOnly()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            disabled={isLoadingCreativeOnly || presetsInvalid || hookMissing}
            title={
              presetsInvalid
                ? 'Pick at least one image preset (Custom needs a non-empty prompt to count)'
                : hookMissing
                  ? 'The Hook field is required'
                  : undefined
            }
          >
            {buttonLabel}
          </Button>
        </div>
      </div>

      {/* Right — generated batches (same cards as the Creatives tab) */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <Column4 origin="creativeOnly" title="Creatives batches" />
      </div>
    </div>
  );
};

import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

const CONCEPTS_HELP =
  "Три тактичні варіанти креативу для обраного кута. Кожен — окремий хук + акцент + CTA + Meta-копія, побудовані за різними хук-формулами:\n" +
  "• F2 Surprise — «[Несподіваний факт]. [Конкретний контекст].»\n" +
  "• F3 Question — «[Питання від третьої особи]. [Інформаційний поворот].»\n" +
  "• F4 Number — «[Число]. [Контекст]. [Поворот].»\n" +
  "• F6 Contrast — «[Поширена думка]. [Факт, що її перевертає].»\n" +
  "F1 Problem і F5 Story деактивовані.\n" +
  "Один кут перетворюється на 3 різні способи його реалізувати — тут обирається той варіант, який піде в банер.";

const CATEGORY_HELP =
  "Аспект, який тестує креатив — одна з 8 категорій:\n" +
  "• Demographic — сегмент аудиторії.\n" +
  "• Process Stage — етап шляху клієнта.\n" +
  "• Emotional State — стан читача.\n" +
  "• Logistical — практична деталь (документи, терміни, вартість).\n" +
  "• Outcome — як виглядає «вирішено».\n" +
  "• Comparison — проти чого порівнюємо.\n" +
  "• Identity Marker — вузький ідентичний маркер.\n" +
  "• Scope — масштаб можливості.\n" +
  "Усі 3 креативи тестують 3 РІЗНІ категорії.";

const HOOK_HELP =
  "Головний рядок банера — те, що читач бачить перш за все. 40–55 символів (макс 60). Має зачепити за 2 секунди скрола і повідомити: для кого це, що пропонується, чому зараз.";

const ACCENT_HELP =
  "Другий, менший рядок під хуком — уточнення або емоційне підсилення. 25–35 символів (макс 40). Працює в парі з хуком: додає конкретику (кому саме, в якій ситуації) або підсилює настрій. Не дублює хук іншими словами.";

const CTA_HELP =
  "Текст кнопки. 8–12 символів (макс 15). Лише з білого списку: Learn More, Read More, Discover More, Read Guide, Find Out, See More, Know More, Read On, Explore. Жодних транзакційних «Apply Now / Buy Now / Sign Up» — Meta такого не пропустить.";

const META_TITLE_HELP =
  "Заголовок оголошення в Ads Manager — те, що Meta показує під банером. 22–27 символів (макс 40). Має бути в одній темі з хуком, інакше Compliance Agent позначить «Article mismatch».";

const META_COPY_HELP =
  "Основний текст оголошення в Ads Manager — те, що йде під заголовком. 100–120 символів (макс 125). Розширює обіцянку хука, але не «продає» — це інформаційна довідка про статтю, а не оффер.";

const COMPLIANCE_HELP =
  "Автоматична перевірка креативу проти внутрішніх політик (медичні твердження, гарантії кредитів, транзакційні слова, локаційний таргетинг, фейкові UI-елементи, відповідність статті тощо). Зелений = пройшов перевірку, готовий до запуску. Жовтий = знайдено можливе порушення; нижче в Type / Description / Policy Reference буде вказано, що саме не так.";

const COMPLIANCE_TYPE_HELP =
  "Категорія знайденого порушення — наприклад: Misleading, False claim, Loan fraud, Location targeting, Article mismatch, Article quality. Підказує, що саме ШІ вважає проблемою.";

const COMPLIANCE_DESCRIPTION_HELP =
  "Короткий опис порушення на 5–10 слів — конкретно, що не так у тексті. Читати разом із Type і Policy Reference.";

const POLICY_REFERENCE_HELP =
  "Внутрішній код політики, проти якої знайдено порушення. Категорію видно вище в полі Type — її достатньо, щоб зрозуміти проблему.";

// Image presets shipped by the n8n graph. IDs match the preset_id each preset
// node emits — never reorder/rename without updating the workflow's filter.
const IMAGE_PRESETS: { id: string; label: string; hint: string }[] = [
  { id: 'A',      label: 'YT Thumbnail',    hint: 'YouTube-thumbnail для віральної реклами — висока насиченість, сильний контраст, жирний хук + кнопка CTA. Кінематографічна подача.' },
  { id: 'B',      label: 'Organic Social',  hint: 'Виглядає як UGC-пост у стрічці. Великий хук із товстою обводкою поверх затемненого фото, декоративні пастельні стікери, курсивний CTA без кнопки.' },
  { id: 'C',      label: 'Highlight Block', hint: 'Повнокадрове фото + ОДИН однотонний блок зверху з хуком. Без акценту, без CTA. Найпростіший варіант.' },
  { id: 'D',      label: 'Illustrated',     hint: 'Преміум native-ad стиль (як Outbrain/Taboola): редакторська ілюстрація на фоні, жовтий курсивний хук + біла картка + яскравий pill-CTA.' },
  { id: 'Custom', label: 'Custom',          hint: 'Опиши лише ДИЗАЙН (стиль, композиція, настрій, кольори). Хук, акцент і CTA з обраного концепту накладаються автоматично — повторювати їх не треба.' },
];

const CUSTOM_PROMPT_PLACEHOLDER =
  'Опиши лише візуальний дизайн — напр. «Яскрава графіка з іконкою {theme}, великий домінантний текст, високий контраст, мінімум елементів, оптимізовано під мобільний». Хук / акцент / CTA підтягнуться з обраного концепту.';

const IMAGE_MODELS: { label: string; value: string }[] = [
  { label: 'Nano banana 2', value: 'google/gemini-3.1-flash-image-preview' },
  { label: 'Nano banana pro', value: 'google/gemini-3-pro-image-preview' },
  { label: 'GPT-image2', value: 'openai/gpt-5.4-image-2' },
  { label: 'Seedream 4.5', value: 'bytedance-seed/seedream-4.5' },
];

const ASPECT_RATIOS: string[] = ['1:1', '16:9', '9:16', '4:5'];

export const Column3 = () => {
  const {
    concepts,
    updateConcept,
    generateCreative,
    isLoadingCreatives,
    isLoadingConcepts,
    clearConcepts,
    imageGenerationModel,
    aspectRatio,
    selectedPresets,
    customPrompt,
    setImageGenerationModel,
    setAspectRatio,
    setSelectedPresets,
    setCustomPrompt,
    toggleConceptTranslation,
  } = useAppStore();

  // A preset is "effectively selected" when it's checked AND (if Custom) has text.
  // n8n's Filter Active Presets throws if zero presets reach it, so we mirror that
  // here to keep the Generate Creative Batch button disabled when invalid.
  const customActive = selectedPresets.includes('Custom') && customPrompt.trim().length > 0;
  const effectivePresetCount =
    selectedPresets.filter((p) => p !== 'Custom').length + (customActive ? 1 : 0);
  const presetsInvalid = effectivePresetCount === 0;

  const togglePreset = (id: string, checked: boolean) => {
    setSelectedPresets(
      checked
        ? Array.from(new Set([...selectedPresets, id]))
        : selectedPresets.filter((p) => p !== id),
    );
  };

  const settingsBlock = (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="text-[10px] font-bold uppercase text-gray-500">Settings</div>
      <div>
        <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Image model</label>
        <select
          value={imageGenerationModel}
          onChange={(e) => setImageGenerationModel(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1 bg-white"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Aspect ratio</label>
        <select
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1 bg-white"
        >
          {ASPECT_RATIOS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Image presets — which preset branches run in n8n. Default: all four standard
          presets; Custom is opt-in and requires a prompt to actually contribute. */}
      <div>
        <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
          Image presets {presetsInvalid && (
            <span className="ml-1 normal-case font-normal text-red-500">— pick at least one</span>
          )}
        </label>
        <div className="space-y-0.5">
          {IMAGE_PRESETS.map((p) => {
            const checked = selectedPresets.includes(p.id);
            return (
              <div key={p.id} className="flex items-center gap-1.5 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer select-none flex-1">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => togglePreset(p.id, e.target.checked)}
                  />
                  <span className="font-medium text-slate-800">{p.label}</span>
                </label>
                <InfoTooltip text={p.hint} iconSize={11} />
              </div>
            );
          })}
        </div>

        {/* Custom-prompt textarea — visible only when Custom is checked. */}
        {selectedPresets.includes('Custom') && (
          <div className="mt-2">
            <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
              Custom prompt
              {selectedPresets.includes('Custom') && customPrompt.trim().length === 0 && (
                <span className="ml-1 normal-case font-normal text-red-500">
                  — required when Custom is checked
                </span>
              )}
            </label>
            <Textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={CUSTOM_PROMPT_PLACEHOLDER}
              className="bg-white text-xs"
              rows={4}
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="flex items-center gap-1.5 font-bold text-xl">
          3. Concepts
          <InfoTooltip text={CONCEPTS_HELP} />
        </h2>
        {concepts.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearConcepts}>Clear</Button>
        )}
      </div>

      {concepts.length === 0 && (
        <div className="text-gray-400 italic">
          {isLoadingConcepts ? 'Generating concept...' : 'Waiting for concepts...'}
        </div>
      )}

      {settingsBlock}

      {concepts.map((concept, index) => {
        const isUk = !!concept.showTranslation && !!concept.translation;
        const hookVal = isUk ? (concept.translation?.hook ?? '') : concept.hook;
        const accentVal = isUk ? (concept.translation?.accent ?? '') : concept.accent;
        const ctaVal = isUk ? (concept.translation?.cta ?? '') : concept.cta;
        const metaTitleVal = isUk ? (concept.translation?.metaTitle ?? '') : concept.metaTitle;
        const metaCopyVal = isUk ? (concept.translation?.metaCopy ?? '') : concept.metaCopy;
        let translateLabel = '🇺🇦 Translate';
        if (concept.isTranslating) translateLabel = 'Translating…';
        else if (isUk) translateLabel = '🇺🇸 Original';
        return (
        <Card key={concept.id} className="p-4 space-y-3 bg-slate-50 shadow-sm border-blue-100">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-blue-800">
              Creative {index + 1}
              {concept.formula && <span> — {concept.formula}</span>}
              {concept.formulaName && <span> — {concept.formulaName}</span>}
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => toggleConceptTranslation(concept.id)}
              disabled={concept.isTranslating}
            >
              {translateLabel}
            </Button>
          </div>

          {concept.aspectCategory && (
            <div className="flex items-center gap-1 text-xs">
              <span className="font-bold uppercase text-gray-400">Category:</span>
              <InfoTooltip text={CATEGORY_HELP} iconSize={12} />
              <span className="text-slate-700">{concept.aspectCategory}</span>
            </div>
          )}

          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Hook
              <InfoTooltip text={HOOK_HELP} iconSize={11} />
            </label>
            <Textarea
              value={hookVal}
              onChange={(e) => updateConcept(concept.id, 'hook', e.target.value)}
              readOnly={isUk}
              className={`bg-white text-sm resize-none ${isUk ? 'cursor-default opacity-95' : ''}`}
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Accent
              <InfoTooltip text={ACCENT_HELP} iconSize={11} />
            </label>
            <Textarea
              value={accentVal}
              onChange={(e) => updateConcept(concept.id, 'accent', e.target.value)}
              readOnly={isUk}
              className={`bg-white text-sm resize-none ${isUk ? 'cursor-default opacity-95' : ''}`}
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              CTA
              <InfoTooltip text={CTA_HELP} iconSize={11} />
            </label>
            <Textarea
              value={ctaVal}
              onChange={(e) => updateConcept(concept.id, 'cta', e.target.value)}
              readOnly={isUk}
              className={`bg-white text-sm resize-none ${isUk ? 'cursor-default opacity-95' : ''}`}
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Meta Title
              <InfoTooltip text={META_TITLE_HELP} iconSize={11} />
            </label>
            <Textarea
              value={metaTitleVal}
              onChange={(e) => updateConcept(concept.id, 'metaTitle', e.target.value)}
              readOnly={isUk}
              className={`bg-white text-sm resize-none ${isUk ? 'cursor-default opacity-95' : ''}`}
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Meta Copy
              <InfoTooltip text={META_COPY_HELP} iconSize={11} />
            </label>
            <Textarea
              value={metaCopyVal}
              onChange={(e) => updateConcept(concept.id, 'metaCopy', e.target.value)}
              readOnly={isUk}
              className={`bg-white text-sm ${isUk ? 'cursor-default opacity-95' : ''}`}
            />
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[10px] font-bold uppercase text-gray-400">Compliance check:</span>
              <InfoTooltip text={COMPLIANCE_HELP} iconSize={11} />
              <span
                className={`inline-block w-3 h-3 rounded-full ${concept.compliant ? 'bg-green-500' : 'bg-yellow-500'}`}
                title={concept.compliant ? 'Compliant' : 'Not compliant'}
                aria-label={concept.compliant ? 'Compliant' : 'Not compliant'}
              />
            </div>
            {concept.complianceType && (
              <div className="text-sm">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                  Type:
                  <InfoTooltip text={COMPLIANCE_TYPE_HELP} iconSize={11} />
                </span>{' '}
                <span className="text-slate-700 whitespace-pre-wrap">{concept.complianceType}</span>
              </div>
            )}
            {concept.complianceDescription && (
              <div className="text-sm">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                  Description:
                  <InfoTooltip text={COMPLIANCE_DESCRIPTION_HELP} iconSize={11} />
                </span>{' '}
                <span className="text-slate-700 whitespace-pre-wrap">{concept.complianceDescription}</span>
              </div>
            )}
            {concept.policyReference && (
              <div className="text-sm">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                  Policy Reference:
                  <InfoTooltip text={POLICY_REFERENCE_HELP} iconSize={11} />
                </span>{' '}
                <span className="text-slate-700 whitespace-pre-wrap">{concept.policyReference}</span>
              </div>
            )}
          </div>

          <Button
            onClick={() => generateCreative(concept.id)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-2"
            disabled={isLoadingCreatives || !concept.compliant || presetsInvalid}
            title={
              !concept.compliant
                ? 'Blocked — this creative is not compliant and cannot be released'
                : presetsInvalid
                  ? 'Pick at least one image preset (Custom needs a non-empty prompt to count)'
                  : undefined
            }
          >
            {!concept.compliant
              ? 'Blocked — not compliant'
              : presetsInvalid
                ? 'Pick at least one preset'
                : isLoadingCreatives
                  ? 'Generating Images...'
                  : `Generate Creative Batch (${effectivePresetCount})`}
          </Button>
        </Card>
        );
      })}
    </div>
  );
};

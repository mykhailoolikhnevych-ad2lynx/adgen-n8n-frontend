import React, { useEffect } from 'react';
import { useAppStore, type CustomBlocks } from '@/store/useAppStore';
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
  { id: 'Custom', label: 'Custom',          hint: 'Свій варіант. Базово містить той самий каркас, що A/B/C/D (правила тексту, сцена, хук, акцент, CTA, заборонене). Чіпами нижче вмикаєш/вимикаєш блоки. Перетягни чіп у текстове поле, щоб закріпити блок у конкретній позиції — без перетягування блоки рендеряться у порядку за замовчуванням.' },
];

const CUSTOM_PROMPT_PLACEHOLDER =
  'Опиши лише ВІЗУАЛЬНИЙ ДИЗАЙН — стиль, композиція, настрій, кольори. ' +
  'Каркасні блоки (text rules / scene / hook / accent / CTA / forbidden) n8n додає у позиціях за замовчуванням. ' +
  'Перетягни чіп згори сюди, щоб закріпити його блок inline на місці дропу — повторне перетягування того ж чіпа прибере попереднє входження. ' +
  'Також підтримуються плейсхолдери для сирого тексту: {hook_text}, {accent_text}, {cta_text}, {theme}, {meta_ad_title}, {meta_ad_copy}.';

// Each chip toggles + positions a block in the Preset Custom prompt that n8n's
// Build Image Context / Preset Custom assembles. `token` is the placeholder
// inserted when the chip is dragged into the textarea — n8n substitutes the
// block's content at that position instead of placing it in the default order.
// Labels stay English so they match the placeholder tokens; tooltips/helper
// text are Ukrainian per user request.
//
// NOT exposed as chips (forced ON in the store, no toggle): Text rules and
// Forbidden — those are guard rails the buyer should never disable. They render
// at their default positions (TR at the start, Forbidden at the end).
const CUSTOM_BLOCK_DEFS: { key: keyof CustomBlocks; label: string; token: string; hint: string }[] = [
  { key: 'scene',  label: 'Scene',  token: '{scene}',  hint: 'Сцена з обраного концепту: суб’єкт, оточення, реквізит, настрій. Базово ВИМКНЕНО — вмикай, якщо хочеш накласти каркас сцени з концепту поверх свого опису.' },
  { key: 'hook',   label: 'Hook',   token: '{hook}',   hint: 'Рендерить banner_hook великим жирним шрифтом у верхній зоні. Вимикай тільки якщо твій дизайн навмисно ховає хук.' },
  { key: 'accent', label: 'Accent', token: '{accent}', hint: 'Рендерить banner_accent другим, меншим рядком під хуком.' },
  { key: 'cta',    label: 'CTA',    token: '{cta}',    hint: 'Рендерить banner_cta як кнопку: велика заокруглена, яскравий fill, білий текст, нижня зона.' },
];

const IMAGE_MODELS: { label: string; value: string }[] = [
  { label: 'Nano banana 2', value: 'google/gemini-3.1-flash-image-preview' },
  { label: 'Nano banana pro', value: 'google/gemini-3-pro-image-preview' },
  { label: 'GPT-image2', value: 'openai/gpt-5.4-image-2' },
  { label: 'Seedream 4.5', value: 'bytedance-seed/seedream-4.5' },
];

const ASPECT_RATIOS: string[] = ['1:1', '16:9', '9:16', '4:5'];

// Character offset for a drop inside a <textarea>. We rely on the browser's
// drop-caret: when dragover is preventDefault'd, Chromium/Firefox update
// selectionStart to track the mouse, so reading it in onDrop gives the drop
// position. caretRangeFromPoint can't be used here — for replaced elements
// like <textarea> it returns ranges anchored in a parent DOM node, not in the
// textarea's internal text. Falls back to end-of-text when selection looks
// unset (selectionStart === 0 while the user clearly dropped further down).
const getDropOffset = (ta: HTMLTextAreaElement): number => {
  const sel = ta.selectionStart;
  if (typeof sel === 'number' && sel >= 0 && sel <= ta.value.length) return sel;
  return ta.value.length;
};

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
    customBlocks,
    setImageGenerationModel,
    setAspectRatio,
    setSelectedPresets,
    setCustomPrompt,
    setCustomBlocks,
    toggleConceptTranslation,
    savedPrompts,
    savedPromptsStatus,
    selectedSavedPromptIds,
    setSelectedSavedPromptIds,
    loadSavedPrompts,
  } = useAppStore();

  // Pull the shared prompt library on mount — re-fetches each time so a
  // freshly-saved prompt in Docs shows up here without a hard refresh.
  useEffect(() => {
    void loadSavedPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A preset is "effectively selected" when it's checked AND (if Custom) has text.
  // n8n's Filter Active Presets throws if zero presets reach it, so we mirror that
  // here to keep the Generate Creative Batch button disabled when invalid.
  const customActive = selectedPresets.includes('Custom') && customPrompt.trim().length > 0;
  // Selected saved prompts that still exist in the loaded library — guards
  // against stale ids that were deleted by an admin since last load.
  const savedPromptIdSet = new Set(savedPrompts.map((p) => String(p.id)));
  const activeSavedPromptIds = selectedSavedPromptIds.filter((id) => savedPromptIdSet.has(id));
  const effectivePresetCount =
    selectedPresets.filter((p) => p !== 'Custom').length
    + (customActive ? 1 : 0)
    + activeSavedPromptIds.length;
  const presetsInvalid = effectivePresetCount === 0;

  const toggleSavedPrompt = (id: string, checked: boolean) => {
    setSelectedSavedPromptIds(
      checked
        ? Array.from(new Set([...selectedSavedPromptIds, id]))
        : selectedSavedPromptIds.filter((x) => x !== id),
    );
  };

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

        {/* Saved prompts — pre-authored prompt bodies shared via Docs → Prompt
            Bases. Each picked entry runs as its own image variant. The author
            writes scene / background / colours by hand and uses {hook} /
            {accent} / {cta} placeholders; n8n substitutes the chosen_creative
            values at generation time.
            UI: a dropdown to ADD a prompt (only unselected entries shown), then
            the picked prompts appear below as the same checkbox row as the
            built-in presets — unchecking removes the entry from selection. */}
        {(() => {
          const availableToAdd = savedPrompts.filter(
            (p) => !selectedSavedPromptIds.includes(String(p.id)),
          );
          const pickedPrompts = savedPrompts.filter((p) =>
            selectedSavedPromptIds.includes(String(p.id)),
          );
          return (
            <div className="mt-3 pt-2 border-t border-slate-200">
              <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                Saved prompts
                {savedPromptsStatus === 'loading' && (
                  <span className="ml-1 normal-case font-normal text-slate-400">— loading…</span>
                )}
                {savedPromptsStatus === 'error' && (
                  <span className="ml-1 normal-case font-normal text-red-500">— load failed</span>
                )}
                {savedPromptsStatus === 'success' && savedPrompts.length === 0 && (
                  <span className="ml-1 normal-case font-normal text-slate-400">
                    — none yet (add via Docs → Prompt Bases)
                  </span>
                )}
              </label>

              {/* Dropdown — picking a prompt adds it to the list below. Value
                  stays at "" so re-opening always shows the placeholder. */}
              {savedPrompts.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) toggleSavedPrompt(id, true);
                  }}
                  disabled={availableToAdd.length === 0}
                  className="w-full text-xs border rounded-md px-2 py-1 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">
                    {availableToAdd.length === 0
                      ? 'All saved prompts already added'
                      : 'Add a saved prompt…'}
                  </option>
                  {availableToAdd.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Picked prompts — same row layout as standard presets so the
                  visual grouping reads as one continuous list. Clicking the
                  checkbox removes the entry. */}
              {pickedPrompts.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {pickedPrompts.map((p) => {
                    const idStr = String(p.id);
                    return (
                      <div key={idStr} className="flex items-center gap-1.5 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked
                            onChange={(e) => toggleSavedPrompt(idStr, e.target.checked)}
                          />
                          <span className="font-medium text-slate-800 truncate" title={p.name}>
                            {p.name}
                          </span>
                        </label>
                        <InfoTooltip text={(p.ua_description && p.ua_description.trim()) || p.prompt} iconSize={11} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Custom-prompt block — visible only when Custom is checked. Chips
            toggle blocks on/off AND are draggable: dropping a chip into the
            textarea inserts its placeholder ({hook} etc.) at the drop point so
            n8n renders that block inline at that position instead of in the
            default order. Re-dragging the same chip removes any previous
            occurrence so blocks can't end up duplicated. */}
        {selectedPresets.includes('Custom') && (
          <div className="mt-2 space-y-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                Custom blocks
              </label>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {CUSTOM_BLOCK_DEFS.map((b) => (
                  <label
                    key={b.key}
                    draggable={customBlocks[b.key]}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', b.token);
                      e.dataTransfer.setData('application/x-custom-block', b.token);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    className={`flex items-center gap-1.5 text-xs select-none ${
                      customBlocks[b.key] ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer opacity-60'
                    }`}
                    title={customBlocks[b.key] ? 'Drag onto the textarea to pin at a specific position' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={customBlocks[b.key]}
                      onChange={(e) =>
                        setCustomBlocks({ ...customBlocks, [b.key]: e.target.checked })
                      }
                    />
                    <span className="font-medium text-slate-800">{b.label}</span>
                    <InfoTooltip text={b.hint} iconSize={11} />
                  </label>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-gray-500">
                Перетягни чіп у текстове поле нижче, щоб закріпити блок у конкретній позиції. Без перетягування блоки рендеряться у порядку за замовчуванням ({CUSTOM_BLOCK_DEFS.map((b) => b.label).join(' → ')}).
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
                Design direction
                {customPrompt.trim().length === 0 && (
                  <span className="ml-1 normal-case font-normal text-red-500">
                    — обов’язкове, коли Custom увімкнено
                  </span>
                )}
              </label>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onDragOver={(e) => {
                  // Only intercept drops that come from our chips, otherwise let
                  // the browser handle normal text-paste-style drops natively.
                  if (e.dataTransfer.types.includes('application/x-custom-block')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }
                }}
                onDrop={(e) => {
                  const token = e.dataTransfer.getData('application/x-custom-block')
                    || e.dataTransfer.getData('text/plain');
                  if (!token || !CUSTOM_BLOCK_DEFS.some((b) => b.token === token)) return;
                  e.preventDefault();
                  const ta = e.currentTarget;
                  const dropPos = getDropOffset(ta);
                  // Remove any prior occurrence of this token before inserting.
                  const existingIdx = customPrompt.indexOf(token);
                  let newText: string;
                  let cursorPos: number;
                  if (existingIdx === -1) {
                    newText = customPrompt.slice(0, dropPos) + token + customPrompt.slice(dropPos);
                    cursorPos = dropPos + token.length;
                  } else {
                    const cleaned =
                      customPrompt.slice(0, existingIdx) +
                      customPrompt.slice(existingIdx + token.length);
                    // If the existing occurrence was before the drop point, the
                    // drop position shifts back by the token's length.
                    const adjusted = existingIdx < dropPos ? dropPos - token.length : dropPos;
                    const safePos = Math.max(0, Math.min(adjusted, cleaned.length));
                    newText = cleaned.slice(0, safePos) + token + cleaned.slice(safePos);
                    cursorPos = safePos + token.length;
                  }
                  setCustomPrompt(newText);
                  requestAnimationFrame(() => {
                    ta.focus();
                    ta.setSelectionRange(cursorPos, cursorPos);
                  });
                }}
                placeholder={CUSTOM_PROMPT_PLACEHOLDER}
                className="bg-white text-xs"
                rows={5}
              />
            </div>
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

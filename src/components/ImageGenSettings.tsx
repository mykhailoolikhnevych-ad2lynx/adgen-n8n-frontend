import React, { useEffect, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { useAppStore, type CustomBlocks } from '@/store/useAppStore';
import { Textarea } from '@/components/ui/textarea';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { SavedPrompt } from '@/lib/prompts';

// The image-generation SETTINGS panel (image model, aspect ratio, image presets,
// saved prompts, custom-prompt builder). Extracted from Column3 so the Creative
// Gen tab renders the exact same panel — both read/write the same store slice,
// so a change made in one tab is visible in the other.

// Help texts shared between the Concepts column and the Creative Gen tab.
export const HOOK_HELP =
  "Головний рядок банера — те, що читач бачить перш за все. 40–55 символів (макс 60). Має зачепити за 2 секунди скрола і повідомити: для кого це, що пропонується, чому зараз.";

export const ACCENT_HELP =
  "Другий, менший рядок під хуком — уточнення або емоційне підсилення. 25–35 символів (макс 40). Працює в парі з хуком: додає конкретику (кому саме, в якій ситуації) або підсилює настрій. Не дублює хук іншими словами.";

export const CTA_HELP =
  "Текст кнопки. 8–12 символів (макс 15). Лише з білого списку: Learn More, Read More, Discover More, Read Guide, Find Out, See More, Know More, Read On, Explore. Жодних транзакційних «Apply Now / Buy Now / Sign Up» — Meta такого не пропустить.";

// Searchable add-a-saved-prompt picker. Same UX shape as the GEO / Language
// combobox: focus opens the dropdown, typing filters by name (case-insensitive
// substring), mouse-down on a row picks it. Lives as its own component because
// the surrounding IIFE in the settings panel can't host React hooks.
const SavedPromptPicker = ({ available, onPick }: {
  available: SavedPrompt[];
  onPick: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = query
    ? available.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : available;
  const empty = available.length === 0;

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={open ? query : ''}
        placeholder={empty ? 'All saved prompts already added' : 'Add a saved prompt…'}
        disabled={empty}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onClick={() => { if (!open) { setOpen(true); setQuery(''); } }}
        onChange={(e) => { if (!open) setOpen(true); setQuery(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); setQuery(''); e.currentTarget.blur(); }
        }}
        className="w-full text-xs border rounded-md px-2 py-1 pr-7 bg-white disabled:bg-slate-100 disabled:text-slate-400"
      />
      <CaretDown
        size={12}
        weight="bold"
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-700"
      />
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
        >
          {filtered.map((p) => (
            <li
              key={String(p.id)}
              role="option"
              // onMouseDown fires before the input blur so the click still picks.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(String(p.id));
                setOpen(false);
                setQuery('');
              }}
              className="cursor-pointer px-3 py-1.5 text-xs hover:bg-slate-100 truncate"
              title={p.name}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && query && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
          <li className="px-3 py-1.5 text-xs text-slate-400 italic">
            No prompts match “{query}”
          </li>
        </ul>
      )}
    </div>
  );
};

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

// A preset is "effectively selected" when it's checked AND (if Custom) has text.
// n8n's Filter Active Presets throws if zero presets reach it, so the Generate
// buttons stay disabled while invalid. Shared by Column3 and the Creative Gen tab.
export const useEffectivePresets = () => {
  const selectedPresets = useAppStore((s) => s.selectedPresets);
  const customPrompt = useAppStore((s) => s.customPrompt);
  const savedPrompts = useAppStore((s) => s.savedPrompts);
  const selectedSavedPromptIds = useAppStore((s) => s.selectedSavedPromptIds);

  const customActive = selectedPresets.includes('Custom') && customPrompt.trim().length > 0;
  // Selected saved prompts that still exist in the loaded library — guards
  // against stale ids that were deleted by an admin since last load.
  const savedPromptIdSet = new Set(savedPrompts.map((p) => String(p.id)));
  const activeSavedPromptIds = selectedSavedPromptIds.filter((id) => savedPromptIdSet.has(id));
  const effectivePresetCount =
    selectedPresets.filter((p) => p !== 'Custom').length
    + (customActive ? 1 : 0)
    + activeSavedPromptIds.length;
  return { effectivePresetCount, presetsInvalid: effectivePresetCount === 0 };
};

export const ImageGenSettings = () => {
  const {
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
    savedPrompts,
    savedPromptsStatus,
    selectedSavedPromptIds,
    setSelectedSavedPromptIds,
    loadSavedPrompts,
  } = useAppStore();

  const { presetsInvalid } = useEffectivePresets();

  // Pull the shared prompt library on mount — re-fetches each time so a
  // freshly-saved prompt in Docs shows up here without a hard refresh.
  useEffect(() => {
    void loadSavedPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
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

              {/* Searchable picker — focus to open, type to filter by name,
                  click to add. Replaces the plain <select> so libraries with
                  many saved prompts don't force the operator to scroll. */}
              {savedPrompts.length > 0 && (
                <SavedPromptPicker
                  available={availableToAdd}
                  onPick={(id) => toggleSavedPrompt(id, true)}
                />
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
};

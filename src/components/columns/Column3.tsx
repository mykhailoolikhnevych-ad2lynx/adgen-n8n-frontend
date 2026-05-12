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
  "Аспект, який тестує цей креатив — одна з 8 категорій:\n" +
  "• Demographic — конкретний сегмент аудиторії (молоді мами, фрилансери, пенсіонери 60+).\n" +
  "• Process Stage — етап шляху клієнта (рисерч / збір документів / подача заявки / очікування рішення).\n" +
  "• Emotional State — стан, який адресує креатив (розгубленість, надія, втома, впевненість).\n" +
  "• Logistical — практична деталь (документи, терміни, вартість, правила відповідності).\n" +
  "• Outcome — як виглядає «вирішено» (стабільний платіж, нове житло, спокій).\n" +
  "• Comparison — проти чого порівнюємо (vs приватна оренда, vs зволікання, vs «надто складно»).\n" +
  "• Identity Marker — вузький ідентичний маркер (пенсійний дохід, життєвий етап, тип роботи).\n" +
  "• Scope — масштаб можливості (скільки опцій, типів, рівнів допомоги).\n" +
  "Усі 3 креативи в підбірці тестують 3 РІЗНІ категорії, щоб не повторювати одну й ту саму грань кута.";

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
  "Автоматична перевірка креативу проти 14 політик (медичні твердження, гарантії кредитів, §12 транзакційні слова, §7 location, фейкові UI-елементи, відповідність статті тощо). Зелений = пройшов перевірку, готовий до запуску. Жовтий = знайдено можливе порушення; нижче в Type / Description / Policy Reference буде вказано, що саме не так.";

const COMPLIANCE_TYPE_HELP =
  "Категорія знайденого порушення — наприклад: Misleading, False claim, Loan fraud, Location targeting, Article mismatch, Article quality. Підказує, що саме ШІ вважає проблемою.";

const COMPLIANCE_DESCRIPTION_HELP =
  "Короткий опис порушення на 5–10 слів — конкретно, що не так у тексті. Читати разом із Type і Policy Reference.";

const POLICY_REFERENCE_HELP =
  "Номер політики, проти якої знайдено порушення (наприклад «Policy 12» = транзакційні твердження, «Policy 14» = відповідність статті). Повний список політик — у промпті Compliance Agent у n8n.";

const IMAGE_MODELS: { label: string; value: string }[] = [
  { label: 'Nano banana 2', value: 'google/gemini-3.1-flash-image-preview' },
  { label: 'Nano banana pro', value: 'google/gemini-3-pro-image-preview' },
  { label: 'GPT-image2', value: 'openai/gpt-5.4-image-2' },
  { label: 'Seedream 4.5', value: 'bytedance-seed/seedream-4.5' },
];

const ASPECT_RATIOS: string[] = ['1:1', '16:9', '9:16', '4:5'];

const AD_LANGUAGES: string[] = [
  'English (US)',
  'Spanish (Latin America)',
  'Arabic',
  'French',
  'Portuguese (Brazil)',
  'Indonesian',
  'German',
  'Japanese',
  'Turkish',
  'Vietnamese',
  'English (UK)',
  'Italian',
  'Korean',
  'Spanish (Spain)',
  'Portuguese (Portugal)',
  'Polish',
  'Ukrainian',
  'Malay',
  'Dutch',
  'Romanian',
  'Hungarian',
  'Greek',
  'Czech',
  'Serbian',
  'Swedish',
  'Catalan',
  'Bulgarian',
  'Albanian',
  'Danish',
  'Finnish',
  'Norwegian',
  'Slovak',
  'Belarusian',
  'Croatian',
  'Lithuanian',
  'Slovenian',
  'Latvian',
  'Macedonian',
  'Estonian',
];

export const Column3 = () => {
  const {
    concepts,
    updateConcept,
    generateCreative,
    isLoadingCreatives,
    isLoadingConcepts,
    clearConcepts,
    imageGenerationModel,
    adLanguage,
    aspectRatio,
    setImageGenerationModel,
    setAdLanguage,
    setAspectRatio,
  } = useAppStore();

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
      <div>
        <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Ad language</label>
        <select
          value={adLanguage}
          onChange={(e) => setAdLanguage(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1 bg-white"
        >
          {AD_LANGUAGES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
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

      {concepts.map((concept, index) => (
        <Card key={concept.id} className="p-4 space-y-3 bg-slate-50 shadow-sm border-blue-100">
          <div className="text-sm font-semibold text-blue-800">
            Creative {index + 1}
            {concept.formula && <span> — {concept.formula}</span>}
            {concept.formulaName && <span> — {concept.formulaName}</span>}
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
              value={concept.hook}
              onChange={(e) => updateConcept(concept.id, 'hook', e.target.value)}
              className="bg-white text-sm resize-none"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Accent
              <InfoTooltip text={ACCENT_HELP} iconSize={11} />
            </label>
            <Textarea
              value={concept.accent}
              onChange={(e) => updateConcept(concept.id, 'accent', e.target.value)}
              className="bg-white text-sm resize-none"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              CTA
              <InfoTooltip text={CTA_HELP} iconSize={11} />
            </label>
            <Textarea
              value={concept.cta}
              onChange={(e) => updateConcept(concept.id, 'cta', e.target.value)}
              className="bg-white text-sm resize-none"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Meta Title
              <InfoTooltip text={META_TITLE_HELP} iconSize={11} />
            </label>
            <Textarea
              value={concept.metaTitle}
              onChange={(e) => updateConcept(concept.id, 'metaTitle', e.target.value)}
              className="bg-white text-sm resize-none"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Meta Copy
              <InfoTooltip text={META_COPY_HELP} iconSize={11} />
            </label>
            <Textarea
              value={concept.metaCopy}
              onChange={(e) => updateConcept(concept.id, 'metaCopy', e.target.value)}
              className="bg-white text-sm"
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
            disabled={isLoadingCreatives}
          >
            {isLoadingCreatives ? 'Generating Images...' : 'Generate Creative Batch'}
          </Button>
        </Card>
      ))}
    </div>
  );
};

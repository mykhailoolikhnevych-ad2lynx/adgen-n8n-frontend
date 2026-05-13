import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

const ANGLES_HELP =
  "Три стратегічні підходи, які ШІ згенерував. Кожен побудований на одному з 5 когнітивних тригерів:\n" +
  "• CG — Curiosity Gap: інтрига, «розрив» між тим, що читач знає і що міг би знати.\n" +
  "• SR — Self-Reference: упізнавання себе через демографічний / ідентичний маркер.\n" +
  "• LA — Loss Aversion: усвідомлення вигоди, яку можна втратити (без тиску терміновості).\n" +
  "• PI — Pattern Interrupt: нерекламний тон, виламує зі звичної стрічки.\n" +
  "• BS — Belief Shift: контраст із поширеною думкою, перевертає переконання.\n" +
  "Це НЕ три варіанти заголовка — три різні стратегії. Обери ту, що найкраще пасує аудиторії, і натисни «Select & Next».";

const DIRECTION_HELP =
  "Опис у 15–25 слів стратегічного підходу цього кута, яку стверджує банер, але ще не сам заголовок. Приклад: «Зайти через підхід (мало хто знає) і спертися на маловідому житлову програму з самої статті». Можеш редагувати, якщо хочеш скоригувати кут перед генерацією хуків — агент-копірайтер читає саме цей текст, щоб вирішити, як звучатиме банер.";

const HOOK_SEED_HELP =
  "Чорнова ідея заголовка банера на 8–12 слів. Вона навмисно неповна — це сирий концепт без структури формули. Приклад: «вигода, про яку більшість пенсіонерів у цій ситуації ніколи не чує». Наступний агент (Копірайтер) перетворить це на готовий хук за однією з формул (F2/F3/F4/F6). Поміняй, якщо хочеш інший стартовий концепт, або залиш як є, щоб ШІ зробив це сам.";

const AWARENESS_HELP =
  "Рівень обізнаності холодної аудиторії з темою. L1 — Unaware (взагалі не шукають цю тему, не знають про неї). L2 — Problem-Aware (знають про проблему, але не про конкретне рішення). RSOC-трафік на Meta зазвичай L1–L2 — це впливає на те, наскільки прямою чи натяковою має бути подача.";

const EMOTION_HELP =
  "Емоційний якір кута — одна емоція зі списку:\n" +
  "• Discovery — момент «знайшов щось нове».\n" +
  "• Hope — надія на краще, позитивне очікування.\n" +
  "• Relief — полегшення після напруження / хвилювання.\n" +
  "• Concern — занепокоєння, але без паніки.\n" +
  "• Pride — гордість за себе чи приналежність до групи.\n" +
  "• Indignation — обурення несправедливістю.\n" +
  "• Confidence — упевненість, що знаєш, як діяти.\n" +
  "• Curiosity — цікавість, бажання дізнатися більше.\n" +
  "Визначає тон хука і настрій візуалу. Один кут = одна емоція, без міксів.";

export const Column2 = () => {
  const { angles, updateAngle, generateConcept, generateAngles, isLoadingAngles, isLoadingConcepts, toggleAngleTranslation } = useAppStore();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="flex items-center gap-1.5 font-bold text-xl">
          2. Angles
          <InfoTooltip text={ANGLES_HELP} />
        </h2>
        {angles.length > 0 && (
          <Button variant="ghost" size="sm" onClick={generateAngles} disabled={isLoadingAngles}>Regenerate</Button>
        )}
      </div>
      {angles.length === 0 && (
        <div className="text-gray-400 italic">
          {isLoadingAngles ? 'Generating angles...' : 'Generate angles first...'}
        </div>
      )}
      {angles.map((angle, index) => {
        const isUk = !!angle.showTranslation && !!angle.translation;
        const directionValue = isUk ? (angle.translation?.direction ?? '') : angle.direction;
        const hookSeedValue = isUk ? (angle.translation?.hookSeed ?? '') : angle.hookSeed;
        const whyWorksValue = isUk ? (angle.translation?.whyWorks ?? '') : angle.whyWorks;
        let translateLabel = '🇺🇦 Translate';
        if (angle.isTranslating) translateLabel = 'Translating…';
        else if (isUk) translateLabel = '🇺🇸 Original';
        return (
        <Card key={angle.id} className="p-4 space-y-3 bg-slate-50">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700">
              Angle {index + 1}
              {(angle.code || angle.trigger) && (
                <span className="text-slate-600 font-normal">
                  {' — '}
                  {angle.code && <span className="font-semibold">[{angle.code}]</span>}
                  {angle.code && angle.trigger && ' '}
                  {angle.trigger}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => toggleAngleTranslation(angle.id)}
              disabled={angle.isTranslating}
            >
              {translateLabel}
            </Button>
          </div>

          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Direction
              <InfoTooltip text={DIRECTION_HELP} />
            </label>
            <Textarea
              value={directionValue}
              onChange={(e) => updateAngle(angle.id, 'direction', e.target.value)}
              readOnly={isUk}
              className={`bg-white text-sm ${isUk ? 'cursor-default opacity-95' : ''}`}
            />
          </div>

          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Hook Seed
              <InfoTooltip text={HOOK_SEED_HELP} />
            </label>
            <Textarea
              value={hookSeedValue}
              onChange={(e) => updateAngle(angle.id, 'hookSeed', e.target.value)}
              readOnly={isUk}
              className={`bg-white text-sm ${isUk ? 'cursor-default opacity-95' : ''}`}
            />
          </div>

          <div className="text-xs space-y-1">
            <div className="flex items-center gap-1">
              <span className="font-bold uppercase text-gray-400">Awareness:</span>
              <InfoTooltip text={AWARENESS_HELP} iconSize={12} />
              <span className="text-slate-700">{angle.awarenessLevel || '—'}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold uppercase text-gray-400">Emotion:</span>
              <InfoTooltip text={EMOTION_HELP} iconSize={12} />
              <span className="text-slate-700">{angle.emotionalAnchor || '—'}</span>
            </div>
          </div>

          <div className="text-sm">
            <span className="text-[10px] font-bold uppercase text-gray-400">Why it works:</span>{' '}
            <span className="whitespace-pre-wrap text-slate-700">{whyWorksValue}</span>
          </div>

          <Button
            onClick={() => generateConcept(angle.id)}
            disabled={isLoadingConcepts}
            className="w-full"
          >
            {isLoadingConcepts ? 'Generating...' : 'Select & Next'}
          </Button>
        </Card>
        );
      })}
    </div>
  );
};
import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

const ANGLES_HELP =
  "Три стратегічні підходи, які ШІ згенерував із твого вводу. Кожен — це окрема психологічна «причина зупинити скрол», побудована на іншому когнітивному тригері (Curiosity Gap, Self-Reference, Loss Aversion, Pattern Interrupt або Belief Shift). Це НЕ три варіанти заголовка — це три різні стратегії. Обери ту, що найкраще пасує твоїй аудиторії та інтуїції, і натисни «Select & Next», щоб згенерувати варіанти хуків.";

const DIRECTION_HELP =
  "Опис у 15–25 слів стратегічного підходу цього кута — ПРЕМІСА, яку стверджує банер, але ще не сам заголовок. Приклад: «Зайти через підхід „мало хто знає\" і спертися на маловідому житлову програму з самої статті». Можеш редагувати, якщо хочеш скоригувати кут перед генерацією хуків — агент-копірайтер читає саме цей текст, щоб вирішити, як звучатиме банер.";

const HOOK_SEED_HELP =
  "Чорнова ідея заголовка банера на 8–12 слів. Вона навмисно неповна — це сирий концепт без структури формули. Приклад: «вигода, про яку більшість пенсіонерів у цій ситуації ніколи не чує». Наступний агент (Копірайтер) перетворить це на готовий хук за однією з формул (F2/F3/F4/F6). Поміняй, якщо хочеш інший стартовий концепт, або залиш як є, щоб ШІ зробив це сам.";

export const Column2 = () => {
  const { angles, updateAngle, generateConcept, generateAngles, isLoadingAngles, isLoadingConcepts } = useAppStore();

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
      {angles.map((angle, index) => (
        <Card key={angle.id} className="p-4 space-y-3 bg-slate-50">
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

          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Direction
              <InfoTooltip text={DIRECTION_HELP} />
            </label>
            <Textarea
              value={angle.direction}
              onChange={(e) => updateAngle(angle.id, 'direction', e.target.value)}
              className="bg-white text-sm"
            />
          </div>

          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
              Hook Seed
              <InfoTooltip text={HOOK_SEED_HELP} />
            </label>
            <Textarea
              value={angle.hookSeed}
              onChange={(e) => updateAngle(angle.id, 'hookSeed', e.target.value)}
              className="bg-white text-sm"
            />
          </div>

          <div className="text-xs space-y-1">
            <div>
              <span className="font-bold uppercase text-gray-400">Awareness:</span>{' '}
              <span className="text-slate-700">{angle.awarenessLevel || '—'}</span>
            </div>
            <div>
              <span className="font-bold uppercase text-gray-400">Emotion:</span>{' '}
              <span className="text-slate-700">{angle.emotionalAnchor || '—'}</span>
            </div>
          </div>

          <div className="text-sm">
            <span className="text-[10px] font-bold uppercase text-gray-400">Why it works:</span>{' '}
            <span className="whitespace-pre-wrap text-slate-700">{angle.whyWorks}</span>
          </div>

          <Button
            onClick={() => generateConcept(angle.id)}
            disabled={isLoadingConcepts}
            className="w-full"
          >
            {isLoadingConcepts ? 'Generating...' : 'Select & Next'}
          </Button>
        </Card>
      ))}
    </div>
  );
};
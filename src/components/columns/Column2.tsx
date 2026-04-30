import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';

export const Column2 = () => {
  const { angles, updateAngle, generateConcept, generateAngles, isLoadingAngles, isLoadingConcepts } = useAppStore();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="font-bold text-xl">2. Angles</h2>
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
            <label className="text-[10px] font-bold uppercase text-gray-400">Direction</label>
            <Textarea
              value={angle.direction}
              onChange={(e) => updateAngle(angle.id, 'direction', e.target.value)}
              className="bg-white text-sm"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Hook Seed</label>
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
import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';

export const Column2 = () => {
  const { angles, updateAngle, generateConcept, generateAngles, isLoadingAngles, isLoadingConcepts } = useAppStore();

  if (angles.length === 0) return <div className="text-gray-400 italic">Generate angles first...</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-xl">2. Angles</h2>
        <Button variant="ghost" size="sm" onClick={generateAngles} disabled={isLoadingAngles}>Regenerate</Button>
      </div>
      {angles.map((angle) => (
        <Card key={angle.id} className="p-4 space-y-3 bg-slate-50">
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Direction</label>
            <Textarea 
              value={angle.direction} 
              onChange={(e) => updateAngle(angle.id, 'direction', e.target.value)} 
              className="bg-white text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Why it works</label>
            <p className="text-sm whitespace-pre-wrap">{angle.whyWorks}</p>
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
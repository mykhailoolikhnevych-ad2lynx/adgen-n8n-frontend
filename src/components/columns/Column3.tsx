import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';

export const Column3 = () => {
  const { concepts, updateConcept, generateCreative, isLoadingCreatives, isLoadingConcepts } = useAppStore();

  if (concepts.length === 0) {
    return (
      <div className="text-gray-400 italic">
        {isLoadingConcepts ? 'Generating concept...' : 'Waiting for concepts...'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-xl mb-2">3. Concepts</h2>
      
      {concepts.map((concept, index) => (
        <Card key={concept.id} className="p-4 space-y-3 bg-slate-50 shadow-sm border-blue-100">
          <h3 className="font-semibold text-sm text-blue-800">Concept {index + 1}</h3>
          
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Hook</label>
            <Textarea 
              value={concept.hook} 
              onChange={(e) => updateConcept(concept.id, 'hook', e.target.value)} 
              className="bg-white text-sm resize-none" 
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Accent</label>
            <Textarea 
              value={concept.accent} 
              onChange={(e) => updateConcept(concept.id, 'accent', e.target.value)} 
              className="bg-white text-sm resize-none" 
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">CTA</label>
            <Textarea 
              value={concept.cta} 
              onChange={(e) => updateConcept(concept.id, 'cta', e.target.value)} 
              className="bg-white text-sm resize-none" 
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Meta Title</label>
            <Textarea 
              value={concept.metaTitle} 
              onChange={(e) => updateConcept(concept.id, 'metaTitle', e.target.value)} 
              className="bg-white text-sm resize-none" 
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Meta Copy</label>
            <Textarea 
              value={concept.metaCopy} 
              onChange={(e) => updateConcept(concept.id, 'metaCopy', e.target.value)} 
              className="bg-white text-sm" 
            />
          </div>

          <Button 
            onClick={() => generateCreative(concept.id)} 
            className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-2"
            disabled={isLoadingCreatives}
          >
            {isLoadingCreatives ? "Generating Images..." : "Generate Creative"}
          </Button>
        </Card>
      ))}
    </div>
  );
};
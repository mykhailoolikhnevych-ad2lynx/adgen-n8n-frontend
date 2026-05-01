import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';

export const Column3 = () => {
  const { concepts, updateConcept, generateCreative, isLoadingCreatives, isLoadingConcepts, clearConcepts } = useAppStore();

  if (concepts.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-bold text-xl mb-2">3. Concepts</h2>
        <div className="text-gray-400 italic">
          {isLoadingConcepts ? 'Generating concept...' : 'Waiting for concepts...'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="font-bold text-xl">3. Concepts</h2>
        <Button variant="ghost" size="sm" onClick={clearConcepts}>Clear</Button>
      </div>

      {concepts.map((concept, index) => (
        <Card key={concept.id} className="p-4 space-y-3 bg-slate-50 shadow-sm border-blue-100">
          <div className="text-sm font-semibold text-blue-800">
            Creative {index + 1}
            {concept.formula && <span> — {concept.formula}</span>}
            {concept.formulaName && <span> — {concept.formulaName}</span>}
          </div>

          {concept.aspectCategory && (
            <div className="text-xs">
              <span className="font-bold uppercase text-gray-400">Category:</span>{' '}
              <span className="text-slate-700">{concept.aspectCategory}</span>
            </div>
          )}

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

          <div className="space-y-2 pt-2 border-t border-slate-200">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[10px] font-bold uppercase text-gray-400">Compliance check:</span>
              <span
                className={`inline-block w-3 h-3 rounded-full ${concept.compliant ? 'bg-green-500' : 'bg-yellow-500'}`}
                title={concept.compliant ? 'Compliant' : 'Not compliant'}
                aria-label={concept.compliant ? 'Compliant' : 'Not compliant'}
              />
            </div>
            {concept.complianceType && (
              <div className="text-sm">
                <span className="text-[10px] font-bold uppercase text-gray-400">Type:</span>{' '}
                <span className="text-slate-700 whitespace-pre-wrap">{concept.complianceType}</span>
              </div>
            )}
            {concept.complianceDescription && (
              <div className="text-sm">
                <span className="text-[10px] font-bold uppercase text-gray-400">Description:</span>{' '}
                <span className="text-slate-700 whitespace-pre-wrap">{concept.complianceDescription}</span>
              </div>
            )}
            {concept.policyReference && (
              <div className="text-sm">
                <span className="text-[10px] font-bold uppercase text-gray-400">Policy Reference:</span>{' '}
                <span className="text-slate-700 whitespace-pre-wrap">{concept.policyReference}</span>
              </div>
            )}
          </div>

          <Button
            onClick={() => generateCreative(concept.id)} 
            className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-2"
            disabled={isLoadingCreatives}
          >
            {isLoadingCreatives ? "Generating Images..." : "Generate Creative Batch"}
          </Button>
        </Card>
      ))}
    </div>
  );
};
import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';

export const Column4 = () => {
  const { creatives, updateCreative, deleteCreative, sendToTelegram } = useAppStore();

  if (creatives.length === 0) {
    return <div className="text-gray-400 italic">Waiting for final creatives...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-xl mb-2">4. Final Creatives</h2>
      
      {creatives.map((creative, index) => (
        <Card key={creative.id} className="p-4 space-y-4 bg-white shadow-md border-green-200 border-2">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm text-green-700">Creative {index + 1}</h3>
            <Button variant="destructive" size="sm" onClick={() => deleteCreative(creative.id)}>
              Delete
            </Button>
          </div>
          
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Meta Ad Title</label>
            <Textarea 
              value={creative.metaTitle} 
              onChange={(e) => updateCreative(creative.id, 'metaTitle', e.target.value)} 
              className="bg-slate-50 text-sm font-semibold resize-none" 
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400">Meta Ad Copy</label>
            <Textarea 
              value={creative.metaCopy} 
              onChange={(e) => updateCreative(creative.id, 'metaCopy', e.target.value)} 
              className="bg-slate-50 text-sm min-h-[100px]" 
            />
          </div>

          {/* Сетка картинок. Если n8n вернул массив ссылок на картинки - показываем их */}
          {creative.images && creative.images.length > 0 && (
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-400 mb-2 block">Generated Images</label>
              <div className="grid grid-cols-3 gap-2">
                {creative.images.map((imgUrl, i) => (
                  <div key={i} className="aspect-square bg-slate-100 rounded-md overflow-hidden border">
                    <img src={imgUrl} alt={`Creative ${i+1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button 
            onClick={() => sendToTelegram(creative.id)} 
            className="w-full bg-green-600 hover:bg-green-700 text-white"
          >
            Send to Telegram
          </Button>
        </Card>
      ))}
    </div>
  );
};
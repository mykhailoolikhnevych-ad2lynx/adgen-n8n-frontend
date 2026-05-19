import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { GEOS } from '@/lib/geos';

export const ArticlePage = () => {
  const [topic, setTopic] = useState('');
  const [geo, setGeo] = useState('United States');
  const [errors, setErrors] = useState({ topic: false, geo: false });

  const handleGenerate = () => {
    const newErrors = {
      topic: !topic.trim(),
      geo: !geo.trim(),
    };
    setErrors(newErrors);
    if (newErrors.topic || newErrors.geo) return;
    // TODO: hook up webhook / store action
  };

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl mb-2">1. Input</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Article topic *</label>
              <Input
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  if (errors.topic) setErrors((p) => ({ ...p, topic: false }));
                }}
                placeholder="e.g. Reverse mortgage calculators"
                className={errors.topic ? 'border-red-500 focus-visible:ring-red-500' : ''}
              />
              {errors.topic && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">GEO *</label>
              <Combobox
                value={geo}
                onChange={(v) => {
                  setGeo(v);
                  if (errors.geo) setErrors((p) => ({ ...p, geo: false }));
                }}
                options={GEOS}
                placeholder="Click to choose or type… e.g. United States"
                inputClassName="text-sm rounded-md bg-white px-2"
                error={errors.geo}
              />
              {errors.geo && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>
          </div>

          <Button onClick={handleGenerate} className="mt-4">
            Generate Article
          </Button>
        </div>
      </div>

      {/* 2. Results */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl mb-2">2. Results</h2>

          {/* Full-width status bar */}
          <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center">
            <span>
              <span className="font-semibold text-slate-700">Status:</span>{' '}
              <span className="text-slate-600">Idle</span>
            </span>
          </div>

          <div className="text-gray-400 italic">Waiting for input</div>
        </div>
      </div>
    </div>
  );
};

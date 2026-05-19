import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { GEOS } from '@/lib/geos';

const ANCHOR_TRANSLATIONS: { label: string; value: string }[] = [
  { label: 'Automatic', value: 'automatic' },
  { label: 'None', value: 'none' },
];

export const KeywordsPage = () => {
  const [geo, setGeo] = useState('United States');
  const [language, setLanguage] = useState('English');
  const [anchor, setAnchor] = useState('');
  const [anchorTranslation, setAnchorTranslation] = useState('automatic');
  const [errors, setErrors] = useState({ language: false, anchor: false });

  const handleResearch = () => {
    const newErrors = {
      language: !language.trim(),
      anchor: !anchor.trim(),
    };
    setErrors(newErrors);
    if (newErrors.language || newErrors.anchor) return;
    // TODO: hook up webhook / store action
  };

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* 1. Input — narrow column matching Creatives layout */}
      <div className="w-1/4 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl mb-2">1. Input</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Mode</label>
              <Input
                value="Deep"
                readOnly
                disabled
                className="bg-slate-50 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">GEO</label>
              <Combobox
                value={geo}
                onChange={setGeo}
                options={GEOS}
                placeholder="Click to choose or type… e.g. United States"
                inputClassName="text-sm rounded-md bg-white px-2"
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Language *</label>
              <Input
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  if (errors.language) setErrors((p) => ({ ...p, language: false }));
                }}
                placeholder="e.g. English"
                className={errors.language ? 'border-red-500 focus-visible:ring-red-500' : ''}
              />
              {errors.language && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Anchor *</label>
              <Input
                value={anchor}
                onChange={(e) => {
                  setAnchor(e.target.value);
                  if (errors.anchor) setErrors((p) => ({ ...p, anchor: false }));
                }}
                placeholder="Seed keyword"
                className={errors.anchor ? 'border-red-500 focus-visible:ring-red-500' : ''}
              />
              {errors.anchor && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
            </div>

            <div>
              <label className="text-xs font-medium uppercase text-slate-500">Anchor translation</label>
              <select
                value={anchorTranslation}
                onChange={(e) => setAnchorTranslation(e.target.value)}
                className="w-full text-sm border rounded-md px-2 py-1 bg-white"
              >
                {ANCHOR_TRANSLATIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <Button onClick={handleResearch} className="mt-4">
            Research
          </Button>
        </div>
      </div>

      {/* 2. Results — takes remaining width */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl mb-2">2. Results</h2>

          {/* Full-width status bar (real-time status will go here later) */}
          <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center">
            <span>
              <span className="font-semibold text-slate-700">Status:</span>{' '}
              <span className="text-slate-600">Idle</span>
            </span>
          </div>

          {/* Strategic narrative — one paragraph of generated text */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-1">Strategic narrative:</h3>
            <p className="text-sm text-gray-400 italic whitespace-pre-wrap">
              Waiting for input
            </p>
          </div>

          {/* Full-width section header — TOP 10 Keywords */}
          <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center">
            <span className="font-semibold text-slate-700">TOP 10 Keywords</span>
          </div>

          {/* Keywords table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                  <th className="py-2 pr-2 w-10">Rank</th>
                  <th className="py-2 pr-2">Keyword (original)</th>
                  <th className="py-2 pr-2">Translation (UA)</th>
                  <th className="py-2 pr-2 w-20">Volume</th>
                  <th className="py-2 pr-2 w-16">CPC</th>
                  <th className="py-2 pr-2 w-20">Trend</th>
                  <th className="py-2 pr-2 w-10">Q</th>
                  <th className="py-2 pr-2">Thesis (why this one)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={8} className="py-4 text-center text-gray-400 italic">
                    Waiting for input
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Full-width section header — Strategic Clusters */}
          <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center">
            <span className="font-semibold text-slate-700">
              Strategic Clusters — Budget Allocation + Key Metrics
            </span>
          </div>

          {/* Strategic Clusters table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                  <th className="py-2 pr-2 w-16">Priority</th>
                  <th className="py-2 pr-2">Cluster name (original)</th>
                  <th className="py-2 pr-2">Name (UA)</th>
                  <th className="py-2 pr-2 w-20">Volume</th>
                  <th className="py-2 pr-2 w-16">CPC</th>
                  <th className="py-2 pr-2 w-20">Trend</th>
                  <th className="py-2 pr-2 w-20">Budget %</th>
                  <th className="py-2 pr-2">Justification (UA)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={8} className="py-4 text-center text-gray-400 italic">
                    Waiting for input
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Full-width section header — Gem Hunter */}
          <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center">
            <span className="font-semibold text-slate-700">
              Gem Hunter — Deep Analysis by Categories
            </span>
          </div>

          {/* Gem Hunter table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                  <th className="py-2 pr-2">Category</th>
                  <th className="py-2 pr-2">Keyword (original)</th>
                  <th className="py-2 pr-2">Translation (UA)</th>
                  <th className="py-2 pr-2 w-20">Volume</th>
                  <th className="py-2 pr-2 w-16">CPC</th>
                  <th className="py-2 pr-2 w-20">Trend</th>
                  <th className="py-2 pr-2 w-10">Q</th>
                  <th className="py-2 pr-2">Why GEM (UA)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={8} className="py-4 text-center text-gray-400 italic">
                    Waiting for input
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

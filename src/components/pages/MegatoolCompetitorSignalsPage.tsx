import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getIsAdmin } from '@/lib/roles';
import { post, ErrorBox } from './MegatoolAutozalivBuilderPage';

// Competitor Signals (megatool-competitor-signals) — admin-only test tab: Adheart ads grouped by article,
// with a status from how the article progresses. Read-only. The status rules live in the workflow's Validate node.
const WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_COMPETITOR_SIGNALS_URL as string | undefined;

const STATUSES = ['rising', 'proven', 'burst', 'dying', 'dead', 'other'] as const;
const STATUS_INFO: Record<string, { hint: string; color: string }> = {
  rising: { hint: '5+ ads in the last 7 days, at least double the 7 days before, on 2+ different days, article 21 days old or less', color: 'bg-emerald-100 text-emerald-800' },
  proven: { hint: 'Article 14+ days old and 3+ new ads in the last 7 days', color: 'bg-blue-100 text-blue-800' },
  burst: { hint: '5+ ads in the last 7 days, all on one day: a mass launch, not yet proof of anything', color: 'bg-amber-100 text-amber-800' },
  dying: { hint: '5+ ads, none new in the last 7 days', color: 'bg-orange-100 text-orange-800' },
  dead: { hint: 'No new ads for more than 14 days before the last parse', color: 'bg-slate-200 text-slate-600' },
  other: { hint: 'None of the above', color: 'bg-slate-100 text-slate-500' },
};

const COLUMNS: { key: string; label: string; hint?: string; sortable?: boolean }[] = [
  { key: 'status', label: 'status' },
  { key: 'competitor', label: 'competitor' },
  { key: 'article', label: 'article' },
  { key: 'ads', label: 'ads', sortable: true },
  { key: 'live', label: 'live', hint: 'Ads active in the latest parse', sortable: true },
  { key: 'w3', label: 'wk -3', hint: 'Ads placed 14–20 days before the last parse', sortable: true },
  { key: 'w2', label: 'wk -2', hint: 'Ads placed 7–13 days before the last parse', sortable: true },
  { key: 'w1', label: 'wk -1', hint: 'Ads placed in the 7 days before the last parse', sortable: true },
  { key: 'launch_days', label: 'days', hint: 'Different days with new ads in the last 7 days', sortable: true },
  { key: 'first_ad', label: 'first ad', sortable: true },
  { key: 'last_seen', label: 'last seen', sortable: true },
  { key: 'age_days', label: 'age', hint: 'Days from the first ad to the last parse', sortable: true },
  { key: 'avg_days', label: 'avg run', hint: 'Average active days per ad', sortable: true },
  { key: 'max_days', label: 'max run', hint: 'Longest-running ad, in active days', sortable: true },
  { key: 'geos', label: 'geo', hint: 'Most common geo, and how many geos in total', sortable: true },
];

type Sort = { key: string; dir: 'asc' | 'desc' };
type Result = { headers: string[]; rows: string[][]; total: number; summary: [string, string, number, string, number][] };

export function MegatoolCompetitorSignalsPage() {
  const [competitor, setCompetitor] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [minAds, setMinAds] = useState('3');
  const [sort, setSort] = useState<Sort>({ key: 'w1', dir: 'desc' });
  const [data, setData] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<string>();
  const requestNo = useRef(0); // a slower, older answer must not overwrite a newer one

  const load = async () => {
    const no = ++requestNo.current;
    setBusy(true);
    setError(undefined);
    try {
      const res = await post(WEBHOOK, 'PUBLIC_WEBHOOK_COMPETITOR_SIGNALS_URL', {
        action: 'signals', competitor, status, search, sort, minAds: Number(minAds) || 3, is_admin: await getIsAdmin(),
      }, 60_000);
      if (no === requestNo.current) setData(res);
    } catch (e: any) {
      if (no === requestNo.current) setError(e.message);
    } finally {
      if (no === requestNo.current) setBusy(false);
    }
  };
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [competitor, status, search, minAds, sort]);

  // competitor -> last parse, ads in that parse, articles per status
  const byCompetitor = useMemo(() => {
    const out: Record<string, { lastParse: string; parseAds: number; counts: Record<string, number> }> = {};
    for (const [name, lastParse, parseAds, st, n] of data?.summary || []) {
      out[name] ??= { lastParse, parseAds, counts: {} };
      out[name].counts[st] = n;
    }
    return out;
  }, [data]);
  const col = (h: string) => data?.headers.indexOf(h) ?? -1;

  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 overflow-hidden">
      <div className="m-4 mb-2 flex min-h-0 flex-1 flex-col gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-semibold text-slate-800">Competitor Signals</span>
          <span>— Adheart ads grouped by article. Weeks count back from each competitor's last parse. Test data: rules may change.</span>
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={load} disabled={busy}>{busy ? 'Loading…' : '↻ Refresh'}</Button>
        </div>

        <div className="max-h-52 shrink-0 overflow-auto rounded border border-slate-200">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-slate-100 text-left text-[10px] font-bold uppercase text-gray-500">
              <tr>
                <th className="px-2 py-1">competitor</th>
                <th className="px-2 py-1">last parse</th>
                <th className="px-2 py-1" title="Ads in the latest parse. A small number means live counts and statuses for this competitor are unreliable.">ads in parse</th>
                {STATUSES.map((s) => <th key={s} className="px-2 py-1 text-right" title={STATUS_INFO[s].hint}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(byCompetitor).map(([name, c]) => (
                <tr key={name} className={`border-t border-slate-100 ${competitor === name ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-1">
                    <button type="button" className="font-medium text-slate-800 hover:underline" onClick={() => setCompetitor(competitor === name ? '' : name)}>{name}</button>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{c.lastParse}</td>
                  <td className="px-2 py-1">{c.parseAds}</td>
                  {STATUSES.map((s) => (
                    <td key={s} className="px-2 py-1 text-right">
                      {c.counts[s] ? (
                        <button
                          type="button"
                          className="text-blue-600 hover:underline"
                          onClick={() => { setCompetitor(name); setStatus(s); }}
                        >
                          {c.counts[s]}
                        </button>
                      ) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
              {!data && <tr><td colSpan={9} className="px-2 py-2 text-slate-400">{busy ? 'Loading…' : 'No data'}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={competitor} onChange={(e) => setCompetitor(e.target.value)} className="h-8 rounded border border-slate-200 bg-white px-2 text-sm">
            <option value="">All competitors</option>
            {Object.keys(byCompetitor).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="flex gap-1">
            {['', ...STATUSES].map((s) => (
              <button
                key={s || 'all'}
                type="button"
                title={s ? STATUS_INFO[s].hint : undefined}
                onClick={() => setStatus(s)}
                className={`h-8 rounded border px-2.5 capitalize ${status === s ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
              >
                {s || 'all'}
              </button>
            ))}
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Article contains…" className="h-8 w-56 bg-white" />
          <label className="flex items-center gap-1" title="Hide articles with fewer ads">
            Min ads
            <Input type="number" min={1} value={minAds} onChange={(e) => setMinAds(e.target.value)} className="h-8 w-20 bg-white" />
          </label>
          {data && <span className="ml-auto text-slate-500">Showing {data.rows.length} of {data.total} articles</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[10px] font-bold uppercase text-gray-500">
              <tr>
                <th className="px-2 py-1" />
                {COLUMNS.map((c) => (
                  <th key={c.key} title={c.hint} className="whitespace-nowrap px-2 py-1">
                    {c.sortable ? (
                      <button type="button" className="uppercase hover:text-slate-800" onClick={() => toggleSort(c.key)}>
                        {c.label}{sort.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r) => {
                const get = (h: string) => r[col(h)] || '';
                const info = STATUS_INFO[get('status')] || STATUS_INFO.other;
                return (
                  <tr key={`${get('competitor')}|${get('article')}`} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1">
                      {get('image') ? (
                        <button type="button" className="block h-10 w-10" onClick={() => setPreview(get('image'))}>
                          <img src={get('image')} alt="" loading="lazy" className="h-10 w-10 min-w-10 rounded object-cover" />
                        </button>
                      ) : <div className="h-10 w-10 rounded bg-slate-100" />}
                    </td>
                    {COLUMNS.map((c) => {
                      if (c.key === 'status') return <td key={c.key} className="px-2 py-1"><span title={info.hint} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${info.color}`}>{get('status')}</span></td>;
                      if (c.key === 'article') {
                        return (
                          <td key={c.key} className="min-w-[20rem] max-w-md px-2 py-1">
                            {get('landing') ? <a href={get('landing')} target="_blank" rel="noreferrer" className="break-all text-blue-600 hover:underline">{get('article')}</a> : <span className="break-all">{get('article')}</span>}
                            {get('title') && <div className="truncate text-[11px] text-slate-400" title={get('title')}>{get('title')}</div>}
                          </td>
                        );
                      }
                      if (c.key === 'geos') return <td key={c.key} className="whitespace-nowrap px-2 py-1">{get('top_geo') || '—'}{Number(get('geos')) > 1 ? ` +${Number(get('geos')) - 1}` : ''}</td>;
                      return <td key={c.key} className="whitespace-nowrap px-2 py-1">{get(c.key) || '—'}</td>;
                    })}
                  </tr>
                );
              })}
              {data && data.rows.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 1} className="px-2 py-2 text-slate-400">No articles match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {error && <ErrorBox msg={`Competitor Signals: ${error}`} />}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPreview(undefined)}>
          <img src={preview} alt="" className="max-h-[90vh] max-w-[90vw] rounded" />
        </div>
      )}
    </div>
  );
}

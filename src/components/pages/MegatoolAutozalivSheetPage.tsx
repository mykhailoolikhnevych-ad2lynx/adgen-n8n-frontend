import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Read-only view of the autozaliv Google Sheet (the Apps Script mass-scaling
// tool). n8n reads one tab per request via the Sheets API; long cells arrive
// already truncated to 300 chars.
const WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_AUTOZALIV_SHEET_URL as string | undefined;

const TABS = [
  'articles for uploading',
  'ads for uploading',
  'Filtered Results',
  'Filter for AUTOZALYV',
  'update status',
  'List',
] as const;
type Tab = (typeof TABS)[number];

type TabData = { values: string[][]; fetchedAt: string };

export function MegatoolAutozalivSheetPage() {
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [data, setData] = useState<Partial<Record<Tab, TabData>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = async (t: Tab) => {
    if (!WEBHOOK) {
      setError('PUBLIC_WEBHOOK_AUTOZALIV_SHEET_URL is not set');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: res } = await axios.post(WEBHOOK, { tab: t }, { timeout: 90_000 });
      const outer = Array.isArray(res) ? res[0] : res;
      if (!outer?.ok) throw new Error(outer?.error || 'Sheet read failed');
      setData((d) => ({ ...d, [t]: { values: outer.values || [], fetchedAt: outer.fetchedAt } }));
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Sheet read failed');
    } finally {
      setLoading(false);
    }
  };

  // Fetch a tab the first time it's opened; Refresh re-fetches on demand.
  useEffect(() => {
    if (!data[tab]) load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const current = data[tab];
  const [header, rows] = useMemo(() => {
    const values = current?.values || [];
    const head = values[0] || [];
    const width = Math.max(head.length, ...values.slice(1).map((r) => r.length), 0);
    const body = values
      .slice(1)
      .filter((r) => r.some((c) => c !== ''))
      .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
    return [Array.from({ length: width }, (_, i) => head[i] ?? ''), body];
  }, [current]);

  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.some((c) => c.toLowerCase().includes(q))) : rows;

  return (
    <div className="flex flex-col h-full w-full gap-3 p-4 bg-slate-100 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm border transition-colors ${
              t === tab
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows…"
            className="h-8 w-56 bg-white"
          />
          <Button size="sm" onClick={() => load(tab)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="text-xs text-slate-500">
        Read-only · {shown.length}
        {q ? ` of ${rows.length}` : ''} rows
        {current?.fetchedAt ? ` · fetched ${new Date(current.fetchedAt).toLocaleTimeString()}` : ''}
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex-1 overflow-auto rounded border border-slate-200 bg-white">
        {!current && loading ? (
          <div className="p-6 text-sm text-slate-500">Loading “{tab}”…</div>
        ) : (
          <table className="text-sm border-collapse">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                <th className="px-2 py-2 text-right">#</th>
                {header.map((h, i) => (
                  <th key={i} className="px-2 py-2 whitespace-nowrap">
                    {h || '—'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, ri) => (
                <tr key={ri} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-2 py-1 text-right text-slate-400">{ri + 1}</td>
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      title={c.length > 60 ? c : undefined}
                      className={`px-2 py-1 max-w-[280px] truncate ${
                        /^error/i.test(c) ? 'text-red-600' : 'text-slate-800'
                      }`}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

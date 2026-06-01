import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Admin-only usage analytics. Polls PUBLIC_WEBHOOK_LIST_EVENTS_URL every 30s
// for the last N usage events and renders them as a filterable table.
// Read-only — the page never writes anywhere, never blocks user actions.

interface UsageRow {
  ts: string;
  email: string;
  tab: string;
  action: string;
  status: string;
  duration_ms: number | null;
  meta: string;
  error_message: string;
}

const LIST_URL = import.meta.env.PUBLIC_WEBHOOK_LIST_EVENTS_URL as string | undefined;
const POLL_MS = 30_000;

const fmtTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
};

export const DashboardPage = () => {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [emailFilter, setEmailFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const fetchEvents = async () => {
    if (!LIST_URL) {
      setStatus('error');
      setError('PUBLIC_WEBHOOK_LIST_EVENTS_URL is not set in .env');
      return;
    }
    setStatus('loading');
    try {
      const { data } = await axios.post(LIST_URL, { limit: 500 }, { timeout: 30_000 });
      const outer = Array.isArray(data) ? data[0] : data;
      const payload = outer && typeof outer === 'object' && 'json' in outer ? (outer as any).json : outer;
      const list: any[] = Array.isArray(payload?.events) ? payload.events
        : Array.isArray(payload?.rows) ? payload.rows
        : Array.isArray(payload) ? payload
        : [];
      const normalized: UsageRow[] = list.map((r) => ({
        ts: String(r.ts ?? r.created_at ?? ''),
        email: String(r.email ?? ''),
        tab: String(r.tab ?? ''),
        action: String(r.action ?? ''),
        status: String(r.status ?? ''),
        duration_ms: typeof r.duration_ms === 'number' ? r.duration_ms : null,
        meta: typeof r.meta === 'string' ? r.meta : (r.meta ? JSON.stringify(r.meta) : ''),
        error_message: String(r.error_message ?? ''),
      }));
      // newest first
      normalized.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setRows(normalized);
      setStatus('success');
      setError(null);
      setLastFetched(Date.now());
    } catch (e: any) {
      console.error('[Dashboard] fetch error:', e);
      setStatus('error');
      setError(e?.message ?? String(e));
    }
  };

  // initial fetch + 30s poll
  useEffect(() => {
    void fetchEvents();
    const id = setInterval(() => { void fetchEvents(); }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const emailQ = emailFilter.trim().toLowerCase();
    const actionQ = actionFilter.trim().toLowerCase();
    if (!emailQ && !actionQ) return rows;
    return rows.filter((r) =>
      (!emailQ || r.email.toLowerCase().includes(emailQ)) &&
      (!actionQ || r.action.toLowerCase().includes(actionQ)),
    );
  }, [rows, emailFilter, actionFilter]);

  const lastFetchedLabel = lastFetched ? new Date(lastFetched).toLocaleTimeString() : '—';

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4 bg-slate-100 overflow-hidden">
      <div className="bg-white rounded-xl border p-4 shadow-sm flex items-center gap-3 shrink-0">
        <h2 className="font-bold text-xl">Usage Dashboard</h2>
        <span className="text-xs text-slate-500">{filtered.length} of {rows.length} events</span>
        <span className="text-xs text-slate-400 ml-auto">
          Last fetched: <span className="font-mono">{lastFetchedLabel}</span>
        </span>
        <Button variant="outline" size="sm" onClick={() => { void fetchEvents(); }} disabled={status === 'loading'}>
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      <div className="bg-white rounded-xl border p-4 shadow-sm flex items-end gap-3 shrink-0">
        <div className="flex-1">
          <label className="text-xs font-medium uppercase text-slate-500">Filter by email</label>
          <Input value={emailFilter} onChange={(e) => setEmailFilter(e.target.value)} placeholder="contains…" />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium uppercase text-slate-500">Filter by action</label>
          <Input value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder="e.g. generateCreative" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setEmailFilter(''); setActionFilter(''); }}>Clear</Button>
      </div>

      <div className="flex-1 min-h-0 bg-white rounded-xl border shadow-sm overflow-auto">
        {status === 'error' && (
          <div className="p-6 text-red-600 text-sm whitespace-pre-wrap">
            {error ?? 'Unknown error fetching usage events'}
          </div>
        )}
        {status !== 'error' && filtered.length === 0 && (
          <div className="p-6 text-gray-400 italic">
            {status === 'loading' ? 'Loading…' : 'No events match the current filters.'}
          </div>
        )}
        {filtered.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
                <th className="py-2 px-3">When</th>
                <th className="py-2 px-3">Email</th>
                <th className="py-2 px-3">Tab</th>
                <th className="py-2 px-3">Action</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 w-24">Duration</th>
                <th className="py-2 px-3">Meta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-1.5 px-3 font-mono text-xs whitespace-nowrap">{fmtTime(r.ts)}</td>
                  <td className="py-1.5 px-3">{r.email}</td>
                  <td className="py-1.5 px-3 text-slate-600">{r.tab}</td>
                  <td className="py-1.5 px-3 font-semibold">{r.action}</td>
                  <td className="py-1.5 px-3">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      r.status === 'success' ? 'bg-green-100 text-green-700'
                      : r.status === 'error' ? 'bg-red-100 text-red-700'
                      : r.status === 'start' ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-700'
                    }`}>{r.status || '—'}</span>
                  </td>
                  <td className="py-1.5 px-3 font-mono text-xs text-slate-500">{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</td>
                  <td className="py-1.5 px-3 font-mono text-[11px] text-slate-500 max-w-md truncate" title={r.meta}>{r.meta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Admin-only usage analytics. Polls PUBLIC_WEBHOOK_LIST_EVENTS_URL every 30s
// for the last 30 days of usage events and renders them as sub-tabs:
//   - Events            (raw chronological log, with email/action filters)
//   - Top Users         (leaderboard by event count)
//   - Action Popularity (each action ranked by count)
//   - Tab Breakdown     (per-tab event share)
// All aggregations happen client-side from the single fetched payload.

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

type SubTab = 'events' | 'topUsers' | 'actions' | 'tabs';

const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: 'events',   label: 'Events' },
  { value: 'topUsers', label: 'Top Users' },
  { value: 'actions',  label: 'Action Popularity' },
  { value: 'tabs',     label: 'Tab Breakdown' },
];

const LIST_URL = import.meta.env.PUBLIC_WEBHOOK_LIST_EVENTS_URL as string | undefined;
const POLL_MS = 30_000;
const FETCH_LIMIT = 5000;
const RANGE_DAYS = 30;

const fmtTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch { return iso; }
};

const fmtDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  } catch { return iso; }
};

// Compute the ISO string for N days ago (start of that day) — used as the `since`
// filter so the n8n side can clip the response.
const sinceIso = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

// ---------------------------------------------------------------------------
// Sub-tab views — each takes the already-filtered rows.
// ---------------------------------------------------------------------------

const StatusPill = ({ value }: { value: string }) => (
  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
    value === 'success' ? 'bg-green-100 text-green-700'
    : value === 'error' ? 'bg-red-100 text-red-700'
    : value === 'start' ? 'bg-blue-100 text-blue-700'
    : 'bg-slate-100 text-slate-700'
  }`}>{value || '—'}</span>
);

// Inline CSS bar that fills (count / max) of its row. Pure CSS, no library.
const Bar = ({ value, max, tint = 'bg-blue-100' }: { value: number; max: number; tint?: string }) => {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="relative w-full h-4 bg-slate-50 rounded overflow-hidden">
      <div className={`absolute inset-y-0 left-0 ${tint}`} style={{ width: `${pct}%` }} />
      <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-mono text-slate-700">
        {pct}%
      </span>
    </div>
  );
};

const EventsView = ({ rows }: { rows: UsageRow[] }) => {
  if (rows.length === 0) {
    return <div className="p-6 text-gray-400 italic">No events match the current filters.</div>;
  }
  return (
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
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="py-1.5 px-3 font-mono text-xs whitespace-nowrap">{fmtTime(r.ts)}</td>
            <td className="py-1.5 px-3">{r.email}</td>
            <td className="py-1.5 px-3 text-slate-600">{r.tab}</td>
            <td className="py-1.5 px-3 font-semibold">{r.action}</td>
            <td className="py-1.5 px-3"><StatusPill value={r.status} /></td>
            <td className="py-1.5 px-3 font-mono text-xs text-slate-500">{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</td>
            <td className="py-1.5 px-3 font-mono text-[11px] text-slate-500 max-w-md truncate" title={r.meta}>{r.meta}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

interface UserSummary {
  email: string;
  count: number;
  favoriteAction: string;
  favoriteCount: number;
  lastSeen: string;
}

const TopUsersView = ({ rows }: { rows: UsageRow[] }) => {
  const data = useMemo<UserSummary[]>(() => {
    const byEmail = new Map<string, { count: number; actions: Map<string, number>; lastSeen: string }>();
    for (const r of rows) {
      const email = r.email || 'unknown';
      let agg = byEmail.get(email);
      if (!agg) { agg = { count: 0, actions: new Map(), lastSeen: r.ts }; byEmail.set(email, agg); }
      agg.count++;
      agg.actions.set(r.action, (agg.actions.get(r.action) ?? 0) + 1);
      if (r.ts > agg.lastSeen) agg.lastSeen = r.ts;
    }
    return Array.from(byEmail.entries()).map(([email, a]) => {
      let favAction = ''; let favCount = 0;
      for (const [act, cnt] of a.actions.entries()) if (cnt > favCount) { favAction = act; favCount = cnt; }
      return { email, count: a.count, favoriteAction: favAction, favoriteCount: favCount, lastSeen: a.lastSeen };
    }).sort((a, b) => b.count - a.count);
  }, [rows]);

  if (data.length === 0) return <div className="p-6 text-gray-400 italic">No events in range.</div>;
  const max = data[0].count;

  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 bg-slate-100 z-10">
        <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
          <th className="py-2 px-3 w-10">#</th>
          <th className="py-2 px-3">Email</th>
          <th className="py-2 px-3 w-24">Events</th>
          <th className="py-2 px-3">Favorite action</th>
          <th className="py-2 px-3 w-40">Last seen</th>
          <th className="py-2 px-3 w-48">Activity vs top</th>
        </tr>
      </thead>
      <tbody>
        {data.map((u, i) => (
          <tr key={u.email} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="py-1.5 px-3 text-slate-500 font-mono text-xs">{i + 1}</td>
            <td className="py-1.5 px-3 font-semibold">{u.email}</td>
            <td className="py-1.5 px-3 font-mono">{u.count}</td>
            <td className="py-1.5 px-3 text-slate-700">{u.favoriteAction} <span className="text-slate-400 text-xs">({u.favoriteCount})</span></td>
            <td className="py-1.5 px-3 font-mono text-xs text-slate-500">{fmtTime(u.lastSeen)}</td>
            <td className="py-1.5 px-3"><Bar value={u.count} max={max} tint="bg-blue-200" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const CountView = ({
  rows, keyFn, label, tint,
}: {
  rows: UsageRow[];
  keyFn: (r: UsageRow) => string;
  label: string;
  tint: string;
}) => {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = keyFn(r) || '—';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const total = rows.length || 1;
    return Array.from(counts.entries())
      .map(([k, c]) => ({ key: k, count: c, pct: Math.round((c / total) * 1000) / 10 }))
      .sort((a, b) => b.count - a.count);
  }, [rows, keyFn]);

  if (data.length === 0) return <div className="p-6 text-gray-400 italic">No events in range.</div>;
  const max = data[0].count;

  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 bg-slate-100 z-10">
        <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
          <th className="py-2 px-3 w-10">#</th>
          <th className="py-2 px-3">{label}</th>
          <th className="py-2 px-3 w-24">Events</th>
          <th className="py-2 px-3 w-20">Share</th>
          <th className="py-2 px-3 w-64">Distribution</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={d.key} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="py-1.5 px-3 text-slate-500 font-mono text-xs">{i + 1}</td>
            <td className="py-1.5 px-3 font-semibold">{d.key}</td>
            <td className="py-1.5 px-3 font-mono">{d.count}</td>
            <td className="py-1.5 px-3 font-mono text-slate-600 text-xs">{d.pct}%</td>
            <td className="py-1.5 px-3"><Bar value={d.count} max={max} tint={tint} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// ---------------------------------------------------------------------------
// Top-level page.
// ---------------------------------------------------------------------------

export const DashboardPage = () => {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [emailFilter, setEmailFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [activeTab, setActiveTab] = useState<SubTab>('events');

  const fetchEvents = async () => {
    if (!LIST_URL) {
      setStatus('error');
      setError('PUBLIC_WEBHOOK_LIST_EVENTS_URL is not set in .env');
      return;
    }
    setStatus('loading');
    try {
      const { data } = await axios.post(
        LIST_URL,
        { limit: FETCH_LIMIT, since: sinceIso(RANGE_DAYS) },
        { timeout: 30_000 },
      );
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

  useEffect(() => {
    void fetchEvents();
    const id = setInterval(() => { void fetchEvents(); }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Email/action filters narrow the rows for every sub-tab (raw or aggregated).
  const filtered = useMemo(() => {
    const emailQ = emailFilter.trim().toLowerCase();
    const actionQ = actionFilter.trim().toLowerCase();
    if (!emailQ && !actionQ) return rows;
    return rows.filter((r) =>
      (!emailQ  || r.email.toLowerCase().includes(emailQ)) &&
      (!actionQ || r.action.toLowerCase().includes(actionQ)),
    );
  }, [rows, emailFilter, actionFilter]);

  const sinceLabel = useMemo(() => fmtDate(sinceIso(RANGE_DAYS)), []);
  const lastFetchedLabel = lastFetched ? new Date(lastFetched).toLocaleTimeString() : '—';

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* Header */}
      <div className="bg-white rounded-xl border p-4 shadow-sm flex items-center gap-3 shrink-0">
        <h2 className="font-bold text-xl">Usage Dashboard</h2>
        <span className="text-xs text-slate-500">{filtered.length} of {rows.length} events</span>
        <span className="text-xs text-slate-400">range: {sinceLabel} → now</span>
        <span className="text-xs text-slate-400 ml-auto">
          Last fetched: <span className="font-mono">{lastFetchedLabel}</span>
        </span>
        <Button variant="outline" size="sm" onClick={() => { void fetchEvents(); }} disabled={status === 'loading'}>
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {/* Sub-tab nav */}
      <div className="bg-white rounded-xl border p-2 shadow-sm flex items-center gap-1 shrink-0">
        {SUB_TABS.map((t) => {
          const isActive = t.value === activeTab;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setActiveTab(t.value)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filters (narrow all views) */}
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

      {/* Content */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border shadow-sm overflow-auto">
        {status === 'error' && (
          <div className="p-6 text-red-600 text-sm whitespace-pre-wrap">{error ?? 'Unknown error fetching usage events'}</div>
        )}
        {status !== 'error' && rows.length === 0 && status !== 'loading' && (
          <div className="p-6 text-gray-400 italic">No events in the last {RANGE_DAYS} days yet.</div>
        )}
        {status !== 'error' && (rows.length > 0 || status === 'loading') && (
          <>
            {activeTab === 'events'   && <EventsView    rows={filtered} />}
            {activeTab === 'topUsers' && <TopUsersView  rows={filtered} />}
            {activeTab === 'actions'  && <CountView     rows={filtered} keyFn={(r) => r.action} label="Action" tint="bg-purple-200" />}
            {activeTab === 'tabs'     && <CountView     rows={filtered} keyFn={(r) => r.tab}    label="Tab"    tint="bg-emerald-200" />}
          </>
        )}
      </div>
    </div>
  );
};

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
//   - Graph             (per-day activity, segmented by user)
// All aggregations happen client-side from the single fetched payload.

interface UsageRow {
  ts: string;
  email: string;
  tab: string;
  action: string;
  meta: string;
  meta_out: string;
  error_message: string;
  execution_id: string;
}

type SubTab = 'events' | 'topUsers' | 'actions' | 'tabs' | 'graph';

const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: 'events',   label: 'Events' },
  { value: 'topUsers', label: 'Top Users' },
  { value: 'actions',  label: 'Action Popularity' },
  { value: 'tabs',     label: 'Tab Breakdown' },
  { value: 'graph',    label: 'Graph' },
];

const LIST_URL = import.meta.env.PUBLIC_WEBHOOK_LIST_EVENTS_URL as string | undefined;
const POLL_MS = 30_000;
const FETCH_LIMIT = 5000;
const DEFAULT_RANGE_DAYS = 30;

const fmtTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch { return iso; }
};

// Convert a YYYY-MM-DD input value (what <input type="date"> gives us) into an
// ISO string anchored at the start of that day in the user's local timezone.
const dateInputToIso = (yyyyMmDd: string): string => {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return new Date(0).toISOString();
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
};

// Format a Date as YYYY-MM-DD (what <input type="date"> expects).
const toDateInput = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Today minus N days, as a YYYY-MM-DD string.
const daysAgoInput = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toDateInput(d);
};

const todayInput = (): string => toDateInput(new Date());

// Preset ranges available in the picker dropdown. Each preset knows how to
// compute its own "from" date (as YYYY-MM-DD). "Custom" has no computed value;
// it just keeps whatever the user typed into the date input.
type PresetKey = 'today' | 'last7' | 'last30' | 'thisMonth' | 'custom';

const PRESETS: { value: PresetKey; label: string; compute: (() => string) | null }[] = [
  { value: 'today',     label: 'Today',         compute: () => todayInput() },
  { value: 'last7',     label: 'Last 7 days',   compute: () => daysAgoInput(7) },
  { value: 'last30',    label: 'Last 30 days',  compute: () => daysAgoInput(30) },
  { value: 'thisMonth', label: 'This month',    compute: () => {
      const d = new Date(); d.setDate(1); return toDateInput(d);
    } },
  { value: 'custom',    label: 'Custom',        compute: null },
];

// Look at the current `fromDate` and tell which preset it corresponds to.
// Anything that doesn't match a preset exactly falls through to "custom".
const detectPreset = (fromDate: string): PresetKey => {
  for (const p of PRESETS) {
    if (p.compute && p.compute() === fromDate) return p.value;
  }
  return 'custom';
};

// ---------------------------------------------------------------------------
// Sub-tab views — each takes the already-filtered rows.
// ---------------------------------------------------------------------------

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
          <th className="py-2 px-3 w-24">Exec</th>
          <th className="py-2 px-3">Meta</th>
          <th className="py-2 px-3">Meta out</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="py-1.5 px-3 font-mono text-xs whitespace-nowrap">{fmtTime(r.ts)}</td>
            <td className="py-1.5 px-3">{r.email}</td>
            <td className="py-1.5 px-3 text-slate-600">{r.tab}</td>
            <td className="py-1.5 px-3 font-semibold">{r.action}</td>
            <td className="py-1.5 px-3 font-mono text-[11px] text-slate-500" title={r.execution_id}>{r.execution_id || '—'}</td>
            <td className="py-1.5 px-3 font-mono text-[11px] text-slate-500 max-w-md truncate" title={r.meta}>{r.meta}</td>
            <td className="py-1.5 px-3 font-mono text-[11px] text-slate-500 max-w-md truncate" title={r.meta_out}>{r.meta_out}</td>
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

// Graph view — daily activity, segmented per action (event type). Two
// interactive filters narrow the data on top of the page-level filters:
//   - Tab pills: multi-select. Empty = all tabs.
//   - Clickable legend: multi-select. Empty = all events.
// Each day shows one horizontal bar whose length is proportional to the day's
// max in the (filtered) range, split into colored segments per action with
// rare actions folded into a grey "others" segment.
// Curated 8-hue palette — 500-shade Tailwind colors picked for maximum
// distinguishability when stacked as small segments. Hues are spaced around the
// wheel: indigo / sky for cool blues, emerald / teal for greens, amber / orange
// for warm yellows, rose / pink for warm reds — avoiding any two that read as
// the same color at glance.
const ACTION_PALETTE = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-violet-500', 'bg-sky-500',     'bg-orange-500', 'bg-pink-500',
];
const TOP_ACTIONS_IN_GRAPH = ACTION_PALETTE.length;
const TAB_OPTIONS = ['creatives', 'keywords', 'angles', 'article'] as const;

const GraphView = ({ rows }: { rows: UsageRow[] }) => {
  const [selectedTabs, setSelectedTabs] = useState<Set<string>>(new Set());
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());

  const toggleTab = (tab: string) => {
    setSelectedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tab)) next.delete(tab); else next.add(tab);
      return next;
    });
  };
  const toggleAction = (action: string) => {
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(action)) next.delete(action); else next.add(action);
      return next;
    });
  };

  // Tab filter narrows the input set first; legend & aggregations all flow from this.
  const tabFiltered = useMemo(
    () => (selectedTabs.size === 0 ? rows : rows.filter((r) => selectedTabs.has(r.tab))),
    [rows, selectedTabs],
  );

  // Legend reflects whatever survived the tab filter — selecting an action that no
  // longer exists in the data is a non-issue because the legend won't list it.
  const topActions = useMemo<string[]>(() => {
    const counts = new Map<string, number>();
    for (const r of tabFiltered) {
      const action = r.action || 'unknown';
      counts.set(action, (counts.get(action) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_ACTIONS_IN_GRAPH)
      .map(([a]) => a);
  }, [tabFiltered]);

  // Action filter applied after the legend is computed, so the legend keeps showing
  // the full palette of available events while the chart focuses on the picked ones.
  const actionFiltered = useMemo(
    () => (selectedActions.size === 0 ? tabFiltered : tabFiltered.filter((r) => selectedActions.has(r.action || 'unknown'))),
    [tabFiltered, selectedActions],
  );

  const dailyData = useMemo(() => {
    const byDay = new Map<string, { total: number; byAction: Map<string, number> }>();
    for (const r of actionFiltered) {
      const day = (r.ts || '').slice(0, 10);
      if (!day) continue;
      const action = r.action || 'unknown';
      let agg = byDay.get(day);
      if (!agg) { agg = { total: 0, byAction: new Map() }; byDay.set(day, agg); }
      agg.total++;
      agg.byAction.set(action, (agg.byAction.get(action) ?? 0) + 1);
    }
    return Array.from(byDay.entries())
      .map(([day, a]) => ({ day, total: a.total, byAction: a.byAction }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [actionFiltered]);

  const maxTotal = dailyData.reduce((m, d) => Math.max(m, d.total), 0) || 1;
  const colorFor = (action: string): string => {
    const idx = topActions.indexOf(action);
    return idx === -1 ? 'bg-slate-300' : ACTION_PALETTE[idx];
  };

  const hasFilter = selectedTabs.size > 0 || selectedActions.size > 0;
  const tabsAllActive = selectedTabs.size === 0;
  const actionsAllActive = selectedActions.size === 0;

  return (
    <div className="p-4 space-y-3">
      {/* Tab filter (multi-select pills) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 uppercase font-bold text-[10px] mr-1 w-12">Tab</span>
        <button
          type="button"
          onClick={() => setSelectedTabs(new Set())}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            tabsAllActive
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          All
        </button>
        {TAB_OPTIONS.map((t) => {
          const active = selectedTabs.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleTab(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Event filter (clickable legend). When nothing is selected, every item is
          at full strength; once something is picked, the unpicked ones dim. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 uppercase font-bold text-[10px] mr-1 w-12">Events</span>
        <button
          type="button"
          onClick={() => setSelectedActions(new Set())}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            actionsAllActive
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          All
        </button>
        {topActions.map((a) => {
          const isSelected = selectedActions.has(a);
          const active = actionsAllActive || isSelected;
          return (
            <button
              key={a}
              type="button"
              onClick={() => toggleAction(a)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-all ${
                isSelected
                  ? 'border-slate-900 bg-white shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-400'
              } ${active ? 'opacity-100' : 'opacity-40'}`}
            >
              <span className={`inline-block w-3 h-3 rounded ${colorFor(a)}`} />
              <span className="font-mono text-slate-700">{a}</span>
            </button>
          );
        })}
        <span className="flex items-center gap-1.5 px-2.5 py-1 opacity-60">
          <span className="inline-block w-3 h-3 rounded bg-slate-300" />
          <span className="text-slate-500">others</span>
        </span>
      </div>

      {dailyData.length === 0 ? (
        <div className="p-6 text-gray-400 italic">
          {hasFilter ? 'No events match the selected filters.' : 'No events in range.'}
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr className="text-left text-[10px] font-bold uppercase text-gray-500 border-b border-slate-200">
              <th className="py-2 px-3 w-28">Day</th>
              <th className="py-2 px-3 w-16">Total</th>
              <th className="py-2 px-3">By event</th>
            </tr>
          </thead>
          <tbody>
            {dailyData.map((d) => {
              const knownSegments = topActions
                .map((a) => ({ action: a, count: d.byAction.get(a) ?? 0, color: colorFor(a) }))
                .filter((s) => s.count > 0);
              const othersCount = d.total - knownSegments.reduce((s, x) => s + x.count, 0);
              const segments = othersCount > 0
                ? [...knownSegments, { action: 'others', count: othersCount, color: 'bg-slate-300' }]
                : knownSegments;
              const widthPct = (d.total / maxTotal) * 100;
              return (
                <tr key={d.day} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-1.5 px-3 font-mono text-xs whitespace-nowrap">{d.day}</td>
                  <td className="py-1.5 px-3 font-mono">{d.total}</td>
                  <td className="py-1.5 px-3">
                    <div className="relative h-4 bg-slate-50 rounded overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 flex"
                        style={{ width: `${widthPct}%`, minWidth: '4px' }}
                      >
                        {segments.map((s, i) => (
                          <div
                            key={`${s.action}-${i}`}
                            className={s.color}
                            style={{ flex: s.count }}
                            title={`${s.action}: ${s.count}`}
                          />
                        ))}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
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
  // User-controlled lower bound for the date range. Defaults to 30 days ago;
  // the upper bound is always "now". Re-fetches when this changes.
  const [fromDate, setFromDate] = useState<string>(() => daysAgoInput(DEFAULT_RANGE_DAYS));

  const fetchEvents = async (sinceOverride?: string) => {
    if (!LIST_URL) {
      setStatus('error');
      setError('PUBLIC_WEBHOOK_LIST_EVENTS_URL is not set in .env');
      return;
    }
    setStatus('loading');
    try {
      const since = sinceOverride ?? dateInputToIso(fromDate);
      const { data } = await axios.post(
        LIST_URL,
        { limit: FETCH_LIMIT, since },
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
        meta: typeof r.meta === 'string' ? r.meta : (r.meta ? JSON.stringify(r.meta) : ''),
        meta_out: typeof r.meta_out === 'string' ? r.meta_out : (r.meta_out ? JSON.stringify(r.meta_out) : ''),
        error_message: String(r.error_message ?? ''),
        execution_id: String(r.execution_id ?? ''),
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

  // Re-fetch (and restart the 30s poll) whenever the lower-bound date changes.
  useEffect(() => {
    void fetchEvents();
    const id = setInterval(() => { void fetchEvents(); }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate]);

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

  const lastFetchedLabel = lastFetched ? new Date(lastFetched).toLocaleTimeString() : '—';
  const todayMax = todayInput();

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* Header */}
      <div className="bg-white rounded-xl border p-4 shadow-sm flex items-center gap-3 shrink-0 flex-wrap">
        <h2 className="font-bold text-xl">Usage Dashboard</h2>
        <span className="text-xs text-slate-500">{filtered.length} of {rows.length} events</span>

        {/* Range presets + custom from-date picker. Picking a preset updates the date;
            editing the date manually flips the preset to "Custom" automatically. */}
        <div className="flex items-center gap-2 ml-2">
          <label className="text-[10px] font-bold uppercase text-slate-500" htmlFor="dash-range">Range</label>
          <select
            id="dash-range"
            value={detectPreset(fromDate)}
            onChange={(e) => {
              const p = PRESETS.find((x) => x.value === e.target.value);
              if (p?.compute) setFromDate(p.compute());
              // "Custom" doesn't change fromDate — just keeps whatever's in the input.
            }}
            className="text-sm border rounded-md px-2 py-1 bg-white"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          <label className="text-[10px] font-bold uppercase text-slate-500 ml-1" htmlFor="dash-from">From</label>
          <input
            id="dash-from"
            type="date"
            value={fromDate}
            max={todayMax}
            onChange={(e) => setFromDate(e.target.value || daysAgoInput(DEFAULT_RANGE_DAYS))}
            className="text-sm border rounded-md px-2 py-1 bg-white"
          />
          <span className="text-xs text-slate-400">→ now</span>
        </div>

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
          <div className="p-6 text-gray-400 italic">No events in the selected range.</div>
        )}
        {status !== 'error' && (rows.length > 0 || status === 'loading') && (
          <>
            {activeTab === 'events'   && <EventsView    rows={filtered} />}
            {activeTab === 'topUsers' && <TopUsersView  rows={filtered} />}
            {activeTab === 'actions'  && <CountView     rows={filtered} keyFn={(r) => r.action} label="Action" tint="bg-purple-200" />}
            {activeTab === 'tabs'     && <CountView     rows={filtered} keyFn={(r) => r.tab}    label="Tab"    tint="bg-emerald-200" />}
            {activeTab === 'graph'    && <GraphView     rows={filtered} />}
          </>
        )}
      </div>
    </div>
  );
};

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getIsAdmin } from '@/lib/roles';
import { PG_WEBHOOK, post, callBuilder, fetchCompetitors, ErrorBox, type Competitor } from './MegatoolAutozalivBuilderPage';

// Parse Adheart (megatool-adheart-parse) — was a panel in Autozaliv Builder step 1. Parses the picked
// competitors in the background; results land in Postgres (or the sheet without PG_WEBHOOK) and the
// competitor's adheart_parsed status.
const ADHEART_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_ADHEART_PARSE_URL as string | undefined;
const callAdheart = (body: object) => post(ADHEART_WEBHOOK, 'PUBLIC_WEBHOOK_ADHEART_PARSE_URL', body, 60_000);

const START_OPTIONS = ['1 day ago', '3 days ago', '7 days ago', '14 days ago', '1 month ago', '3 months ago'];
type Opts = { start: string; date: string; minReach: string; geo: string; maxPages: string };

// "7 days ago" / "1 month ago" / a picked date → YYYY-MM-DD.
function startDateOf(o: Opts): string {
  if (o.start === 'date') return o.date;
  const [n, unit] = o.start.split(' ');
  const d = new Date();
  if (unit.startsWith('month')) d.setMonth(d.getMonth() - Number(n));
  else d.setDate(d.getDate() - Number(n));
  return d.toISOString().slice(0, 10);
}

// The adheart.me ads page for one filter line, with the same params the parser sends to its API
// (ads_archive/adheart_fetch.py), so the site shows what the parse would get.
function adheartUrl(term: string, o: Opts): string {
  const p = new URLSearchParams({ search_version: 'v3', ad_status: 'active', 'link_search.value': term });
  const start = startDateOf(o);
  if (start) p.set('placement_date.startDate', start);
  if (Number(o.minReach)) p.set('total_reach.from', o.minReach);
  for (const g of o.geo.split(/[\s,]+/).filter(Boolean)) p.append('ad_geo.select[].value', g);
  return `https://adheart.me/en/ads?${p}`;
}

// Schedule (megatool-adheart-schedule): which days and hour each competitor is parsed. Scheduled parses go to Postgres only.
const SCHEDULE_WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_ADHEART_SCHEDULE_URL as string | undefined;
const callSchedule = async (body: object) =>
  post(SCHEDULE_WEBHOOK, 'PUBLIC_WEBHOOK_ADHEART_SCHEDULE_URL', { ...body, is_admin: await getIsAdmin() }, 30_000);
const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']] as const;
type ScheduleRow = {
  competitor: string; days: number[]; hour: number; startDate: string; minReach: string; maxPages: string;
  lastRun: string; status: string; dirty?: boolean; saving?: boolean;
};

function AdheartSchedule() {
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [error, setError] = useState<string>();
  const load = async () => {
    try {
      setError(undefined);
      const res = await callSchedule({ action: 'list' });
      setRows(res.rows.map((r: any[]) => ({
        competitor: r[0], days: r[1], hour: r[2], startDate: r[3], minReach: String(r[4]), maxPages: String(r[5]), lastRun: r[6] || '', status: r[7] || '',
      })));
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const edit = (name: string, patch: Partial<ScheduleRow>) =>
    setRows((rs) => rs.map((r) => (r.competitor === name ? { ...r, ...patch, dirty: true } : r)));
  const save = async (r: ScheduleRow) => {
    setRows((rs) => rs.map((x) => (x.competitor === r.competitor ? { ...x, saving: true } : x)));
    try {
      setError(undefined);
      const res = await callSchedule({
        action: 'save', competitor: r.competitor, days: r.days, hour: r.hour, startDate: r.startDate,
        minReach: Number(r.minReach) || 0, maxPages: Number(r.maxPages) || 150,
      });
      if (!res.rows.some((x: string[]) => x[0] === 'saved')) throw new Error(`"${r.competitor}" was not found`);
      setRows((rs) => rs.map((x) => (x.competitor === r.competitor ? { ...x, saving: false, dirty: false } : x)));
    } catch (e: any) {
      setError(`Save ${r.competitor}: ${e.message}`);
      setRows((rs) => rs.map((x) => (x.competitor === r.competitor ? { ...x, saving: false } : x)));
    }
  };

  return (
    <details className="shrink-0 rounded border border-slate-200">
      <summary className="cursor-pointer px-2 py-1.5 font-semibold text-slate-800">
        Schedule <span className="font-normal text-slate-500">— {rows.filter((r) => r.days.length).length} scheduled. Runs at the set hour, Kyiv time, on the picked days. Postgres only, no sheet tab.</span>
      </summary>
      <div className="max-h-64 overflow-auto border-t border-slate-200">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-slate-100 text-left text-[10px] font-bold uppercase text-gray-500">
            <tr>
              <th className="px-2 py-1">competitor</th>
              <th className="px-2 py-1">days</th>
              <th className="px-2 py-1">hour</th>
              <th className="px-2 py-1">ads placed since</th>
              <th className="px-2 py-1">min reach</th>
              <th className="px-2 py-1">max pages</th>
              <th className="px-2 py-1">last start</th>
              <th className="w-16 px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.competitor} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-800">{r.competitor}</td>
                <td className="whitespace-nowrap px-2 py-1">
                  {WEEK.map(([d, label]) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => edit(r.competitor, { days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] })}
                      className={`mr-0.5 rounded border px-1.5 py-0.5 ${r.days.includes(d) ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                    >
                      {label}
                    </button>
                  ))}
                  <button type="button" className="ml-1 text-blue-600 hover:underline" onClick={() => edit(r.competitor, { days: r.days.length === 7 ? [] : WEEK.map(([d]) => d) })}>
                    {r.days.length === 7 ? 'none' : 'all'}
                  </button>
                </td>
                <td className="px-2 py-1">
                  <select value={r.hour} onChange={(e) => edit(r.competitor, { hour: Number(e.target.value) })} className="h-7 rounded border border-slate-200 bg-white px-1">
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <select value={r.startDate} onChange={(e) => edit(r.competitor, { startDate: e.target.value })} className="h-7 rounded border border-slate-200 bg-white px-1">
                    {START_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1"><Input type="number" min={0} value={r.minReach} onChange={(e) => edit(r.competitor, { minReach: e.target.value })} className="h-7 w-20 bg-white" /></td>
                <td className="px-2 py-1"><Input type="number" min={1} max={1000} value={r.maxPages} onChange={(e) => edit(r.competitor, { maxPages: e.target.value })} className="h-7 w-20 bg-white" /></td>
                <td className="whitespace-nowrap px-2 py-1" title={r.status}>{r.lastRun || '—'}</td>
                <td className="px-2 py-1">
                  {r.dirty && <Button size="sm" className="h-7" disabled={r.saving} onClick={() => save(r)}>{r.saving ? '…' : 'Save'}</Button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-2 py-2 text-slate-400">{error ? 'Schedule could not be loaded.' : 'Loading…'}</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <div className="border-t border-red-200 bg-red-50 px-2 py-1.5 text-red-700">{error}</div>}
    </details>
  );
}

export function MegatoolParseAdheartPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const loadCompetitors = async () => {
    try {
      setCompetitors(await fetchCompetitors());
    } catch {
      // the table shows "No competitors loaded"
    }
  };
  useEffect(() => {
    loadCompetitors();
  }, []);
  const [adheartRun, setAdheartRun] = useState<{ busy?: boolean; msg?: string; error?: string }>({});
  // Same knobs as adheart_* in ads_archive/main.py. Empty min reach = any; empty geo = any.
  const [adheartOpts, setAdheartOpts] = useState<Opts>({ start: '7 days ago', date: '', minReach: '20', geo: '', maxPages: '150' });
  // Competitors picked in the panel, and filters edited there (this run only; unset = the sheet's
  // adheart_search, or the domains joined with " | " — the same fallback the workflow applies).
  const [adheartPicked, setAdheartPicked] = useState<Set<string>>(new Set());
  const [adheartSearchEdits, setAdheartSearchEdits] = useState<Record<string, string>>({});
  const adheartSearchFor = (c: Competitor) => adheartSearchEdits[c.name] ?? (c.adheartSearch || c.domains.join(' | '));
  // Postgres only: a new competitor (name + domains), then picked for parsing.
  const [newComp, setNewComp] = useState<{ name: string; domains: string; busy?: boolean; error?: string }>({ name: '', domains: '' });
  const addCompetitor = async () => {
    setNewComp((s) => ({ ...s, busy: true, error: undefined }));
    try {
      const res = await callBuilder({ action: 'add-competitor', name: newComp.name, domains: newComp.domains });
      const added = res.rows.find((r) => r[0] === 'added');
      if (!added) {
        const clashes = res.rows.filter((r) => r[0] === 'clash').map((r) => r[1]);
        throw new Error(clashes.length ? `Already taken — ${clashes.join('; ')}` : 'Not added: this name already exists');
      }
      await loadCompetitors();
      setAdheartPicked((s) => new Set(s).add(added[1]));
      setNewComp({ name: '', domains: '' });
    } catch (e: any) {
      setNewComp((s) => ({ ...s, busy: false, error: e.message }));
    }
  };
  // Postgres only: removes a competitor. Its parsed ads stay in Postgres; its articles leave the Builder list at the next
  // 5-minute refresh. Adding it again with the same domains brings them back.
  const [deleting, setDeleting] = useState<{ name?: string; error?: string }>({});
  const deleteCompetitor = async (name: string) => {
    if (!window.confirm(`Delete competitor "${name}"?\n\nIts articles disappear from the list within ~5 minutes. Parsed ads stay in Postgres — adding it again with the same domains brings them back.`)) return;
    setDeleting({ name });
    try {
      const res = await callBuilder({ action: 'delete-competitor', name });
      if (!res.rows.some((r) => r[0] === 'deleted')) throw new Error(`"${name}" was not found`);
      setAdheartPicked((s) => {
        const n = new Set(s);
        n.delete(name);
        return n;
      });
      await loadCompetitors();
      setDeleting({});
    } catch (e: any) {
      setDeleting({ error: `Delete ${name}: ${e.message}` });
    }
  };
  // Postgres only: an admin-only competitor (and its articles / ads) is hidden from non-admins in the Builder.
  const [visibilityError, setVisibilityError] = useState<string>();
  const setAdminOnly = async (name: string, adminOnly: boolean) => {
    setVisibilityError(undefined);
    setCompetitors((cs) => cs.map((c) => (c.name === name ? { ...c, adminOnly } : c)));
    try {
      const res = await callBuilder({ action: 'set-competitor-admin-only', name, adminOnly });
      if (!res.rows.some((r) => r[0] === 'updated')) throw new Error(`"${name}" was not found`);
    } catch (e: any) {
      setVisibilityError(`Admins only ${name}: ${e.message}`);
      await loadCompetitors();
    }
  };
  const parseAdheart = async () => {
    const o = adheartOpts;
    setAdheartRun({ busy: true });
    try {
      const res = await callAdheart({
        action: 'competitors',
        // domains let the workflow parse a competitor added here that isn't in the sheet's Competitors tab
        competitors: competitors.filter((c) => adheartPicked.has(c.name)).map((c) => ({ name: c.name, search: adheartSearchFor(c), domains: c.domains })),
        startDate: o.start === 'date' ? o.date : o.start,
        minReach: Number(o.minReach) || 0,
        geo: o.geo,
        maxPages: Number(o.maxPages) || 150,
      });
      const names = (res.jobs || []).map((j: { name: string }) => j.name).join(', ');
      const skipped = (res.skipped || []).length ? ` Skipped: ${res.skipped.join('; ')}.` : '';
      setAdheartPicked(new Set());
      setAdheartRun({
        msg: PG_WEBHOOK
          ? `Adheart parse started: ${names}. Press ↻ Status in a few minutes to see each result; when it's done, Refresh the Autozaliv Builder article list to see the new ads.${skipped}`
          : `Adheart parse started: ${names}. Press ↻ Status in a few minutes to see each result; a finished one is ticked for "Import checked competitors" (Adheart) in the sheet.${skipped}`,
      });
    } catch (e: any) {
      setAdheartRun({ error: e.message });
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 overflow-hidden">
      <div className="m-4 mb-2 flex min-h-0 flex-1 flex-col gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        {/* Competitors (Competitors tab / autozaliv.competitors): pick, check / edit filters, see the last result. */}
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-semibold text-slate-800">Parse Adheart</span>
          <span>— pick competitors. Filters: one per line, "|" = or, a space inside = and. ↗ opens the filter on adheart.me with the settings below.</span>
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={loadCompetitors}>↻ Status</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-slate-100 text-left text-[10px] font-bold uppercase text-gray-500">
              <tr>
                <th className="w-8 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={competitors.length > 0 && adheartPicked.size === competitors.length}
                    onChange={(e) => setAdheartPicked(e.target.checked ? new Set(competitors.map((c) => c.name)) : new Set())}
                  />
                </th>
                <th className="px-2 py-1">competitor</th>
                <th className="px-2 py-1">filters</th>
                <th className="px-2 py-1">adheart</th>
                <th className="px-2 py-1">last result</th>
                {PG_WEBHOOK && <th className="whitespace-nowrap px-2 py-1" title="Only admins see this competitor and its articles in the Autozaliv Builder">admins only</th>}
                {PG_WEBHOOK && <th className="w-8 px-2 py-1" />}
              </tr>
            </thead>
            <tbody>
              {competitors.map((c) => {
                const terms = adheartSearchFor(c).split('\n').map((t) => t.trim()).filter(Boolean);
                return (
                  <tr key={c.name} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={adheartPicked.has(c.name)}
                        onChange={(e) =>
                          setAdheartPicked((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(c.name);
                            else n.delete(c.name);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-800">{c.name}</td>
                    <td className="w-1/2 px-2 py-1">
                      <textarea
                        value={adheartSearchFor(c)}
                        onChange={(e) => setAdheartSearchEdits((s) => ({ ...s, [c.name]: e.target.value }))}
                        rows={Math.max(1, terms.length)}
                        className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 font-mono text-[11px]"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {terms.map((t, i) => (
                        <a
                          key={i}
                          href={adheartUrl(t, adheartOpts)}
                          target="_blank"
                          rel="noreferrer"
                          title={t}
                          className="mr-2 text-blue-600 hover:underline"
                        >
                          ↗ {terms.length > 1 ? `line ${i + 1}` : 'open'}
                        </a>
                      ))}
                    </td>
                    <td className="px-2 py-1 text-[11px]">{c.adheartParsed || '—'}</td>
                    {PG_WEBHOOK && (
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          title={c.adminOnly ? 'Hidden from non-admins' : 'Visible to everyone'}
                          checked={c.adminOnly}
                          onChange={(e) => setAdminOnly(c.name, e.target.checked)}
                        />
                      </td>
                    )}
                    {PG_WEBHOOK && (
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          title={`Delete ${c.name}`}
                          disabled={!!deleting.name}
                          onClick={() => deleteCompetitor(c.name)}
                          className="rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          {deleting.name === c.name ? '…' : '🗑'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {competitors.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-2 text-slate-400">No competitors loaded — press ↻ Status.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {PG_WEBHOOK && <AdheartSchedule />}
        {PG_WEBHOOK && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">Add competitor</span>
            <Input
              value={newComp.name}
              onChange={(e) => setNewComp((s) => ({ ...s, name: e.target.value }))}
              placeholder="Name"
              className="h-8 w-40 bg-white"
            />
            <Input
              value={newComp.domains}
              onChange={(e) => setNewComp((s) => ({ ...s, domains: e.target.value }))}
              placeholder="Domains, comma-separated: site.com, other.com"
              className="h-8 min-w-[18rem] flex-1 bg-white"
            />
            <Button size="sm" variant="outline" className="h-8" onClick={addCompetitor} disabled={newComp.busy || !newComp.name.trim() || !newComp.domains.trim()}>
              {newComp.busy ? 'Adding…' : '+ Add'}
            </Button>
            {newComp.error && <span className="text-red-600">{newComp.error}</span>}
            {deleting.error && <span className="text-red-600">{deleting.error}</span>}
            {visibilityError && <span className="text-red-600">{visibilityError}</span>}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            Ads placed since
            <div className="flex gap-1">
              <select value={adheartOpts.start} onChange={(e) => setAdheartOpts((o) => ({ ...o, start: e.target.value }))} className="h-8 rounded border border-slate-200 bg-white px-2 text-sm">
                {START_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="date">Pick a date…</option>
              </select>
              {adheartOpts.start === 'date' && (
                <Input type="date" value={adheartOpts.date} onChange={(e) => setAdheartOpts((o) => ({ ...o, date: e.target.value }))} className="h-8 w-36 bg-white" />
              )}
            </div>
          </label>
          <label className="flex flex-col gap-1" title="Only ads that reached at least this many people. Empty = any.">
            Min reach
            <Input type="number" min={0} value={adheartOpts.minReach} onChange={(e) => setAdheartOpts((o) => ({ ...o, minReach: e.target.value }))} placeholder="any" className="h-8 w-24 bg-white" />
          </label>
          <label className="flex flex-col gap-1" title="Country codes, comma-separated (US, GB = either). Empty = any.">
            Geo
            <Input value={adheartOpts.geo} onChange={(e) => setAdheartOpts((o) => ({ ...o, geo: e.target.value.toUpperCase() }))} placeholder="any, e.g. US, GB" className="h-8 w-32 bg-white" />
          </label>
          <label className="flex flex-col gap-1" title="40 ads per page, up to 1000 pages per search.">
            Max pages
            <Input type="number" min={1} max={1000} value={adheartOpts.maxPages} onChange={(e) => setAdheartOpts((o) => ({ ...o, maxPages: e.target.value }))} className="h-8 w-24 bg-white" />
          </label>
          <div className="ml-auto">
            <Button size="sm" onClick={parseAdheart} disabled={adheartRun.busy || adheartPicked.size === 0 || (adheartOpts.start === 'date' && !adheartOpts.date)}>
              {adheartRun.busy ? 'Starting…' : `Start${adheartPicked.size ? ` (${adheartPicked.size})` : ''}`}
            </Button>
          </div>
        </div>
      </div>
      {adheartRun.error && <ErrorBox msg={`Parse Adheart: ${adheartRun.error}`} />}
      {adheartRun.msg && <div className="mx-4 mb-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{adheartRun.msg}</div>}
    </div>
  );
}

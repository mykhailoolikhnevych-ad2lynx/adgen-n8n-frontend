import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getAuthEmail } from '@/lib/identity';
import { post, ErrorBox } from './MegatoolAutozalivBuilderPage';

// FB Rejects (megatool-fb-rejects, admins only): each user adds the FB ad accounts they want to watch. n8n scans them every hour
// for DISAPPROVED ads; 🌸 swaps a rejected ad to neutral flowers (ad PAUSED); every 2 h n8n checks the swapped ads:
// approved -> the ad is deleted and the reject is gone from the account, rejected again / 48 h in review -> failed.
const WEBHOOK = import.meta.env.PUBLIC_WEBHOOK_FB_REJECTS_URL as string | undefined;
const ENV = 'PUBLIC_WEBHOOK_FB_REJECTS_URL';
const CHUNK = 10; // ads per "clean" call (each one is ~4 Graph calls)

type Account = {
  account_id: string; account_name: string; token_name: string; added_at: string;
  last_scan_at: string | null; last_error: string | null; open: number;
};
type Reject = {
  ad_id: string; account_id: string; campaign_id: string | null; campaign: string | null; adset_id: string | null;
  adset: string | null; ad_name: string | null; reason: string | null; state: string; new_creative: string | null;
  note: string | null; cleaned_by: string | null; found_at: string; swapped_at: string | null; updated_at: string;
};

const STATE: Record<string, { label: string; color: string; hint: string }> = {
  new: { label: 'rejected', color: 'bg-red-100 text-red-800', hint: 'Rejected by FB, nothing done yet' },
  failed: { label: 'failed', color: 'bg-amber-100 text-amber-800', hint: 'The swap or the review failed - see the note. 🌸 tries again' },
  appealed: { label: '⚖ appealed', color: 'bg-violet-100 text-violet-800', hint: 'Review requested in Ads Manager with the original creative. Approved -> resolved; still rejected -> 🌸 or Skip' },
  swapped: { label: '🌸 in review', color: 'bg-blue-100 text-blue-800', hint: 'Flowers in, ad paused. Checked every 2 h: approved -> the ad is deleted' },
  deleted: { label: '✅ removed', color: 'bg-emerald-100 text-emerald-800', hint: 'Approved with flowers, ad deleted: the reject is gone from the account' },
  resolved: { label: 'resolved by FB', color: 'bg-slate-100 text-slate-500', hint: 'No longer rejected (appeal, edit or deleted in Ads Manager)' },
};
const FILTERS: { value: string; label: string; states: string[] }[] = [
  { value: 'open', label: 'To fix', states: ['new', 'failed'] },
  { value: 'swapped', label: 'In review', states: ['swapped', 'appealed'] },
  { value: 'done', label: 'Done (7 days)', states: ['deleted', 'resolved'] },
  { value: 'all', label: 'All', states: Object.keys(STATE) },
];
const CLEANABLE = ['new', 'failed', 'appealed'];
// skipped ads and the rejects an account already had when it was added ('baseline') are never shown

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-GB', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const adsManager = (r: Reject) =>
  `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${r.account_id}&selected_ad_ids=${r.ad_id}`;

export function MegatoolFbRejectsPage() {
  const [email, setEmail] = useState<string>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [known, setKnown] = useState<{ account_id: string; account_name: string }[]>([]); // fb_accounts, for the picker
  const [ads, setAds] = useState<Reject[]>();
  const [newAccount, setNewAccount] = useState('');
  const [filter, setFilter] = useState('open');
  const [accountFilter, setAccountFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>(); // what is running right now
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const requestNo = useRef(0);

  useEffect(() => {
    getAuthEmail().then((id) => (id?.email ? setEmail(id.email) : setError('Not signed in: no email')));
  }, []);

  const call = (body: object, timeout = 120_000) => post(WEBHOOK, ENV, { ...body, email }, timeout);

  const load = async () => {
    if (!email) return;
    const no = ++requestNo.current;
    try {
      const res = await call({ action: 'list' }, 60_000);
      if (no !== requestNo.current) return;
      setAccounts(res.watch || []);
      setKnown(res.known || []);
      setAds(res.ads || []);
    } catch (e: any) {
      if (no === requestNo.current) setError(e.message);
    }
  };
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 60_000);
    return () => clearInterval(t);
  }, [email]);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setError(undefined);
    setInfo(undefined);
    try {
      const msg = await fn();
      if (msg) setInfo(msg);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(undefined);
      await load();
    }
  };

  const addAccount = () =>
    run('Adding account…', async () => {
      const res = await call({ action: 'add', account_id: newAccount.trim() }); // act_ id or account name
      const id = res.account.account_id;
      setNewAccount('');
      setBusy(`Scanning ${res.account.account_name}…`);
      const scan = await call({ action: 'scan', account_id: id }, 180_000);
      return `Added ${res.account.account_name}: ${scan.baseline || 0} old reject(s) hidden, new ones will show up here${scan.errors?.length ? ` (${scan.errors.join('; ')})` : ''}`;
    });

  const removeAccount = (a: Account) => {
    if (!confirm(`Stop watching ${a.account_name} (act_${a.account_id})?`)) return;
    run('Removing…', async () => {
      await call({ action: 'delete', account_id: a.account_id });
      if (accountFilter === a.account_id) setAccountFilter('');
    });
  };

  const rescan = (a: Account) =>
    run(`Scanning ${a.account_name}…`, async () => {
      const scan = await call({ action: 'scan', account_id: a.account_id }, 180_000);
      return `${a.account_name}: ${scan.found} rejected ad(s)${scan.errors?.length ? ` (${scan.errors.join('; ')})` : ''}`;
    });

  const clean = (ids: string[]) => {
    if (!ids.length) return;
    if (!confirm(`Swap ${ids.length} ad(s) to neutral flowers and pause them?\nAfter FB approves, the ad is deleted and the reject is gone.`)) return;
    run('🌸 Swapping…', async () => {
      const failed: string[] = [];
      let ok = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        setBusy(`🌸 Swapping ${Math.min(i + CHUNK, ids.length)}/${ids.length}…`);
        const res = await call({ action: 'clean', ad_ids: ids.slice(i, i + CHUNK) }, 300_000);
        for (const r of res.results || []) r.ok ? ok++ : failed.push(`${r.ad_id}: ${r.error}`);
      }
      setSelected(new Set());
      if (failed.length) throw new Error(`${ok} swapped, ${failed.length} failed:\n${failed.slice(0, 10).join('\n')}`);
      return `🌸 ${ok} ad(s) swapped to flowers and paused. Checked every 2 h.`;
    });
  };

  // FB has no API to appeal one ad: open it in Ads Manager (click "Request review" there) and track it as appealed
  const appeal = (r: Reject) => {
    window.open(adsManager(r), '_blank', 'noopener');
    run('Marking as appealed…', async () => {
      await call({ action: 'appeal', ad_ids: [r.ad_id] });
      return `Ads Manager opened for ${r.ad_name || r.ad_id}: click "Request review" there. Approved -> it moves to Done.`;
    });
  };

  const setSkip = (ids: string[]) =>
    run('Skipping…', async () => {
      await call({ action: 'skip', ad_ids: ids });
      setSelected(new Set());
    });

  // every rejected / failed row in the current view (filter + account + search), 500 per call
  const skipAll = (ids: string[]) => {
    if (!ids.length || !confirm(`Skip all ${ids.length} rejected ad(s) in this view?\nThey will never be shown again.`)) return;
    run('Skipping…', async () => {
      for (let i = 0; i < ids.length; i += 500) await call({ action: 'skip', ad_ids: ids.slice(i, i + 500) });
      setSelected(new Set());
      return `${ids.length} ad(s) skipped.`;
    });
  };

  const accName = useMemo(() => Object.fromEntries(accounts.map((a) => [a.account_id, a.account_name])), [accounts]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of ads || []) if (!accountFilter || r.account_id === accountFilter) c[r.state] = (c[r.state] || 0) + 1;
    return c;
  }, [ads, accountFilter]);
  const visible = useMemo(() => {
    const states = FILTERS.find((f) => f.value === filter)?.states || [];
    const s = search.trim().toLowerCase();
    return (ads || []).filter((r) => states.includes(r.state) && (!accountFilter || r.account_id === accountFilter)
      && (!s || [r.ad_id, r.ad_name, r.campaign, r.adset, r.reason].some((v) => (v || '').toLowerCase().includes(s))));
  }, [ads, filter, accountFilter, search]);
  const selectable = visible.filter((r) => CLEANABLE.includes(r.state));
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.ad_id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const skippable = visible.filter((r) => ['new', 'failed', 'appealed'].includes(r.state)).map((r) => r.ad_id);
  const selectedIds = [...selected].filter((id) => selectable.some((r) => r.ad_id === id));

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 overflow-hidden">
      <div className="m-4 mb-2 flex min-h-0 flex-1 flex-col gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-semibold text-slate-800">FB Rejects</span>
          <span>— rejected ads of your accounts, scanned every hour. 🌸 swaps the ad to neutral flowers (paused); once FB approves it, the ad is deleted and the reject is gone.</span>
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => run('Loading…', async () => {})} disabled={!!busy}>↻ Refresh</Button>
        </div>

        {/* my accounts */}
        <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2">
          <span className="font-semibold text-slate-700">My accounts</span>
          {accounts.map((a) => (
            <span
              key={a.account_id}
              className={`flex items-center gap-1 rounded border px-2 py-0.5 ${accountFilter === a.account_id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}
              title={`act_${a.account_id} · token ${a.token_name} · last scan ${fmt(a.last_scan_at)}${a.last_error ? `\nError: ${a.last_error}` : ''}`}
            >
              <button type="button" className="hover:underline" onClick={() => setAccountFilter(accountFilter === a.account_id ? '' : a.account_id)}>
                {a.account_name}
              </button>
              {a.open > 0 && <span className="rounded bg-red-100 px-1 text-red-700">{a.open}</span>}
              {a.last_error && <span className="text-amber-600">⚠</span>}
              <button type="button" className="text-slate-400 hover:text-blue-600" title="Scan now" onClick={() => rescan(a)} disabled={!!busy}>↻</button>
              <button type="button" className="text-slate-400 hover:text-red-600" title="Remove" onClick={() => removeAccount(a)} disabled={!!busy}>🗑</button>
            </span>
          ))}
          {!accounts.length && <span className="text-slate-400">No accounts yet - add one →</span>}
          <form className="ml-auto flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (newAccount.trim()) addAccount(); }}>
            <Input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="Account name or act_ id" list="fb-rejects-known" className="h-7 w-64 text-xs" />
            <datalist id="fb-rejects-known">
              {known.filter((k) => !accounts.some((a) => a.account_id === k.account_id)).map((k) => (
                <option key={k.account_id} value={k.account_name}>act_{k.account_id}</option>
              ))}
            </datalist>
            <Button size="sm" className="h-7" type="submit" disabled={!!busy || !email || !newAccount.trim()}>+ Add</Button>
          </form>
        </div>

        {/* filters + bulk */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => { setFilter(f.value); setSelected(new Set()); }}
                className={`rounded px-2 py-1 ${filter === f.value ? 'bg-slate-800 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}
              >
                {f.label} ({f.states.reduce((n, s) => n + (counts[s] || 0), 0)})
              </button>
            ))}
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ad / campaign / reason" className="h-7 w-60 text-xs" />
          {busy && <span className="text-blue-600">{busy}</span>}
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="outline" className="h-7" disabled={!!busy || !skippable.length} onClick={() => skipAll(skippable)}>Skip all ({skippable.length})</Button>
            <Button size="sm" variant="outline" className="h-7" disabled={!!busy || !selectedIds.length} onClick={() => setSkip(selectedIds)}>Skip ({selectedIds.length})</Button>
            <Button size="sm" className="h-7 bg-pink-600 hover:bg-pink-700" disabled={!!busy || !selectedIds.length} onClick={() => clean(selectedIds)}>
              🌸 Flowers for selected ({selectedIds.length})
            </Button>
          </div>
        </div>

        {error && <ErrorBox msg={error} />}
        {info && <div className="whitespace-pre-wrap rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">{info}</div>}

        <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[10px] font-bold uppercase text-gray-500">
              <tr>
                <th className="w-8 px-2 py-1">
                  <input type="checkbox" checked={allSelected} disabled={!selectable.length}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.ad_id)))} />
                </th>
                <th className="px-2 py-1">found</th>
                <th className="px-2 py-1">account</th>
                <th className="px-2 py-1">campaign / ad set</th>
                <th className="px-2 py-1">ad</th>
                <th className="px-2 py-1">FB reason</th>
                <th className="px-2 py-1">state</th>
                <th className="px-2 py-1">note</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const st = STATE[r.state] || { label: r.state, color: 'bg-slate-100', hint: '' };
                const can = CLEANABLE.includes(r.state);
                return (
                  <tr key={r.ad_id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="px-2 py-1">
                      {can && <input type="checkbox" checked={selected.has(r.ad_id)} onChange={() => toggle(r.ad_id)} />}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">{fmt(r.found_at)}</td>
                    <td className="px-2 py-1">{accName[r.account_id] || `act_${r.account_id}`}</td>
                    <td className="px-2 py-1">
                      <div className="text-slate-800">{r.campaign || '—'}</div>
                      <div className="text-slate-400">{r.adset || '—'}</div>
                    </td>
                    <td className="px-2 py-1">
                      <a href={adsManager(r)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{r.ad_name || r.ad_id}</a>
                      <div className="text-slate-400">{r.ad_id}</div>
                    </td>
                    <td className="px-2 py-1 font-medium text-red-700">{r.reason}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      <span className={`rounded px-1.5 py-0.5 ${st.color}`} title={st.hint}>{st.label}</span>
                      {r.swapped_at && <div className="mt-0.5 text-slate-400" title={r.cleaned_by || ''}>🌸 {fmt(r.swapped_at)}</div>}
                    </td>
                    <td className="max-w-xs px-2 py-1 text-slate-500">{r.note}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {can && (
                        <Button size="sm" className="h-6 bg-pink-600 px-2 hover:bg-pink-700" disabled={!!busy} onClick={() => clean([r.ad_id])}>🌸 Flowers</Button>
                      )}
                      {(r.state === 'new' || r.state === 'failed') && (
                        <Button size="sm" variant="outline" className="ml-1 h-6 px-2" disabled={!!busy} onClick={() => appeal(r)} title="Open in Ads Manager to request review">⚖ Appeal</Button>
                      )}
                      {['new', 'failed', 'appealed'].includes(r.state) && (
                        <Button size="sm" variant="ghost" className="ml-1 h-6 px-2" disabled={!!busy} onClick={() => setSkip([r.ad_id])} title="Never show this ad again">Skip</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr><td colSpan={9} className="px-2 py-3 text-slate-400">{ads ? (accounts.length ? 'Nothing here' : 'Add an ad account above') : 'Loading…'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

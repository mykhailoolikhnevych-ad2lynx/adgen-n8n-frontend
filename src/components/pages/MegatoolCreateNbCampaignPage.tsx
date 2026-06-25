import { useState, useMemo, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { useAppStore, type ArticleStatus } from '@/store/useAppStore';

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Creating NB Campaign…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

const START_DATE_OPTIONS = [
  { label: 'Now', value: 'now' },
  { label: 'Tomorrow', value: 'tomorrow' },
  { label: 'Tomorrow +1', value: 'tomorrow+1' },
  { label: 'Tomorrow +2', value: 'tomorrow+2' },
] as const;

type StartDate = 'now' | 'tomorrow' | 'tomorrow+1' | 'tomorrow+2';

interface Props {
  onClose: () => void;
}

const CopyableCard = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — ignore
    }
  };
  return (
    <div className="border rounded-lg bg-white p-3 shadow-sm flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-slate-900 break-all flex-1 min-w-0">{value || '—'}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopy}
          disabled={!value}
          className="shrink-0 h-7 text-[11px]"
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
    </div>
  );
};

export const MegatoolCreateNbCampaignPage = ({ onClose }: Props) => {
  const selectedFbAd = useAppStore((s) => s.selectedFbAd);
  const binomOfferResult = useAppStore((s) => s.binomOfferResult);
  const status = useAppStore((s) => s.nbCampaignStatus);
  const result = useAppStore((s) => s.nbCampaignResult);
  const error = useAppStore((s) => s.nbCampaignError);
  const createNbCampaign = useAppStore((s) => s.createNbCampaign);
  const resetNbCampaign = useAppStore((s) => s.resetNbCampaign);
  // Live-fetched from the n8n nb_accounts datatable on mount.
  const nbAccountsList = useAppStore((s) => s.nbAccountsList);
  const nbAccountsStatus = useAppStore((s) => s.nbAccountsStatus);
  const nbAccountsError = useAppStore((s) => s.nbAccountsError);
  const fetchNbAccounts = useAppStore((s) => s.fetchNbAccounts);
  useEffect(() => {
    // Only auto-fetch when status is 'idle'. Never auto-refetch on error —
    // that creates a tight loop if the parser drops every row. The visible
    // "retry" button lets the user trigger another attempt manually.
    if (nbAccountsStatus === 'idle') {
      void fetchNbAccounts();
    }
  }, [nbAccountsStatus, fetchNbAccounts]);
  const nbAccountNames = useMemo(() => nbAccountsList.map((a) => a.name), [nbAccountsList]);

  const defaultCampaignName = useMemo(
    () => selectedFbAd?.creativeTitle || selectedFbAd?.adName || '',
    [selectedFbAd],
  );

  const [selectedAccountName, setSelectedAccountName] = useState('');
  const [campaignName, setCampaignName] = useState(defaultCampaignName);
  const [budget, setBudget] = useState(40);
  const [startDate, setStartDate] = useState<StartDate>('now');
  const [showRaw, setShowRaw] = useState(false);

  const isLoading = status === 'loading';

  if (!selectedFbAd || !binomOfferResult) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-xl border p-6 shadow-sm text-slate-600 text-sm max-w-md text-center">
          Please complete Create Binom Offer first.
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={onClose}>← Back</Button>
          </div>
        </div>
      </div>
    );
  }

  const selectedAccount = nbAccountsList.find((a) => a.name === selectedAccountName);
  const canSubmit = !isLoading && !!selectedAccount && !!campaignName.trim() && budget >= 1;

  const handleSubmit = () => {
    if (!selectedAccount) return;
    void createNbCampaign({
      nbAccountId: selectedAccount.id,
      campaignName: campaignName.trim(),
      headline: selectedFbAd.creativeTitle,
      body: selectedFbAd.creativeBody,
      callToAction: 'Learn More',
      brandName: '',
      assetUrl: selectedFbAd.thumbnailUrl,
      clickThroughUrl: binomOfferResult.binomCampaignUrl,
      budget,
      startDate,
    });
  };

  const handleReset = () => {
    resetNbCampaign();
    setSelectedAccountName('');
    setCampaignName(defaultCampaignName);
    setBudget(40);
    setStartDate('now');
    setShowRaw(false);
  };

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* LEFT — form */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-xl">→ Create NB Campaign</h2>
          <Button variant="outline" size="sm" onClick={onClose}>← Back</Button>
        </div>

        {/* Selected ad summary (read-only) */}
        <section className="mb-5 border rounded-lg bg-slate-50 p-3 flex gap-3">
          {selectedFbAd.thumbnailUrl ? (
            <img
              src={selectedFbAd.thumbnailUrl}
              alt=""
              className="h-16 w-16 rounded object-cover shrink-0"
            />
          ) : (
            <div className="h-16 w-16 rounded bg-slate-200 shrink-0 flex items-center justify-center text-[10px] text-slate-500">
              no image
            </div>
          )}
          <div className="flex-1 min-w-0 text-xs space-y-0.5">
            <div className="font-semibold text-slate-800 truncate" title={selectedFbAd.adName}>
              {selectedFbAd.adName}
            </div>
            {selectedFbAd.creativeTitle && (
              <div className="text-slate-600 truncate" title={selectedFbAd.creativeTitle}>
                <span className="text-slate-400">Headline:</span> {selectedFbAd.creativeTitle}
              </div>
            )}
            {selectedFbAd.creativeBody && (
              <div className="text-slate-500 line-clamp-2" title={selectedFbAd.creativeBody}>
                {selectedFbAd.creativeBody.slice(0, 120)}{selectedFbAd.creativeBody.length > 120 ? '…' : ''}
              </div>
            )}
          </div>
        </section>

        {/* Form */}
        <section className="space-y-4">
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">
              NB Account *
              {nbAccountsStatus === 'loading' && <span className="ml-2 text-[10px] text-blue-600 normal-case">loading accounts…</span>}
              {nbAccountsStatus === 'success' && <span className="ml-2 text-[10px] text-slate-400 normal-case">({nbAccountsList.length})</span>}
            </label>
            <Combobox
              value={selectedAccountName}
              onChange={setSelectedAccountName}
              options={nbAccountNames}
              placeholder={nbAccountsStatus === 'loading' ? 'Loading NB accounts…' : 'Type to search 428+ accounts…'}
              inputClassName="text-sm rounded-md bg-white px-2"
              minSearchChars={1}
            />
            {nbAccountsStatus === 'error' && (
              <div className="mt-1 flex items-center gap-2 text-[10px] text-red-600">
                <span>Failed to load NB accounts: {nbAccountsError ?? 'unknown'}</span>
                <button
                  type="button"
                  onClick={() => void fetchNbAccounts()}
                  className="underline hover:no-underline"
                >
                  retry
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Campaign Name *</label>
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Campaign name"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Budget (USD/day) *</label>
            <Input
              type="number"
              min={1}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              placeholder="40"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500">Start Date</label>
            <select
              value={startDate}
              onChange={(e) => setStartDate(e.target.value as StartDate)}
              className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {START_DATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSubmit} disabled={!canSubmit} className="flex-1">
              {isLoading ? 'Creating…' : 'Create NB Campaign'}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={isLoading}>
              Reset
            </Button>
          </div>
        </section>
      </div>

      {/* RIGHT — status + results */}
      <div className="w-[28rem] shrink-0 bg-white rounded-xl border p-4 overflow-hidden shadow-sm flex flex-col">
        <h2 className="font-bold text-xl mb-2 shrink-0">Result</h2>

        <div className="-mx-4 bg-slate-200 px-4 py-2 text-sm flex items-center justify-between shrink-0">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Status:</span>
            {isLoading && (
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"
              />
            )}
            <span className={`font-medium ${STATUS_COLOR[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto mt-3 space-y-3">
          {status === 'idle' && (
            <div className="text-slate-400 italic text-sm">
              Fill the form and press Create NB Campaign. Results appear here.
            </div>
          )}
          {status === 'loading' && (
            <div className="text-slate-600 text-sm">Creating NB campaign — usually 10–60s.</div>
          )}
          {status === 'error' && (
            <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md whitespace-pre-wrap">
              <div className="font-semibold mb-1">Error</div>
              {error ?? 'Unknown error'}
            </div>
          )}
          {status === 'success' && result && (
            <>
              <CopyableCard label="NB Account ID" value={result.nbAccountId} />
              <CopyableCard label="Campaign ID" value={result.campaignId} />
              <CopyableCard label="Adset ID" value={result.adsetId} />
              <CopyableCard label="Ad ID" value={result.adId} />
              {result.campaignName && (
                <CopyableCard label="Campaign Name" value={result.campaignName} />
              )}

              <div className="border rounded-lg bg-slate-50">
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center justify-between"
                >
                  <span>Raw response</span>
                  <span className="text-slate-400">{showRaw ? '▾' : '▸'}</span>
                </button>
                {showRaw && (
                  <pre className="px-3 pb-3 text-[10px] font-mono whitespace-pre-wrap break-all text-slate-700">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

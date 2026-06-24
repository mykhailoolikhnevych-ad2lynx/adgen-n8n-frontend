import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/Combobox';
import { useAppStore, type ArticleStatus } from '@/store/useAppStore';
import { BINOM_GROUP_NAMES, BINOM_AMO_DOMAINS } from '@/lib/binomGroups';

const STATUS_LABEL: Record<ArticleStatus, string> = {
  idle: 'Idle',
  loading: 'Creating Binom offer…',
  success: 'Done',
  error: 'Error',
};

const STATUS_COLOR: Record<ArticleStatus, string> = {
  idle: 'text-slate-600',
  loading: 'text-blue-600',
  success: 'text-green-600',
  error: 'text-red-600',
};

interface MegatoolCreateBinomOfferPageProps {
  onClose: () => void;
  onOpenNbCampaign?: () => void;
}

const CopyableCard = ({ label, value, isLink }: { label: string; value: string; isLink?: boolean }) => {
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
        {isLink && value ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-blue-600 hover:underline break-all flex-1 min-w-0"
            title={value}
          >
            {value}
          </a>
        ) : (
          <span className="font-mono text-xs text-slate-900 break-all flex-1 min-w-0">{value || '—'}</span>
        )}
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

export const MegatoolCreateBinomOfferPage = ({ onClose, onOpenNbCampaign }: MegatoolCreateBinomOfferPageProps) => {
  const selectedFbAd = useAppStore((s) => s.selectedFbAd);
  const status = useAppStore((s) => s.binomOfferStatus);
  const result = useAppStore((s) => s.binomOfferResult);
  const error = useAppStore((s) => s.binomOfferError);
  const createBinomOffer = useAppStore((s) => s.createBinomOffer);
  const resetBinomOffer = useAppStore((s) => s.resetBinomOffer);

  const [newAmoDomain, setNewAmoDomain] = useState<string>('same');
  const [newAmoChannel, setNewAmoChannel] = useState('same');
  const [newBinomGroup, setNewBinomGroup] = useState<string>('same');
  const [isRoas, setIsRoas] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const isLoading = status === 'loading';

  if (!selectedFbAd) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-xl border p-6 shadow-sm text-slate-600 text-sm max-w-md text-center">
          Please select an ad first in FB Campaign Reader.
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={onClose}>← Back to FB Campaign Reader</Button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    if (!selectedFbAd.trackingUrl) return;
    void createBinomOffer({
      trackingUrl: selectedFbAd.trackingUrl,
      newAmoDomain,
      newAmoChannel: newAmoChannel.trim() || 'same',
      newBinomGroup,
      isRoas,
    });
  };

  const handleReset = () => {
    resetBinomOffer();
    setNewAmoDomain('same');
    setNewAmoChannel('same');
    setNewBinomGroup('same');
    setIsRoas(false);
    setShowRaw(false);
  };

  return (
    <div className="flex h-full w-full gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* LEFT — form */}
      <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-xl">→ Create Binom Offer</h2>
          <Button variant="outline" size="sm" onClick={onClose}>← Back</Button>
        </div>

        {/* Selected ad summary */}
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
            <div className="text-slate-600 truncate" title={selectedFbAd.adsetName}>
              <span className="text-slate-400">Adset:</span> {selectedFbAd.adsetName}
            </div>
            <div className="text-slate-600 truncate" title={selectedFbAd.campaignName}>
              <span className="text-slate-400">Campaign:</span> {selectedFbAd.campaignName}
            </div>
            <a
              href={selectedFbAd.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline truncate block font-mono text-[11px]"
              title={selectedFbAd.trackingUrl}
            >
              {selectedFbAd.trackingUrl || '(no tracking URL)'}
            </a>
          </div>
        </section>

        {/* Form */}
        <section className="space-y-4">
          <div>
            <label className="text-xs font-medium uppercase text-slate-500">New AMO Domain *</label>
            <Combobox
              value={newAmoDomain}
              onChange={setNewAmoDomain}
              options={[...BINOM_AMO_DOMAINS]}
              placeholder="Click to choose or type…"
              inputClassName="text-sm rounded-md bg-white px-2"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              <code>same</code> keeps the original domain from the source ad.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500">New AMO Channel *</label>
            <Input
              value={newAmoChannel}
              onChange={(e) => setNewAmoChannel(e.target.value)}
              placeholder="e.g. ch12345 or 'same'"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              <code>same</code> keeps the original channel from the source ad.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium uppercase text-slate-500">New Binom Group *</label>
            <Combobox
              value={newBinomGroup}
              onChange={setNewBinomGroup}
              options={[...BINOM_GROUP_NAMES]}
              placeholder="Click to choose or type…"
              inputClassName="text-sm rounded-md bg-white px-2"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Group name (resolved server-side), raw UUID, or <code>same</code>.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isRoas}
              onChange={(e) => setIsRoas(e.target.checked)}
            />
            ROAS campaign
          </label>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !selectedFbAd.trackingUrl}
              className="flex-1"
            >
              {isLoading ? 'Creating…' : 'Create Binom Offer'}
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isLoading}
            >
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
              Fill the form and press Create Binom Offer. Results appear here.
            </div>
          )}
          {status === 'loading' && (
            <div className="text-slate-600 text-sm">Creating Binom offer & campaign — usually 5–30s.</div>
          )}
          {status === 'error' && (
            <div className="border border-red-300 bg-red-50 text-red-700 text-xs p-2 rounded-md whitespace-pre-wrap">
              <div className="font-semibold mb-1">Error</div>
              {error ?? 'Unknown error'}
            </div>
          )}
          {status === 'success' && result && (
            <>
              <CopyableCard
                label="Binom Offer ID(s)"
                value={(result.binomOfferIds ?? []).join(', ')}
              />
              <CopyableCard label="Binom Campaign ID" value={result.binomCampaignId ?? ''} />
              <CopyableCard label="Binom Campaign URL" value={result.binomCampaignUrl ?? ''} isLink />
              {result.binomCampaignName && (
                <CopyableCard label="Binom Campaign Name" value={result.binomCampaignName} />
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

              {onOpenNbCampaign && (
                <div className="pt-1">
                  <Button
                    onClick={onOpenNbCampaign}
                    disabled={!selectedFbAd}
                    className="w-full"
                  >
                    → Create NB Campaign
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

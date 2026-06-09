import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { listPrompts, savePrompt, deletePrompt, type SavedPrompt } from '@/lib/prompts';

// Docs page: two top-level sections that look like the Dashboard's sub-tab nav.
//   - Knowledge Base    : visible to everyone, one inner tab per module with a
//                         short "how this tab works" placeholder for now.
//   - Prompt Bases      : admin-only (same gate as Dashboard). Lets ops save /
//                         edit / delete reusable prompt bodies. Persisted to
//                         localStorage so we don't need a backend yet.

type Section = 'kb' | 'prompts';

// ---------------------------------------------------------------------------
// Knowledge Base — placeholder copy. Edit MODULE_DOCS as the real docs land.
// ---------------------------------------------------------------------------

type ModuleId = 'keywords' | 'angles' | 'article' | 'creatives';

interface ModuleDoc {
  id: ModuleId;
  label: string;
  body: string;
}

const MODULE_DOCS: ModuleDoc[] = [
  {
    id: 'keywords',
    label: 'Keywords',
    body: 'Keywords tab — short placeholder. Enter an anchor keyword, pick a country and translation, then run the research. The workflow scrapes the SERP and rewrites the result as an HTML brief you can copy.',
  },
  {
    id: 'angles',
    label: 'Angles',
    body: 'Angles tab — short placeholder. Two-step flow. Step 1: build audience segments from an anchor + GEO. Step 2: pick the segments you like and get curated top-pick headlines per audience.',
  },
  {
    id: 'article',
    label: 'Article',
    body: 'Article tab — short placeholder. Provide a topic, GEO, language, and a mode. The workflow scrapes the SERP top-10 and rewrites it into an article in the chosen style.',
  },
  {
    id: 'creatives',
    label: 'Creatives',
    body: 'Creatives tab — short placeholder. Four columns: input, angles, concepts, batches. Fill in the form, generate angles, pick one to expand into concepts, then turn each concept into a batch of banner variants.',
  },
];

const KnowledgeBaseView = () => {
  const [moduleId, setModuleId] = useState<ModuleId>('keywords');
  const active = MODULE_DOCS.find((m) => m.id === moduleId) ?? MODULE_DOCS[0];

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden">
      {/* Inner tab nav — same visual language as the Dashboard sub-tabs. */}
      <div className="bg-white rounded-xl border p-2 shadow-sm flex items-center gap-1 shrink-0">
        {MODULE_DOCS.map((m) => {
          const isActive = m.id === moduleId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setModuleId(m.id)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 bg-white rounded-xl border shadow-sm p-6 overflow-auto">
        <h3 className="font-bold text-lg mb-3">{active.label}</h3>
        <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
          {active.body}
        </p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Prompt Bases — admin-only. Backed by the DEV Prompt Bases n8n workflow so
// every admin sees the same shared library. List fetches on mount; save/delete
// roundtrip to the API and reuse the response (no extra refetch).
// ---------------------------------------------------------------------------

type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

const humanizeError = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
};

const PromptBasesView = () => {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftBody, setDraftBody] = useState('');
  // id can be a string or a number — n8n's Data Table auto-id is integer, but
  // the API surface accepts both. Track whichever we got back from the server.
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFetchStatus('loading');
      setFetchError(null);
      try {
        const list = await listPrompts();
        if (cancelled) return;
        setPrompts(list);
        setFetchStatus('success');
      } catch (e) {
        if (cancelled) return;
        setFetchStatus('error');
        setFetchError(humanizeError(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const resetForm = () => {
    setDraftName('');
    setDraftBody('');
    setEditingId(null);
    setOpError(null);
  };

  const handleSave = async () => {
    const name = draftName.trim();
    const body = draftBody;
    if (!name || !body.trim()) return;
    setBusy('saving');
    setOpError(null);
    try {
      const saved = await savePrompt({ id: editingId ?? undefined, name, prompt: body });
      setPrompts((cur) => {
        const idx = cur.findIndex((p) => p.id === saved.id);
        if (idx === -1) return [saved, ...cur];
        const next = cur.slice();
        next[idx] = saved;
        return next;
      });
      resetForm();
    } catch (e) {
      setOpError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  };

  const handleEdit = (p: SavedPrompt) => {
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftBody(p.prompt);
    setOpError(null);
  };

  const handleDelete = async (id: string | number) => {
    setBusy('deleting');
    setOpError(null);
    try {
      await deletePrompt(id);
      setPrompts((cur) => cur.filter((p) => p.id !== id));
      if (editingId === id) resetForm();
    } catch (e) {
      setOpError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  };

  const canSave = draftName.trim().length > 0 && draftBody.trim().length > 0 && busy === null;

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden">
      {/* Sidebar list */}
      <aside className="w-72 shrink-0 bg-white rounded-xl border shadow-sm overflow-y-auto flex flex-col">
        <div className="p-3 border-b sticky top-0 bg-white z-10">
          <h3 className="font-bold text-sm">Saved prompts</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {fetchStatus === 'loading' && 'loading…'}
            {fetchStatus === 'error' && <span className="text-red-600">load failed</span>}
            {fetchStatus === 'success' && `${prompts.length} shared with the team`}
          </p>
        </div>
        {fetchStatus === 'error' && fetchError && (
          <div className="p-3 text-xs text-red-600 whitespace-pre-wrap">{fetchError}</div>
        )}
        {fetchStatus === 'success' && prompts.length === 0 && (
          <div className="p-3 text-xs text-slate-400 italic">
            No prompts yet. Use the form to add the first one.
          </div>
        )}
        {prompts.length > 0 && (
          <ul className="divide-y">
            {prompts.map((p) => {
              const isEditing = p.id === editingId;
              return (
                <li
                  key={p.id}
                  className={`p-3 transition-colors ${
                    isEditing ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="font-semibold text-sm truncate" title={p.name}>
                    {p.name}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 line-clamp-2 whitespace-pre-wrap">
                    {p.prompt}
                  </div>
                  {p.updated_by && (
                    <div className="text-[10px] text-slate-400 mt-1 font-mono truncate" title={`${p.updated_by} · ${p.updated_at ?? ''}`}>
                      {p.updated_by}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(p)}
                      disabled={busy !== null}
                      className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      Edit
                    </button>
                    <span className="text-xs text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      disabled={busy !== null}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Form */}
      <div className="flex-1 bg-white rounded-xl border shadow-sm p-4 overflow-y-auto flex flex-col">
        <h3 className="font-bold text-sm mb-3">
          {editingId ? 'Edit prompt' : 'New prompt'}
        </h3>

        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
          Name
        </label>
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="A short identifier — e.g. Process stage hook"
          className="mb-4"
          disabled={busy !== null}
        />

        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
          Custom prompt
        </label>
        <Textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          placeholder="Write the full prompt body here…"
          rows={14}
          className="font-mono text-sm flex-1 min-h-[260px] mb-4"
          disabled={busy !== null}
        />

        {opError && (
          <div className="text-xs text-red-600 mb-3 whitespace-pre-wrap" role="alert">
            {opError}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          {editingId && (
            <Button variant="outline" size="sm" onClick={resetForm} disabled={busy !== null}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {busy === 'saving'
              ? 'Saving…'
              : editingId ? 'Update' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Top-level Docs page.
// ---------------------------------------------------------------------------

interface DocsPageProps {
  isAdmin: boolean;
}

export const DocsPage = ({ isAdmin }: DocsPageProps) => {
  // If a non-admin lands here we just default to the only section they can see.
  const [section, setSection] = useState<Section>('kb');

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* Top-level section nav — mirrors the Dashboard's sub-tab look. */}
      <div className="bg-white rounded-xl border p-2 shadow-sm flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setSection('kb')}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            section === 'kb'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
          aria-current={section === 'kb' ? 'page' : undefined}
        >
          Knowledge Base
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setSection('prompts')}
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              section === 'prompts'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
            aria-current={section === 'prompts' ? 'page' : undefined}
          >
            Prompt Bases
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {section === 'kb' && <KnowledgeBaseView />}
        {section === 'prompts' && isAdmin && <PromptBasesView />}
      </div>
    </div>
  );
};

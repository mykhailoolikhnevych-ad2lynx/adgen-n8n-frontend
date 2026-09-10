import { useEffect, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import type { SavedPrompt } from '@/lib/prompts';

// Searchable add-a-saved-prompt picker. Same UX shape as the GEO / Language
// combobox: focus opens the dropdown, typing filters by name (case-insensitive
// substring), mouse-down on a row picks it. Shared by the image settings panel
// and the Video Generator's motion picker.
export const SavedPromptPicker = ({ available, onPick, placeholder = 'Add a saved prompt…' }: {
  available: SavedPrompt[];
  onPick: (id: string) => void;
  /** Shown when there is something to add. The "nothing left" copy is fixed. */
  placeholder?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = query
    ? available.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : available;
  const empty = available.length === 0;

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={open ? query : ''}
        placeholder={empty ? 'All saved prompts already added' : placeholder}
        disabled={empty}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onClick={() => { if (!open) { setOpen(true); setQuery(''); } }}
        onChange={(e) => { if (!open) setOpen(true); setQuery(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); setQuery(''); e.currentTarget.blur(); }
        }}
        className="w-full text-xs border rounded-md px-2 py-1 pr-7 bg-white disabled:bg-slate-100 disabled:text-slate-400"
      />
      <CaretDown
        size={12}
        weight="bold"
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-700"
      />
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
        >
          {filtered.map((p) => (
            <li
              key={String(p.id)}
              role="option"
              // onMouseDown fires before the input blur so the click still picks.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(String(p.id));
                setOpen(false);
                setQuery('');
              }}
              className="cursor-pointer px-3 py-1.5 text-xs hover:bg-slate-100 truncate"
              title={p.name}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && query && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
          <li className="px-3 py-1.5 text-xs text-slate-400 italic">
            No prompts match “{query}”
          </li>
        </ul>
      )}
    </div>
  );
};

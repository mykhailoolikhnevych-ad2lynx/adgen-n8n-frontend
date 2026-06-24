import React, { useState, useRef, useEffect } from "react";
import { CaretDown } from "@phosphor-icons/react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ComboboxProps {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;       // wrapper div
  inputClassName?: string;  // input element — passed through to Input
  error?: boolean;
  // For very large option sets (the MEGATOOL NB Accounts list = 400+),
  // gate the dropdown until the user has typed at least N characters so
  // clicking the field doesn't trigger a 100-item render that freezes
  // Chrome. Showing "Type at least N character(s) to search" hint instead.
  // Defaults to 0 (current behavior — show everything on open).
  minSearchChars?: number;
}

export const Combobox: React.FC<ComboboxProps> = ({
  value,
  onChange,
  options,
  placeholder,
  className,
  inputClassName,
  error,
  minSearchChars = 0,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // When minSearchChars is set and the query is shorter, suppress option
  // rendering entirely — render zero <li> elements. Otherwise filter by query
  // (empty query → full list). Cap rendered items to keep DOM cheap.
  const querySatisfied = query.length >= minSearchChars;
  const filteredAll = !querySatisfied
    ? []
    : query
      ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
      : options;
  // 20 is a deliberately tight cap — the dropdown is searchable, so the user
  // narrows further by typing. Bigger renders thrash low-end machines under
  // hover-paint storms (each <li> has hover:bg-slate-100).
  const MAX_RENDERED = 20;
  const filtered = filteredAll.slice(0, MAX_RENDERED);
  const hiddenCount = filteredAll.length - filtered.length;
  const showSearchHint = open && !querySatisfied && minSearchChars > 0;

  // What the input renders: while open we mirror the user's query; while closed we show the stored value.
  const displayValue = open ? query : value;

  const pick = (option: string) => {
    onChange(option);
    setOpen(false);
    setQuery("");
    // Blur the input so a subsequent click triggers a fresh onFocus → dropdown reopens.
    // Without this, the input retains focus (mouseDown preventDefault below) and onFocus never re-fires.
    const input = containerRef.current?.querySelector<HTMLInputElement>("input");
    input?.blur();
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Input
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onClick={() => {
          // If the input is already focused but the dropdown was closed (e.g. user picked
          // an option and clicked the field again), force re-open with a clean query.
          if (!open) {
            setOpen(true);
            setQuery("");
          }
        }}
        onChange={(e) => {
          // Typing should always reveal the dropdown with the typed query as the filter.
          if (!open) setOpen(true);
          setQuery(e.target.value);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
            e.currentTarget.blur();
          }
        }}
        className={cn(
          error && "border-red-500 focus-visible:ring-red-500",
          inputClassName,
          "pr-7", // keep right padding for chevron — must come after inputClassName so it wins
        )}
      />
      <CaretDown
        size={14}
        weight="bold"
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-900"
      />
      {showSearchHint && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg px-3 py-2 text-[11px] text-slate-500 select-none">
          Type at least {minSearchChars} character{minSearchChars === 1 ? '' : 's'} to search {options.length} options…
        </div>
      )}
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
        >
          {filtered.map((option) => (
            <li
              key={option}
              role="option"
              aria-selected={option === value}
              // onMouseDown fires BEFORE input blur, so the click actually picks the option
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              className={cn(
                "cursor-pointer px-3 py-1.5 text-xs hover:bg-slate-100",
                option === value && "bg-slate-50 font-semibold",
              )}
            >
              {option}
            </li>
          ))}
          {hiddenCount > 0 && (
            <li
              role="presentation"
              aria-hidden="true"
              className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 border-t border-slate-100 select-none"
            >
              …and {hiddenCount} more — keep typing to narrow
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

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
}

export const Combobox: React.FC<ComboboxProps> = ({
  value,
  onChange,
  options,
  placeholder,
  className,
  inputClassName,
  error,
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

  // Filter options: while open, by what the user typed (NOT by stored value).
  // Empty query → full list. This is the whole point — clicking always shows everything.
  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

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
        </ul>
      )}
    </div>
  );
};

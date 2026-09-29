import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

// Date + time in one field with a 24h clock. The native datetime-local input
// follows the OS locale (AM/PM on en-US Windows) and can't be forced to 24h.
// Value format matches datetime-local: "YYYY-MM-DDTHH:mm" (no timezone).

const pad2 = (n: number) => String(n).padStart(2, "0");
const dateStr = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** "YYYY-MM-DD" — earlier days are disabled. */
  minDate?: string;
  className?: string;
};

function TimeColumn({ items, selected, onPick }: { items: string[]; selected: string; onPick: (v: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Keep the selected value in view (scrollTop, not scrollIntoView — that would scroll the page too).
  React.useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-selected="true"]');
    if (ref.current && el) ref.current.scrollTop = el.offsetTop - ref.current.clientHeight / 2 + el.clientHeight / 2;
  }, [selected]);
  return (
    <div ref={ref} className="relative h-64 w-14 overflow-y-auto border-l">
      {items.map((v) => (
        <button
          key={v}
          type="button"
          data-selected={v === selected}
          onClick={() => onPick(v)}
          className={cn(
            "block w-full py-1 text-center text-sm hover:bg-slate-100",
            v === selected && "bg-blue-600 font-semibold text-white hover:bg-blue-600",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function DateTimePicker24h({ value, onChange, minDate, className }: Props) {
  const [open, setOpen] = React.useState(false);
  const datePart = value.slice(0, 10);
  const hour = value.slice(11, 13) || "00";
  const minute = value.slice(14, 16) || "00";

  const initial = datePart ? new Date(`${datePart}T00:00`) : new Date();
  const [view, setView] = React.useState({ y: initial.getFullYear(), m: initial.getMonth() });
  // Re-open on the selected month.
  React.useEffect(() => {
    if (open && datePart) {
      const d = new Date(`${datePart}T00:00`);
      setView({ y: d.getFullYear(), m: d.getMonth() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const cells = Array.from({ length: 42 }, (_, i) => new Date(view.y, view.m, 1 - lead + i));
  const todayStr = (() => { const t = new Date(); return dateStr(t.getFullYear(), t.getMonth(), t.getDate()); })();
  const shiftMonth = (delta: number) => setView(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const display = datePart
    ? `${datePart.slice(8, 10)}.${datePart.slice(5, 7)}.${datePart.slice(0, 4)} ${hour}:${minute}`
    : "";

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "mt-1 flex h-9 w-full items-center justify-between rounded-md border border-input bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring",
            className,
          )}
        >
          <span className={display ? "text-slate-900" : "text-slate-400"}>{display || "дд.мм.рррр гг:хх"}</span>
          <CalendarBlank className="h-4 w-4 text-slate-500" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 flex rounded-md border bg-white shadow-lg"
        >
          <div className="p-2">
            <div className="mb-1 flex items-center justify-between">
              <button type="button" onClick={() => shiftMonth(-1)} className="rounded p-1 hover:bg-slate-100">
                <CaretLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold">
                {first.toLocaleString("en-GB", { month: "short" })} {view.y}
              </span>
              <button type="button" onClick={() => shiftMonth(1)} className="rounded p-1 hover:bg-slate-100">
                <CaretRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-sm">
              {WEEKDAYS.map((w) => <div key={w} className="py-1 text-xs font-medium text-slate-500">{w}</div>)}
              {cells.map((d) => {
                const s = dateStr(d.getFullYear(), d.getMonth(), d.getDate());
                const disabled = !!minDate && s < minDate;
                const outside = d.getMonth() !== view.m;
                const selected = s === datePart;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(`${s}T${hour}:${minute}`);
                      if (outside) setView({ y: d.getFullYear(), m: d.getMonth() });
                    }}
                    className={cn(
                      "h-8 w-8 rounded",
                      outside ? "text-slate-400" : "text-slate-800",
                      !disabled && "hover:bg-slate-100",
                      s === todayStr && !selected && "font-semibold text-blue-600",
                      selected && "bg-blue-600 font-semibold text-white hover:bg-blue-600",
                      disabled && "cursor-not-allowed text-slate-300",
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col">
            <div className="border-b border-l px-2 py-2 text-center text-sm font-semibold">{hour}:{minute}</div>
            <div className="flex flex-1">
              <TimeColumn items={HOURS} selected={hour} onPick={(h) => datePart && onChange(`${datePart}T${h}:${minute}`)} />
              <TimeColumn items={MINUTES} selected={minute} onPick={(m) => datePart && onChange(`${datePart}T${hour}:${m}`)} />
            </div>
            <div className="border-l border-t p-2 text-right">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
              >
                OK
              </button>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

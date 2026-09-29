import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';
import { customStartError, formatInZone, toLocalInputValue } from '@/lib/nbStartTime';

/** Start Date = "Свій час": 24h picker in the PC's timezone + LA (NB) preview. */
export const NbCustomStartField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const error = customStartError(value);
  const ms = value ? new Date(value).getTime() : NaN;
  return (
    <div>
      <label className="text-xs font-medium uppercase text-slate-500">
        Start (ваш час · {Intl.DateTimeFormat().resolvedOptions().timeZone})
      </label>
      <DateTimePicker24h
        value={value}
        minDate={toLocalInputValue(new Date()).slice(0, 10)}
        onChange={onChange}
      />
      {error ? (
        <p className="text-xs text-red-600 mt-1">{error}</p>
      ) : Number.isFinite(ms) && (
        <p className="text-xs text-slate-600 mt-1">
          = <strong>{formatInZone(ms, 'America/Los_Angeles')}</strong> (час NewsBreak)
        </p>
      )}
    </div>
  );
};

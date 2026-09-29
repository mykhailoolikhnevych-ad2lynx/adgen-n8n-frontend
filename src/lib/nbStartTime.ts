// Custom NB start time, shared by Create NB Campaign and Newsbreak Copier.
// The operator picks a moment in their own PC timezone; NB runs on Los Angeles
// time (PDT/PST — Intl handles the DST switch), so the pages preview it there.

export const MIN_START_LEAD_MIN = 5;
const DEFAULT_LEAD_MIN = 10;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Date → "YYYY-MM-DDTHH:mm" in the PC's timezone. */
export const toLocalInputValue = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Prefill for the picker: actual time + 10 min. */
export const defaultCustomStart = () => toLocalInputValue(new Date(Date.now() + DEFAULT_LEAD_MIN * 60_000));

/** Unix seconds for the n8n `startTime` field. */
export const customStartToUnix = (customStart: string) => Math.floor(new Date(customStart).getTime() / 1000);

export const formatInZone = (ms: number, timeZone?: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  // en-GB renders LA as "GMT-7"; en-US gives the familiar "PDT"/"PST".
  const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')} ${zone}`;
};

export const customStartError = (customStart: string): string | null => {
  if (!customStart) return 'Оберіть дату й час старту';
  const ms = new Date(customStart).getTime();
  if (!Number.isFinite(ms)) return 'Невірна дата';
  if (ms < Date.now() + MIN_START_LEAD_MIN * 60_000) {
    return `Старт має бути щонайменше через ${MIN_START_LEAD_MIN} хв від поточного часу`;
  }
  return null;
};

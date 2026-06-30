// Distribute N ads across adsets following the NB Campaign rule: max 4 ads
// per adset, balanced as evenly as possible.
//
// Examples:
//   1..4 → [n]                       (single adset)
//   5    → [3, 2]
//   6    → [3, 3]
//   7    → [4, 3]
//   8    → [4, 4]
//   9    → [3, 3, 3]
//   10   → [4, 3, 3]
//   13   → [4, 3, 3, 3]              (ceil(13/4)=4 adsets, base 3, 1 gets +1)
export const MAX_ADS_PER_ADSET = 4;

export function splitIntoAdsets(n: number): number[] {
  if (n <= 0) return [];
  const numAdsets = Math.ceil(n / MAX_ADS_PER_ADSET);
  const base = Math.floor(n / numAdsets);
  const remainder = n % numAdsets;
  return Array.from({ length: numAdsets }, (_, i) => base + (i < remainder ? 1 : 0));
}

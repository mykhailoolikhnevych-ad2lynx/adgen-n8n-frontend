// Binom group catalog — mirror of the `binom_groups` n8n datatable.
// Each group belongs to a specific tracker (ilab.nnctrack.com or
// jaguars.nnctrack.com). Group names can repeat across trackers — they're
// different Binom installs with different UUIDs, so name alone isn't unique.

export interface BinomGroup {
  name: string;
  tracker: string;
}

export const BINOM_GROUPS: readonly BinomGroup[] = [
  // ilab.nnctrack.com
  { name: 'Iryna', tracker: 'ilab.nnctrack.com' },
  { name: 'Andriy_Spivak', tracker: 'ilab.nnctrack.com' },
  { name: 'Volodymyr', tracker: 'ilab.nnctrack.com' },
  { name: 'Igor_T', tracker: 'ilab.nnctrack.com' },
  { name: 'Inna', tracker: 'ilab.nnctrack.com' },
  { name: 'ILAB', tracker: 'ilab.nnctrack.com' },
  { name: 'Kateryna', tracker: 'ilab.nnctrack.com' },
  { name: 'Alena', tracker: 'ilab.nnctrack.com' },
  { name: 'Maksym_Chykolva', tracker: 'ilab.nnctrack.com' },
  { name: 'Ross', tracker: 'ilab.nnctrack.com' },
  { name: 'Vitaliy_Ostrovsiy', tracker: 'ilab.nnctrack.com' },
  { name: 'Marta_Ostrovskaya', tracker: 'ilab.nnctrack.com' },
  { name: 'Evheniy_Starynskiy', tracker: 'ilab.nnctrack.com' },
  { name: 'Ihor_Fedyniak', tracker: 'ilab.nnctrack.com' },
  { name: 'Eugene_Sulima', tracker: 'ilab.nnctrack.com' },
  { name: 'Andrey_Sharkov', tracker: 'ilab.nnctrack.com' },
  { name: 'Ihor_Kazan', tracker: 'ilab.nnctrack.com' },
  { name: 'Dmitriy_Kostenko', tracker: 'ilab.nnctrack.com' },
  { name: 'Alex_Yashchenko', tracker: 'ilab.nnctrack.com' },
  { name: 'Yaroslav_Kazan', tracker: 'ilab.nnctrack.com' },
  { name: 'Ilab_Native', tracker: 'ilab.nnctrack.com' },
  { name: 'taras.tychkivskyi', tracker: 'ilab.nnctrack.com' },
  { name: 'Volodymyr.Zvenyhorodskyi', tracker: 'ilab.nnctrack.com' },
  { name: 'ilab_e-commerce', tracker: 'ilab.nnctrack.com' },
  { name: 'Ilab_leadgen', tracker: 'ilab.nnctrack.com' },
  { name: 'Victoria', tracker: 'ilab.nnctrack.com' },
  { name: 'Victoria_Mustafaeva', tracker: 'ilab.nnctrack.com' },
  { name: 'Anastasiia_Hrachova', tracker: 'ilab.nnctrack.com' },
  { name: 'Mariana_Turkivska', tracker: 'ilab.nnctrack.com' },
  { name: 'Ilab_rsoc', tracker: 'ilab.nnctrack.com' },
  { name: 'Rnd', tracker: 'ilab.nnctrack.com' },
  { name: 'Kseniia_Kuchabska', tracker: 'ilab.nnctrack.com' },
  { name: 'Yurii_Kateryniuk', tracker: 'ilab.nnctrack.com' },
  { name: 'Solomiia_Kava', tracker: 'ilab.nnctrack.com' },
  { name: 'Lilia_Stanislavska', tracker: 'ilab.nnctrack.com' },
  { name: 'vladyslav_andrianov', tracker: 'ilab.nnctrack.com' },
  { name: 'diana_sverdan', tracker: 'ilab.nnctrack.com' },
  { name: 'sofiia_semeniv', tracker: 'ilab.nnctrack.com' },
  { name: 'sofiia_tomyn', tracker: 'ilab.nnctrack.com' },
  { name: 'FB_Autozalyv_Bangers', tracker: 'ilab.nnctrack.com' },
  { name: 'andrii.kuchabskyi', tracker: 'ilab.nnctrack.com' },
  { name: 'viktoriia.troian', tracker: 'ilab.nnctrack.com' },
  { name: 'vladyslav.vasiuta', tracker: 'ilab.nnctrack.com' },
  { name: 'ilona.ivaniv', tracker: 'ilab.nnctrack.com' },
  { name: 'oleksandr.svyryda', tracker: 'ilab.nnctrack.com' },
  { name: 'marta.havriutina', tracker: 'ilab.nnctrack.com' },
  { name: 'denys_podletskyi', tracker: 'ilab.nnctrack.com' },
  { name: 'Rnd-01', tracker: 'ilab.nnctrack.com' },
  { name: 'Rnd-tests', tracker: 'ilab.nnctrack.com' },
  { name: 'khrystyna.kleban', tracker: 'ilab.nnctrack.com' },

  // jaguars.nnctrack.com
  { name: 'ILAB', tracker: 'jaguars.nnctrack.com' },
  { name: 'Eugene_Sulima', tracker: 'jaguars.nnctrack.com' },
  { name: 'optimizer', tracker: 'jaguars.nnctrack.com' },
  { name: 'Victoria', tracker: 'jaguars.nnctrack.com' },
  { name: 'Igor_T', tracker: 'jaguars.nnctrack.com' },
  { name: 'Volodymyr', tracker: 'jaguars.nnctrack.com' },
  { name: 'Iryna', tracker: 'jaguars.nnctrack.com' },
  { name: 'Kateryna', tracker: 'jaguars.nnctrack.com' },
  { name: 'Maksym', tracker: 'jaguars.nnctrack.com' },
  { name: 'other', tracker: 'jaguars.nnctrack.com' },
  { name: 'Serhii', tracker: 'jaguars.nnctrack.com' },
  { name: 'Mykhailo', tracker: 'jaguars.nnctrack.com' },
  { name: 'Serhii_X', tracker: 'jaguars.nnctrack.com' },
  { name: 'Mykhailo_X', tracker: 'jaguars.nnctrack.com' },
  { name: 'Andrii_Tymkiv', tracker: 'jaguars.nnctrack.com' },
  { name: 'Nataliia_Vorobei', tracker: 'jaguars.nnctrack.com' },
  { name: 'Eugene_Ecom', tracker: 'jaguars.nnctrack.com' },
  { name: 'Igor_Ecom', tracker: 'jaguars.nnctrack.com' },
  { name: 'NB_Shared', tracker: 'jaguars.nnctrack.com' },
  { name: 'oleksii_kotliarevskyi', tracker: 'jaguars.nnctrack.com' },
  { name: 'Test Group', tracker: 'jaguars.nnctrack.com' },
];

// Trackers the user can target. Each Binom install lives at its own host.
export const BINOM_TRACKERS = [
  'ilab.nnctrack.com',
  'jaguars.nnctrack.com',
] as const;
export type BinomTracker = typeof BINOM_TRACKERS[number];
export const DEFAULT_BINOM_TRACKER: BinomTracker = 'ilab.nnctrack.com';

// AMO landing-page domain → Binom install. The source ad's trackingUrl points
// at the AMO page (e.g. perabianco.com), and each AMO domain belongs to one
// Binom tracker — so we can auto-pick the tracker from the URL. Add new
// mappings here as more AMO domains come online.
export const AMO_DOMAIN_TO_TRACKER: Record<string, BinomTracker> = {
  'perabianco.com': 'ilab.nnctrack.com',
  'pancettafuns.com': 'jaguars.nnctrack.com',
};

// Resolve a trackingUrl to its Binom tracker via AMO_DOMAIN_TO_TRACKER.
// Returns null if the URL is missing, unparseable, or the host isn't in the
// map yet — the UI keeps its current selection in that case.
export function getTrackerFromTrackingUrl(
  url: string | null | undefined,
): BinomTracker | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return AMO_DOMAIN_TO_TRACKER[host] ?? null;
  } catch {
    return null;
  }
}

// Group names belonging to `tracker`. Always prepends "same" as the first
// option. If `tracker` doesn't match any row, falls back to every known name
// (de-duped) so we never end up with an empty dropdown.
export function getGroupNamesForTracker(tracker: string | null | undefined): string[] {
  const matches = tracker
    ? BINOM_GROUPS.filter((g) => g.tracker === tracker).map((g) => g.name)
    : [];
  const source = matches.length > 0 ? matches : BINOM_GROUPS.map((g) => g.name);
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const n of source) {
    if (!seen.has(n)) {
      seen.add(n);
      dedup.push(n);
    }
  }
  return ['same', ...dedup];
}

// AMO domain options for the Binom Offer Creator. "same" keeps the original
// AMO domain from the source ad; the rest mirror common domains pulled from
// apps_script/csv with fb - Copy of List.csv (Domains Amo column).
export const BINOM_AMO_DOMAINS = [
  'same',
  'walletilo.com',
  'contranoche.com',
  'contradia.com',
  'healthquix.com',
  'geeksstory.com',
  'finomira.com',
  'fintreat.com',
  'healquix.com',
] as const;

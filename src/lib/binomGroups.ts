// BINOM_GROUP_NAMES is hardcoded until the server-side table is wired up.
// Swap to a live fetch once the backend exposes an endpoint for it.
export const BINOM_GROUP_NAMES = [
  'same',
  'ILAB',
  'Rnd',
  'Alex_Yashchenko',
  'Andrey_Sharkov',
  'Dmitriy_Kostenko',
  'Igor_T',
  'Ihor_Kazan',
  'Ilab_Native',
  'Ilab_rsoc',
  'Mariana_Turkivska',
  'Ross',
  'Volodymyr.Zvenyhorodskyi',
  'Yaroslav_Kazan',
  'Anastasiia_Hrachova',
] as const;

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

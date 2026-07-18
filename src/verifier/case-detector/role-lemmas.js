// W1/W3 (W1-W3-MORPHOLOGY-DESIGN.md §1.8/§3.2): open catalog of procedural
// role lemmas. Two consumers by design: the W1 compiler selects these
// lexemes from SGJP into the `role` section of morph-pl.json (full singular
// paradigms — compiled, not hand-written), and W3's apposition signal (S-A)
// walks the compiled paradigms via the reverse index. This file carries
// ONLY lemma strings — no forms, no data derived from any external dataset.
export const ROLE_LEMMAS = [
  'powód', 'powódka', 'pozwany', 'pozwana', 'wnioskodawca', 'wnioskodawczyni',
  'uczestnik', 'uczestniczka', 'dłużnik', 'dłużniczka', 'wierzyciel',
  'kredytobiorca', 'kredytobiorczyni', 'pożyczkobiorca', 'pełnomocnik',
  'świadek', 'biegły', 'komornik', 'spadkobierca', 'najemca', 'wynajmujący',
  'zamawiający', 'wykonawca', 'oskarżony', 'pokrzywdzony', 'podejrzany',
  'obwiniony', 'upadły', 'sędzia', 'referendarz', 'prokurator', 'notariusz',
  'radca', 'adwokat', 'mecenas', 'przewodniczący', 'ubezpieczyciel',
  'ubezpieczony', 'poręczyciel', 'zleceniodawca', 'zleceniobiorca',
  'kredytodawca', 'pożyczkodawca',
  // Gate condition added at the W1 design gate (2026-07-12, FLEKSJA-IMPL-
  // PLAN.md SS0/SS12 O-FL-1): consumer/business-party/injured-party/generic
  // "strona" roles, missing from the original W1-W3-MORPHOLOGY-DESIGN.md
  // SS1.8 list.
  'konsument', 'przedsiębiorca', 'poszkodowany', 'strona',
];

// Skróty, po których następuje rzeczownik (zwykle własny).
// Scalaj ZAWSZE, niezależnie od wielkości litery następnego słowa.
export const CAT_A = new Set([
  // Tytuły/zawody
  'adw.', 'apl.', 'mec.', 'prof.', 'inż.', 'lek.', 'med.',
  'por.', 'kpt.', 'ks.', 'o.', 'św.', 'p.',
  'rad.',
  // B4-lite (RECALL-90-DESIGN.md §2.4): protects the trailing dot of role/
  // title abbreviations the lexicon matches as multi-token spans written
  // with an internal space ("r. pr.", "sekr. sąd.") — trimTrailingPunctuationStep
  // only consults the LAST whitespace-delimited token of a matched span, so
  // "r.pr." alone (below) doesn't cover the spaced variant's own last token.
  'pr.', 'sąd.', 'radc.',
  // Wielowyrazowe
  'r.pr.',
  // Adresowe
  'ul.', 'al.', 'pl.', 'os.', 'gm.', 'pow.', 'woj.', 'm.st.',
  'im.', 'pn.',
  'zam.',
  // Łączniki do rzeczownika (nigdy nie kończą zdania)
  'ds.', 'm.in.', 'tj.', 'tzw.', 'tzn.', 'np.',
  // Label-only (zawsze poprzedzają wartość, nigdy końca zdania)
  'tel.', 'sygn.', 'rep.',
]);

// Skróty, które mogą legalnie kończyć zdanie.
// Scalaj TYLKO gdy następny segment zaczyna się małą literą (lub cyfrą).
export const CAT_B = new Set([
  // Prawne
  'art.', 'ust.', 'pkt.', 'lit.', 'par.', 'rozdz.', 'zał.',
  'dz.u.', 'dz.urz.', 'poz.', 'zob.',
  'k.c.', 'k.k.', 'k.p.', 'k.p.c.', 'k.p.k.',
  // Daty/czas
  'r.', 'w.', 'p.n.e.', 'n.e.',
  'godz.', 'min.', 'sek.', 'ok.',
  'pon.', 'wt.', 'czw.', 'pt.', 'sob.', 'niedz.',
  // Ogólne
  'itp.', 'itd.',
  'ww.', 'cd.', 'cdn.', 'br.', 'bm.', 'ub.r.',
  'obr.',
  // Firmy
  'sp.', 'z o.o.', 'o.o.', 's.a.', 'p.p.', 'p.o.', 'spółdz.',
  // Inne
  'ob.', 'zw.',
]);

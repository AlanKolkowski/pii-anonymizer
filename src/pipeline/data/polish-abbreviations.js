// Skróty, po których następuje rzeczownik (zwykle własny).
// Scalaj ZAWSZE, niezależnie od wielkości litery następnego słowa.
export const CAT_A = new Set([
  // Tytuły/zawody
  'adw.', 'apl.', 'mec.', 'prof.', 'inż.', 'lek.', 'med.',
  'por.', 'kpt.', 'ks.', 'o.', 'św.', 'p.',
  // Wielowyrazowe
  'r.pr.',
  // Adresowe
  'ul.', 'al.', 'pl.', 'os.', 'gm.', 'pow.', 'woj.', 'm.st.',
  'im.', 'pn.',
]);

// Skróty, które mogą legalnie kończyć zdanie.
// Scalaj TYLKO gdy następny segment zaczyna się małą literą (lub cyfrą).
export const CAT_B = new Set([
  // Prawne
  'art.', 'ust.', 'pkt.', 'lit.', 'par.', 'rozdz.', 'zał.',
  'dz.u.', 'dz.urz.', 'rep.', 'poz.', 'sygn.', 'zob.',
  // Daty/czas
  'r.', 'w.', 'p.n.e.', 'n.e.',
  'godz.', 'min.', 'sek.', 'ok.',
  'pon.', 'wt.', 'czw.', 'pt.', 'sob.', 'niedz.',
  // Ogólne
  'tj.', 'tzn.', 'tzw.', 'np.', 'm.in.', 'itp.', 'itd.',
  'ww.', 'cd.', 'cdn.', 'br.', 'bm.', 'ub.r.', 'ds.',
  // Firmy
  'sp.', 'z o.o.', 'o.o.', 's.a.', 'p.p.', 'p.o.', 'spółdz.',
  // Inne
  'tel.', 'ob.', 'zw.',
]);

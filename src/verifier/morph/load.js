// W1 (W1-W3-MORPHOLOGY-DESIGN.md §1.6): loader for the compiled morphology
// artifact `morph-pl.json`. Pure JSON → structures; zero I/O here — the
// bundler (or the resources path, per the §1.5 size decision) imports the
// artifact and hands it in. Reverse indexes are built in memory at load
// time: memory cost instead of artifact size.
//
// Fail-closed: a wrong format version, a missing section or a wrong type
// throws — the flexion engine reports "dane niedostępne" instead of ever
// guessing without data (§2.1).

export const MORPH_FORMAT_VERSION = 'morph-pl/1';

function fail(reason) {
  throw new Error(`morph-pl: ${reason}`);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`sekcja "${name}" ma zły typ`);
  return value;
}

export function loadMorphData(json) {
  const root = assertPlainObject(json, 'root');
  const meta = assertPlainObject(root.meta, 'meta');
  if (meta.wersjaFormatu !== MORPH_FORMAT_VERSION) {
    fail(`nieznana wersja formatu: ${JSON.stringify(meta.wersjaFormatu)}`);
  }

  const imionaRaw = assertPlainObject(root.imiona, 'imiona');
  const nazwiskaRaw = assertPlainObject(root.nazwiska, 'nazwiska');
  const roleRaw = assertPlainObject(root.role, 'role');

  const imiona = new Map();
  for (const [name, entry] of Object.entries(imionaRaw)) {
    const { rodzaj, paradygmat = null, frek = 0 } = assertPlainObject(entry, `imiona.${name}`);
    if (!['m', 'f', 'm/f'].includes(rodzaj)) fail(`imiona.${name}: zły rodzaj`);
    if (paradygmat !== null) assertPlainObject(paradygmat, `imiona.${name}.paradygmat`);
    imiona.set(name.toLocaleLowerCase('pl'), { rodzaj, paradygmat, frek });
  }

  const nazwiskaWyjatki = new Map();
  for (const [lemma, entry] of Object.entries(nazwiskaRaw)) {
    const parsed = assertPlainObject(entry, `nazwiska.${lemma}`);
    assertPlainObject(parsed.formy, `nazwiska.${lemma}.formy`);
    nazwiskaWyjatki.set(lemma, { formy: parsed.formy, warianty: Boolean(parsed.warianty) });
  }

  const role = new Map();
  for (const [lemma, paradygmat] of Object.entries(roleRaw)) {
    role.set(lemma, assertPlainObject(paradygmat, `role.${lemma}`));
  }

  // Reverse index: inflected form (lower) → [{ lemat, sekcja, przypadki }]
  const formaDoLematu = new Map();
  const index = (forma, wpis) => {
    const key = forma.toLocaleLowerCase('pl');
    if (!formaDoLematu.has(key)) formaDoLematu.set(key, []);
    formaDoLematu.get(key).push(wpis);
  };
  for (const [name, entry] of imiona) {
    if (!entry.paradygmat) {
      index(name, { lemat: name, sekcja: 'imiona', przypadki: ['M'] });
      continue;
    }
    for (const [przypadek, forma] of Object.entries(entry.paradygmat)) {
      if (typeof forma === 'string') index(forma, { lemat: name, sekcja: 'imiona', przypadki: [przypadek] });
    }
  }
  for (const [lemma, entry] of nazwiskaWyjatki) {
    for (const [przypadek, formy] of Object.entries(entry.formy)) {
      for (const forma of Array.isArray(formy) ? formy : [formy]) {
        if (typeof forma === 'string') index(forma, { lemat: lemma, sekcja: 'nazwiska', przypadki: [przypadek] });
      }
    }
  }
  for (const [lemma, paradygmat] of role) {
    for (const [przypadek, forma] of Object.entries(paradygmat)) {
      if (typeof forma === 'string') index(forma, { lemat: lemma, sekcja: 'role', przypadki: [przypadek] });
    }
  }

  return {
    imiona,
    nazwiskaWyjatki,
    role,
    formaDoLematu,
    meta: { wersjaFormatu: meta.wersjaFormatu, zrodla: meta.zrodla ?? {} },
  };
}

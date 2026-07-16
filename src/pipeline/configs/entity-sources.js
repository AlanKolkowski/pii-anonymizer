// `backends` is the ordered list of inference backends a source can run on.
// First entry = preferred when available; later entries = fallbacks.
// q8 is wasm-only because ORT-Web's WebNN EP doesn't broadcast `scale` to
// input rank for per-tensor int8 dequantize and MLGraphBuilder rejects the
// rank mismatch. fp16/fp32 run on either; we prefer GPU when available.
//
// `sizeBytes` is the exact ONNX artifact size reported by the Hugging Face
// model tree. `sizeMB` is rounded-up decimal MB for bench labels and WASM
// eviction accounting; ORT heap/scratch overhead is handled by the worker's
// conservative MEMORY_BUDGET_MB rather than by inflating model sizes here.
const mb = (bytes) => Math.ceil(bytes / 1_000_000);

// Desktop (Electron) builds override the ONNX artifact variant — default q8
// (INT8, onnx/model_quantized.onnx) — to keep the installer small. sizeBytes
// is zeroed because it described the web variant; the original sizeMB is kept
// as a conservative over-estimate for WASM-heap eviction accounting. q8 forces
// wasm-only backends (see the WebNN note above).
// In Node (eval) import.meta.env does not exist, so the same variable is also
// honored from process.env — this lets `VITE_MODEL_DTYPE=q8 npm run eval`
// measure the exact artifact the desktop build ships (EVAL-RECALL-AUDIT §8 A10).
const DTYPE_OVERRIDE = import.meta.env?.VITE_MODEL_DTYPE
  || (typeof process !== 'undefined' ? process.env?.VITE_MODEL_DTYPE : null)
  || null;

function withDtypeOverride(sources) {
  if (!DTYPE_OVERRIDE) return sources;
  const out = {};
  for (const [alias, def] of Object.entries(sources)) {
    out[alias] = def.kind === 'hf'
      ? {
          ...def,
          dtype: DTYPE_OVERRIDE,
          sizeBytes: 0,
          backends: DTYPE_OVERRIDE.startsWith('q') || DTYPE_OVERRIDE.includes('int8') ? ['wasm'] : def.backends,
        }
      : def;
  }
  return out;
}

export const SOURCES = withDtypeOverride({
  'multilang-fp32': { kind: 'hf', id: 'wjarka/eu-pii-anonimization-multilang', dtype: 'fp32', sizeBytes: 1110246874, sizeMB: mb(1110246874), backends: ['webnn-gpu', 'wasm'] },
  'polish-fp16':    { kind: 'hf', id: 'wjarka/eu-pii-anonimization-pl',        dtype: 'fp16', sizeBytes: 555323817,  sizeMB: mb(555323817),  backends: ['webnn-gpu', 'wasm'] },
  'regex':          { kind: 'regex' },
  'lexicon':        { kind: 'lexicon' },
  // B2 (RECALL-90-DESIGN.md §2.2): not a model of its own — createCaseFoldedNerStep
  // reuses multilang-fp32/polish-fp16 directly (see configs/default.js) and
  // relabels their output. Registered here only so requiredSources()/
  // snapshotConfig() (src/eval/run.js) can resolve and document it like any
  // other source; resolveActiveSources()'s kind switch has no branch for it
  // on purpose — the step self-gates on segment content, not an active flag
  // computed from this registry (see createCaseFoldedNerStep's own doc comment).
  'case-folded':    { kind: 'case-folded' },
  // ST-5 (SCOPE-TIERS-DESIGN.md §5.2): deterministic matcher over the user's
  // own case-signature allowlist — no model, no download. Registered like
  // 'case-folded' so requiredSources()/snapshotConfig() can resolve it;
  // resolveActiveSources()'s kind switch has no branch on purpose — the step
  // self-gates on a non-empty allowlist passed through configure.
  'case-allowlist': { kind: 'case-allowlist' },
});

export const ENTITY_SOURCES = {
  // B2 (RECALL-90-DESIGN.md §2.2): 'case-folded' added to its five contract
  // types below (PERSON_NAME, ORGANIZATION_NAME, POSTAL_ADDRESS, LOCATION,
  // PERSON_ROLE_OR_TITLE) for the same reason B3/B4-lite's 'lexicon' entries
  // are — sourceFilterStep drops any candidate whose source isn't listed
  // here for its type, regardless of score, so omitting it would silently
  // discard every candidate createCaseFoldedNerStep emits.
  PERSON_NAME:              ['multilang-fp32', 'case-folded'],
  DATE_OF_BIRTH:            ['polish-fp16'],
  PERSON_ATTRIBUTE:         ['multilang-fp32'],
  PERSON_ALIAS:             ['polish-fp16'],
  PERSON_IDENTIFIER:        ['multilang-fp32', 'regex'],
  // B4-lite (RECALL-90-DESIGN.md §2.4): 'lexicon' added alongside multilang-fp32.
  // PERSON_ROLE_OR_TITLE is weight 1 (type-weights.js) — below the A8 safety-net
  // threshold (weight >=4) — so a source NOT listed here is dropped outright by
  // sourceFilterStep regardless of score. Omitting 'lexicon' here would silently
  // discard every candidate the new step emits.
  PERSON_ROLE_OR_TITLE:     ['multilang-fp32', 'lexicon', 'case-folded'],
  ORGANIZATION_NAME:        ['polish-fp16', 'multilang-fp32', 'case-folded'],
  ORGANIZATION_IDENTIFIER:  ['multilang-fp32', 'regex'],
  EMAIL_ADDRESS:            ['polish-fp16', 'regex'],
  PHONE_NUMBER:             ['polish-fp16', 'regex'],
  CONTACT_HANDLE:           ['polish-fp16'],
  POSTAL_ADDRESS:           ['polish-fp16', 'case-folded'],
  LOCATION:                 ['polish-fp16', 'case-folded'],
  GEO_LOCATION:             ['polish-fp16'],
  IP_ADDRESS:               ['polish-fp16'],
  DEVICE_IDENTIFIER:        ['multilang-fp32'],
  COOKIE_IDENTIFIER:        ['polish-fp16'],
  ACCOUNT_IDENTIFIER:       ['polish-fp16'],
  AUTH_SECRET:              ['polish-fp16'],
  BANK_ACCOUNT_IDENTIFIER:  ['polish-fp16', 'regex'],
  PAYMENT_CARD:             ['polish-fp16'],
  PAYMENT_CARD_SECURITY:    ['polish-fp16'],
  // ST-5 (SCOPE-TIERS-DESIGN.md §5.2 pkt 3): 'case-allowlist' alias for the
  // user's own case signatures — same trap as B3/B4-lite/B2 entries above:
  // sourceFilterStep drops any candidate whose source isn't listed for its
  // type, regardless of score, so omitting it would silently discard every
  // candidate createCaseAllowlistStep emits.
  DOCUMENT_REFERENCE:       ['multilang-fp32', 'polish-fp16', 'regex', 'case-allowlist'],
  FINANCIAL_AMOUNT:         ['multilang-fp32', 'polish-fp16', 'regex'],
  INCOME_COMPENSATION:      ['polish-fp16'],
  VEHICLE_IDENTIFIER:       ['polish-fp16', 'regex'],
  // B3 (RECALL-90-DESIGN.md §2.3): 'lexicon' added alongside the model for
  // the three proven-leak categories (EVAL-RECALL-AUDIT.md #2/#11/#30) plus
  // the remaining art. 9 categories below — same reasoning as B4-lite's
  // PERSON_ROLE_OR_TITLE comment above: these are all weight 5
  // (type-weights.js), well above the A8 safety-net floor, but a source not
  // listed here is still dropped outright by sourceFilterStep regardless of
  // score, so omitting 'lexicon' would silently discard every candidate the
  // new step emits. Landed incrementally, one category per commit
  // (feature/recall-b3), as special-category-lexicon.json grew.
  HEALTH_DATA:              ['multilang-fp32', 'lexicon'], // The only model that catches all
  GENETIC_DATA:             ['polish-fp16'],
  BIOMETRIC_DATA:           ['polish-fp16'],
  RELIGION_OR_BELIEF:       ['polish-fp16', 'lexicon'],
  POLITICAL_OPINION:        ['polish-fp16', 'lexicon'],
  SEXUAL_ORIENTATION:       ['polish-fp16', 'lexicon'],
  TRADE_UNION_MEMBERSHIP:   ['polish-fp16', 'lexicon'],
  ETHNIC_ORIGIN:            ['polish-fp16', 'lexicon'],
  CRIMINAL_OFFENCE_DATA:    ['polish-fp16', 'lexicon'],
};

export const ENTITY_LABELS = {
  PERSON_NAME:              'Imię i nazwisko',
  DATE_OF_BIRTH:            'Data urodzenia',
  PERSON_ATTRIBUTE:         'Cechy osobowe',
  PERSON_ALIAS:             'Pseudonim',
  PERSON_IDENTIFIER:        'Identyfikator (PESEL, NIP)',
  PERSON_ROLE_OR_TITLE:     'Stanowisko / rola',
  ORGANIZATION_NAME:        'Nazwa organizacji',
  ORGANIZATION_IDENTIFIER:  'NIP, KRS, REGON',
  EMAIL_ADDRESS:            'Adres email',
  PHONE_NUMBER:             'Numer telefonu',
  CONTACT_HANDLE:           'Identyfikator komunikatora',
  POSTAL_ADDRESS:           'Adres pocztowy',
  LOCATION:                 'Miejscowość, region',
  GEO_LOCATION:             'Współrzędne GPS',
  IP_ADDRESS:               'Adres IP',
  DEVICE_IDENTIFIER:        'MAC, IMEI',
  COOKIE_IDENTIFIER:        'Cookie ID',
  ACCOUNT_IDENTIFIER:       'Numer konta użytkownika',
  AUTH_SECRET:              'Hasło, klucz API',
  BANK_ACCOUNT_IDENTIFIER:  'IBAN',
  PAYMENT_CARD:             'Numer karty',
  PAYMENT_CARD_SECURITY:    'CVV, data ważności',
  DOCUMENT_REFERENCE:       'Numer faktury',
  FINANCIAL_AMOUNT:         'Kwota',
  INCOME_COMPENSATION:      'Wynagrodzenie',
  VEHICLE_IDENTIFIER:       'Numer rejestracyjny, VIN',
  HEALTH_DATA:              'Dane medyczne',
  GENETIC_DATA:             'Dane genetyczne',
  BIOMETRIC_DATA:           'Dane biometryczne',
  RELIGION_OR_BELIEF:       'Wyznanie',
  POLITICAL_OPINION:        'Poglądy polityczne',
  SEXUAL_ORIENTATION:       'Orientacja seksualna',
  TRADE_UNION_MEMBERSHIP:   'Przynależność do związków',
  ETHNIC_ORIGIN:            'Pochodzenie etniczne',
  CRIMINAL_OFFENCE_DATA:    'Dane karne',
};

// Employment (docs category 8) is omitted because its only entity
// (PERSON_ROLE_OR_TITLE) already appears in Tożsamość.
export const ENTITY_CATEGORIES = [
  { id: 'personal-identity',     label: 'Tożsamość',                    entities: ['PERSON_NAME', 'DATE_OF_BIRTH', 'PERSON_ATTRIBUTE', 'PERSON_ALIAS', 'PERSON_IDENTIFIER', 'PERSON_ROLE_OR_TITLE'] },
  { id: 'organizations',         label: 'Organizacje',                  entities: ['ORGANIZATION_NAME', 'ORGANIZATION_IDENTIFIER'] },
  { id: 'contact-location',      label: 'Kontakt i lokalizacja',        entities: ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'CONTACT_HANDLE', 'POSTAL_ADDRESS', 'LOCATION', 'GEO_LOCATION'] },
  { id: 'technical-identifiers', label: 'Identyfikatory techniczne',    entities: ['IP_ADDRESS', 'DEVICE_IDENTIFIER', 'COOKIE_IDENTIFIER', 'ACCOUNT_IDENTIFIER', 'AUTH_SECRET'] },
  { id: 'financial',             label: 'Finanse',                      entities: ['BANK_ACCOUNT_IDENTIFIER', 'PAYMENT_CARD', 'PAYMENT_CARD_SECURITY', 'DOCUMENT_REFERENCE', 'FINANCIAL_AMOUNT', 'INCOME_COMPENSATION', 'VEHICLE_IDENTIFIER'] },
  { id: 'health-biometric',      label: 'Zdrowie i biometria',          entities: ['HEALTH_DATA', 'GENETIC_DATA', 'BIOMETRIC_DATA'] },
  { id: 'special-categories',    label: 'Kategorie szczególne',         entities: ['RELIGION_OR_BELIEF', 'POLITICAL_OPINION', 'SEXUAL_ORIENTATION', 'TRADE_UNION_MEMBERSHIP', 'ETHNIC_ORIGIN', 'CRIMINAL_OFFENCE_DATA'] },
];

// Art. 9-10 RODO (zdrowie/biometria + kategorie szczególne: wyznanie, poglądy,
// orientacja, przynależność związkowa, pochodzenie etniczne, dane karne) są
// WŁĄCZONE domyślnie — decyzja 20/A12 (PRODUCT-DECISIONS.md), zamyka ustalenie α
// audytu recall (EVAL-RECALL-AUDIT §7.7). Przy pustym localStorage aplikacja
// startuje właśnie z tego zbioru (defaultEnabledEntities() w main.js), a w
// praktyce ZUS-owej/karnej/pracowniczej to najcięższe dane; nadmiar maskowania
// jest odwracalny, przeciek do LLM-a nie. Koszt zerowy: HEALTH_DATA używa
// multilang-fp32, reszta polish-fp16 — oba modele są już wymagane przez
// kategorie tożsamości/kontaktu, więc requiredSources się nie zmienia (przybite
// testem "adds no new model source").
export const DEFAULT_ENABLED_CATEGORIES = [
  'personal-identity', 'organizations', 'contact-location',
  'technical-identifiers', 'financial',
  'health-biometric', 'special-categories',
];

export function allEntityTypes() {
  return Object.keys(ENTITY_SOURCES);
}

export function defaultEnabledEntities() {
  const out = [];
  for (const cat of ENTITY_CATEGORIES) {
    if (DEFAULT_ENABLED_CATEGORIES.includes(cat.id)) {
      out.push(...cat.entities);
    }
  }
  return out;
}

export function requiredSources(enabledEntities) {
  const set = new Set();
  for (const type of enabledEntities) {
    const sources = ENTITY_SOURCES[type];
    if (!sources) continue;
    for (const s of sources) set.add(s);
  }
  return [...set];
}

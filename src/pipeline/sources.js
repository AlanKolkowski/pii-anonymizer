export const SOURCE_MARKERS = {
  'bardsai/eu-pii-anonimization-multilang': '¹',
  'bardsai/eu-pii-anonimization': '²',
  regex: 'ʳ',
  rescan: 'ᵇ',
};

export const SOURCE_LABELS = {
  'bardsai/eu-pii-anonimization-multilang': 'bardsai/eu-pii-anonimization-multilang',
  'bardsai/eu-pii-anonimization': 'bardsai/eu-pii-anonimization',
  regex: 'regex (built-in patterns)',
  rescan: 'rescan (backfill of known values)',
};

export function sourcesToArray(source) {
  if (source == null) return [];
  return Array.isArray(source) ? source : [source];
}

export function unionSources(a, b) {
  const seen = new Set();
  const out = [];
  for (const s of [...sourcesToArray(a), ...sourcesToArray(b)]) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

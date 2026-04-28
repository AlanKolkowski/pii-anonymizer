export const SOURCE_MARKERS = {
  'wjarka/eu-pii-anonimization-multilang': '¹',
  'wjarka/eu-pii-anonimization-pl': '²',
  regex: 'ʳ',
  rescan: 'ᵇ',
};

export const SOURCE_LABELS = {
  'wjarka/eu-pii-anonimization-multilang': 'wjarka/eu-pii-anonimization-multilang (mirror of bardsai/eu-pii-anonimization-multilang)',
  'wjarka/eu-pii-anonimization-pl': 'wjarka/eu-pii-anonimization-pl (mirror of bardsai/eu-pii-anonimization)',
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

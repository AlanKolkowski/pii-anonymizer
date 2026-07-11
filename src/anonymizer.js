import { findTokens } from './tokens.js';
import { resolveOccurrences, renderResolvedText } from './substitution.js';

const INFLECTION_SUFFIXES = ['a', 'ą', 'ę', 'em', 'owi', 'u', 'ie'];
const ADJECTIVAL_SURNAME_FAMILIES = [
  { lemma: 'ski', forms: ['ski', 'skiego', 'skiemu', 'skim', 'skich'] },
  { lemma: 'ska', forms: ['ska', 'skiej', 'ską'] },
  { lemma: 'cki', forms: ['cki', 'ckiego', 'ckiemu', 'ckim', 'ckich'] },
  { lemma: 'cka', forms: ['cka', 'ckiej', 'cką'] },
  { lemma: 'dzki', forms: ['dzki', 'dzkiego', 'dzkiemu', 'dzkim', 'dzkich'] },
  { lemma: 'dzka', forms: ['dzka', 'dzkiej', 'dzką'] },
];

function adjectivalSurnameStem(word) {
  for (const family of ADJECTIVAL_SURNAME_FAMILIES) {
    for (const form of family.forms) {
      if (word.endsWith(form) && word.length > form.length) {
        return { family: family.lemma, stem: word.slice(0, -form.length) };
      }
    }
  }
  return null;
}

function sameAdjectivalSurnameForm(a, b) {
  const left = adjectivalSurnameStem(a);
  const right = adjectivalSurnameStem(b);
  if (!left || !right) return null;
  return left.family === right.family && left.stem === right.stem;
}

function inflectionStems(word) {
  const stems = new Set([word]);
  for (const suffix of INFLECTION_SUFFIXES) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) {
      stems.add(word.slice(0, -suffix.length));
    }
  }
  if (word.endsWith('ek') && word.length > 4) {
    stems.add(`${word.slice(0, -2)}k`);
  }
  if (word.endsWith('ka') && word.length > 4) {
    stems.add(word.slice(0, -1));
  }
  if (word.endsWith('kiem') && word.length > 6) {
    stems.add(`${word.slice(0, -4)}k`);
  }
  return stems;
}

function hasSharedInflectionStem(a, b) {
  const left = inflectionStems(a);
  const right = inflectionStems(b);
  for (const stem of left) {
    if (stem.length >= 3 && right.has(stem)) return true;
  }
  return false;
}

function wordsMatch(w1, w2) {
  const a = w1.toLowerCase();
  const b = w2.toLowerCase();
  if (a === b) return true;

  const surnameMatch = sameAdjectivalSurnameForm(a, b);
  if (surnameMatch !== null) return surnameMatch;

  return hasSharedInflectionStem(a, b);
}

export function couldBeSamePerson(name1, name2) {
  const words1 = name1.split(/\s+/);
  const words2 = name2.split(/\s+/);

  if (words1.length === words2.length) {
    return words1.every((w, i) => wordsMatch(w, words2[i]));
  }

  // Different word count: check if all words of the shorter name
  // match a subset of the longer name's words
  const [shorter, longer] =
    words1.length < words2.length ? [words1, words2] : [words2, words1];

  const used = new Set();
  for (const sw of shorter) {
    let found = false;
    for (let i = 0; i < longer.length; i++) {
      if (!used.has(i) && wordsMatch(sw, longer[i])) {
        used.add(i);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function createNameNormalizer() {
  const groups = [];

  return function (name) {
    for (const group of groups) {
      if (couldBeSamePerson(name, group.canonical)) {
        return group.canonical;
      }
    }
    groups.push({ canonical: name });
    return name;
  };
}

function ingestSource({ text, entities }, state) {
  for (const entity of entities) {
    const value = text.slice(entity.start, entity.end);
    const type = entity.entity_group;
    let normalizedValue = value;
    if (type === 'PERSON_NAME') {
      normalizedValue = state.normalizeName(value);
    } else if (type === 'ORGANIZATION_NAME') {
      normalizedValue = value.toLowerCase();
    }
    const canonicalKey = `${type}::${normalizedValue}`;

    if (!state.seen[canonicalKey]) {
      let token;
      do {
        state.counters[type] = (state.counters[type] || 0) + 1;
        token = `[${type}_${state.counters[type]}]`;
      } while (state.reserved.has(token));
      state.seen[canonicalKey] = token;
      state.legend[token] = value;
    }

    const rawKey = `${type}::${value}`;
    if (rawKey !== canonicalKey) {
      state.seen[rawKey] = state.seen[canonicalKey];
    }
  }
}

function collectReservedTokens(texts) {
  const reserved = new Set();
  for (const text of texts) {
    if (!text) continue;
    for (const t of findTokens(text)) reserved.add(t.token);
  }
  return reserved;
}
export function buildTokenMap(entities, originalText) {
  const state = {
    counters: {},
    seen: {},
    legend: {},
    normalizeName: createNameNormalizer(),
    reserved: collectReservedTokens([originalText]),
  };
  ingestSource({ text: originalText, entities }, state);
  return { seen: state.seen, legend: state.legend };
}

export function buildTokenMapMulti(sources) {
  const state = {
    counters: {},
    seen: {},
    legend: {},
    normalizeName: createNameNormalizer(),
    reserved: collectReservedTokens(sources.map((s) => s.text)),
  };
  for (const source of sources) ingestSource(source, state);
  return { seen: state.seen, legend: state.legend };
}

export function applyTokens(text, entities, seen) {
  const positionsSeen = new Set();
  const unique = [];
  for (const entity of entities) {
    const posKey = `${entity.start}:${entity.end}`;
    if (!positionsSeen.has(posKey)) {
      positionsSeen.add(posKey);
      unique.push(entity);
    }
  }
  unique.sort((a, b) => b.start - a.start);

  let result = text;
  for (const entity of unique) {
    const value = text.slice(entity.start, entity.end);
    const key = `${entity.entity_group}::${value}`;
    const token = seen[key];
    result = result.slice(0, entity.start) + token + result.slice(entity.end);
  }
  return result;
}

export function anonymizeText(text, entities) {
  const { seen, legend } = buildTokenMap(entities, text);
  return { anonymized: applyTokens(text, entities, seen), legend };
}

export function aggregateEntities(rawTokens, originalText) {
  // Reconstruct character positions by finding each sub-word in the text
  let pos = 0;
  const tokens = rawTokens.map((token) => {
    const idx = originalText.indexOf(token.word, pos);
    const start = idx >= 0 ? idx : pos;
    const end = start + token.word.length;
    pos = end;
    return { ...token, start, end };
  });

  // Merge consecutive tokens of the same entity type.
  // Allow index gaps of ≤2 (handles spaces between phone digits, etc.)
  // Merge regardless of B-/I- prefix (handles models that tag all tokens as B-)
  const groups = [];
  let current = null;

  for (const token of tokens) {
    const type = token.entity.replace(/^[BI]-/, '');

    const shouldMerge =
      current &&
      current.type === type &&
      token.index - current.lastIndex <= 2;

    if (shouldMerge) {
      current.end = token.end;
      current.scores.push(token.score);
      current.lastIndex = token.index;
    } else {
      if (current) groups.push(current);
      current = {
        type,
        start: token.start,
        end: token.end,
        scores: [token.score],
        lastIndex: token.index,
      };
    }
  }
  if (current) groups.push(current);

  return groups.map((g) => ({
    entity_group: g.type,
    start: g.start,
    end: g.end,
    score: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
  }));
}

export function chunkText(text, maxChars) {
  if (text.length <= maxChars) return [{ text, offset: 0 }];

  // Find break points: prefer paragraph boundaries (\n\n), fallback to lines (\n)
  const breaks = [];
  for (const m of text.matchAll(/\n\n+/g)) {
    breaks.push(m.index + m[0].length);
  }
  if (breaks.length === 0) {
    for (const m of text.matchAll(/\n/g)) {
      breaks.push(m.index + 1);
    }
  }

  // Greedily pack complete segments into chunks
  const chunks = [];
  let from = 0;
  let lastFit = 0;

  for (const bp of breaks) {
    if (bp - from > maxChars) {
      const splitAt = lastFit > from ? lastFit : bp;
      chunks.push({ text: text.slice(from, splitAt), offset: from });
      from = splitAt;
    }
    lastFit = bp;
  }

  // Emit remaining text
  if (from < text.length) {
    chunks.push({ text: text.slice(from, text.length), offset: from });
  }

  return chunks;
}

const EMAIL_ANCHORED_RE = /^[\w.+-]+@[\w.-]+\.\w{2,}/;
const EMAIL_LOCAL_CHAR = /[\w.+-]/;
const EMAIL_DOMAIN_CHAR = /[\w.-]/;

function findEmailEntities(text) {
  const entities = [];
  let searchFrom = 0;
  let lastEnd = 0; // matches never overlap, mirroring global-regex semantics
  let at;
  while ((at = text.indexOf('@', searchFrom)) !== -1) {
    let start = at;
    while (start > lastEnd && EMAIL_LOCAL_CHAR.test(text[start - 1])) start--;
    if (start === at) { searchFrom = at + 1; continue; }
    let end = at + 1;
    while (end < text.length && EMAIL_DOMAIN_CHAR.test(text[end])) end++;
    const m = EMAIL_ANCHORED_RE.exec(text.slice(start, end));
    if (m) {
      entities.push({
        entity_group: 'EMAIL_ADDRESS',
        start,
        end: start + m[0].length,
        score: 1.0,
        source: 'regex',
      });
      lastEnd = start + m[0].length;
      searchFrom = lastEnd;
    } else {
      searchFrom = at + 1;
    }
  }
  return entities;
}
export function findRegexEntities(text) {
  const patterns = [
    { regex: /\b\d{11}\b/g, entity_group: 'PERSON_IDENTIFIER' },
    { regex: /\b\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}\b/g, entity_group: 'ORGANIZATION_IDENTIFIER' },
    { regex: /\bPL\s?\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}\b/g, entity_group: 'BANK_ACCOUNT_IDENTIFIER' },
    { regex: /(?<!\d)\+?\d{2}[\s-]?\d{2,3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, entity_group: 'PHONE_NUMBER' },
    { regex: /(?<!\d)\+?48[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g, entity_group: 'PHONE_NUMBER' },
    { regex: /\b\d{1,3}(?:[\s\u00a0]\d{3})*,\d{2}\s?zł/g, entity_group: 'FINANCIAL_AMOUNT' },
  ];

  const entities = findEmailEntities(text);
  for (const { regex, entity_group } of patterns) {
    for (const m of text.matchAll(regex)) {
      entities.push({
        entity_group,
        start: m.index,
        end: m.index + m[0].length,
        score: 1.0,
        source: 'regex',
      });
    }
  }
  return entities;
}

const WORD_BOUNDARY = /[\s,;:()„""–\-]/;
const MAX_SNAP = 6; // max chars to expand in either direction

export function snapToWordBoundaries(entities, text) {
  return entities.map((entity) => {
    let { start, end } = entity;

    // Expand start to the beginning of the word (max MAX_SNAP chars)
    const minStart = Math.max(0, start - MAX_SNAP);
    while (start > minStart && !WORD_BOUNDARY.test(text[start - 1])) start--;

    // Expand end to the end of the word (max MAX_SNAP chars)
    const maxEnd = Math.min(text.length, end + MAX_SNAP);
    while (end < maxEnd && !WORD_BOUNDARY.test(text[end])) end++;

    if (start === entity.start && end === entity.end) return entity;
    return { ...entity, start, end };
  });
}


const DEDUP_SCORE_EPSILON = 0.1;

function spansOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function isPreciseRegexEntity(entity) {
  return entity.source === 'regex' && entity.score === 1.0;
}

function removeEntitiesCoveredByPreciseRegex(entities) {
  const preciseRegexEntities = entities.filter(isPreciseRegexEntity);
  if (preciseRegexEntities.length === 0) return entities;

  return entities.filter((entity) => {
    if (isPreciseRegexEntity(entity)) return true;
    return !preciseRegexEntities.some(
      (regexEntity) => regexEntity.entity_group === entity.entity_group && spansOverlap(regexEntity, entity),
    );
  });
}

export function deduplicateEntities(entities) {
  if (entities.length <= 1) return entities;

  const candidates = removeEntitiesCoveredByPreciseRegex(entities);
  candidates.sort((a, b) => a.start - b.start || b.score - a.score);

  const result = [candidates[0]];
  for (let i = 1; i < candidates.length; i++) {
    const prev = result[result.length - 1];
    const curr = candidates[i];

    if (curr.start < prev.end) {
      // Perfect-score (regex) entities are precise — prefer them over wider NER
      const prevPerfect = prev.score === 1.0;
      const currPerfect = curr.score === 1.0;
      if (prevPerfect !== currPerfect) {
        if (currPerfect) result[result.length - 1] = curr;
      } else {
        // Same precision tier: when scores are close (within epsilon), prefer
        // wider span; when scores differ meaningfully, trust the higher score
        // (NER emitting a greedy wider candidate with much lower confidence
        // usually means it's over-extending into punctuation or context).
        const prevSpan = prev.end - prev.start;
        const currSpan = curr.end - curr.start;
        const scoresClose = Math.abs(curr.score - prev.score) <= DEDUP_SCORE_EPSILON;
        if (scoresClose) {
          if (currSpan > prevSpan) result[result.length - 1] = curr;
        } else if (curr.score > prev.score) {
          result[result.length - 1] = curr;
        }
      }
    } else {
      result.push(curr);
    }
  }

  return result;
}

// Facade over the S2 substitution engine (SHARED-FOUNDATION-DESIGN.md §4.3):
// empty decisions and an identity resolver reduce to exactly today's
// behavior, so all four deanonymization sinks keep working unchanged.
export function deanonymizeText(text, legend) {
  return renderResolvedText(resolveOccurrences(text, { legend }), text);
}

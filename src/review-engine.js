import { foldValue } from './pipeline/steps/tier-partition.js';
import { overlapsAny } from './ui/annotation-editor/operations.js';

// ST-3 (SCOPE-TIERS-DESIGN.md §4.1): the W2 review-bucket engine. Pure
// functions only — document state (candidates, decisions) lives in main.js,
// storage (localStorage dictionary) is the caller's job, and the UI surface
// is ST-4. Everything here is keyed by `valueKey` — the same
// `TYPE::folded-value` key tierPartitionStep stamps on candidates — because
// the decision granularity is per value within a type (§4.1 pkt 2), matching
// the annotation editor's token granularity.
//
// A decisions map is `Map<valueKey, { decision: 'mask'|'skip',
// origin: 'user'|'bulk'|'dictionary', appliedPositions?: string[] }>`.
// `appliedPositions` exists only on applied 'mask' records: the POSITION keys
// (`start:end`, see positionKey) of every entity the application added (full
// spans, uncovered remainders, and postEdit-backfilled occurrences), so undo
// can remove exactly what the decision caused — acceptance §4.3 pkt 1:
// "cofnięcie przywraca stan". Position-keyed, not value-keyed: postEdit runs
// unscoped (it backfills occurrences of ANY value already present in the
// array, e.g. filling a hole tierPartitionStep left by moving a blocking W2
// span into reviewCandidates), so it can seed a duplicate of a value some
// other, pre-existing, decision-independent entity already carries elsewhere
// in the document. A value-keyed applied set would make undo delete that
// unrelated entity too — a confirmed W1 leak across the MCP boundary, fixed
// here by tracking exactly which entities THIS application added, by
// identity (position), not by what value they happen to hold.

// Fragments shorter than this (after whitespace trim) are not worth a token —
// same floor as backfill's MIN_VALUE_LENGTH (src/pipeline/steps/backfill.js).
const MIN_FRAGMENT_LENGTH = 2;

export function valueKeyFor(entityGroup, value) {
  return `${entityGroup}::${foldValue(value)}`;
}

export function entityValueKey(entity, text) {
  return valueKeyFor(entity.entity_group, text.slice(entity.start, entity.end));
}

// Candidates produced before tierPartitionStep stamped valueKey (or hand-built
// in tests) still get a stable key.
function candidateKey(candidate, text) {
  return candidate.valueKey ?? entityValueKey(candidate, text);
}

export function parseValueKey(valueKey) {
  const idx = valueKey.indexOf('::');
  return { type: valueKey.slice(0, idx), folded: valueKey.slice(idx + 2) };
}

// Map valueKey → { valueKey, entity_group, occurrences } in first-seen order.
export function groupCandidates(candidates, text = '') {
  const groups = new Map();
  for (const candidate of candidates ?? []) {
    const key = candidateKey(candidate, text);
    if (!groups.has(key)) {
      groups.set(key, { valueKey: key, entity_group: candidate.entity_group, occurrences: [] });
    }
    groups.get(key).occurrences.push(candidate);
  }
  return groups;
}

export function pendingValueKeys(candidates, decisions, text = '') {
  const pending = [];
  for (const key of groupCandidates(candidates, text).keys()) {
    if (!decisions?.has(key)) pending.push(key);
  }
  return pending;
}

// §4.1 pkt 1: review state is DERIVED — a source is review-complete iff every
// candidate valueKey has a decision; a document without candidates is
// complete by definition. This is the primitive ST-6 puts on the MCP boundary.
export function reviewComplete(candidates, decisions, text = '') {
  return pendingValueKeys(candidates, decisions, text).length === 0;
}

// Sub-ranges of [start,end) not covered by any existing span, in order.
function uncoveredRanges(start, end, spans) {
  const overlapping = spans
    .filter((s) => s.start < end && s.end > start)
    .sort((a, b) => a.start - b.start);
  const free = [];
  let cursor = start;
  for (const s of overlapping) {
    if (s.start > cursor) free.push([cursor, s.start]);
    cursor = Math.max(cursor, s.end);
    if (cursor >= end) return free;
  }
  if (cursor < end) free.push([cursor, end]);
  return free;
}

function trimWhitespace(text, start, end) {
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return [start, end];
}

function positionKey(entity) {
  return `${entity.start}:${entity.end}`;
}

// Applies a 'mask' decision to the entities array: every occurrence of the
// decided value becomes a regular entity (span, type and source preserved —
// §4.1 pkt 3), then postEdit (the annotation editor's backfill pass) seeds
// occurrences the detector missed. s.entities must stay non-overlapping
// (applyTokens replaces spans by offset), so an occurrence partially covered
// by an existing entity contributes its uncovered remainders instead of the
// full span — every still-visible character of the candidate gets masked,
// which is what §3.2 pkt 3 means by "decyzja «maskuj» obejmie całość".
//
// Returns { entities, appliedPositions }: appliedPositions are the position
// keys (start:end) of every entity this application added — diffed by
// position against the entities array as it stood before this call, so
// postEdit's additions are attributed too. Position, not value: postEdit
// scans the whole array for any known value, not just valueKey, so it can
// seed a duplicate of a value some unrelated, pre-existing entity already
// carries elsewhere — attributing that by value would poison the undo set
// for THIS decision with an entity it never touched (see module comment).
// `valueKey` is accepted for the caller-facing "this application concerns
// this value" contract shared by every function in this module; it is not
// needed to compute appliedPositions.
export function applyMaskDecision({ text, entities, occurrences, valueKey, postEdit = null }) {
  const additions = [];
  const occupied = () => [...entities, ...additions];
  for (const occurrence of occurrences) {
    if (!overlapsAny(occurrence.start, occurrence.end, occupied())) {
      additions.push({
        entity_group: occurrence.entity_group,
        start: occurrence.start,
        end: occurrence.end,
        score: occurrence.score,
        source: occurrence.source,
      });
      continue;
    }
    for (const [rangeStart, rangeEnd] of uncoveredRanges(occurrence.start, occurrence.end, occupied())) {
      const [start, end] = trimWhitespace(text, rangeStart, rangeEnd);
      if (end - start < MIN_FRAGMENT_LENGTH) continue;
      additions.push({
        entity_group: occurrence.entity_group,
        start,
        end,
        score: occurrence.score,
        source: occurrence.source,
      });
    }
  }

  const withAdditions = additions.length > 0 ? [...entities, ...additions] : entities;
  const after = postEdit ? postEdit(text, withAdditions) : withAdditions;

  const before = new Set(entities.map(positionKey));
  const appliedPositions = after.filter((entity) => !before.has(positionKey(entity))).map(positionKey);
  return { entities: after, appliedPositions };
}

// Removes everything a 'mask' decision added: entities at a position in the
// decision's applied set. Position-keyed (not value-keyed) — see
// applyMaskDecision's comment: postEdit runs unscoped, so a decision's
// applied set can include a backfilled entity that happens to share its
// value with an unrelated, pre-existing entity elsewhere in the document;
// filtering by value (the previous design) deleted that untouched entity
// too. A record with no applied positions (e.g. a stale decision whose
// candidate no longer exists) removes nothing — undo can only remove what
// the application actually added, never more.
function removeAppliedEntities(entities, record) {
  const positions = new Set(record?.appliedPositions ?? []);
  return entities.filter((entity) => !positions.has(positionKey(entity)));
}

// Records a decision for one valueKey and applies its effect to entities.
// Flipping an applied 'mask' to 'skip' (or re-masking) first restores the
// pre-decision entities, so decisions never stack. Returns new state —
// inputs are not mutated.
export function applyDecision({ text, entities, candidates, decisions, valueKey, decision, origin = 'user', postEdit = null }) {
  const nextDecisions = new Map(decisions ?? []);
  const previous = nextDecisions.get(valueKey);
  let nextEntities = previous?.decision === 'mask'
    ? removeAppliedEntities(entities, previous)
    : entities;

  if (decision === 'mask') {
    const occurrences = (candidates ?? []).filter((c) => candidateKey(c, text) === valueKey);
    const applied = applyMaskDecision({ text, entities: nextEntities, occurrences, valueKey, postEdit });
    nextEntities = applied.entities;
    nextDecisions.set(valueKey, { decision: 'mask', origin, appliedPositions: applied.appliedPositions });
  } else {
    nextDecisions.set(valueKey, { decision: 'skip', origin });
  }
  return { entities: nextEntities, decisions: nextDecisions };
}

// Undo (§4.1 pkt 4): the candidate returns to the unresolved state; if the
// decision was 'mask', its entities (including backfilled copies) are removed.
export function clearDecision({ text, entities, decisions, valueKey }) {
  const nextDecisions = new Map(decisions ?? []);
  const previous = nextDecisions.get(valueKey);
  if (!previous) return { entities, decisions: nextDecisions };
  nextDecisions.delete(valueKey);
  const nextEntities = previous.decision === 'mask'
    ? removeAppliedEntities(entities, previous)
    : entities;
  return { entities: nextEntities, decisions: nextDecisions };
}

// "Zakończ przegląd – pomiń pozostałe" (§4.3 pkt 4): every pending valueKey
// becomes 'skip' with origin 'bulk'. Entities are untouched by construction.
export function finishReview(candidates, decisions, text = '') {
  const nextDecisions = new Map(decisions ?? []);
  for (const key of pendingValueKeys(candidates, nextDecisions, text)) {
    nextDecisions.set(key, { decision: 'skip', origin: 'bulk' });
  }
  return nextDecisions;
}

// --- persistent dictionary (§4.1 pkt 5) -----------------------------------
//
// Two lists per type, alwaysMask / alwaysSkip, holding FOLDED values. This is
// configuration, not case content — the same data class as the blocklist
// phrases in entity-rules.js (see the design's D2 argument; final verdict is
// GATE-SCOPE GS-3). Entries are created only by an explicit "remember" action
// in the UI (ST-4) — never automatically.

export function emptyDictionary() {
  return { version: 1, alwaysMask: {}, alwaysSkip: {} };
}

function sanitizeList(raw) {
  if (!Array.isArray(raw)) return null;
  const values = [...new Set(raw.filter((v) => typeof v === 'string').map(foldValue).filter(Boolean))];
  return values.length > 0 ? values : null;
}

function sanitizeSection(raw) {
  const section = {};
  if (raw && typeof raw === 'object') {
    for (const [type, list] of Object.entries(raw)) {
      const values = sanitizeList(list);
      if (values) section[type] = values;
    }
  }
  return section;
}

// Defensive by design: the dictionary lives in localStorage, so corrupt or
// hand-edited JSON must degrade to an empty dictionary, never throw.
export function parseDictionary(raw) {
  if (typeof raw !== 'string' || raw === '') return emptyDictionary();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyDictionary();
  }
  if (!parsed || typeof parsed !== 'object') return emptyDictionary();
  return {
    version: 1,
    alwaysMask: sanitizeSection(parsed.alwaysMask),
    alwaysSkip: sanitizeSection(parsed.alwaysSkip),
  };
}

export function serializeDictionary(dictionary) {
  return JSON.stringify(dictionary);
}

// 'mask' | 'skip' | null. If a corrupt store lists a value on both sides,
// mask wins — the safe direction.
export function dictionaryDecisionFor(dictionary, valueKey) {
  if (!dictionary) return null;
  const { type, folded } = parseValueKey(valueKey);
  if (dictionary.alwaysMask?.[type]?.includes(folded)) return 'mask';
  if (dictionary.alwaysSkip?.[type]?.includes(folded)) return 'skip';
  return null;
}

function withoutEntry(section, type, folded) {
  const list = section[type];
  if (!list?.includes(folded)) return section;
  const nextList = list.filter((v) => v !== folded);
  const next = { ...section };
  if (nextList.length > 0) next[type] = nextList;
  else delete next[type];
  return next;
}

// Adding to one list removes the value from the other — a value is never on
// both sides. Returns a new dictionary; input is not mutated.
export function addDictionaryEntry(dictionary, valueKey, decision) {
  const { type, folded } = parseValueKey(valueKey);
  if (!folded) return dictionary;
  const target = decision === 'mask' ? 'alwaysMask' : 'alwaysSkip';
  const other = decision === 'mask' ? 'alwaysSkip' : 'alwaysMask';
  const targetSection = { ...dictionary[target] };
  const list = targetSection[type] ?? [];
  if (!list.includes(folded)) targetSection[type] = [...list, folded];
  return {
    version: 1,
    [target]: targetSection,
    [other]: withoutEntry(dictionary[other], type, folded),
  };
}

export function removeDictionaryEntry(dictionary, valueKey) {
  const { type, folded } = parseValueKey(valueKey);
  return {
    version: 1,
    alwaysMask: withoutEntry(dictionary.alwaysMask, type, folded),
    alwaysSkip: withoutEntry(dictionary.alwaysSkip, type, folded),
  };
}

// Flat view for the settings UI (ST-4): [{ valueKey, type, folded, decision }].
export function dictionaryEntries(dictionary) {
  const entries = [];
  for (const [decision, section] of [['mask', dictionary.alwaysMask], ['skip', dictionary.alwaysSkip]]) {
    for (const [type, values] of Object.entries(section ?? {})) {
      for (const folded of values) {
        entries.push({ valueKey: `${type}::${folded}`, type, folded, decision });
      }
    }
  }
  return entries;
}

// --- classify-result reconciliation (§4.1 pkt 5, poziomy 1–3) ---------------
//
// Runs in main.js's 'result' handler on every classify. Decision memory
// levels: (1) the document's own decisions survive the rerun untouched,
// (2) fresh candidates whose valueKey already has a decision are NOT asked
// again — 'mask' decisions are re-applied to the fresh entity list (the
// pipeline knows nothing about decisions), (3) undecided candidates are
// resolved from the persistent dictionary with origin 'dictionary' (marked in
// the bucket, reversible per document).
//
// With tiering asleep (allMask default), candidates is always empty and this
// returns the entities array UNCHANGED (same reference) — byte-for-byte
// today's behavior.
export function resolveClassifyResult({ text, entities, candidates, prevDecisions, dictionary, postEdit = null }) {
  const decisions = new Map(prevDecisions ?? []);
  if (!candidates || candidates.length === 0) {
    return { entities, candidates: [], decisions };
  }

  const groups = groupCandidates(candidates, text);
  for (const key of groups.keys()) {
    if (decisions.has(key)) continue;
    const dictDecision = dictionaryDecisionFor(dictionary, key);
    if (dictDecision) decisions.set(key, { decision: dictDecision, origin: 'dictionary' });
  }

  let nextEntities = entities;
  for (const [key, group] of groups) {
    const record = decisions.get(key);
    if (record?.decision !== 'mask') continue;
    const applied = applyMaskDecision({
      text, entities: nextEntities, occurrences: group.occurrences, valueKey: key, postEdit,
    });
    nextEntities = applied.entities;
    decisions.set(key, { ...record, appliedPositions: applied.appliedPositions });
  }
  return { entities: nextEntities, candidates, decisions };
}

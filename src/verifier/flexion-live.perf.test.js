// FL-5-LIVE-WIRING-DESIGN.md K7/G-FL5-8: order-of-magnitude timing for the
// live wiring's render path (buildOutcomeResolver -> resolveOccurrences ->
// renderResolvedText), the same "log, not gate" convention already used for
// the DOCX side (src/docx-rebuild/rebuild-docx.perf.test.js/MD6): the
// assertions pin correctness (occurrence/inflection counts), never
// wall-clock, so a slow CI/laptop never flakes; the number lands in the test
// output for the gate to read. Criterion (§5.5 pkt 5 of the parent design):
// ~20k chars / 50 occurrences informally under ~50ms.
import { buildOutcomeResolver } from './flexion-live.js';
import { resolveOccurrences, renderResolvedText } from '../substitution.js';

const LEGEND = {
  '[PERSON_NAME_1]': 'Jan Kowalski',
  '[PERSON_NAME_2]': 'Barbara Zawadzka',
};
// Attested genitive forms on file for both tokens (production shape:
// morph:null, A0 tier — exactly what ships today, §5.1), matching every
// mention's "od" (S-P -> D) below. Both surnames are adjectival
// (-ski/-ska family, rule-governed even with morph:null — the same family
// flexion-resolver.test.js's own proofs use); an indeclinable-feminine
// surname (e.g. "Nowak") is deliberately NOT used here: its bare shape
// can't distinguish case without a given-name dictionary hit, so an
// attested non-nominative form for one would silently fail to attribute
// (a real, separate engine property — not what this smoke test is about).
const SEEN = {
  'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_1]',
  'PERSON_NAME::Jana Kowalskiego': '[PERSON_NAME_1]',
  'PERSON_NAME::Barbara Zawadzka': '[PERSON_NAME_2]',
  'PERSON_NAME::Barbary Zawadzkiej': '[PERSON_NAME_2]',
};

// A realistic legal-brief paragraph (~140-150 chars), alternating between an
// unambiguous-preposition mention (S-P "od" -> D, reaches 'wysoka' with no
// annotation, matching the parent design's FD-3 recipe) and plain filler —
// the same shape as rebuild-docx.perf.test.js's own paragraph(i) helper.
function paragraph(i) {
  if (i % 3 !== 0) {
    return 'W pozostałym zakresie powództwo podlega oddaleniu jako nieudowodnione co do wysokości oraz co do zasady, o czym orzeczono jak w sentencji wyroku. ';
  }
  const token = (i / 3) % 2 === 0 ? '[PERSON_NAME_1]' : '[PERSON_NAME_2]';
  return `Sąd zasądza od ${token} kwotę zadośćuczynienia wraz z odsetkami ustawowymi za opóźnienie liczonymi od dnia wytoczenia powództwa do dnia zapłaty. `;
}

function buildDoc(paragraphCount) {
  let text = '';
  for (let i = 0; i < paragraphCount; i++) text += paragraph(i);
  return text;
}

describe('flexion live wiring — order-of-magnitude timing (K7/G-FL5-8, log-only)', () => {
  it('~20k chars / 50 occurrences renders well within the informal budget', () => {
    const PARAGRAPH_COUNT = 150; // i % 3 === 0 for i in [0,150) -> 50 mentions
    const text = buildDoc(PARAGRAPH_COUNT);
    expect(text.length).toBeGreaterThan(18_000);
    expect(text.length).toBeLessThan(24_000);

    const resolveReplacement = buildOutcomeResolver({
      enabled: true, morph: null, seen: SEEN, liveLegend: LEGEND, outcome: {},
    });

    const t0 = performance.now();
    const occurrences = resolveOccurrences(text, { legend: LEGEND, resolveReplacement });
    const rendered = renderResolvedText(occurrences, text);
    const elapsed = performance.now() - t0;

    expect(occurrences).toHaveLength(50);
    const inflected = occurrences.filter((o) => o.source === 'resolver').length;
    expect(inflected).toBe(50); // every mention has an unambiguous S-P signal + an attested form on file
    expect(rendered).toContain('Jana Kowalskiego');
    expect(rendered).toContain('Barbary Zawadzkiej');
    expect(rendered).not.toContain('[PERSON_NAME_');

    console.log(`[fl5-perf] ${text.length} chars, ${occurrences.length} occurrences (${inflected} inflected): ${elapsed.toFixed(2)} ms (informational only, not a gate — G-FL5-8)`);
  }, 15_000);
});

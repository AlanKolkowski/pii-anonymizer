// HC-1 (H-3-CLOSURE-DESIGN.md §4): the per-tier frontier in
// deduplicateEntities (src/anonymizer.js's dedupStep, ~:748-794) plus the
// type-rule merge gate (merge.js) already close H-3 case (b) — "a mask
// candidate existed but a wider pass-tier span won the single-bucket
// arbitration" — via ST-2's tier-aware dedup, already merged and covered by
// tier-partition-invariance.test.js's all-mask proof. HC-1 does not build
// new arbitration logic (§4.1 pt 4: no new state, no side-channel ledger) —
// it PROVES the existing mechanism on the six real H-3 leaks by threading
// each one through the exact postprocess tail order from
// src/pipeline/configs/default.js (~:111-114): dedup -> backfill -> merge ->
// tierPartition. Inputs are synthetic candidate sets reproducing the
// measured situation (HC-2's H-3-CLOSURE-DESIGN.md §1.2 inventory: a wide
// pass-tier span the model actually produced + the mask-tier candidate
// HC-2's regex now emits) — never a live model or eval run (laptop-safe,
// H-3-CLOSURE-DESIGN.md §7).
//
// N1/N2 (§4.3), spelled out for this test file specifically:
//   N1 (mechanism): all-mask invariance is a claim about dedup's mechanics
//     at a FIXED candidate set, and is proven elsewhere
//     (tier-partition-invariance.test.js) — this file does not touch or
//     re-litigate it.
//   N2 (candidate set): HC-2's regexes deliberately CHANGE the candidate set
//     in both allMask:true and allMask:false modes (a new mask candidate now
//     exists where none did before) — that is what this file measures, via
//     a tagged eval-style scenario, not a frozen-candidate-set invariance
//     proof. The tail below always runs with allMask:false (tiers active)
//     because case (b) only has meaning once pass/mask are different
//     buckets; N1's separate all-mask guarantee is unaffected.
import { describe, it, expect } from 'vitest';
import { dedupStep } from './dedup.js';
import { backfillOccurrencesStep } from './backfill.js';
import { mergeStep } from './merge.js';
import { createTierPartitionStep } from './tier-partition.js';
import { effectiveTier } from '../configs/type-tiers.js';
import { anonymizeText } from '../../anonymizer.js';

// Same wiring as createPostprocessSteps (configs/default.js) with
// allMask:false and no overrides — the real TYPE_TIERS resolves
// PERSON_IDENTIFIER/EMAIL_ADDRESS/VEHICLE_IDENTIFIER to 'mask' and
// DOCUMENT_REFERENCE/ORGANIZATION_NAME to 'pass', exactly the tiers this
// scenario needs.
const tierOpts = { allMask: false };
const tierOf = (entity) => effectiveTier(entity, tierOpts);

function runTail(ctx) {
  const deduped = dedupStep(ctx, tierOf);
  const backfilled = backfillOccurrencesStep(deduped, tierOf);
  const merged = mergeStep(backfilled);
  const partitioned = createTierPartitionStep(tierOpts)(merged);
  return partitioned;
}

function span(text, value, from = 0) {
  const start = text.indexOf(value, from);
  if (start === -1) throw new Error(`fixture error: ${JSON.stringify(value)} not found in ${JSON.stringify(text)}`);
  return { start, end: start + value.length };
}

// Six real corpus sentences (test-data/adversarial/adw_14_dokumenty_tozsamosci.txt,
// test-data/adversarial/adw_31_komornik.txt, test-data/adversarial-holdout/
// hold_identyfikatory_12.txt, test-data/adversarial-holdout/hold_dane_osobowe_09.txt)
// — the six case-(a) leaks from the design's §1.2 inventory. `wideLabel` is
// the extra word the synthetic wide pass-tier span includes beyond the bare
// leak value (models plausibly fold a preceding label token into their
// guess) — reconstructed per §1.2's "Model otagował" column since the
// original model output was not preserved, only the post-dedupe leak.
const LEAKS = [
  {
    id: '#1 92712/00/2780 (prawo jazdy)',
    text: 'Dane strony postępowania: Bożena Wróblewska, PESEL 57020976679, dowód osobisty seria i nr BMA 733701, paszport nr AG 1391751, prawo jazdy nr 92712/00/2780.',
    value: '92712/00/2780',
    maskType: 'PERSON_IDENTIFIER',
    passType: 'DOCUMENT_REFERENCE',
    wideLabel: 'nr ',
  },
  {
    id: '#2 00123/22/0611 (prawo jazdy)',
    text: 'W aktach znajduje się kopia paszportu nr EJ 1234567 oraz prawa jazdy nr 00123/22/0611 kat. B.',
    value: '00123/22/0611',
    maskType: 'PERSON_IDENTIFIER',
    passType: 'DOCUMENT_REFERENCE',
    wideLabel: 'nr ',
  },
  {
    id: '#3 DKR 744829 (dowód osobisty)',
    text: 'Tożsamość mocodawcy ustalono na podstawie dowodu osobistego seria i nr DKR 744829, wydanego przez Prezydenta Miasta Torunia.',
    value: 'DKR 744829',
    maskType: 'PERSON_IDENTIFIER',
    passType: 'DOCUMENT_REFERENCE',
    wideLabel: 'nr ',
  },
  {
    id: '#4 DKR744829 sklejone (dowód osobisty)',
    text: 'Zbiorczy zapis z systemu: dow. os. DKR744829 (bez spacji).',
    value: 'DKR744829',
    maskType: 'PERSON_IDENTIFIER',
    passType: 'DOCUMENT_REFERENCE',
    wideLabel: 'os. ',
  },
  {
    id: '#5 CTR 88812 (tablica rejestracyjna)',
    text: 'przyczepa lekka, nr rej. CTR 88812.',
    value: 'CTR 88812',
    maskType: 'VEHICLE_IDENTIFIER',
    passType: 'DOCUMENT_REFERENCE',
    wideLabel: 'rej. ',
  },
  {
    id: '#6 kontakt@przedsiębior.pl (e-mail IDN)',
    text: 'Korespondencję firmową prosimy kierować na adres kontakt@przedsiębior.pl.',
    value: 'kontakt@przedsiębior.pl',
    maskType: 'EMAIL_ADDRESS',
    passType: 'ORGANIZATION_NAME',
    wideLabel: 'adres ',
  },
];

describe('HC-1: arbitration goldens on the six H-3 case-(a) leaks (H-3-CLOSURE-DESIGN.md §4.1 pt 1)', () => {
  it.each(LEAKS)('$id: the mask candidate survives the full tail; the wide pass span does not', ({ text, value, maskType, passType, wideLabel }) => {
    const valueSpan = span(text, value);
    const wideStart = valueSpan.start - wideLabel.length;
    expect(text.slice(wideStart, wideStart + wideLabel.length)).toBe(wideLabel); // fixture sanity check

    const passCandidate = {
      entity_group: passType,
      start: wideStart,
      end: valueSpan.end,
      score: 0.92,
      source: 'multilang-fp32',
    };
    const maskCandidate = {
      entity_group: maskType,
      start: valueSpan.start,
      end: valueSpan.end,
      score: 1.0,
      source: 'regex',
    };

    const ctx = { text, entities: [passCandidate, maskCandidate], anonymized: '', legend: {} };
    const result = runTail(ctx);

    // GT span comes out in ctx.entities, masked.
    const survivingMask = result.entities.filter((e) => e.entity_group === maskType);
    expect(survivingMask.some((e) => text.slice(e.start, e.end) === value)).toBe(true);

    // The wide pass-tier span disappears at partition (dropped, not review).
    expect(result.entities.some((e) => e.entity_group === passType)).toBe(false);

    // reviewCandidates untouched — no review-tier entity was ever involved.
    expect(result.reviewCandidates).toEqual([]);

    // End-to-end: the value is actually replaced by a token, the rest of
    // the sentence (including the label word the wide span had swallowed)
    // stays in plain text.
    const { anonymized } = anonymizeText(text, result.entities);
    expect(anonymized).not.toContain(value);
    expect(anonymized).toContain(wideLabel.trim());
  });

  it('email case (#6): masks exactly [EMAIL_ADDRESS_1], the rest of the sentence stays plain (H-3-CLOSURE-DESIGN.md §4.2)', () => {
    const leak = LEAKS[5];
    const valueSpan = span(leak.text, leak.value);
    const wideStart = valueSpan.start - leak.wideLabel.length;

    const passCandidate = { entity_group: leak.passType, start: wideStart, end: valueSpan.end, score: 0.92, source: 'multilang-fp32' };
    const maskCandidate = { entity_group: leak.maskType, start: valueSpan.start, end: valueSpan.end, score: 1.0, source: 'regex' };

    const ctx = { text: leak.text, entities: [passCandidate, maskCandidate], anonymized: '', legend: {} };
    const result = runTail(ctx);
    const { anonymized, legend } = anonymizeText(leak.text, result.entities);

    expect(anonymized).toBe('Korespondencję firmową prosimy kierować na adres [EMAIL_ADDRESS_1].');
    expect(legend['[EMAIL_ADDRESS_1]']).toBe('kontakt@przedsiębior.pl');
  });
});

describe('HC-1: merge does not let a pass span absorb a mask span (H-3-CLOSURE-DESIGN.md §4.1 pt 2)', () => {
  // Isolates mergeStep specifically (not the full tail) — pins the SAME
  // guard tier-partition-invariance/ST-5 already relies on, now against an
  // H-3 scenario rather than the one it was originally discovered on: a
  // pass-tier span (DOCUMENT_REFERENCE/ORGANIZATION_NAME) directly adjacent
  // to (or, as measured, overlapping) a mask-tier HC-2 regex span must
  // never merge into one entity, because entity-rules.js declares no
  // mergeWithAdjacent/mergeWithFollowing rule between any pass-tier type
  // and any mask-tier type — the gate is the type-rule table, and holds
  // regardless of gap vs. overlap.
  it.each(LEAKS)('$id: dedup+backfill+merge keep the pass and mask spans as two separate entities', ({ text, value, maskType, passType, wideLabel }) => {
    const valueSpan = span(text, value);
    const wideStart = valueSpan.start - wideLabel.length;

    const passCandidate = { entity_group: passType, start: wideStart, end: valueSpan.end, score: 0.92, source: 'multilang-fp32' };
    const maskCandidate = { entity_group: maskType, start: valueSpan.start, end: valueSpan.end, score: 1.0, source: 'regex' };

    const ctx = { text, entities: [passCandidate, maskCandidate], anonymized: '', legend: {} };
    const deduped = dedupStep(ctx, tierOf);
    const backfilled = backfillOccurrencesStep(deduped, tierOf);
    const merged = mergeStep(backfilled);

    const passSurvivors = merged.entities.filter((e) => e.entity_group === passType);
    const maskSurvivors = merged.entities.filter((e) => e.entity_group === maskType);
    expect(passSurvivors).toHaveLength(1);
    expect(maskSurvivors).toHaveLength(1);
    expect(text.slice(maskSurvivors[0].start, maskSurvivors[0].end)).toBe(value);
  });

  it('adjacent-with-gap variant (not just overlap): a pass span one space away (within MAX_GAP) from the mask span still does not merge', () => {
    // MAX_GAP (merge.js) is 3 chars and only bridges whitespace/comma/\n —
    // this is the closest realistic adjacency short of overlap: the pass
    // span ends, a single space, then the mask span begins immediately.
    const text = 'Sygn. akt XY 1000 DKR 744829 w tej sprawie.';
    const passStart = text.indexOf('XY 1000');
    const passCandidate = { entity_group: 'DOCUMENT_REFERENCE', start: passStart, end: passStart + 'XY 1000'.length, score: 0.9, source: 'multilang-fp32' };
    const maskSpan = span(text, 'DKR 744829');
    const maskCandidate = { entity_group: 'PERSON_IDENTIFIER', start: maskSpan.start, end: maskSpan.end, score: 1.0, source: 'regex' };

    const gap = text.slice(passCandidate.end, maskCandidate.start);
    expect(gap).toBe(' '); // fixture sanity check — genuinely within MAX_GAP

    const ctx = { text, entities: [passCandidate, maskCandidate], anonymized: '', legend: {} };
    const deduped = dedupStep(ctx, tierOf);
    const backfilled = backfillOccurrencesStep(deduped, tierOf);
    const merged = mergeStep(backfilled);

    expect(merged.entities).toHaveLength(2);
    expect(merged.entities.map((e) => e.entity_group).sort()).toEqual(['DOCUMENT_REFERENCE', 'PERSON_IDENTIFIER']);
  });
});

describe('HC-1: "one decision step" semantics (H-3-CLOSURE-DESIGN.md §4.1 pt 3, documentation only)', () => {
  // No new code path — this test exists so the contract has a runnable
  // anchor, not just prose: dedup/backfill/merge resolve REPRESENTATION
  // within a tier (which span/label represents an overlapping family of
  // same-tier candidates); tierPartitionStep is the ONLY place a masking
  // decision is made. A mask candidate that reaches partition is never
  // competing with a pass candidate for survival — they live in disjoint
  // frontier buckets from dedup onward (src/anonymizer.js:748-794) — so
  // "which one wins" is not a question the tail ever asks across tiers.
  it('a mask candidate and a same-span pass candidate both reach tierPartitionStep untouched, which then applies the single masking decision', () => {
    const text = 'nr rej. CTR 88812.';
    const s = span(text, 'CTR 88812');
    const passCandidate = { entity_group: 'DOCUMENT_REFERENCE', start: s.start, end: s.end, score: 0.9, source: 'multilang-fp32' };
    const maskCandidate = { entity_group: 'VEHICLE_IDENTIFIER', start: s.start, end: s.end, score: 1.0, source: 'regex' };

    const deduped = dedupStep({ text, entities: [passCandidate, maskCandidate], anonymized: '', legend: {} }, tierOf);
    // Both survive dedup — different tiers never arbitrate against each other.
    expect(deduped.entities).toHaveLength(2);

    const partitioned = createTierPartitionStep(tierOpts)(mergeStep(backfillOccurrencesStep(deduped, tierOf)));
    expect(partitioned.entities).toHaveLength(1);
    expect(partitioned.entities[0].entity_group).toBe('VEHICLE_IDENTIFIER');
  });
});

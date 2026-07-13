// The authoritative disjointness guard — RECALL-90-DESIGN.md §3.4 point 1:
// "twarda asercja rozłączności wartości (żadne nazwisko/PESEL/IBAN z dev nie
// występuje w holdout)". Unlike the first-pass hand-compiled denylists in
// holdout-people.test.js / holdout-pools.test.js (design-time sanity
// checks against a list a human transcribed), this test re-derives the dev
// value set from the actual dev generator's DOCS + build() — the same
// source of truth scripts/generate-adversarial-corpus.mjs itself uses at
// generation time — so it catches drift if either corpus's templates or
// values ever change, not just what a human happened to notice by reading
// the generator once.
import { DOCS, build } from '../generate-adversarial-corpus.mjs';
import { assembleHoldoutDocs, buildHoldoutDoc } from './holdout-templates.mjs';
import { collectIdentifyingValues, findDisjointnessViolations } from './holdout-disjointness.mjs';

describe('dev/holdout disjointness (the actual generated corpora, not a hand-compiled list)', () => {
  const devBuilt = DOCS.map((doc) => build(doc.parts));
  const devValues = collectIdentifyingValues(devBuilt);
  const holdoutBuilt = assembleHoldoutDocs().map((doc) => buildHoldoutDoc(doc.parts));

  it('dev corpus actually has identifying values to compare against (sanity: the check is exercised, not vacuous)', () => {
    expect(devValues.size).toBeGreaterThan(50);
  });

  it('holdout corpus actually has identifying values (sanity: not vacuous the other direction either)', () => {
    const holdoutValues = collectIdentifyingValues(holdoutBuilt);
    expect(holdoutValues.size).toBeGreaterThan(200);
  });

  it('zero holdout PERSON_NAME/PERSON_IDENTIFIER/ORGANIZATION_IDENTIFIER/BANK_ACCOUNT_IDENTIFIER/VEHICLE_IDENTIFIER value equals a dev one', () => {
    const violations = findDisjointnessViolations(devValues, holdoutBuilt);
    expect(violations).toEqual([]);
  });

  it('this guard would actually catch a violation (negative control — proves the test isn\'t vacuously passing)', () => {
    const contaminated = [...holdoutBuilt, { expected: [...devValues].slice(0, 1).map((text) => ({ entity_group: 'PERSON_NAME', text })) }];
    const violations = findDisjointnessViolations(devValues, contaminated);
    expect(violations.length).toBeGreaterThan(0);
  });
});

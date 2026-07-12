import { charCoverage, confusionMatrix, attributeLayer, weightFor } from './analyze.js';

describe('charCoverage', () => {
  const exp = { start: 10, end: 20 };

  it('full cover by a single span', () => {
    const { coverage, uncovered } = charCoverage(exp, [{ start: 10, end: 20 }]);
    expect(coverage).toBe(1);
    expect(uncovered).toEqual([]);
  });

  it('no cover', () => {
    const { coverage, uncovered } = charCoverage(exp, [{ start: 0, end: 5 }]);
    expect(coverage).toBe(0);
    expect(uncovered).toEqual([{ start: 10, end: 20 }]);
  });

  it('partial cover leaves the residue runs', () => {
    const { coverage, uncovered } = charCoverage(exp, [
      { start: 8, end: 12 },
      { start: 15, end: 17 },
    ]);
    expect(coverage).toBeCloseTo(0.4);
    expect(uncovered).toEqual([
      { start: 12, end: 15 },
      { start: 17, end: 20 },
    ]);
  });

  it('coverage is type-agnostic (mask under a wrong type still covers)', () => {
    const { coverage } = charCoverage(
      { start: 0, end: 11, entity_group: 'PERSON_IDENTIFIER' },
      [{ start: 0, end: 11, entity_group: 'PHONE_NUMBER' }],
    );
    expect(coverage).toBe(1);
  });
});

describe('confusionMatrix', () => {
  it('routes exact-type matches to the diagonal, type confusions off-diagonal, misses to (brak)', () => {
    const expected = [
      { entity_group: 'PERSON_NAME', start: 0, end: 10 },
      { entity_group: 'PERSON_IDENTIFIER', start: 20, end: 31 },
      { entity_group: 'LOCATION', start: 40, end: 46 },
    ];
    const predicted = [
      { entity_group: 'PERSON_NAME', start: 0, end: 10 },
      { entity_group: 'PHONE_NUMBER', start: 20, end: 31 },
      { entity_group: 'ORGANIZATION_NAME', start: 60, end: 70 },
    ];
    const m = confusionMatrix(expected, predicted);
    expect(m.PERSON_NAME.PERSON_NAME).toBe(1);
    expect(m.PERSON_IDENTIFIER.PHONE_NUMBER).toBe(1);
    expect(m.LOCATION['(brak)']).toBe(1);
    expect(m['(brak)'].ORGANIZATION_NAME).toBe(1);
  });
});

describe('attributeLayer', () => {
  const exp = { entity_group: 'PERSON_NAME', start: 100, end: 115 };

  it('never detected → detekcja', () => {
    const { layer } = attributeLayer(exp, [{ step: 'nerStep', changes: {} }], []);
    expect(layer).toBe('detekcja');
  });

  it('detected then removed → the removing step', () => {
    const steps = [
      {
        step: 'nerStep',
        changes: { entities: { added: [{ entity_group: 'PERSON_NAME', start: 100, end: 115, score: 0.4, source: 'multilang-fp32' }] } },
      },
      {
        step: 'thresholdStep',
        changes: { entities: { removed: [{ entity_group: 'PERSON_NAME', start: 100, end: 115, score: 0.4, source: 'multilang-fp32' }] } },
      },
    ];
    const res = attributeLayer(exp, steps, []);
    expect(res.layer).toBe('thresholdStep');
    expect(res.detail).toContain('thresholdStep');
  });

  it('present at the end with wrong boundaries → granice', () => {
    const finalPredicted = [{ entity_group: 'PERSON_NAME', start: 100, end: 110 }];
    const steps = [
      {
        step: 'nerStep',
        changes: { entities: { added: [{ entity_group: 'PERSON_NAME', start: 100, end: 110, score: 0.9, source: 'multilang-fp32' }] } },
      },
    ];
    const res = attributeLayer(exp, steps, finalPredicted);
    expect(res.layer).toBe('granice');
    expect(res.detail).toContain('pierwszej detekcji');
  });

  it('exact final span → ok', () => {
    const res = attributeLayer(exp, [], [{ entity_group: 'PERSON_NAME', start: 100, end: 115 }]);
    expect(res.layer).toBe('ok');
  });
});

describe('weightFor', () => {
  it('PESEL and special categories outweigh organizations and roles', () => {
    expect(weightFor('PERSON_IDENTIFIER')).toBe(5);
    expect(weightFor('HEALTH_DATA')).toBe(5);
    expect(weightFor('PERSON_NAME')).toBe(4);
    expect(weightFor('ORGANIZATION_NAME')).toBe(2);
    expect(weightFor('PERSON_ROLE_OR_TITLE')).toBe(1);
    expect(weightFor('TYP_NIEZNANY')).toBe(3);
  });
});

import { describe, it, expect } from 'vitest';
import { checkLlmArtifacts } from './n08-llm-artifacts.js';

describe('checkLlmArtifacts (N-8)', () => {
  it('flags a markdown heading', () => {
    const findings = checkLlmArtifacts('## Uzasadnienie\n\nDalszy tekst.');
    expect(findings.some((f) => f.message.includes('Nagłówek markdown'))).toBe(true);
  });

  it('flags markdown bold', () => {
    const findings = checkLlmArtifacts('**Uzasadnienie**');
    expect(findings.some((f) => f.message.includes('Pogrubienie markdown'))).toBe(true);
  });

  it('flags a bracket placeholder', () => {
    const findings = checkLlmArtifacts('Powód [uzupełnić] wnosi o.');
    expect(findings.some((f) => f.quote === '[uzupełnić]')).toBe(true);
  });

  it('flags a bare TODO marker', () => {
    const findings = checkLlmArtifacts('TODO: sprawdzić kwotę.');
    expect(findings.some((f) => f.message.includes('TODO'))).toBe(true);
  });

  it('flags an em-dash per the house punctuation rule (en-dash only)', () => {
    const findings = checkLlmArtifacts('Termin — 10 dni.');
    expect(findings.some((f) => f.quote === '—')).toBe(true);
  });

  it('does not flag an en-dash', () => {
    expect(checkLlmArtifacts('Termin – 10 dni.')).toEqual([]);
  });

  it('flags a run of English words', () => {
    const findings = checkLlmArtifacts('Zgodnie z umową, this is a placeholder text nie do końca po polsku.');
    expect(findings.some((f) => f.message.includes('po angielsku'))).toBe(true);
  });

  it('returns no findings for clean Polish legal prose', () => {
    expect(checkLlmArtifacts('Powód wnosi o zasądzenie od pozwanego kwoty wskazanej w pozwie.')).toEqual([]);
  });

  it('findings never include a severity above informational', () => {
    const findings = checkLlmArtifacts('## H\n\n**b** — TODO [uzupełnić]');
    expect(findings.every((f) => f.severity === 'informacyjna')).toBe(true);
  });
});

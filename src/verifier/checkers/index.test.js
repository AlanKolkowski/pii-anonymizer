import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runAllCheckers } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_DIR = join(__dirname, '../../../test-data/synthetic');

describe('runAllCheckers', () => {
  it('aggregates findings from every checker, sorted by position in the text', () => {
    const text = 'Powódka Jan Kowalski wnosi [PERSON_NAME_9] o zapłatę — TODO.';
    const findings = runAllCheckers(text, { legend: {} });

    const checkers = new Set(findings.map((f) => f.checker));
    expect(checkers.has('N-1')).toBe(true); // [PERSON_NAME_9] unresolved
    expect(checkers.has('N-3')).toBe(true); // Powódka + Jan gender mismatch
    expect(checkers.has('N-8')).toBe(true); // em-dash + TODO

    for (let i = 1; i < findings.length; i++) {
      expect(findings[i].index).toBeGreaterThanOrEqual(findings[i - 1].index);
    }
  });

  it('returns an empty array for clean text with no legend', () => {
    expect(runAllCheckers('Zwykły, czysty tekst pisma bez żadnych problemów.')).toEqual([]);
  });

  it('defaults the legend to empty when not provided', () => {
    expect(() => runAllCheckers('PESEL: 92071314764')).not.toThrow();
  });

  it('every finding has the common shape (checker, severity, message, index, quote)', () => {
    const findings = runAllCheckers('Powódka Jan Kowalski, [PERSON_NAME_9], TODO — 31 lutego 2026.');
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(typeof f.checker).toBe('string');
      expect(['wysoka', 'średnia', 'informacyjna']).toContain(f.severity);
      expect(typeof f.message).toBe('string');
      expect(typeof f.index).toBe('number');
      expect(typeof f.quote).toBe('string');
    }
  });
});

describe('runAllCheckers — smoke test on the real synthetic corpus', () => {
  const docs = [
    'pismo_01_wezwanie_do_zaplaty',
    'pismo_02_umowa_najmu',
    'pismo_03_odwolanie_od_decyzji_zus',
    'pismo_04_umowa_o_dzielo',
    'pismo_05_wypowiedzenie_umowy_o_prace',
    'pismo_06_reklamacja_konsumencka',
    'pismo_07_emoji_astral',
  ];

  for (const doc of docs) {
    it(`runs on ${doc}.txt without throwing, and findings never come back malformed`, () => {
      const text = readFileSync(join(SYNTHETIC_DIR, `${doc}.txt`), 'utf8');
      let findings;
      expect(() => { findings = runAllCheckers(text, { legend: {} }); }).not.toThrow();
      expect(Array.isArray(findings)).toBe(true);
      for (const f of findings) {
        expect(f.index).toBeGreaterThanOrEqual(0);
        expect(f.index).toBeLessThanOrEqual(text.length);
      }
    });
  }
});

import { describe, it, expect } from 'vitest';
import { checkDuplicateParagraphs } from './n09-duplicate-paragraphs.js';

describe('checkDuplicateParagraphs (N-9)', () => {
  it('flags a paragraph repeated verbatim later in the document', () => {
    const para = 'Wnoszę o zasądzenie od pozwanego na rzecz powoda kwoty dochodzonej pozwem wraz z odsetkami ustawowymi.';
    const text = `${para}\n\nAkapit pośredni o czymś innym, wystarczająco długi.\n\n${para}`;
    const findings = checkDuplicateParagraphs(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].checker).toBe('N-9');
  });

  it('does not flag two distinct paragraphs', () => {
    const text = 'Pierwszy akapit z wystarczająco długą treścią do sprawdzenia.\n\nDrugi, zupełnie inny akapit, też odpowiednio długi.';
    expect(checkDuplicateParagraphs(text)).toEqual([]);
  });

  it('does not flag short repeated markers like section numbers', () => {
    const text = 'I.\n\nTreść pierwszej sekcji, dość długa jak na akapit.\n\nII.\n\nTreść drugiej sekcji, również długa.';
    expect(checkDuplicateParagraphs(text)).toEqual([]);
  });

  it('ignores whitespace-only differences when comparing paragraphs', () => {
    const para = 'Wnoszę o zasądzenie od pozwanego kwoty dochodzonej niniejszym pozwem w całości.';
    const text = `${para}\n\nInny odpowiednio długi akapit pośredni do rozdzielenia treści.\n\n${para.replace(/ /g, '  ')}`;
    expect(checkDuplicateParagraphs(text)).toHaveLength(1);
  });

  it('returns no findings for a single-paragraph document', () => {
    expect(checkDuplicateParagraphs('Jedyny akapit w tym dokumencie, wystarczająco długi.')).toEqual([]);
  });
});

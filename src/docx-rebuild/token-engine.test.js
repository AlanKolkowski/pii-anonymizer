// @vitest-environment jsdom
import { rebuildPart, countTokensInPart, sanitizeValue, W_NS } from './token-engine.js';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function docXml(body) {
  return `${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`;
}

function run(text, props = '') {
  return `<w:r>${props}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

const LEGEND = {
  '[PERSON_NAME_1]': 'Jan Kowalski',
  '[ADDRESS_2]': 'ul. Piekary 33, Toruń',
  '[CASE_NUMBER_1]': 'I C 1552/23',
};

function rebuild(body, legend = LEGEND, extra = {}) {
  return rebuildPart({ xmlText: docXml(body), partName: 'word/document.xml', legend, ...extra });
}

function textsOf(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagNameNS(W_NS, 't')].map((t) => t.textContent);
}

describe('rebuildPart — matching and replacement (§4)', () => {
  it('replaces a token contained in one run', () => {
    const out = rebuild(`<w:p>${run('Pozwany [PERSON_NAME_1] wnosi o…')}</w:p>`);
    expect(out.changed).toBe(true);
    expect(textsOf(out.xml)).toEqual(['Pozwany Jan Kowalski wnosi o…']);
    expect(out.replaced).toEqual([{ token: '[PERSON_NAME_1]', count: 1 }]);
    expect(out.left).toEqual([]);
  });

  it('reassembles a token split across three runs by proofErr/rsid (§4.1)', () => {
    const body = '<w:p>'
      + run('Pozwany [PERSON_', '<w:rPr><w:b/></w:rPr>')
      + '<w:proofErr w:type="spellStart"/>'
      + run('NAME_', '<w:rPr><w:b/><w:i/></w:rPr>')
      + run('1] wnosi o…')
      + '</w:p>';
    const out = rebuild(body);
    // §4.4: whole value lands in the segment the token STARTS in (first run
    // wins the formatting); middles emptied; tail keeps the suffix.
    expect(textsOf(out.xml)).toEqual(['Pozwany Jan Kowalski', '', ' wnosi o…']);
    expect(out.replaced).toEqual([{ token: '[PERSON_NAME_1]', count: 1 }]);
  });

  it('replaces two tokens in one paragraph in a single pass', () => {
    const out = rebuild(`<w:p>${run('[PERSON_NAME_1], zam. [ADDRESS_2].')}</w:p>`);
    expect(textsOf(out.xml)).toEqual(['Jan Kowalski, zam. ul. Piekary 33, Toruń.']);
    expect(out.replaced).toHaveLength(2);
  });

  it('a case-annotated token is matched whole, annotation included (rawLength)', () => {
    const out = rebuild(`<w:p>${run('przeciwko [PERSON_NAME_1|D] wnosi')}</w:p>`);
    expect(textsOf(out.xml)).toEqual(['przeciwko Jan Kowalski wnosi']);
  });

  it('inserted values are never re-scanned — no cascade — but the post-scan reports the literal (§4.5/§6.2)', () => {
    const legend = { '[PERSON_NAME_1]': 'wartość z literałem [ADDRESS_2]', '[ADDRESS_2]': 'NIGDY' };
    const out = rebuild(`<w:p>${run('X [PERSON_NAME_1] Y')}</w:p>`, legend);
    expect(textsOf(out.xml)).toEqual(['X wartość z literałem [ADDRESS_2] Y']);
    expect(out.replaced).toEqual([{ token: '[PERSON_NAME_1]', count: 1 }]);
    // The residue scan runs on the FINAL stream, so the injected literal is
    // visible in the report map without ever being replaced.
    expect(out.left).toEqual([expect.objectContaining({
      token: '[ADDRESS_2]',
      reason: 'literał-w-wartości',
    })]);
  });

  it('nested text-box paragraphs are their own units — replaced once, not doubled', () => {
    const inner = `<w:p>${run('W polu: [CASE_NUMBER_1].')}</w:p>`;
    const body = `<w:p>${run('Na zewnątrz [PERSON_NAME_1].')}`
      + `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>${inner}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    const out = rebuild(body);
    const replacedTotal = out.replaced.reduce((sum, r) => sum + r.count, 0);
    expect(replacedTotal).toBe(2);
    expect(out.xml).toContain('I C 1552/23');
    expect(out.xml).toContain('Jan Kowalski');
  });
});

describe('rebuildPart — fail-safe (§6.1, C-DOCX-7)', () => {
  it('a token unknown to the legend stays visible and is reported with context', () => {
    const out = rebuild(`<w:p>${run('pozwany [PERSON_NAME_9] wnosi')}</w:p>`);
    expect(out.changed).toBe(false);
    expect(out.xml).toBeNull();
    expect(out.left).toEqual([{
      token: '[PERSON_NAME_9]',
      reason: 'brak-w-legendzie',
      context: 'pozwany [PERSON_NAME_9] wnosi',
    }]);
  });

  it('a token interrupted by a hard element is NOT matched and is reported (§4.2 pkt 4)', () => {
    const body = `<w:p>${run('Adres: [ADDRESS_')}<w:r><w:tab/></w:r>${run('2] dalej')}</w:p>`;
    const out = rebuild(body);
    expect(out.changed).toBe(false);
    expect(out.left).toHaveLength(1);
    expect(out.left[0]).toMatchObject({ reason: 'przerwany-elementem' });
  });

  it('tokens inside field instructions and deleted text are report-only (§5.1/§5.2)', () => {
    const body = '<w:p>'
      + '<w:r><w:instrText xml:space="preserve"> REF [PERSON_NAME_1] </w:instrText></w:r>'
      + `<w:del><w:r><w:delText>usunięto [ADDRESS_2]</w:delText></w:r></w:del>`
      + run('widoczny [CASE_NUMBER_1]')
      + '</w:p>';
    const out = rebuild(body);
    expect(out.reportOnlyTokens).toEqual({ instrText: 1, delText: 1 });
    expect(out.replaced).toEqual([{ token: '[CASE_NUMBER_1]', count: 1 }]);
    expect(out.xml).toContain('REF [PERSON_NAME_1]');
    expect(out.xml).toContain('usunięto [ADDRESS_2]');
  });

  it('zero replacements → xml stays null (§3.3 verbatim invariant hook)', () => {
    const out = rebuild(`<w:p>${run('Czysty tekst bez tokenów.')}</w:p>`);
    expect(out.changed).toBe(false);
    expect(out.xml).toBeNull();
  });
});

describe('rebuildPart — injection and hygiene (§4.6, §9.4, C-DOCX-6)', () => {
  it('malicious legend values enter as text, never as markup', () => {
    const legend = { '[PERSON_NAME_1]': '</w:t><w:evil/>&lt;szkodnik&gt;' };
    const out = rebuild(`<w:p>${run('X [PERSON_NAME_1] Y')}</w:p>`, legend);
    expect(out.xml).not.toContain('<w:evil/>');
    const doc = new DOMParser().parseFromString(out.xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.getElementsByTagNameNS(W_NS, 'evil')).toHaveLength(0);
    expect(textsOf(out.xml)).toEqual(['X </w:t><w:evil/>&lt;szkodnik&gt; Y']);
  });

  it('control characters and raw newlines in values become spaces, counted', () => {
    expect(sanitizeValue('a\u0000b\r\nc\td')).toEqual({ text: 'a b  c\td', sanitized: 3 });
    const legend = { '[PERSON_NAME_1]': 'Jan\nKowalski' };
    const out = rebuild(`<w:p>${run('X [PERSON_NAME_1] Y')}</w:p>`, legend);
    expect(out.sanitized).toBe(1);
    expect(textsOf(out.xml)).toEqual(['X Jan Kowalski Y']);
  });

  it('adds xml:space="preserve" when the new content has boundary whitespace', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan' };
    const body = '<w:p><w:r><w:t>[PERSON_NAME_1] i dalej</w:t></w:r></w:p>';
    // Token at index 0, then the tail begins — replacing leaves ' i dalej';
    // the value itself has no boundary space, so craft one that does:
    const out = rebuildPart({
      xmlText: docXml('<w:p><w:r><w:t>[PERSON_NAME_1]</w:t></w:r><w:r><w:t xml:space="preserve"> ogon</w:t></w:r></w:p>'),
      partName: 'p',
      legend: { '[PERSON_NAME_1]': ' Jan ' },
    });
    expect(out.xml).toContain('xml:space="preserve"');
    expect(textsOf(out.xml)).toEqual([' Jan ', ' ogon']);
    void body;
  });

  it('the flexion seam (§8) resolves per occurrence and its output is sanitized', () => {
    const calls = [];
    const out = rebuild(`<w:p>${run('przeciwko [PERSON_NAME_1] oraz [ADDRESS_2]')}</w:p>`, LEGEND, {
      resolveReplacement: (args) => {
        calls.push(args);
        return { text: args.token === '[PERSON_NAME_1]' ? 'Janowi\nKowalskiemu' : args.baseValue };
      },
    });
    expect(textsOf(out.xml)).toEqual(['przeciwko Janowi Kowalskiemu oraz ul. Piekary 33, Toruń']);
    expect(out.sanitized).toBe(1);
    expect(calls[0]).toMatchObject({ token: '[PERSON_NAME_1]', baseValue: 'Jan Kowalski', part: 'word/document.xml' });
    expect(calls[0].contextBefore).toContain('przeciwko');
  });

  // DOCX-IMPL-PLAN.md FD-1 pt 0: the historic bug — `createFlexionResolver`
  // (and the S2 contract generally) refuses with a bare `undefined`; today's
  // (pre-fix) `rebuildPart` did `sanitizeValue(resolved.text)` straight on
  // that, throwing on the very first refusal. This is the RED->GREEN proof.
  describe('the flexion seam — a resolver refusal never crashes (FD-1 pt 0, R-D8)', () => {
    const REFUSER = () => undefined;

    it('a refusing resolver does not throw and falls back to the base value', () => {
      expect(() => rebuild(`<w:p>${run('Pozwany [PERSON_NAME_1] wnosi')}</w:p>`, LEGEND, {
        resolveReplacement: REFUSER,
      })).not.toThrow();
    });

    it('a refusing resolver produces output byte-for-byte identical to no resolver at all (G-D9)', () => {
      const body = `<w:p>${run('Pozwany [PERSON_NAME_1|D], zam. [ADDRESS_2].')}</w:p>`;
      const withRefuser = rebuild(body, LEGEND, { resolveReplacement: REFUSER });
      const withoutResolver = rebuild(body, LEGEND);
      expect(withRefuser.xml).toBe(withoutResolver.xml);
      expect(withRefuser.replaced).toEqual(withoutResolver.replaced);
      expect(withRefuser.declined).toEqual([]);
    });
  });

  // FD-1 §3.2: full seam contract — the resolver gets tokenId/type/case/
  // occurrence/part alongside token/baseValue/contexts, with contexts and
  // occurrence counted from the RAW (annotated) match span, even when the
  // token is torn across runs by proofErr/rsid.
  it('the resolver receives the full FD-1 contract, contexts counted from the raw annotated span', () => {
    const calls = [];
    const body = '<w:p>'
      + run('Zasądza od [PERSON_', '<w:rPr><w:b/></w:rPr>')
      + '<w:proofErr w:type="spellStart"/>'
      + run('NAME_1|D] kwotę.')
      + '</w:p>';
    rebuild(body, LEGEND, { resolveReplacement: (args) => { calls.push(args); return undefined; } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      token: '[PERSON_NAME_1]',
      tokenId: 'PERSON_NAME_1',
      type: 'PERSON_NAME',
      baseValue: 'Jan Kowalski',
      case: 'D',
      occurrence: 0,
      part: 'word/document.xml',
    });
    expect(calls[0].contextBefore).toBe('Zasądza od ');
    expect(calls[0].contextAfter).toBe(' kwotę.');
  });

  it('occurrence is a per-part counter over eligible (legend-having) hits, left to right', () => {
    const calls = [];
    const out = rebuild(
      `<w:p>${run('[PERSON_NAME_9] i [PERSON_NAME_1] i [ADDRESS_2] i [PERSON_NAME_1|D]')}</w:p>`,
      LEGEND,
      { resolveReplacement: (args) => { calls.push(args); return undefined; } },
    );
    // [PERSON_NAME_9] has no legend entry — never reaches the resolver at all.
    expect(calls.map((c) => c.occurrence)).toEqual([0, 1, 2]);
    expect(calls.map((c) => c.token)).toEqual(['[PERSON_NAME_1]', '[ADDRESS_2]', '[PERSON_NAME_1]']);
    expect(out.left).toContainEqual(expect.objectContaining({ token: '[PERSON_NAME_9]', reason: 'brak-w-legendzie' }));
  });

  // FD-2 (§3.3): a report row for every occurrence whose file value differs
  // from the base, carrying the resolver's own note metadata; a refusal
  // gets no row but is counted separately (flexionDeclinedCount, O-FL-2).
  describe('the flexion seam — FD-2 "odmieniono" rows and the decline counter', () => {
    it('a value differing from the base gets a declined row with the resolver note; a refusal gets none but bumps the counter', () => {
      const out = rebuild(
        `<w:p>${run('od [PERSON_NAME_1|D] oraz [PERSON_NAME_1]')}</w:p>`,
        LEGEND,
        {
          resolveReplacement: (args) => {
            if (args.occurrence === 0) {
              return { text: 'Jana Kowalskiego', note: { przypadek: 'D', zrodlo: 'reguła', pewnosc: 'wysoka' } };
            }
            return undefined; // second occurrence: PERSON_NAME, has a legend value, declines
          },
        },
      );
      expect(out.declined).toEqual([{
        token: '[PERSON_NAME_1]',
        z: 'Jan Kowalski',
        na: 'Jana Kowalskiego',
        przypadek: 'D',
        zrodlo: 'reguła',
        pewnosc: 'wysoka',
        part: 'word/document.xml',
      }]);
      expect(out.flexionDeclinedCount).toBe(1);
    });

    it('with no resolver at all, there are never declined rows nor decline counts', () => {
      const out = rebuild(`<w:p>${run('od [PERSON_NAME_1|D]')}</w:p>`, LEGEND);
      expect(out.declined).toEqual([]);
      expect(out.flexionDeclinedCount).toBe(0);
    });

    it('a non-PERSON_NAME refusal does not inflate the PERSON_NAME-scoped decline counter', () => {
      const out = rebuild(`<w:p>${run('zam. [ADDRESS_2]')}</w:p>`, LEGEND, { resolveReplacement: () => undefined });
      expect(out.flexionDeclinedCount).toBe(0);
      expect(out.declined).toEqual([]);
    });
  });
});

describe('countTokensInPart (report-only parts, §5.1)', () => {
  it('counts every token including field and deleted streams', () => {
    const xml = docXml('<w:p>'
      + run('[PERSON_NAME_1] i [PERSON_NAME_1]')
      + '<w:r><w:instrText>[ADDRESS_2]</w:instrText></w:r>'
      + '</w:p>');
    expect(countTokensInPart(xml, 'word/comments.xml')).toBe(3);
  });
});

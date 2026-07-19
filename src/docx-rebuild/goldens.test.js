// @vitest-environment jsdom
//
// Binds the COMMITTED files in test-data/docx/ to the engine's real
// behavior. The generator (scripts/generate-docx-rebuild-goldens.mjs) only
// writes bytes; this suite is the proof that what the README promises about
// each file is what the code actually does — so the manual MD6 pass in
// Word starts from files with machine-checked semantics. If a file on disk
// drifts from the generator's output, these assertions catch it.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebuildDocx } from './rebuild-docx.js';
import { openZip, ZipFormatError } from './zip-reader.js';
import { OoxmlInspectError } from './ooxml-inspect.js';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-data', 'docx');
const load = (name) => new Uint8Array(readFileSync(join(DIR, name)));

const LEGEND = {
  '[PERSON_NAME_1]': 'Jan Kowalski',
  '[PERSON_NAME_2]': 'Barbara Lis',
  '[ADDRESS_1]': 'ul. Piekary 33, 87-100 Toruń',
  '[CASE_NUMBER_1]': 'I C 1234/23',
};

describe('test-data/docx goldens — golden-pismo.docx', () => {
  it('rebuilds with every §5 structure behaving as documented', async () => {
    const { status, bytes, report } = await rebuildDocx(load('golden-pismo.docx'), LEGEND);
    expect(status).toBe('ok');

    // 6 in document.xml (whole-run, split-run, hyperlink text, fldSimple
    // result, tracked insert) + header + footer.
    expect(report.totals).toEqual({ replaced: 8, left: 0, declined: 0 });

    // The one external hyperlink is reported, not blocking (§9.3).
    expect(report.egress.hyperlinks).toBe(1);
    expect(report.egress.blocked).toEqual([]);

    // Tracked-delete text is report-only (§5.2): visible, counted, untouched.
    expect(report.reportOnly).toContainEqual(
      { part: 'word/document.xml', warstwa: 'tekst-usunięty', tokens: 1 },
    );

    const zip = openZip(bytes);
    const doc = new TextDecoder().decode(await zip.extract('word/document.xml'));
    expect(doc).toContain('Powód Jan Kowalski, zamieszkały: ul. Piekary 33, 87-100 Toruń');
    // Run-split token repaired first-run-wins; the second run's formatting
    // survives on its remaining text.
    expect(doc).toContain('Pozwany Barbara Lis');
    expect(doc).toContain('sygn. I C 1234/23 w Legalisie');
    expect(doc).toContain('Klient: Jan Kowalski');
    expect(doc).toContain('w:instr=" DOCPROPERTY Klient "');
    expect(doc).toContain('Wnosimy o zasądzenie od Barbara Lis kosztów procesu.');
    expect(doc).toContain('dawny zapis o [PERSON_NAME_1]');

    const header = new TextDecoder().decode(await zip.extract('word/header1.xml'));
    expect(header).toContain('pełnomocnik Jan Kowalski');
    const footer = new TextDecoder().decode(await zip.extract('word/footer1.xml'));
    expect(footer).toContain('ul. Piekary 33, 87-100 Toruń');

    // Relationship parts travel byte-for-byte (C-DOCX-5).
    const source = openZip(load('golden-pismo.docx'));
    for (const rels of ['_rels/.rels', 'word/_rels/document.xml.rels']) {
      expect(await zip.extract(rels)).toEqual(await source.extract(rels));
    }
  });
});

describe('test-data/docx goldens — hostile set refusals', () => {
  it('hostile-egress-template.docx blocks the export with the attachedTemplate finding', async () => {
    const { status, bytes, report } = await rebuildDocx(load('hostile-egress-template.docx'), LEGEND);
    expect(status).toBe('blocked-egress');
    expect(bytes).toBeNull();
    expect(report.egress.blocked).toHaveLength(1);
    expect(report.egress.blocked[0].type).toContain('attachedTemplate');
  });

  it.each([
    ['hostile-doctype-xxe.docx'],
    ['hostile-billion-laughs.docx'],
  ])('%s is refused at the DOCTYPE pre-scan (C-DOCX-1)', async (name) => {
    const err = await rebuildDocx(load(name), LEGEND).catch((e) => e);
    expect(err).toBeInstanceOf(OoxmlInspectError);
    expect(err.code).toBe('DOCTYPE');
  });

  it('hostile-macros.docx is refused as a macro container (C-DOCX-9)', async () => {
    const err = await rebuildDocx(load('hostile-macros.docx'), LEGEND).catch((e) => e);
    expect(err).toBeInstanceOf(OoxmlInspectError);
    expect(err.code).toBe('MACROS');
  });

  it('hostile-not-a-zip.docx is refused by the container layer (C-DOCX-9)', async () => {
    const err = await rebuildDocx(load('hostile-not-a-zip.docx'), LEGEND).catch((e) => e);
    expect(err).toBeInstanceOf(ZipFormatError);
  });
});

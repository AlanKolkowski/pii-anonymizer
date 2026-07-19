// OOXML inspection (DOCX-REBUILD-DESIGN.md MD3, §3.1 krok 2, §5.1, §9.3).
// Runs at import time on the untrusted container: resolves the parts the
// token engine will process BY RELATIONSHIP (never by guessed file names),
// refuses macros/Strict/DTD outright, and classifies every external
// reference — hyperlinks are allowed and counted, everything else external
// blocks the export (W4: the module itself never ADDS anything, so the
// input's own external references are the only egress candidates).
//
// Every XML part read here goes through rejectDoctype() first (C-DOCX-1) and
// a parsererror check after — fail-closed, never "skip this part".

export class OoxmlInspectError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'OoxmlInspectError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new OoxmlInspectError(message, code);
}

const decoder = new TextDecoder('utf-8', { fatal: false });

// C-DOCX-1: OOXML never legally carries a DTD, so any DOCTYPE/ENTITY marker
// is grounds for rejecting the whole file — the primary control, independent
// of any parser property. Exported for the token engine, which re-applies it
// to every part it parses.
export function rejectDoctype(xmlText, partName) {
  if (xmlText.includes('<!DOCTYPE') || xmlText.includes('<!ENTITY')) {
    fail(`Część „${partName}" zawiera deklarację DTD — dokument odrzucony.`, 'DOCTYPE');
  }
}

export function parseXmlPart(xmlText, partName) {
  rejectDoctype(xmlText, partName);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    fail(`Część „${partName}" nie jest poprawnym XML — dokument odrzucony.`, 'PARSE');
  }
  return doc;
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT_REL = /\/relationships\/officeDocument$/;
const TOKEN_PART_RELS = ['header', 'footer', 'footnotes', 'endnotes'];
const STRICT_NS_MARKER = 'purl.oclc.org/ooxml';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Field instructions that make Word reach outside the document on open
// (§9.3): INCLUDETEXT/INCLUDEPICTURE pull external content, DDE/DDEAUTO
// launch inter-process links.
const HOSTILE_INSTRUCTIONS = ['INCLUDETEXT', 'INCLUDEPICTURE', 'DDEAUTO', 'DDE'];
const HOSTILE_INSTR_NAME_RE = new RegExp(`\\b(${HOSTILE_INSTRUCTIONS.join('|')})\\b`);

// Fast POSITIVE pre-filter only (MD3-D1): matched inside a literal
// `<w:instrText` element or a `<w:fldSimple w:instr="…">` attribute — escaped
// body text cannot spell a raw tag, so a hit can never false-positive on
// prose, and a hit still blocks without needing a DOM parse. A MISS does
// NOT exempt the part from the DOM scan below: `w:` is a convention, not a
// guarantee — the same document can legally declare
// `xmlns:x="…wordprocessingml…"` and write `<x:instrText>DDEAUTO …`, which
// this literal-prefix regex would never see but Word still executes.
const HOSTILE_FIELD_RE = /<w:instrText[^>]*>[^<]*\b(INCLUDETEXT|INCLUDEPICTURE|DDEAUTO|DDE)\b|<w:fldSimple[^>]*w:instr="[^"]*\b(INCLUDETEXT|INCLUDEPICTURE|DDEAUTO|DDE)\b/;

// Authoritative check (MD3-D1): namespace-aware, so it catches a hostile
// instruction regardless of which prefix the document aliases the
// wordprocessingml namespace to. `getElementsByTagNameNS`/`getAttributeNS`
// resolve by the bound URI, never by the literal prefix string.
function scanHostileFieldsDOM(doc) {
  for (const el of doc.getElementsByTagNameNS(W_NS, 'instrText')) {
    const hit = HOSTILE_INSTR_NAME_RE.exec(el.textContent ?? '');
    if (hit) return hit[1];
  }
  for (const el of doc.getElementsByTagNameNS(W_NS, 'fldSimple')) {
    const hit = HOSTILE_INSTR_NAME_RE.exec(el.getAttributeNS(W_NS, 'instr') ?? '');
    if (hit) return hit[1];
  }
  return null;
}

function normalizeTarget(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `${baseDir}${target}`.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function relsPathFor(partName) {
  const idx = partName.lastIndexOf('/');
  const dir = idx === -1 ? '' : partName.slice(0, idx + 1);
  const base = idx === -1 ? partName : partName.slice(idx + 1);
  return `${dir}_rels/${base}.rels`;
}

async function readPartText(reader, name) {
  return decoder.decode(await reader.extract(name));
}

function relationshipsOf(doc) {
  return [...doc.getElementsByTagNameNS(REL_NS, 'Relationship')];
}

/**
 * Inspects an opened DOCX container (MD1 reader). Throws OoxmlInspectError
 * (macros, Strict OOXML, DTD, broken XML, not-a-DOCX); returns:
 *
 * {
 *   mainPart: 'word/document.xml',
 *   tokenParts: [...],           // main + headers/footers/foot/endnotes (§5.1)
 *   commentsPart: string|null,   // report-only in v1 (P-3)
 *   external: {
 *     hyperlinks: number,        // allowed, surfaced in the report
 *     blocked: [{ part, id, type, target }],  // any other external ref (§9.3)
 *   },
 * }
 */
export async function inspectDocx(reader) {
  const names = new Set(reader.entries.map((e) => e.name));

  if (!names.has('[Content_Types].xml') || !names.has('_rels/.rels')) {
    fail('To nie jest dokument DOCX (brak struktury OOXML).', 'NOT_DOCX');
  }
  // C-DOCX-9: a macro project disqualifies the file whatever the extension says.
  for (const name of names) {
    if (name.toLowerCase().includes('vbaproject')) {
      fail('Dokument zawiera makra (vbaProject) — nie jest legalnym wejściem tego przepływu.', 'MACROS');
    }
  }
  const contentTypes = await readPartText(reader, '[Content_Types].xml');
  rejectDoctype(contentTypes, '[Content_Types].xml');
  if (contentTypes.includes('macroEnabled')) {
    fail('Dokument deklaruje typ makro (macroEnabled) — odrzucony.', 'MACROS');
  }

  const rootRels = parseXmlPart(await readPartText(reader, '_rels/.rels'), '_rels/.rels');
  const officeDocumentRel = relationshipsOf(rootRels)
    .find((rel) => OFFICE_DOCUMENT_REL.test(rel.getAttribute('Type') ?? ''));
  if (!officeDocumentRel) fail('Brak głównej części dokumentu (officeDocument) w relacjach.', 'NOT_DOCX');
  const mainPart = normalizeTarget('', officeDocumentRel.getAttribute('Target') ?? '');
  if (!names.has(mainPart)) fail(`Główna część dokumentu „${mainPart}" nie istnieje w archiwum.`, 'NOT_DOCX');

  const mainText = await readPartText(reader, mainPart);
  rejectDoctype(mainText, mainPart);
  if (mainText.includes(STRICT_NS_MARKER)) {
    fail('Format Strict OOXML nie jest obsługiwany.', 'STRICT_OOXML');
  }

  // Parts the token engine processes, resolved by relationship (§5.1).
  const tokenParts = [mainPart];
  let commentsPart = null;
  const mainDir = mainPart.includes('/') ? mainPart.slice(0, mainPart.lastIndexOf('/') + 1) : '';
  const mainRelsName = relsPathFor(mainPart);
  if (names.has(mainRelsName)) {
    const mainRels = parseXmlPart(await readPartText(reader, mainRelsName), mainRelsName);
    for (const rel of relationshipsOf(mainRels)) {
      if ((rel.getAttribute('TargetMode') ?? 'Internal') === 'External') continue; // classified below
      const type = rel.getAttribute('Type') ?? '';
      const kind = type.slice(type.lastIndexOf('/') + 1);
      const target = normalizeTarget(mainDir, rel.getAttribute('Target') ?? '');
      if (!names.has(target)) continue;
      if (TOKEN_PART_RELS.includes(kind)) tokenParts.push(target);
      else if (kind === 'comments') commentsPart = target;
    }
  }

  // §9.3: every .rels in the container is scanned for external references.
  const external = { hyperlinks: 0, blocked: [] };
  for (const name of names) {
    if (!/(^|\/)_rels\/[^/]+\.rels$/.test(name)) continue;
    const relsDoc = parseXmlPart(await readPartText(reader, name), name);
    for (const rel of relationshipsOf(relsDoc)) {
      if ((rel.getAttribute('TargetMode') ?? 'Internal') !== 'External') continue;
      const type = rel.getAttribute('Type') ?? '';
      if (/\/relationships\/hyperlink$/.test(type)) {
        external.hyperlinks += 1;
      } else {
        external.blocked.push({
          part: name,
          id: rel.getAttribute('Id') ?? '',
          type,
          target: rel.getAttribute('Target') ?? '',
        });
      }
    }
  }

  // §9.3/MD3-D1: hostile field instructions in any token part block the
  // export too. The regex is a fast positive pre-filter; a miss falls
  // through to the namespace-aware DOM scan (parseXmlPart reuses the same
  // parser MD4 uses on this same part downstream — cost is one extra parse,
  // not a new dependency).
  for (const part of tokenParts) {
    const text = part === mainPart ? mainText : await readPartText(reader, part);
    rejectDoctype(text, part);
    const regexHit = HOSTILE_FIELD_RE.exec(text);
    const hostileName = regexHit ? (regexHit[1] ?? regexHit[2]) : scanHostileFieldsDOM(parseXmlPart(text, part));
    if (hostileName) {
      external.blocked.push({
        part,
        id: '',
        type: `field:${hostileName}`,
        target: '',
      });
    }
  }

  return { mainPart, tokenParts, commentsPart, external };
}

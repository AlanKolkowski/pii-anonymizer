// Orchestrator (DOCX-REBUILD-DESIGN.md MD5, §3.1): ties MD1-MD4 together as
// one pure in-RAM flow — open the untrusted container, inspect, run the
// token engine over the token parts, recompose with untouched parts copied
// verbatim, and produce the reconstruction report (§6.2). No network, no
// IPC, no disk: the only artifact is the returned bytes, which the UI hands
// to the user through the existing explicit download.
//
// Export gates (§6.3, §9.3): egress findings block with no bytes; zero
// replacements block with no bytes (P-4 — almost certainly the wrong file
// or somebody else's legend). Residues do NOT block — the result is safe
// (a token is not PII) and the report is the user's map of manual fixes.

import { openZip } from './zip-reader.js';
import { composeZip } from './zip-writer.js';
import { inspectDocx } from './ooxml-inspect.js';
import { rebuildPart, countTokensInPart } from './token-engine.js';

const decoder = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();

/**
 * @param {Uint8Array|ArrayBuffer} bytes - the untrusted .docx from the AI
 * @param {object} legend - token → value, read at export time (RAM only)
 * @param {object} [options]
 * @param {Function} [options.resolveReplacement] - flexion seam (§8)
 * @returns {Promise<{
 *   status: 'ok'|'blocked-egress'|'blocked-no-replacements',
 *   bytes: Uint8Array|null,
 *   report: object,   // §6.2 schema
 * }>}
 * Throws ZipFormatError/OoxmlInspectError for containers that are rejected
 * outright (hostile ZIP, macros, Strict, DTD, broken XML).
 */
export async function rebuildDocx(bytes, legend, options = {}) {
  const reader = openZip(bytes);
  const inspection = await inspectDocx(reader);

  const report = {
    parts: [],
    reportOnly: [],
    sanitized: 0,
    egress: {
      hyperlinks: inspection.external.hyperlinks,
      blocked: inspection.external.blocked,
    },
    totals: { replaced: 0, left: 0, declined: 0 },
    // FD-2/O-FL-2: occurrences where a PERSON_NAME resolver was consulted
    // (a resolveReplacement was actually passed in) and declined — distinct
    // from "no resolver at all", which never counts as a refusal.
    flexionDeclined: { count: 0 },
  };

  if (inspection.external.blocked.length > 0) {
    return { status: 'blocked-egress', bytes: null, report };
  }

  const modifications = new Map();
  for (const partName of inspection.tokenParts) {
    const xmlText = decoder.decode(await reader.extract(partName));
    const outcome = rebuildPart({
      xmlText,
      partName,
      legend,
      resolveReplacement: options.resolveReplacement ?? null,
    });
    report.sanitized += outcome.sanitized;
    report.totals.replaced += outcome.replaced.reduce((sum, r) => sum + r.count, 0);
    report.totals.left += outcome.left.length;
    report.totals.declined += outcome.declined.length;
    report.flexionDeclined.count += outcome.flexionDeclinedCount;
    if (outcome.replaced.length > 0 || outcome.left.length > 0 || outcome.declined.length > 0) {
      report.parts.push({
        part: partName,
        replaced: outcome.replaced,
        left: outcome.left,
        ...(outcome.declined.length > 0 && { declined: outcome.declined }),
      });
    }
    if (outcome.reportOnlyTokens.instrText > 0) {
      report.reportOnly.push({ part: partName, warstwa: 'kody-pól', tokens: outcome.reportOnlyTokens.instrText });
    }
    if (outcome.reportOnlyTokens.delText > 0) {
      report.reportOnly.push({ part: partName, warstwa: 'tekst-usunięty', tokens: outcome.reportOnlyTokens.delText });
    }
    if (outcome.changed) {
      modifications.set(partName, encoder.encode(outcome.xml));
    }
  }

  if (inspection.commentsPart) {
    const commentsXml = decoder.decode(await reader.extract(inspection.commentsPart));
    const tokens = countTokensInPart(commentsXml, inspection.commentsPart);
    if (tokens > 0) {
      report.reportOnly.push({ part: inspection.commentsPart, warstwa: 'komentarze', tokens });
    }
  }

  if (report.totals.replaced === 0) {
    return { status: 'blocked-no-replacements', bytes: null, report };
  }

  const rebuilt = await composeZip(reader, modifications);
  return { status: 'ok', bytes: rebuilt, report };
}

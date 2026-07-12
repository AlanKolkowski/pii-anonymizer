// Leak-oriented analysis of an eval run (EVAL-RECALL-AUDIT.md part C).
//
// score.js answers "how good are the metrics"; this module answers the
// question a radca prawny actually asks: WHICH characters of expected PII
// survived into the output unmasked, and WHICH pipeline layer let them
// through. Coverage is type-agnostic on purpose — a PESEL masked as a
// PHONE_NUMBER is still masked (a legend/type problem, not a secrecy
// leak); those cases surface in the confusion matrix instead.
//
// CLI: node src/eval/analyze.js [runId] — writes analysis.json + ANALIZA.md
// into the run directory. Layer attribution replays debug.json (the
// per-step entity diffs recorded by the runner).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvalText, EVAL_TEXT_CONVENTION } from './eval-text.js';
import { matchEntities, overlapRatio } from './matching.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

// Severity of a full leak of one entity of the given type, on a 1–5 scale
// anchored in professional-secrecy damage, not model taxonomy:
// 5 = identyfikator osoby / kategorie szczególne art. 9-10 RODO,
// 4 = bezpośrednie namiary na osobę (nazwisko, adres, kontakt, konto),
// 3 = pośrednio identyfikujące (sygnatura sprawy, data urodzenia w parze
//     z innymi danymi, atrybuty, kwoty roszczeń),
// 2 = dane podmiotów gospodarczych i lokalizacje,
// 1 = role i tytuły zawodowe.
export const TYPE_WEIGHTS = {
  PERSON_IDENTIFIER: 5,
  AUTH_SECRET: 5,
  HEALTH_DATA: 5,
  GENETIC_DATA: 5,
  BIOMETRIC_DATA: 5,
  RELIGION_OR_BELIEF: 5,
  POLITICAL_OPINION: 5,
  SEXUAL_ORIENTATION: 5,
  TRADE_UNION_MEMBERSHIP: 5,
  ETHNIC_ORIGIN: 5,
  CRIMINAL_OFFENCE_DATA: 5,
  PERSON_NAME: 4,
  POSTAL_ADDRESS: 4,
  EMAIL_ADDRESS: 4,
  PHONE_NUMBER: 4,
  CONTACT_HANDLE: 4,
  PERSON_ALIAS: 4,
  BANK_ACCOUNT_IDENTIFIER: 4,
  PAYMENT_CARD: 4,
  PAYMENT_CARD_SECURITY: 4,
  DEVICE_IDENTIFIER: 4,
  VEHICLE_IDENTIFIER: 4,
  ACCOUNT_IDENTIFIER: 4,
  DATE_OF_BIRTH: 3,
  DOCUMENT_REFERENCE: 3,
  PERSON_ATTRIBUTE: 3,
  INCOME_COMPENSATION: 3,
  FINANCIAL_AMOUNT: 3,
  IP_ADDRESS: 3,
  GEO_LOCATION: 3,
  COOKIE_IDENTIFIER: 3,
  ORGANIZATION_NAME: 2,
  ORGANIZATION_IDENTIFIER: 2,
  LOCATION: 2,
  PERSON_ROLE_OR_TITLE: 1,
};

export function weightFor(type) {
  return TYPE_WEIGHTS[type] ?? 3;
}

// ── Character coverage ──────────────────────────────────────────────

// Fraction of [e.start, e.end) covered by ANY predicted span, plus the
// uncovered runs (the literal characters that survive unmasked).
export function charCoverage(expected, predictedSpans) {
  const len = expected.end - expected.start;
  if (len <= 0) return { coverage: 1, uncovered: [] };
  const covered = new Array(len).fill(false);
  for (const p of predictedSpans) {
    const from = Math.max(p.start, expected.start);
    const to = Math.min(p.end, expected.end);
    for (let i = from; i < to; i++) covered[i - expected.start] = true;
  }
  const uncovered = [];
  let runStart = -1;
  for (let i = 0; i <= len; i++) {
    const on = i < len && !covered[i];
    if (on && runStart === -1) runStart = i;
    if (!on && runStart !== -1) {
      uncovered.push({ start: expected.start + runStart, end: expected.start + i });
      runStart = -1;
    }
  }
  const coveredCount = covered.filter(Boolean).length;
  return { coverage: coveredCount / len, uncovered };
}

// ── Confusion matrix ────────────────────────────────────────────────

// Type-agnostic span pairing (IoU ≥ threshold), then a matrix of
// expectedType × predictedType; unmatched rows/columns land in "(brak)".
export function confusionMatrix(expected, predicted, { overlapThreshold = 0.5 } = {}) {
  const { matched, missed, spurious } = matchEntities(expected, predicted, {
    overlapThreshold,
    requireTypeMatch: false,
  });
  const matrix = {};
  const bump = (expType, predType) => {
    matrix[expType] ??= {};
    matrix[expType][predType] = (matrix[expType][predType] || 0) + 1;
  };
  for (const m of matched) bump(m.expected.entity_group, m.predicted.entity_group);
  for (const e of missed) bump(e.entity_group, '(brak)');
  for (const p of spurious) bump('(brak)', p.entity_group);
  return matrix;
}

// ── Layer attribution ───────────────────────────────────────────────

const iou = overlapRatio;

function spansOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

// Replays debug.json (runner step diffs) for one expected span and decides
// which layer is responsible for its final state.
export function attributeLayer(expectedEntity, debugSteps, finalPredicted) {
  const overlappingAdds = [];
  const events = [];
  for (const step of debugSteps) {
    const ents = step.changes?.entities;
    if (!ents) continue;
    for (const a of ents.added ?? []) {
      if (spansOverlap(a, expectedEntity)) {
        overlappingAdds.push({ step: step.step, entity: a });
        events.push({ kind: 'add', step: step.step, entity: a });
      }
    }
    for (const r of ents.removed ?? []) {
      if (spansOverlap(r, expectedEntity)) {
        events.push({ kind: 'remove', step: step.step, entity: r });
      }
    }
  }

  const finalOverlaps = finalPredicted.filter((p) => spansOverlap(p, expectedEntity));

  if (finalOverlaps.length > 0) {
    const exact = finalOverlaps.some(
      (p) => p.start === expectedEntity.start && p.end === expectedEntity.end,
    );
    if (exact) return { layer: 'ok', detail: 'dokładne trafienie' };
    const best = finalOverlaps.reduce((a, b) => (iou(expectedEntity, a) >= iou(expectedEntity, b) ? a : b));
    // Wrong boundaries: did any step change them, or were they wrong from
    // the first detection?
    const firstAdd = overlappingAdds[0];
    const boundariesChangedBy = events
      .filter((e) => e.kind === 'add' && e.step !== firstAdd?.step)
      .map((e) => e.step);
    return {
      layer: 'granice',
      detail: firstAdd && firstAdd.entity.start === best.start && firstAdd.entity.end === best.end
        ? `granice z pierwszej detekcji (${firstAdd.step}, źródło: ${firstAdd.entity.source ?? '?'})`
        : `granice zmienione przez: ${[...new Set(boundariesChangedBy)].join(', ') || 'nieustalone'}`,
      finalSpan: { start: best.start, end: best.end, entity_group: best.entity_group },
    };
  }

  if (overlappingAdds.length === 0) {
    return { layer: 'detekcja', detail: 'żadna warstwa nie zgłosiła kandydata (model NER + regex milczą)' };
  }

  // Something was detected and later removed — find the last removal.
  const removals = events.filter((e) => e.kind === 'remove');
  const lastRemoval = removals[removals.length - 1];
  return {
    layer: lastRemoval ? lastRemoval.step : 'nieustalona',
    detail: `kandydat ${lastRemoval?.entity?.entity_group ?? '?'} [${lastRemoval?.entity?.start}:${lastRemoval?.entity?.end}] (źródło: ${lastRemoval?.entity?.source ?? '?'}, score: ${lastRemoval?.entity?.score?.toFixed?.(2) ?? '?'}) usunięty w kroku ${lastRemoval?.step}`,
    candidates: overlappingAdds.map((a) => ({
      step: a.step,
      entity_group: a.entity.entity_group,
      start: a.entity.start,
      end: a.entity.end,
      source: a.entity.source,
      score: a.entity.score,
    })),
  };
}

// ── Run analysis ────────────────────────────────────────────────────

export async function analyzeRun(runDir, docsDir) {
  const entries = await readdir(docsDir);
  const expectedFiles = entries.filter((f) => f.endsWith('.expected.json')).sort();

  const docs = [];
  const leaks = [];
  const matrixTotal = {};

  for (const expFile of expectedFiles) {
    const name = expFile.replace(/\.expected\.json$/, '');
    let predicted;
    let debugSteps;
    try {
      predicted = JSON.parse(await readFile(join(runDir, name, 'entities.json'), 'utf-8'));
      debugSteps = JSON.parse(await readFile(join(runDir, name, 'debug.json'), 'utf-8'));
    } catch {
      continue; // doc not part of this run
    }
    const expected = JSON.parse(await readFile(join(docsDir, expFile), 'utf-8'));
    const text = await readEvalText(join(docsDir, `${name}.txt`));

    // Confusion matrix (aggregate)
    const m = confusionMatrix(expected, predicted);
    for (const [et, row] of Object.entries(m)) {
      matrixTotal[et] ??= {};
      for (const [pt, n] of Object.entries(row)) {
        matrixTotal[et][pt] = (matrixTotal[et][pt] || 0) + n;
      }
    }

    // Leaks: any expected entity not fully covered by predicted spans.
    for (const e of expected) {
      const { coverage, uncovered } = charCoverage(e, predicted);
      if (coverage >= 1) continue;
      const attribution = attributeLayer(e, debugSteps, predicted);
      const residues = uncovered.map((u) => text.slice(u.start, u.end));
      leaks.push({
        doc: name,
        entity_group: e.entity_group,
        text: e.text,
        span: [e.start, e.end],
        coverage: Number(coverage.toFixed(3)),
        residues,
        weight: weightFor(e.entity_group),
        leakScore: Number((weightFor(e.entity_group) * (1 - coverage)).toFixed(2)),
        layer: attribution.layer,
        layerDetail: attribution.detail,
      });
    }

    docs.push({ name, expected: expected.length, predicted: predicted.length });
  }

  leaks.sort((a, b) => b.leakScore - a.leakScore || a.doc.localeCompare(b.doc));
  return { docs, leaks, matrix: matrixTotal };
}

// ── Markdown rendering ──────────────────────────────────────────────

export function renderMarkdown({ runId, docsDirRel, docs, leaks, matrix }) {
  const lines = [];
  lines.push(`# Analiza przecieków — run ${runId} (korpus: ${docsDirRel})`);
  lines.push('');
  lines.push(`Dokumentów: ${docs.length}, encji oczekiwanych: ${docs.reduce((s, d) => s + d.expected, 0)}, przecieków (pokrycie < 100%): ${leaks.length}.`);
  lines.push('');
  lines.push('Pokrycie liczone agnostycznie względem typu: PESEL zamaskowany jako telefon');
  lines.push('nie jest przeciekiem treści (trafia za to do macierzy pomyłek).');
  lines.push('');

  lines.push('## Rejestr przecieków (malejąco wg dotkliwości: waga typu × niepokryta część)');
  lines.push('');
  lines.push('| # | Waga | Score | Dokument | Typ | Pokrycie | Rezyduum (co wychodzi) | Warstwa | Szczegół |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  leaks.forEach((l, i) => {
    const residue = l.residues.join(' … ').replace(/\n/g, '\\n').replace(/\|/g, '\\|');
    const detail = String(l.layerDetail).replace(/\n/g, ' ').replace(/\|/g, '\\|');
    lines.push(`| ${i + 1} | ${l.weight} | ${l.leakScore} | ${l.doc} | ${l.entity_group} | ${(l.coverage * 100).toFixed(0)}% | \`${residue.slice(0, 60)}\` | **${l.layer}** | ${detail.slice(0, 110)} |`);
  });
  lines.push('');

  // Aggregation by layer and type
  const byLayer = {};
  const byType = {};
  for (const l of leaks) {
    byLayer[l.layer] = (byLayer[l.layer] || 0) + 1;
    byType[l.entity_group] ??= { count: 0, score: 0 };
    byType[l.entity_group].count += 1;
    byType[l.entity_group].score += l.leakScore;
  }
  lines.push('## Przecieki wg warstwy');
  lines.push('');
  lines.push('| Warstwa | Przecieków |');
  lines.push('|---|---|');
  for (const [layer, n] of Object.entries(byLayer).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${layer} | ${n} |`);
  }
  lines.push('');
  lines.push('## Przecieki wg typu (suma score)');
  lines.push('');
  lines.push('| Typ | Przecieków | Σ score |');
  lines.push('|---|---|---|');
  for (const [t, v] of Object.entries(byType).sort((a, b) => b[1].score - a[1].score)) {
    lines.push(`| ${t} | ${v.count} | ${v.score.toFixed(1)} |`);
  }
  lines.push('');

  // Confusion matrix
  const expTypes = Object.keys(matrix).sort();
  const predTypes = [...new Set(Object.values(matrix).flatMap((r) => Object.keys(r)))].sort();
  lines.push('## Macierz pomyłek (wiersze: oczekiwane, kolumny: przewidziane; parowanie po IoU ≥ 0,5 bez wymogu typu)');
  lines.push('');
  lines.push(`| oczekiwane \\ przewidziane | ${predTypes.join(' | ')} |`);
  lines.push(`|---|${predTypes.map(() => '---').join('|')}|`);
  for (const et of expTypes) {
    const row = predTypes.map((pt) => matrix[et][pt] || '');
    lines.push(`| **${et}** | ${row.join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  let runId = positional[0] || 'latest';
  if (runId === 'latest') {
    const { readlink } = await import('node:fs/promises');
    runId = await readlink(join(RESULTS_DIR, 'latest'));
  }
  const runDir = join(RESULTS_DIR, runId);

  const summary = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf-8'));
  if (summary.textConvention !== EVAL_TEXT_CONVENTION) {
    console.error(`Run ${runId} lacks textConvention="${EVAL_TEXT_CONVENTION}" — refusing (stale run).`);
    process.exit(1);
  }
  const docsDirRel = summary.docsDir ?? 'test-data/synthetic';
  const docsDir = resolve(join(TEST_DATA_DIR, '..'), docsDirRel);

  const analysis = await analyzeRun(runDir, docsDir);
  const md = renderMarkdown({ runId, docsDirRel, ...analysis });

  await writeFile(join(runDir, 'analysis.json'), JSON.stringify(analysis, null, 2), 'utf-8');
  await writeFile(join(runDir, 'ANALIZA.md'), md, 'utf-8');
  console.log(`Leaks: ${analysis.leaks.length} (docs: ${analysis.docs.length})`);
  console.log(`Written: ${join(runDir, 'ANALIZA.md')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Analysis failed:', err);
    process.exit(1);
  });
}

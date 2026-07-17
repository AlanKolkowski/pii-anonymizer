import { effectiveOutcomeLegend as effectiveLegend } from '../substitution.js';

const NOOP_OUTCOMES_LIST = {
  addOutcome() {},
  updateOutcome() {},
  removeOutcome() {},
  refreshLegend() {},
};

function legendSnapshot(legend) {
  return legend && Object.keys(legend).length > 0 ? { ...legend } : null;
}

export function createOutcomesCoordinator({
  outcomes,
  outcomesList = NOOP_OUTCOMES_LIST,
  deanonWorkspace,
  getLegend,
  makeId = () => crypto.randomUUID(),
}) {
  function currentLegend() {
    return typeof getLegend === 'function' ? getLegend() : {};
  }

  function createOutcome(label, text, mcpLabel = label, extra = {}) {
    const id = makeId();
    const liveLegend = currentLegend();
    // DOCX-REBUILD §3.4: a DOCX outcome carries `docx: { bytes, inspection }`
    // — RAM only, gone with the outcome; never serialized anywhere and never
    // part of any MCP payload (listings read `text` exclusively).
    const outcome = { id, label, mcpLabel, text, legendSnapshot: legendSnapshot(liveLegend), ...extra };
    outcomes.push(outcome);
    outcomesList.addOutcome(id, label, text, effectiveLegend(outcome, liveLegend));
    deanonWorkspace.activateOutcome(id);
    return id;
  }

  function updateOutcomeFields(id, label, text, { mcpLabel } = {}) {
    const outcome = outcomes.find((x) => x.id === id);
    if (!outcome) return false;
    // DOCX-REBUILD §3.4: the text of a DOCX outcome is a READ-ONLY preview —
    // the bytes are the source of truth, and an edited preview would promise
    // an export that cannot reflect it.
    if (outcome.docx) return false;
    const liveLegend = currentLegend();
    outcome.label = label;
    outcome.text = text;
    if (mcpLabel !== undefined) outcome.mcpLabel = mcpLabel;
    outcome.legendSnapshot = legendSnapshot(liveLegend) ?? outcome.legendSnapshot ?? null;
    outcomesList.updateOutcome(id, label, text, effectiveLegend(outcome, liveLegend));
    deanonWorkspace.activateOutcome(id);
    return true;
  }

  function removeOutcome(id) {
    const idx = outcomes.findIndex((o) => o.id === id);
    if (idx === -1) return false;
    outcomes.splice(idx, 1);
    outcomesList.removeOutcome(id);
    deanonWorkspace.render();
    return true;
  }

  function refreshLegend(legend = currentLegend()) {
    for (const outcome of outcomes) {
      outcomesList.updateOutcome(outcome.id, outcome.label, outcome.text, effectiveLegend(outcome, legend));
    }
    deanonWorkspace.refreshLegend();
  }

  return {
    createOutcome,
    updateOutcomeFields,
    removeOutcome,
    refreshLegend,
  };
}

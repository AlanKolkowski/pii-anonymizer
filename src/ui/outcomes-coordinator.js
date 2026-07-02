const NOOP_OUTCOMES_LIST = {
  addOutcome() {},
  updateOutcome() {},
  removeOutcome() {},
  refreshLegend() {},
};

function legendSnapshot(legend) {
  return legend && Object.keys(legend).length > 0 ? { ...legend } : null;
}

function effectiveLegend(outcome, liveLegend) {
  return outcome?.legendSnapshot ?? liveLegend ?? {};
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

  function createOutcome(label, text, mcpLabel = label) {
    const id = makeId();
    const liveLegend = currentLegend();
    const outcome = { id, label, mcpLabel, text, legendSnapshot: legendSnapshot(liveLegend) };
    outcomes.push(outcome);
    outcomesList.addOutcome(id, label, text, effectiveLegend(outcome, liveLegend));
    deanonWorkspace.activateOutcome(id);
    return id;
  }

  function updateOutcomeFields(id, label, text, { mcpLabel } = {}) {
    const outcome = outcomes.find((x) => x.id === id);
    if (!outcome) return false;
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

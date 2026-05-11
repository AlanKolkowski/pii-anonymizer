const NOOP_OUTCOMES_LIST = {
  addOutcome() {},
  updateOutcome() {},
  removeOutcome() {},
  refreshLegend() {},
};

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

  function createOutcome(label, text) {
    const id = makeId();
    outcomes.push({ id, label, text });
    outcomesList.addOutcome(id, label, text, currentLegend());
    deanonWorkspace.activateOutcome(id);
    return id;
  }

  function updateOutcomeFields(id, label, text) {
    const outcome = outcomes.find((x) => x.id === id);
    if (!outcome) return false;
    outcome.label = label;
    outcome.text = text;
    outcomesList.updateOutcome(id, label, text, currentLegend());
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
    outcomesList.refreshLegend(legend);
    deanonWorkspace.refreshLegend();
  }

  return {
    createOutcome,
    updateOutcomeFields,
    removeOutcome,
    refreshLegend,
  };
}

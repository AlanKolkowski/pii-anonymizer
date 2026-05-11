export function createToolModeController(rootEl, options = {}) {
  const tabs = [...rootEl.querySelectorAll('[data-mode-tab]')];
  const panels = [...rootEl.querySelectorAll('[data-mode-panel]')];
  const validModes = new Set([
    ...tabs.map((el) => el.dataset.modeTab),
    ...panels.map((el) => el.dataset.modePanel),
  ]);
  const initialMode = options.initialMode ?? 'anonymize';
  let mode = validModes.has(initialMode) ? initialMode : tabs[0]?.dataset.modeTab;

  function apply(nextMode, notify = true) {
    if (!validModes.has(nextMode)) return;
    mode = nextMode;
    rootEl.dataset.toolMode = mode;
    for (const tab of tabs) {
      const active = tab.dataset.modeTab === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.modePanel !== mode;
    }
    if (notify && typeof options.onChange === 'function') options.onChange(mode);
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => apply(tab.dataset.modeTab));
  }

  apply(mode, false);

  return {
    getMode() { return mode; },
    setMode(nextMode) { apply(nextMode); },
  };
}

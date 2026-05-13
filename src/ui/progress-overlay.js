import { formatStepDuration, getProgressView } from './progress-state.js';

const RING_CIRCUMFERENCE = 2 * Math.PI * 28;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHECK_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"/></svg>';

function appendText(parent, tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function createRing(percent) {
  const ring = document.createElement('div');
  ring.className = 'progress-ring';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('class', 'track');
  track.setAttribute('cx', '32');
  track.setAttribute('cy', '32');
  track.setAttribute('r', '28');
  svg.appendChild(track);

  const fill = document.createElementNS(SVG_NS, 'circle');
  fill.setAttribute('class', 'fill');
  fill.setAttribute('cx', '32');
  fill.setAttribute('cy', '32');
  fill.setAttribute('r', '28');
  fill.setAttribute('stroke-dasharray', RING_CIRCUMFERENCE.toFixed(3));
  fill.setAttribute(
    'stroke-dashoffset',
    (RING_CIRCUMFERENCE * (1 - percent / 100)).toFixed(3),
  );
  svg.appendChild(fill);

  ring.appendChild(svg);
  appendText(ring, 'div', 'pct', `${Math.round(percent)}%`);
  return ring;
}

function createMeta(view) {
  const meta = document.createElement('span');
  meta.className = 'step-meta';

  const parts = [];
  if (view.documentLabel) parts.push(view.documentLabel);
  parts.push(`krok ${view.activeStepIndex + 1} z ${view.totalSteps}`);

  parts.forEach((part, index) => {
    if (index > 0) appendText(meta, 'span', '', '·');
    appendText(meta, 'span', '', part);
  });
  return meta;
}

function createSummary(view) {
  const summary = document.createElement('div');
  summary.className = 'progress-summary';
  appendText(
    summary,
    'div',
    'progress-title',
    view.status === 'done' ? 'Gotowe' : (view.status === 'error' ? 'Błąd' : 'Anonimizowanie dokumentu'),
  );
  const meta = document.createElement('span');
  meta.className = 'step-meta';
  const parts = [];
  if (view.documentLabel) parts.push(view.documentLabel);
  parts.push(`${view.totalSteps} kroków pipeline'u`);
  parts.forEach((part, index) => {
    if (index > 0) appendText(meta, 'span', '', '·');
    appendText(meta, 'span', '', part);
  });
  summary.appendChild(meta);
  return summary;
}

function createActiveDetail(view) {
  const detail = document.createElement('div');
  detail.className = 'step-detail';
  detail.appendChild(createRing(view.activePercent));

  const text = document.createElement('div');
  text.className = 'progress-text';
  appendText(text, 'span', 'step-name', view.currentLabel);
  text.appendChild(createMeta(view));
  detail.appendChild(text);
  return detail;
}

function createStepRow(step, index, view) {
  const row = document.createElement('div');
  row.className = `step ${step.status === 'pending' ? '' : step.status}`.trim();

  const dot = document.createElement('div');
  dot.className = 'step-dot';
  if (step.status === 'done') {
    dot.innerHTML = CHECK_ICON_SVG;
  } else {
    appendText(dot, 'span', '', String(index + 1).padStart(2, '0'));
  }
  row.appendChild(dot);

  appendText(row, 'div', 'step-label', step.label);
  appendText(
    row,
    'div',
    'step-time',
    step.status === 'done' ? formatStepDuration(step.durationMs) : '',
  );

  if (step.status === 'active') {
    row.appendChild(createActiveDetail(view));
  }

  return row;
}

export function renderProgressOverlay(host, state) {
  const view = getProgressView(state);
  host.innerHTML = '';
  if (!view.visible) return;

  const overlay = document.createElement('div');
  overlay.className = `progress-overlay ${view.fading ? 'fading' : ''}`.trim();
  overlay.dataset.testid = 'progress-overlay';
  overlay.setAttribute('aria-live', 'polite');

  const card = document.createElement('div');
  card.className = 'progress-card';
  card.appendChild(createSummary(view));

  const stepper = document.createElement('div');
  stepper.className = 'stepper';
  view.steps.forEach((step, index) => {
    stepper.appendChild(createStepRow(step, index, view));
  });
  card.appendChild(stepper);

  overlay.appendChild(card);
  host.appendChild(overlay);
}

export function createProgressOverlay(parentEl) {
  const host = document.createElement('div');
  host.dataset.testid = 'progress-overlay-host';
  parentEl.appendChild(host);
  return {
    element: host,
    render(state) {
      renderProgressOverlay(host, state);
    },
  };
}

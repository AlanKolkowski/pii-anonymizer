// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createInitialProgressState, progressReducer } from './progress-state.js';
import { renderProgressOverlay } from './progress-overlay.js';

function render(state) {
  const host = document.createElement('div');
  renderProgressOverlay(host, state);
  return host.innerHTML;
}

describe('renderProgressOverlay', () => {
  it('snapshots the active download state', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 2, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 2, t: 0 });
    state = progressReducer(state, {
      type: 'download-progress',
      file: 'eu-pii-pl/model.onnx',
      progress: 42,
      t: 50,
    });

    expect(render(state)).toMatchInlineSnapshot(`"<div class="progress-overlay" data-testid="progress-overlay" aria-live="polite"><div class="progress-card"><div class="progress-head"><div class="progress-ring"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="28"></circle><circle class="fill" cx="32" cy="32" r="28" stroke-dasharray="175.929" stroke-dashoffset="163.614"></circle></svg><div class="pct">7%</div></div><div class="progress-text"><span class="step-name">Pobieranie modelu eu-pii-pl/model.onnx · 42%</span><span class="step-meta"><span>Dokument 1 z 2</span><span>·</span><span>krok 1 z 6</span></span></div></div><div class="stepper"><div class="step active"><div class="step-dot"><span>01</span></div><div class="step-label">Pobieranie modeli</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>02</span></div><div class="step-label">Preprocessing — normalizacja whitespace</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>03</span></div><div class="step-label">Segmentacja zdań (sentencex)</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>04</span></div><div class="step-label">Detekcja encji — modele HF i reguły</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>05</span></div><div class="step-label">Postprocessing — filtrowanie i granice słów</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>06</span></div><div class="step-label">Rescan i tokenizacja wykrytych PII</div><div class="step-time"></div></div></div></div></div>"`);
  });

  it('snapshots the done state with completed step times', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:start', t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:end', t: 120 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:preprocess:start', t: 120 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:preprocess:end', t: 180 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:segment:start', t: 180 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:segment:end', t: 300 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:ner:start', t: 300 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:ner:end', t: 950 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:postprocess:start', t: 950 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:postprocess:end', t: 1010 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:rescan:start', t: 1010 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:rescan:end', t: 1120 });
    state = progressReducer(state, { type: 'result', id: 'doc-1', t: 1120 });

    expect(render(state)).toMatchInlineSnapshot(`"<div class="progress-overlay" data-testid="progress-overlay" aria-live="polite"><div class="progress-card"><div class="progress-head"><div class="progress-ring"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="28"></circle><circle class="fill" cx="32" cy="32" r="28" stroke-dasharray="175.929" stroke-dashoffset="0.000"></circle></svg><div class="pct">100%</div></div><div class="progress-text"><span class="step-name">Rescan i tokenizacja wykrytych PII</span><span class="step-meta"><span>krok 6 z 6</span></span></div></div><div class="stepper"><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Pobieranie modeli</div><div class="step-time">0.12s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Preprocessing — normalizacja whitespace</div><div class="step-time">0.06s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Segmentacja zdań (sentencex)</div><div class="step-time">0.12s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Detekcja encji — modele HF i reguły</div><div class="step-time">0.65s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Postprocessing — filtrowanie i granice słów</div><div class="step-time">0.06s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Rescan i tokenizacja wykrytych PII</div><div class="step-time">0.11s</div></div></div></div></div>"`);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createInitialProgressState, progressReducer } from './progress-state.js';
import { renderProgressOverlay } from './progress-overlay.js';

function renderHost(state) {
  const host = document.createElement('div');
  renderProgressOverlay(host, state);
  return host;
}

function render(state) {
  return renderHost(state).innerHTML;
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

    expect(render(state)).toMatchInlineSnapshot(`"<div class="progress-overlay" data-testid="progress-overlay" aria-live="polite"><div class="progress-card"><div class="progress-summary"><div class="progress-title">Anonimizowanie dokumentu</div><span class="step-meta"><span>Dokument 1 z 2</span><span>·</span><span>7 kroków pipeline'u</span></span></div><div class="stepper"><div class="step active"><div class="step-dot"><span>01</span></div><div class="step-label">Pobieranie modeli</div><div class="step-time"></div><div class="step-detail"><div class="progress-ring"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="28"></circle><circle class="fill" cx="32" cy="32" r="28" stroke-dasharray="175.929" stroke-dashoffset="102.039"></circle></svg><div class="pct">42%</div></div><div class="progress-text"><div class="step-name-row"><span class="step-name">Pobieranie modeli · eu-pii-pl/model.onnx</span><span class="step-metric">42%</span></div><span class="step-meta"><span>Dokument 1 z 2</span><span>·</span><span>krok 1 z 7</span></span></div></div></div><div class="step"><div class="step-dot"><span>02</span></div><div class="step-label">Preprocessing — normalizacja whitespace</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>03</span></div><div class="step-label">Segmentacja zdań (sentencex)</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>04</span></div><div class="step-label">Ładowanie modeli (WASM/WebNN)</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>05</span></div><div class="step-label">Inferencja NER — modele HF i reguły</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>06</span></div><div class="step-label">Postprocessing — filtrowanie i granice słów</div><div class="step-time"></div></div><div class="step"><div class="step-dot"><span>07</span></div><div class="step-label">Rescan i tokenizacja wykrytych PII</div><div class="step-time"></div></div></div></div></div>"`);
  });

  it('renders model-loading progress as a count with a sweep inside the active ring segment', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:model-load:start', t: 0 });
    state = progressReducer(state, {
      type: 'model-load-progress',
      status: 'loading',
      source: 'polish-fp16',
      completed: 1,
      total: 2,
      t: 10,
    });

    const host = renderHost(state);
    expect(host.querySelector('.progress-ring.segment-indeterminate .pct')?.textContent).toBe('1/2');
    const sweep = host.querySelector('.progress-ring.segment-indeterminate .sweep');
    expect(sweep).not.toBeNull();
    expect(sweep?.getAttribute('stroke-dasharray')).toMatch(/^39\.584 /);
    expect(sweep?.style.getPropertyValue('--seg-from')).toBe('127.549');
    expect(sweep?.style.getPropertyValue('--seg-to')).toBe('79.168');
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
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:model-load:start', t: 300 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:model-load:end', t: 430 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:ner:start', t: 430 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:ner:end', t: 950 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:postprocess:start', t: 950 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:postprocess:end', t: 1010 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:rescan:start', t: 1010 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:rescan:end', t: 1120 });
    state = progressReducer(state, { type: 'result', id: 'doc-1', t: 1120 });

    expect(render(state)).toMatchInlineSnapshot(`"<div class="progress-overlay" data-testid="progress-overlay" aria-live="polite"><div class="progress-card"><div class="progress-summary"><div class="progress-title">Gotowe</div><span class="step-meta"><span>7 kroków pipeline'u</span></span></div><div class="stepper"><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Pobieranie modeli</div><div class="step-time">0.12s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Preprocessing — normalizacja whitespace</div><div class="step-time">0.06s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Segmentacja zdań (sentencex)</div><div class="step-time">0.12s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Ładowanie modeli (WASM/WebNN)</div><div class="step-time">0.13s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Inferencja NER — modele HF i reguły</div><div class="step-time">0.52s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Postprocessing — filtrowanie i granice słów</div><div class="step-time">0.06s</div></div><div class="step done"><div class="step-dot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4"></path></svg></div><div class="step-label">Rescan i tokenizacja wykrytych PII</div><div class="step-time">0.11s</div></div></div></div></div>"`);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createToolModeController } from './tool-mode.js';

function setup() {
  document.body.innerHTML = `
    <div class="tool">
      <button class="tool-tab" data-mode-tab="anonymize"><span class="num">01</span>Anonimizuj</button>
      <button class="tool-tab" data-mode-tab="deanonymize"><span class="num">02</span>Deanonimizuj</button>
      <section data-mode-panel="anonymize"></section>
      <section data-mode-panel="deanonymize"></section>
    </div>
  `;
  const root = document.querySelector('.tool');
  const onChange = vi.fn();
  const ctrl = createToolModeController(root, { onChange });
  return { root, ctrl, onChange };
}

describe('createToolModeController', () => {
  it('defaults to anonymize and hides deanonymize panel', () => {
    const { root, ctrl } = setup();

    expect(ctrl.getMode()).toBe('anonymize');
    expect(root.querySelector('[data-mode-tab="anonymize"]').classList.contains('active')).toBe(true);
    expect(root.querySelector('[data-mode-tab="deanonymize"]').classList.contains('active')).toBe(false);
    expect(root.querySelector('[data-mode-panel="anonymize"]').hidden).toBe(false);
    expect(root.querySelector('[data-mode-panel="deanonymize"]').hidden).toBe(true);
  });

  it('clicking the second tab switches visible mode and calls onChange', () => {
    const { root, ctrl, onChange } = setup();

    root.querySelector('[data-mode-tab="deanonymize"]').click();

    expect(ctrl.getMode()).toBe('deanonymize');
    expect(root.querySelector('[data-mode-tab="anonymize"]').classList.contains('active')).toBe(false);
    expect(root.querySelector('[data-mode-tab="deanonymize"]').classList.contains('active')).toBe(true);
    expect(root.querySelector('[data-mode-panel="anonymize"]').hidden).toBe(true);
    expect(root.querySelector('[data-mode-panel="deanonymize"]').hidden).toBe(false);
    expect(onChange).toHaveBeenCalledWith('deanonymize');
  });
});

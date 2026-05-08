// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOutcomesList } from './index.js';

describe('createOutcomesList', () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root');
  });

  it('renders no cards initially', () => {
    createOutcomesList(root, { onRemove: vi.fn() });
    expect(root.querySelectorAll('[data-testid^="outcome-card-"]').length).toBe(0);
  });

  it('addOutcome renders a card with the deanonymized text', () => {
    const list = createOutcomesList(root, { onRemove: vi.fn() });
    list.addOutcome('o1', 'Pismo', '[PERSON_NAME_1] przyjmuje warunki.', {
      '[PERSON_NAME_1]': 'Jan Kowalski',
    });
    const body = root.querySelector('[data-testid="outcome-body-o1"]');
    expect(body.textContent).toBe('Jan Kowalski przyjmuje warunki.');
  });

  it('updateOutcome re-renders body and label', () => {
    const list = createOutcomesList(root, { onRemove: vi.fn() });
    list.addOutcome('o1', 'A', '[PERSON_NAME_1] tu.', { '[PERSON_NAME_1]': 'Jan' });
    list.updateOutcome('o1', 'B', '[PERSON_NAME_1] tam.', { '[PERSON_NAME_1]': 'Anna' });
    expect(
      root.querySelector('[data-testid="outcome-label-o1"]').textContent,
    ).toBe('B');
    expect(
      root.querySelector('[data-testid="outcome-body-o1"]').textContent,
    ).toBe('Anna tam.');
  });

  it('refreshLegend re-renders every card with the new legend', () => {
    const list = createOutcomesList(root, { onRemove: vi.fn() });
    list.addOutcome('o1', 'A', '[PERSON_NAME_1] tu.', { '[PERSON_NAME_1]': 'Jan' });
    list.addOutcome('o2', 'B', '[PERSON_NAME_1] tam.', { '[PERSON_NAME_1]': 'Jan' });
    list.refreshLegend({ '[PERSON_NAME_1]': 'Anna' });
    expect(root.querySelector('[data-testid="outcome-body-o1"]').textContent).toBe('Anna tu.');
    expect(root.querySelector('[data-testid="outcome-body-o2"]').textContent).toBe('Anna tam.');
  });

  it('removeOutcome detaches the card', () => {
    const list = createOutcomesList(root, { onRemove: vi.fn() });
    list.addOutcome('o1', 'A', 'x', {});
    list.removeOutcome('o1');
    expect(root.querySelector('[data-testid="outcome-card-o1"]')).toBeNull();
  });

  it('clicking remove fires onRemove(id)', () => {
    const onRemove = vi.fn();
    const list = createOutcomesList(root, { onRemove });
    list.addOutcome('o1', 'A', 'x', {});
    root.querySelector('[data-testid="outcome-remove-o1"]').click();
    expect(onRemove).toHaveBeenCalledWith('o1');
  });
});

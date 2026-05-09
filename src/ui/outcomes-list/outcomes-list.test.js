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

  describe('add-outcome form', () => {
    it('renders an inline form for creating outcomes by paste', () => {
      createOutcomesList(root, { onRemove: vi.fn(), onAdd: vi.fn() });
      expect(root.querySelector('[data-testid="outcome-add-label"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="outcome-add-text"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="outcome-add-submit"]')).not.toBeNull();
    });

    it('default label increments per add ("Wynik 1", "Wynik 2", ...)', () => {
      createOutcomesList(root, { onRemove: vi.fn(), onAdd: vi.fn() });
      const labelInput = root.querySelector('[data-testid="outcome-add-label"]');
      expect(labelInput.value).toBe('Wynik 1');
    });

    it('submit fires onAdd(label, text) and clears the form', () => {
      const onAdd = vi.fn();
      createOutcomesList(root, { onRemove: vi.fn(), onAdd });
      const labelInput = root.querySelector('[data-testid="outcome-add-label"]');
      const textInput = root.querySelector('[data-testid="outcome-add-text"]');
      const submit = root.querySelector('[data-testid="outcome-add-submit"]');

      labelInput.value = 'Pismo';
      textInput.value = '[PERSON_NAME_1] zgadza się.';
      textInput.dispatchEvent(new Event('input'));
      submit.click();

      expect(onAdd).toHaveBeenCalledWith('Pismo', '[PERSON_NAME_1] zgadza się.');
      expect(textInput.value).toBe('');
      expect(labelInput.value).toBe('Wynik 2');
    });

    it('submit is disabled when text is empty', () => {
      createOutcomesList(root, { onRemove: vi.fn(), onAdd: vi.fn() });
      const submit = root.querySelector('[data-testid="outcome-add-submit"]');
      expect(submit.disabled).toBe(true);

      const textInput = root.querySelector('[data-testid="outcome-add-text"]');
      textInput.value = 'something';
      textInput.dispatchEvent(new Event('input'));
      expect(submit.disabled).toBe(false);

      textInput.value = '   ';
      textInput.dispatchEvent(new Event('input'));
      expect(submit.disabled).toBe(true);
    });

    it('submit does nothing when label is blank (defensive)', () => {
      const onAdd = vi.fn();
      createOutcomesList(root, { onRemove: vi.fn(), onAdd });
      const labelInput = root.querySelector('[data-testid="outcome-add-label"]');
      const textInput = root.querySelector('[data-testid="outcome-add-text"]');
      const submit = root.querySelector('[data-testid="outcome-add-submit"]');

      labelInput.value = '   ';
      textInput.value = 'x';
      submit.click();

      expect(onAdd).not.toHaveBeenCalled();
    });
  });

  describe('edit-outcome flow', () => {
    function setupCard() {
      const onEdit = vi.fn();
      const list = createOutcomesList(root, { onRemove: vi.fn(), onEdit });
      list.addOutcome('o1', 'Pismo', '[PERSON_NAME_1] zgadza się.', {
        '[PERSON_NAME_1]': 'Jan Kowalski',
      });
      return { list, onEdit };
    }

    it('renders an edit button on each card', () => {
      setupCard();
      expect(root.querySelector('[data-testid="outcome-edit-o1"]')).not.toBeNull();
    });

    it('clicking edit reveals a form with the current label and tokenized text', () => {
      setupCard();
      root.querySelector('[data-testid="outcome-edit-o1"]').click();
      const labelInput = root.querySelector('[data-testid="outcome-edit-label-o1"]');
      const textInput = root.querySelector('[data-testid="outcome-edit-text-o1"]');
      expect(labelInput).not.toBeNull();
      expect(textInput).not.toBeNull();
      expect(labelInput.value).toBe('Pismo');
      expect(textInput.value).toBe('[PERSON_NAME_1] zgadza się.');
    });

    it('saving fires onEdit(id, label, text) and re-renders the card', () => {
      const { onEdit } = setupCard();
      root.querySelector('[data-testid="outcome-edit-o1"]').click();

      const labelInput = root.querySelector('[data-testid="outcome-edit-label-o1"]');
      const textInput = root.querySelector('[data-testid="outcome-edit-text-o1"]');
      labelInput.value = 'Pismo (poprawione)';
      textInput.value = '[PERSON_NAME_1] zgadza się w pełni.';
      root.querySelector('[data-testid="outcome-edit-save-o1"]').click();

      expect(onEdit).toHaveBeenCalledWith(
        'o1',
        'Pismo (poprawione)',
        '[PERSON_NAME_1] zgadza się w pełni.',
      );
      // Form is gone; display mode is back.
      expect(root.querySelector('[data-testid="outcome-edit-label-o1"]')).toBeNull();
      expect(root.querySelector('[data-testid="outcome-body-o1"]')).not.toBeNull();
    });

    it('cancel returns to display mode without firing onEdit', () => {
      const { onEdit } = setupCard();
      root.querySelector('[data-testid="outcome-edit-o1"]').click();

      root.querySelector('[data-testid="outcome-edit-text-o1"]').value = 'whatever';
      root.querySelector('[data-testid="outcome-edit-cancel-o1"]').click();

      expect(onEdit).not.toHaveBeenCalled();
      expect(root.querySelector('[data-testid="outcome-edit-label-o1"]')).toBeNull();
      expect(root.querySelector('[data-testid="outcome-body-o1"]').textContent).toBe(
        'Jan Kowalski zgadza się.',
      );
    });

    it('save with blank label or blank text is a no-op (defensive)', () => {
      const { onEdit } = setupCard();
      root.querySelector('[data-testid="outcome-edit-o1"]').click();

      const labelInput = root.querySelector('[data-testid="outcome-edit-label-o1"]');
      const textInput = root.querySelector('[data-testid="outcome-edit-text-o1"]');
      labelInput.value = '   ';
      textInput.value = 'x';
      root.querySelector('[data-testid="outcome-edit-save-o1"]').click();

      expect(onEdit).not.toHaveBeenCalled();

      // Still in edit mode; try blank text now.
      labelInput.value = 'OK';
      textInput.value = '   ';
      root.querySelector('[data-testid="outcome-edit-save-o1"]').click();
      expect(onEdit).not.toHaveBeenCalled();
    });
  });
});

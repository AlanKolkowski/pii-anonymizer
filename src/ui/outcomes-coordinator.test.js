// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createOutcomesList } from './outcomes-list/index.js';
import { createDeanonWorkspace } from './deanon-workspace/index.js';
import { createOutcomesCoordinator } from './outcomes-coordinator.js';

describe('createOutcomesCoordinator', () => {
  it('updates the legacy outcomes list and deanon panes through the MCP write path', () => {
    document.body.innerHTML = '<div id="legacy"></div><div id="deanon"></div>';
    const outcomes = [];
    let legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };

    const legacy = createOutcomesList(document.getElementById('legacy'), {
      onRemove: vi.fn(),
      onAdd: vi.fn(),
      onEdit: vi.fn(),
    });
    const deanon = createDeanonWorkspace(document.getElementById('deanon'), {
      getOutcomes: () => outcomes,
      getLegend: () => legend,
      onAdd: vi.fn(),
      onUpdate: vi.fn(),
      onRemove: vi.fn(),
      entityLabels: { PERSON_NAME: 'Imię i nazwisko' },
    });
    deanon.render();

    const coordinator = createOutcomesCoordinator({
      outcomes,
      outcomesList: legacy,
      deanonWorkspace: deanon,
      getLegend: () => legend,
      makeId: () => 'mcp-1',
    });

    const id = coordinator.createOutcome('Odpowiedź', 'Witaj [PERSON_NAME_1].');

    expect(id).toBe('mcp-1');
    expect(document.querySelector('[data-testid="outcome-body-mcp-1"]').textContent).toBe(
      'Witaj Jan Kowalski.',
    );
    expect(document.querySelector('[data-testid="deanon-input-body"]').textContent).toContain(
      '[PERSON_NAME_1]',
    );
    expect(document.querySelector('[data-testid="deanon-output-body"]').textContent).toContain(
      'Jan Kowalski',
    );

    coordinator.updateOutcomeFields('mcp-1', 'Odpowiedź 2', 'Cześć [PERSON_NAME_1].');

    expect(document.querySelector('[data-testid="outcome-label-mcp-1"]').textContent).toBe(
      'Odpowiedź 2',
    );
    expect(document.querySelector('[data-testid="deanon-input-body"]').textContent).toContain(
      'Cześć',
    );
  });
});

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

  it('keeps written outcomes tied to the legend snapshot captured before later renumbering', () => {
    document.body.innerHTML = '<div id="legacy"></div><div id="deanon"></div>';
    const outcomes = [];
    const writeLegend = {
      '[PERSON_NAME_1]': 'Adam Nowicki',
      '[PERSON_NAME_2]': 'Barbara Lis',
    };
    let legend = writeLegend;
    const tokenText = 'Zobowiązuje się [PERSON_NAME_1] wobec [PERSON_NAME_2].';
    const expectedText = 'Zobowiązuje się Adam Nowicki wobec Barbara Lis.';

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

    coordinator.createOutcome('Odpowiedź', tokenText);

    legend = { '[PERSON_NAME_1]': 'Barbara Lis' };
    coordinator.refreshLegend(legend);

    expect(document.querySelector('[data-testid="outcome-body-mcp-1"]').textContent).toBe(
      expectedText,
    );
    expect(document.querySelector('[data-testid="deanon-output-body"]').textContent).toBe(
      expectedText,
    );
    expect(outcomes[0].legendSnapshot).toEqual(writeLegend);
  });

  it('tracks mcpLabel: synthetic or LLM-authored, unaffected by display renames', () => {
    document.body.innerHTML = '<div id="deanon"></div>';
    const outcomes = [];
    const deanon = createDeanonWorkspace(document.getElementById('deanon'), {
      getOutcomes: () => outcomes,
      getLegend: () => ({}),
      onAdd: vi.fn(),
      onUpdate: vi.fn(),
      onRemove: vi.fn(),
      entityLabels: {},
    });
    deanon.render();
    let n = 0;
    const coordinator = createOutcomesCoordinator({
      outcomes,
      deanonWorkspace: deanon,
      getLegend: () => ({}),
      makeId: () => `o-${(n += 1)}`,
    });

    // LLM-authored: caller passes mcpLabel = supplied label.
    const llmId = coordinator.createOutcome('Pozew [PERSON_NAME_1]', 'Treść.', 'Pozew [PERSON_NAME_1]');
    expect(outcomes.find((o) => o.id === llmId).mcpLabel).toBe('Pozew [PERSON_NAME_1]');

    // UI-created: synthetic mcpLabel, private label kept separate.
    const uiId = coordinator.createOutcome('Moja prywatna nazwa', 'Tekst.', 'Wynik 7');
    expect(outcomes.find((o) => o.id === uiId).mcpLabel).toBe('Wynik 7');

    // User display-rename (no mcpLabel option) must NOT change mcpLabel.
    coordinator.updateOutcomeFields(uiId, 'Inna prywatna nazwa', 'Tekst.');
    const afterRename = outcomes.find((o) => o.id === uiId);
    expect(afterRename.label).toBe('Inna prywatna nazwa');
    expect(afterRename.mcpLabel).toBe('Wynik 7');

    // LLM write (with mcpLabel option) updates mcpLabel.
    coordinator.updateOutcomeFields(uiId, 'Z LLM', 'Tekst 2.', { mcpLabel: 'Z LLM' });
    expect(outcomes.find((o) => o.id === uiId).mcpLabel).toBe('Z LLM');
  });

  it('can drive the deanon workspace without rendering the legacy outcomes list', () => {
    document.body.innerHTML = '<div id="deanon"></div>';
    const outcomes = [];
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };

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
      deanonWorkspace: deanon,
      getLegend: () => legend,
      makeId: () => 'mcp-1',
    });

    coordinator.createOutcome('Odpowiedź', 'Witaj [PERSON_NAME_1].');

    expect(document.querySelector('[data-testid="outcome-card-mcp-1"]')).toBeNull();
    expect(document.querySelector('[data-testid="deanon-output-body"]').textContent).toContain(
      'Jan Kowalski',
    );
  });
});

// ST-8 (SCOPE-TIERS-DESIGN.md §8.1 pkt 3 / §8.2): outcomes created before a
// tier-configuration change keep deanonymizing byte-for-byte — the legend
// snapshot, not the live configuration, is the truth for old outcomes. New
// sources simply stop generating such tokens; nothing already written moves.
describe('outcome legend snapshots survive a tier-configuration pivot (ST-8)', () => {
  it('an ORG token deanonymizes identically after the live legend loses it', () => {
    document.body.innerHTML = '<div id="legacy"></div><div id="deanon"></div>';
    const outcomes = [];
    let legend = {
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[ORGANIZATION_NAME_2]': 'Kancelaria Radcy Prawnego K-Law',
    };

    const legacy = createOutcomesList(document.getElementById('legacy'), {
      onRemove: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(),
    });
    const deanon = createDeanonWorkspace(document.getElementById('deanon'), {
      getOutcomes: () => outcomes,
      getLegend: () => legend,
      onAdd: vi.fn(), onUpdate: vi.fn(), onRemove: vi.fn(),
      entityLabels: {},
    });
    deanon.render();
    const coordinator = createOutcomesCoordinator({
      outcomes,
      outcomesList: legacy,
      deanonWorkspace: deanon,
      getLegend: () => legend,
      makeId: () => 'mig-1',
    });

    coordinator.createOutcome('Pismo', 'Umowa z [ORGANIZATION_NAME_2] dla [PERSON_NAME_1].');
    const before = document.querySelector('[data-testid="outcome-body-mig-1"]').textContent;
    expect(before).toBe('Umowa z Kancelaria Radcy Prawnego K-Law dla Jan Kowalski.');

    // The pivot: ORGANIZATION_NAME becomes pass-tier, the source is rerun,
    // and the recomputed global legend no longer carries the ORG token.
    legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    coordinator.refreshLegend(legend);

    const after = document.querySelector('[data-testid="outcome-body-mig-1"]').textContent;
    expect(after).toBe(before);
  });
});

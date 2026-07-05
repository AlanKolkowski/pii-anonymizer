// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createAnnotationEditor } from './index.js';

const sampleText = 'Anna mieszka w Warszawie.';
const sampleEntities = [
  { entity_group: 'PERSON_NAME', start: 0, end: 4, score: 0.99 },
  { entity_group: 'LOCATION', start: 15, end: 24, score: 0.98 },
];

function mount(opts = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const editor = createAnnotationEditor(root, {
    text: opts.text ?? sampleText,
    entities: opts.entities ?? sampleEntities,
    entityCategories: [],
    entityLabels: {},
    postEdit: (_t, e) => e,
    onChange: () => {},
    onModeChange: () => {},
    ...opts,
  });
  return { root, editor };
}

describe('annotation-editor — pill rendering', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders entities with .anno + .ann-ent classes (design + legacy)', () => {
    const { root } = mount();
    const pills = root.querySelectorAll('.anno');
    expect(pills.length).toBe(2);
    for (const p of pills) {
      expect(p.classList.contains('ann-ent')).toBe(true);
    }
  });

  it('renders the original text inline so the highlight is readable', () => {
    const { root } = mount();
    const surfaceText = root.querySelector('.ann-editor-surface').textContent;
    expect(surfaceText).toContain('Anna');
    expect(surfaceText).toContain('Warszawie');
    expect(surfaceText).toContain('mieszka w');
  });

  it('exposes data-orig with the original text for inspection / future tweaks', () => {
    const { root } = mount();
    const pills = root.querySelectorAll('.anno');
    expect(pills[0].dataset.orig).toBe('Anna');
    expect(pills[1].dataset.orig).toBe('Warszawie');
  });

  it('applies palette CSS variables inline on the pill', () => {
    const { root } = mount();
    const personPill = root.querySelector('.anno[data-type="PERSON_NAME"]');
    expect(personPill.style.getPropertyValue('--ec-bg')).toMatch(/oklch/);
    expect(personPill.style.getPropertyValue('--ec-ink')).toMatch(/oklch/);
    expect(personPill.style.getPropertyValue('--ec-line')).toMatch(/oklch/);
  });

  it('leaves CSS variables unset for entity types missing from the palette', () => {
    const { root } = mount({
      text: 'aaa bbb',
      entities: [{ entity_group: 'WEIRD_NEW_TYPE', start: 0, end: 3, score: 1 }],
    });
    const pill = root.querySelector('.anno');
    expect(pill.style.getPropertyValue('--ec-bg')).toBe('');
  });

  it('sets the title attribute to "[token] · [original]"', () => {
    const { root } = mount();
    const pill = root.querySelector('.anno[data-type="PERSON_NAME"]');
    expect(pill.title).toMatch(/^\[PERSON_NAME_\d+\] · Anna$/);
  });

  it('keeps an inline × delete element inside each pill', () => {
    const { root } = mount();
    const xs = root.querySelectorAll('.anno .ann-ent-chip-x');
    expect(xs.length).toBe(2);
  });

  it('tags entities with data-token so cross-occurrence hover can find siblings', () => {
    const { root } = mount({
      text: 'Anna and Anna again',
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 4, score: 1 },
        { entity_group: 'PERSON_NAME', start: 9, end: 13, score: 1 },
      ],
    });
    const tokens = [...root.querySelectorAll('.anno')].map((p) => p.dataset.token);
    expect(tokens[0]).toBeTruthy();
    expect(tokens[0]).toBe(tokens[1]); // same canonical → same token
  });

  it('can enter text editing and return to annotation mode when text is unchanged', () => {
    const { root, editor } = mount();
    editor.enterTextMode();
    expect(editor.getMode()).toBe('text');
    expect(editor.isTextDirty()).toBe(false);
    expect(root.querySelector('.ann-editor-textarea')).not.toBeNull();

    const result = editor.commitTextMode(editor.getText());
    expect(result.changed).toBe(false);
    expect(editor.getMode()).toBe('annotation');
    expect(root.querySelector('.ann-editor-surface')).not.toBeNull();
  });

  it('stays in text mode and reports dirty when edited text differs from the snapshot', () => {
    const { root, editor } = mount();
    editor.enterTextMode();
    const textarea = root.querySelector('.ann-editor-textarea');
    textarea.value = 'Anna mieszka w Krakowie.';
    textarea.dispatchEvent(new Event('input'));

    expect(editor.isTextDirty()).toBe(true);
    const result = editor.commitTextMode(editor.getText());
    expect(result.changed).toBe(true);
    expect(editor.getMode()).toBe('text');
  });
});

describe('annotation-editor — global token IDs', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('uses getGlobalSeen() token in the pill title', () => {
    const { root } = mount({
      getGlobalSeen: () => ({ 'PERSON_NAME::Anna': '[PERSON_NAME_7]' }),
    });
    const personPill = root.querySelector('.anno[data-type="PERSON_NAME"]');
    expect(personPill.title).toBe('[PERSON_NAME_7] · Anna');
    expect(personPill.dataset.token).toBe('[PERSON_NAME_7]');
  });

  it('data-token follows globalSeen so hover grouping stays self-consistent', () => {
    const { root } = mount({
      text: 'Anna and Anna again',
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 4, score: 1 },
        { entity_group: 'PERSON_NAME', start: 9, end: 13, score: 1 },
      ],
      getGlobalSeen: () => ({ 'PERSON_NAME::Anna': '[PERSON_NAME_7]' }),
    });
    const pills = [...root.querySelectorAll('.anno[data-type="PERSON_NAME"]')];
    expect(pills).toHaveLength(2);
    expect(pills[0].dataset.token).toBe('[PERSON_NAME_7]');
    expect(pills[1].dataset.token).toBe('[PERSON_NAME_7]');
  });

  it('falls back to per-doc numbering when globalSeen has no matching key', () => {
    const { root } = mount({
      getGlobalSeen: () => ({ 'PERSON_NAME::SomeoneElse': '[PERSON_NAME_99]' }),
    });
    const personPill = root.querySelector('.anno[data-type="PERSON_NAME"]');
    expect(personPill.title).toMatch(/^\[PERSON_NAME_\d+\] · Anna$/);
    expect(personPill.dataset.token).not.toBe('[PERSON_NAME_99]');
  });

  it('defaults to per-doc numbering when getGlobalSeen is not provided', () => {
    const { root } = mount();
    const personPill = root.querySelector('.anno[data-type="PERSON_NAME"]');
    expect(personPill.title).toMatch(/^\[PERSON_NAME_\d+\] · Anna$/);
  });
});

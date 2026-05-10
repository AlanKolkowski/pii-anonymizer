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
});

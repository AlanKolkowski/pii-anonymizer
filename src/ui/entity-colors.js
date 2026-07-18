export const ENTITY_COLORS = {
  PERSON_NAME: '#4CAF50',
  POSTAL_ADDRESS: '#2196F3',
  PHONE_NUMBER: '#FF9800',
  EMAIL_ADDRESS: '#9C27B0',
  ORGANIZATION_NAME: '#00BCD4',
  ORGANIZATION_IDENTIFIER: '#607D8B',
  PERSON_IDENTIFIER: '#E91E63',
  DOCUMENT_REFERENCE: '#795548',
  FINANCIAL_AMOUNT: '#FFC107',
  BANK_ACCOUNT_IDENTIFIER: '#3F51B5',
  LOCATION: '#8BC34A',
  DATE_OF_BIRTH: '#FF5722',
  HEALTH_DATA: '#F44336',
  PERSON_ROLE_OR_TITLE: '#009688',
  PERSON_ATTRIBUTE: '#CDDC39',
  DOCUMENT_IDENTIFIER: '#673AB7',
  INCOME_COMPENSATION: '#FF6F00',
  PROPER_NAME: '#26A69A',
  VEHICLE_IDENTIFIER: '#5C6BC0',
  ACCOUNT_IDENTIFIER: '#EF5350',
  LAND_REGISTER_IDENTIFIER: '#827717',
};

export const FALLBACK_COLOR = '#9E9E9E';

export function colorFor(entityGroup) {
  return ENTITY_COLORS[entityGroup] || FALLBACK_COLOR;
}

// Design palette — oklch triples (bg/ink/line) per entity type. Source of
// truth for in-editor and deanonymization token pills.
export const ENTITY_PALETTE = {
  PERSON_NAME:             { bg: 'oklch(0.95 0.04 165)', ink: 'oklch(0.36 0.10 165)', line: 'oklch(0.84 0.07 165)' },
  DATE_OF_BIRTH:           { bg: 'oklch(0.95 0.04 50)',  ink: 'oklch(0.42 0.12 50)',  line: 'oklch(0.84 0.08 50)'  },
  PERSON_IDENTIFIER:       { bg: 'oklch(0.95 0.04 350)', ink: 'oklch(0.42 0.12 350)', line: 'oklch(0.84 0.08 350)' },
  PERSON_ROLE_OR_TITLE:    { bg: 'oklch(0.95 0.03 220)', ink: 'oklch(0.40 0.10 220)', line: 'oklch(0.84 0.07 220)' },
  POSTAL_ADDRESS:          { bg: 'oklch(0.95 0.04 250)', ink: 'oklch(0.42 0.12 250)', line: 'oklch(0.84 0.08 250)' },
  LOCATION:                { bg: 'oklch(0.95 0.04 140)', ink: 'oklch(0.40 0.10 140)', line: 'oklch(0.84 0.07 140)' },
  EMAIL_ADDRESS:           { bg: 'oklch(0.95 0.04 305)', ink: 'oklch(0.42 0.12 305)', line: 'oklch(0.84 0.08 305)' },
  PHONE_NUMBER:            { bg: 'oklch(0.95 0.04 75)',  ink: 'oklch(0.44 0.12 75)',  line: 'oklch(0.84 0.08 75)'  },
  ORGANIZATION_NAME:       { bg: 'oklch(0.95 0.04 195)', ink: 'oklch(0.40 0.10 195)', line: 'oklch(0.84 0.07 195)' },
  FINANCIAL_AMOUNT:        { bg: 'oklch(0.95 0.04 95)',  ink: 'oklch(0.42 0.12 95)',  line: 'oklch(0.84 0.08 95)'  },
  BANK_ACCOUNT_IDENTIFIER: { bg: 'oklch(0.95 0.04 270)', ink: 'oklch(0.42 0.12 270)', line: 'oklch(0.84 0.08 270)' },
  HEALTH_DATA:             { bg: 'oklch(0.95 0.04 25)',  ink: 'oklch(0.44 0.14 25)',  line: 'oklch(0.84 0.08 25)'  },
  ACCOUNT_IDENTIFIER:      { bg: 'oklch(0.95 0.03 15)',  ink: 'oklch(0.42 0.10 15)',  line: 'oklch(0.84 0.07 15)'  },
};

// Returns a plain object of CSS custom properties for the entity's pill
// styling. Unknown types return an empty object — callers should rely on
// the CSS fallback (var(--ec-bg, var(--bg-tint)) etc.).
export function paletteVarsFor(entityGroup) {
  const p = ENTITY_PALETTE[entityGroup];
  if (!p) return null;
  return { '--ec-bg': p.bg, '--ec-ink': p.ink, '--ec-line': p.line };
}

export function applyPaletteVars(el, entityGroup) {
  const vars = paletteVarsFor(entityGroup);
  if (!vars) return;
  for (const [k, v] of Object.entries(vars)) {
    el.style.setProperty(k, v);
  }
}

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const landingCssUrl = new URL('./landing.css', import.meta.url);

async function readLandingCss() {
  return readFile(landingCssUrl, 'utf8');
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findMatchingBrace(text, openBraceIndex) {
  let depth = 0;

  for (let index = openBraceIndex; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function mediaBlocks(css) {
  const source = stripComments(css);
  const blocks = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const mediaIndex = source.indexOf('@media', searchFrom);
    if (mediaIndex === -1) break;

    const openBraceIndex = source.indexOf('{', mediaIndex);
    if (openBraceIndex === -1) break;

    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
    if (closeBraceIndex === -1) break;

    blocks.push({
      query: source.slice(mediaIndex + '@media'.length, openBraceIndex).trim(),
      body: source.slice(openBraceIndex + 1, closeBraceIndex),
    });
    searchFrom = closeBraceIndex + 1;
  }

  return blocks;
}

function maxWidthPx(query) {
  const widths = [...query.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)]
    .map((match) => Number(match[1]));
  return widths.length ? Math.min(...widths) : null;
}

function parseDeclarations(body) {
  return new Map(
    body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colonIndex = declaration.indexOf(':');
        return [
          declaration.slice(0, colonIndex).trim().toLowerCase(),
          declaration.slice(colonIndex + 1).trim().toLowerCase(),
        ];
      }),
  );
}

function rules(css) {
  const parsed = [];
  const rulePattern = /([^{}@]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(stripComments(css))) !== null) {
    parsed.push({
      selectors: match[1].split(',').map((selector) => selector.trim()),
      declarations: parseDeclarations(match[2]),
    });
  }

  return parsed;
}

function phoneRules(css) {
  return mediaBlocks(css)
    .filter((block) => {
      const width = maxWidthPx(block.query);
      return width !== null && width <= 700;
    })
    .flatMap((block) => rules(block.body).map((rule) => ({ ...rule, query: block.query })));
}

function declarationsForSelector(parsedRules, selector) {
  return parsedRules
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.declarations);
}

function hasOverflowXGuard(declarations) {
  const overflowX = declarations.get('overflow-x');
  const overflow = declarations.get('overflow');
  return ['hidden', 'clip'].includes(overflowX) || ['hidden', 'clip'].includes(overflow);
}

function hasStackOrCollapseStrategy(declarations) {
  return declarations.get('flex-wrap') === 'wrap'
    || declarations.get('flex-direction') === 'column'
    || declarations.get('display') === 'none';
}

function formatRule(rule) {
  const declarations = [...rule.declarations]
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');
  return `@media ${rule.query} { ${rule.selectors.join(', ')} { ${declarations} } }`;
}

describe('landing page responsive layout CSS', () => {
  it('gives the phone header nav a collapse, stack, or hide strategy before it can overflow at 390px', async () => {
    const css = await readLandingCss();
    const narrowHeaderRules = phoneRules(css).filter((rule) =>
      rule.selectors.some((selector) => selector.includes('.site-nav')),
    );
    const containerStrategies = narrowHeaderRules.filter((rule) =>
      rule.selectors.some((selector) => ['.site-nav', '.site-nav-actions'].includes(selector))
      && hasStackOrCollapseStrategy(rule.declarations),
    );
    const hiddenSecondaryItems = narrowHeaderRules.filter((rule) =>
      rule.selectors.some((selector) => [
        '.site-nav > a',
        '.site-nav a:not(.btn)',
        '.site-nav .pill.pill-pl',
        '.site-nav .bmc-nav-slot',
        '.bmc-nav-slot',
      ].includes(selector))
      && rule.declarations.get('display') === 'none',
    );

    expect(
      [...containerStrategies, ...hiddenSecondaryItems].map(formatRule),
      'phone-width CSS must make the header navigation wrap, stack, collapse, or hide secondary items instead of remaining a single overflowing flex row',
    ).not.toEqual([]);
  });

  it('guards the landing page and sticky header against horizontal panning', async () => {
    const css = await readLandingCss();
    const parsedRules = rules(css);
    const pageHasOverflowGuard = ['html', 'body'].some((selector) =>
      declarationsForSelector(parsedRules, selector).some(hasOverflowXGuard),
    );
    const headerHasOverflowGuard = declarationsForSelector(parsedRules, '.site-header')
      .some(hasOverflowXGuard);

    expect(pageHasOverflowGuard, 'body or html must clip horizontal overflow so the landing page cannot pan sideways').toBe(true);
    expect(headerHasOverflowGuard, 'the sticky site header must clip any residual nav overflow').toBe(true);
  });
});

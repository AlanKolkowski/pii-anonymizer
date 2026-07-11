// N-8 (LOCAL-VERIFIER-DESIGN.md §4.1): artifacts that give away LLM-authored
// text left over from drafting — markdown, bracket placeholders, stray
// English fragments, and em-dash (K-Law's own punctuation rule is en-dash
// "–" only, never em-dash "—" — see CLAUDE.md).
const CHECKS = [
  {
    id: 'markdown-heading',
    pattern: /^#{1,6}\s+.+$/gm,
    describe: (m) => `Nagłówek markdown pozostawiony w tekście: „${m[0]}".`,
  },
  {
    id: 'markdown-bold',
    pattern: /\*\*[^*\n]+\*\*/g,
    describe: (m) => `Pogrubienie markdown pozostawione w tekście: „${m[0]}".`,
  },
  {
    id: 'placeholder',
    pattern: /\[(uzupełnić|do uzupełnienia|TODO|FIXME|placeholder|insert\s+\w+)\]/gi,
    describe: (m) => `Placeholder pozostawiony w tekście: „${m[0]}".`,
  },
  {
    id: 'todo-bare',
    pattern: /\bTODO\b/g,
    describe: (m) => `Znacznik „TODO" w tekście pisma.`,
  },
  {
    id: 'em-dash',
    pattern: /—/g,
    describe: () => 'Em-dash „—" w tekście — reguła interpunkcyjna kancelarii wymaga wyłącznie en-dash „–".',
  },
];

const ENGLISH_STOPWORDS = ['the', 'and', 'is', 'are', 'this', 'that', 'with', 'from', 'will', 'shall', 'hereby', 'whereas', 'please', 'note'];
const ENGLISH_RUN_PATTERN = new RegExp(
  `\\b(?:${ENGLISH_STOPWORDS.join('|')})\\b(?:\\s+[A-Za-z']+){2,}`,
  'gi',
);

export function checkLlmArtifacts(text) {
  const findings = [];

  for (const check of CHECKS) {
    check.pattern.lastIndex = 0;
    for (const match of text.matchAll(check.pattern)) {
      findings.push({
        checker: 'N-8',
        severity: 'informacyjna',
        message: check.describe(match),
        index: match.index,
        length: match[0].length,
        quote: match[0],
      });
    }
  }

  for (const match of text.matchAll(ENGLISH_RUN_PATTERN)) {
    findings.push({
      checker: 'N-8',
      severity: 'informacyjna',
      message: `Możliwy fragment po angielsku: „${match[0]}".`,
      index: match.index,
      length: match[0].length,
      quote: match[0],
    });
  }

  return findings;
}

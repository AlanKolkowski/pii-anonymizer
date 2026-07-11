// N-9 (LOCAL-VERIFIER-DESIGN.md §4.1): a paragraph repeated verbatim
// elsewhere in the same document — e.g. a duplicated demand/request
// paragraph, a common LLM drafting slip. Short paragraphs (section markers
// like "II." or single-word headings) are excluded so legitimate repeated
// structure doesn't get flagged.
const MIN_PARAGRAPH_LENGTH = 40;

function splitParagraphs(text) {
  const paragraphs = [];
  let cursor = 0;
  for (const chunk of text.split(/\n{2,}/)) {
    const start = text.indexOf(chunk, cursor);
    paragraphs.push({ text: chunk, index: start });
    cursor = start + chunk.length;
  }
  return paragraphs;
}

export function checkDuplicateParagraphs(text) {
  const paragraphs = splitParagraphs(text);
  const seenAt = new Map();
  const findings = [];

  for (const p of paragraphs) {
    const normalized = p.text.trim().replace(/\s+/g, ' ');
    if (normalized.length < MIN_PARAGRAPH_LENGTH) continue;

    if (seenAt.has(normalized)) {
      findings.push({
        checker: 'N-9',
        severity: 'średnia',
        message: 'Akapit powtórzony w piśmie (identyczna treść jak wcześniej).',
        index: p.index,
        length: p.text.length,
        quote: normalized.length > 80 ? `${normalized.slice(0, 80)}…` : normalized,
      });
    } else {
      seenAt.set(normalized, p.index);
    }
  }

  return findings;
}

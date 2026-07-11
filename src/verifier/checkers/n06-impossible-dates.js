// N-6 (LOCAL-VERIFIER-DESIGN.md §4.1): impossible calendar dates ("31 lutego
// 2026") and a light chronological-consistency check (a "termin" date
// earlier than the document's own first-mentioned date).
const MONTHS = {
  stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6,
  lipca: 7, sierpnia: 8, września: 9, października: 10, listopada: 11, grudnia: 12,
};

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month, year) {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

const NAMED_DATE_PATTERN = /\b(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+(\d{4})\b/gi;
const NUMERIC_DATE_PATTERN = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g;

function collectDates(text) {
  const dates = [];

  for (const match of text.matchAll(NAMED_DATE_PATTERN)) {
    const [full, dayStr, monthName, yearStr] = match;
    dates.push({
      day: parseInt(dayStr, 10),
      month: MONTHS[monthName.toLowerCase()],
      year: parseInt(yearStr, 10),
      index: match.index,
      length: full.length,
      quote: full,
    });
  }
  for (const match of text.matchAll(NUMERIC_DATE_PATTERN)) {
    const [full, dayStr, monthStr, yearStr] = match;
    dates.push({
      day: parseInt(dayStr, 10),
      month: parseInt(monthStr, 10),
      year: parseInt(yearStr, 10),
      index: match.index,
      length: full.length,
      quote: full,
    });
  }

  return dates.sort((a, b) => a.index - b.index);
}

function dateValue(d) {
  return d.year * 10000 + d.month * 100 + d.day;
}

export function checkImpossibleDates(text) {
  const findings = [];
  const dates = collectDates(text);

  for (const d of dates) {
    if (d.month < 1 || d.month > 12) {
      findings.push({
        checker: 'N-6', severity: 'wysoka',
        message: `Nieprawidłowy miesiąc w dacie: „${d.quote}".`,
        index: d.index, length: d.length, quote: d.quote,
      });
      continue;
    }
    if (d.day < 1 || d.day > daysInMonth(d.month, d.year)) {
      findings.push({
        checker: 'N-6', severity: 'wysoka',
        message: `Data niemożliwa w kalendarzu: „${d.quote}".`,
        index: d.index, length: d.length, quote: d.quote,
      });
    }
  }

  const validDates = dates.filter((d) => d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= daysInMonth(d.month, d.year));
  if (validDates.length >= 2) {
    const documentDate = validDates[0];
    const termContext = /\btermin\w*/gi;
    for (const d of validDates.slice(1)) {
      const before = text.slice(Math.max(0, d.index - 60), d.index);
      if (termContext.test(before) && dateValue(d) < dateValue(documentDate)) {
        findings.push({
          checker: 'N-6', severity: 'średnia',
          message: `Termin „${d.quote}" wypada przed datą pisma („${documentDate.quote}").`,
          index: d.index, length: d.length, quote: d.quote,
        });
      }
      termContext.lastIndex = 0;
    }
  }

  return findings;
}

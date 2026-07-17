import gazetteer from './data/surname-gazetteer.json' with { type: 'json' };
import roleLexicon from './data/role-lexicon.json' with { type: 'json' };
import { ENTITY_RULES } from './configs/entity-rules.js';

// Data-consistency guards for the SG-lite collision gazetteer
// (SURNAME-GAZETTEER-DESIGN.md §2.4) — same pattern as
// role-lexicon.consistency.test.js: the tests iterate the DATA, so every
// future entry is covered the moment it lands in the file.

describe('surname-gazetteer.json consistency', () => {
  it('every entry has a lemma, non-empty capitalized forms, a freq bucket and a slotOnly flag', () => {
    expect(gazetteer.entries.length).toBeGreaterThanOrEqual(30);
    for (const entry of gazetteer.entries) {
      expect(entry.lemma, JSON.stringify(entry)).toMatch(/^\p{Lu}/u);
      expect(Array.isArray(entry.forms) && entry.forms.length > 0).toBe(true);
      for (const form of entry.forms) {
        expect(form, `${entry.lemma}: form "${form}" must start uppercase`).toMatch(/^\p{Lu}[\p{Ll}]+$/u);
      }
      expect(entry.forms).toContain(entry.lemma);
      // freq is the PESEL bearer-count log10 bucket — proof the entry IS a
      // surname (verified against dataset 1681 at the O-SG-4 review).
      expect(Number.isInteger(entry.freq) && entry.freq >= 1 && entry.freq <= 6,
        `${entry.lemma}: freq bucket 1..6`).toBe(true);
      expect(typeof entry.slotOnly).toBe('boolean');
    }
  });

  it('forms are disjoint across lemmas', () => {
    const seen = new Map();
    for (const entry of gazetteer.entries) {
      for (const form of entry.forms) {
        expect(seen.has(form), `form "${form}" appears in both ${seen.get(form)} and ${entry.lemma}`).toBe(false);
        seen.set(form, entry.lemma);
      }
    }
  });

  it('no gazetteer form collides with role-lexicon nonEntity forms (an entry cannot be both an entity and a blocklist)', () => {
    const nonEntity = new Set(roleLexicon.nonEntity.flatMap((e) => e.forms.map((f) => f.toLowerCase())));
    for (const entry of gazetteer.entries) {
      for (const form of entry.forms) {
        expect(nonEntity.has(form.toLowerCase()), `form "${form}" is a nonEntity role`).toBe(false);
      }
    }
  });

  it('no gazetteer form collides with the A9 PERSON_ROLE_OR_TITLE blocklist', () => {
    const blocklist = new Set((ENTITY_RULES.PERSON_ROLE_OR_TITLE.blocklist ?? []).map((b) => b.toLowerCase()));
    for (const entry of gazetteer.entries) {
      for (const form of entry.forms) {
        expect(blocklist.has(form.toLowerCase()), `form "${form}" is blocklisted`).toBe(false);
      }
    }
  });

  it('first names are unique, capitalized nominatives and disjoint from gazetteer forms', () => {
    const names = gazetteer.firstNames;
    expect(new Set(names).size).toBe(names.length);
    const forms = new Set(gazetteer.entries.flatMap((e) => e.forms));
    for (const name of names) {
      expect(name).toMatch(/^\p{Lu}[\p{Ll}]+$/u);
      // A first name that is also a gazetteer form (e.g. "Maja") would make
      // slot S1 and the slotOnly rule fight each other — keep them apart.
      expect(forms.has(name), `first name "${name}" is also a gazetteer form`).toBe(false);
    }
  });

  it('slot signal lists are well-formed', () => {
    for (const title of gazetteer.titles) {
      expect(title.length).toBeGreaterThan(0);
    }
    for (const phrase of gazetteer.functionPhrases) {
      expect(phrase).toBe(phrase.toLowerCase());
      expect(phrase.trim()).toBe(phrase);
    }
  });
});

// W3 signal S-R (W1-W3-MORPHOLOGY-DESIGN.md SS3, FLEKSJA-IMPL-PLAN.md SS3.4):
// closed table of specific inflected verb/participle FORMS (not lemmas —
// matching a surface form directly needs no verb conjugator) common in
// Polish legal/procedural documents, mapped to the case of the object they
// govern. Deliberately small and conservative: a form absent from this
// table contributes no signal at all rather than a guessed one. Data only,
// hand-written, no external dataset content.
export const VERB_GOVERNMENT = {
  // Dative government ("doręczono KOMU?").
  doręczono: 'C', wypłacono: 'C', przyznano: 'C', wysłano: 'C', zapłacono: 'C',
  oddano: 'C', wydano: 'C', udzielono: 'C', zwrócono: 'C',
  // Accusative government ("wezwano KOGO?").
  wezwano: 'B', pozwano: 'B', poinformowano: 'B', zawiadomiono: 'B',
  reprezentuje: 'B', reprezentował: 'B', reprezentowała: 'B', pozwał: 'B', pozwała: 'B',
  // Genitive government ("dotyczy KOGO?", "domaga się KOGO?").
  dotyczy: 'D', dotyczyło: 'D', wysłuchano: 'D', żąda: 'D', żądał: 'D', żądała: 'D',
};

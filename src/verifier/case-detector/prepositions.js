// W3 signal S-P (W1-W3-MORPHOLOGY-DESIGN.md SS3, FLEKSJA-IMPL-PLAN.md SS3.4):
// closed table of Polish prepositions -> the case(s) they can govern. Data
// only, hand-written (no external dataset content, no licensing question).
// Several prepositions govern more than one case depending on the meaning
// of the phrase (locative-vs-directional "w"/"na"/"po", genitive-vs-
// instrumental "z") — the cascade in detect.js intersects this against
// every other signal rather than picking one meaning itself.
export const PREPOSITION_CASES = {
  dla: ['D'], do: ['D'], od: ['D'], u: ['D'], bez: ['D'], wskutek: ['D'], podczas: ['D'], wobec: ['D'],
  z: ['D', 'N'], ze: ['D', 'N'],
  ku: ['C'], dzięki: ['C'], przeciwko: ['C'], przeciw: ['C'], wbrew: ['C'],
  przez: ['B'], poprzez: ['B'],
  na: ['B', 'Ms'], o: ['B', 'Ms'], po: ['Ms', 'B'],
  w: ['Ms', 'B'], we: ['Ms', 'B'],
  nad: ['N', 'B'], pod: ['N', 'B'], przed: ['N', 'B'], za: ['N', 'B'], między: ['N', 'B'], nade: ['N', 'B'],
  przy: ['Ms'],
};

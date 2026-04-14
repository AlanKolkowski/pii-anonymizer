export function createContext(text) {
  return {
    text,
    segments: [],
    entities: [],
    anonymized: '',
    legend: {},
    debug: [],
  };
}

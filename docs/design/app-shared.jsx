// Shared theme/tweaks logic for both pages
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "accent": "teal",
  "annotationStyle": "highlight",
  "fontPair": "inter-instrument"
}/*EDITMODE-END*/;

const ACCENTS = {
  teal:   { a: 'oklch(0.55 0.10 168)', i: 'oklch(0.38 0.10 168)', t: 'oklch(0.96 0.04 168)', l: 'oklch(0.86 0.06 168)' },
  indigo: { a: 'oklch(0.55 0.13 264)', i: 'oklch(0.38 0.13 264)', t: 'oklch(0.96 0.04 264)', l: 'oklch(0.86 0.06 264)' },
  amber:  { a: 'oklch(0.65 0.13 70)',  i: 'oklch(0.42 0.12 65)',  t: 'oklch(0.96 0.05 70)',  l: 'oklch(0.86 0.08 70)'  },
  ink:    { a: 'oklch(0.30 0.02 200)', i: 'oklch(0.20 0.02 200)', t: 'oklch(0.94 0.005 200)', l: 'oklch(0.84 0.005 200)' },
};
const FONTS = {
  'inter-instrument': { sans: '"Inter", sans-serif', serif: '"Instrument Serif", serif' },
  'inter-only':       { sans: '"Inter", sans-serif', serif: '"Inter", sans-serif' },
  'mono-everywhere':  { sans: '"JetBrains Mono", monospace', serif: '"JetBrains Mono", monospace' },
};

let _tweaks = TWEAK_DEFAULTS;
let _setTweak = () => {};

function useThemeFromTweaks() {
  const r = window.useTweaks ? window.useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const tweaks = r[0]; const setTweak = r[1];
  _tweaks = tweaks; _setTweak = setTweak;
  React.useEffect(() => {
    document.body.setAttribute('data-theme', tweaks.theme);
    document.body.setAttribute('data-density', tweaks.density);
    const p = ACCENTS[tweaks.accent] || ACCENTS.teal;
    document.documentElement.style.setProperty('--accent', p.a);
    document.documentElement.style.setProperty('--accent-ink', p.i);
    document.documentElement.style.setProperty('--accent-tint', p.t);
    document.documentElement.style.setProperty('--accent-line', p.l);
    const f = FONTS[tweaks.fontPair] || FONTS['inter-instrument'];
    document.documentElement.style.setProperty('--sans', f.sans);
    document.documentElement.style.setProperty('--serif', f.serif);
    window.dispatchEvent(new CustomEvent('pii-tweaks', { detail: { annotationStyle: tweaks.annotationStyle } }));
  }, [tweaks.theme, tweaks.density, tweaks.accent, tweaks.fontPair, tweaks.annotationStyle]);
  return [tweaks, setTweak];
}

function SharedTweaks() {
  const TP = window.TweaksPanel; const TS = window.TweakSection; const TR = window.TweakRadio;
  if (!TP) return null;
  const tweaks = _tweaks; const setTweak = _setTweak;
  return (
    <TP title="Tweaks">
      <TS title="Wygląd">
        <TR label="Motyw" value={tweaks.theme} onChange={v => setTweak('theme', v)}
          options={[{value:'light',label:'Jasny'},{value:'dark',label:'Ciemny'}]}/>
        <TR label="Gęstość" value={tweaks.density} onChange={v => setTweak('density', v)}
          options={[{value:'comfortable',label:'Komfortowo'},{value:'compact',label:'Kompaktowo'}]}/>
      </TS>
      <TS title="Akcent">
        <TR label="Kolor" value={tweaks.accent} onChange={v => setTweak('accent', v)}
          options={[{value:'teal',label:'Teal'},{value:'indigo',label:'Indigo'},{value:'amber',label:'Amber'},{value:'ink',label:'Ink'}]}/>
      </TS>
      <TS title="Adnotacje">
        <TR label="Styl" value={tweaks.annotationStyle} onChange={v => setTweak('annotationStyle', v)}
          options={[{value:'pill',label:'Pigułki'},{value:'highlight',label:'Highlight'},{value:'underline',label:'Underline'}]}/>
      </TS>
      <TS title="Typografia">
        <TR label="Para fontów" value={tweaks.fontPair} onChange={v => setTweak('fontPair', v)}
          options={[{value:'inter-instrument',label:'Inter + Instrument'},{value:'inter-only',label:'Tylko Inter'},{value:'mono-everywhere',label:'Mono'}]}/>
      </TS>
    </TP>
  );
}

window.useThemeFromTweaks = useThemeFromTweaks;
window.SharedTweaks = SharedTweaks;

// Landing page sections + Tool components
const { useState, useEffect, useRef, useMemo } = React;

// ---------- Header ----------
function SiteHeader({ page = 'landing' }) {
  return (
    <header className="site-header">
      <div className="wrap row">
        <a className="brand" href="index.html">
          <span className="brand-mark">π</span>
          <span className="brand-name"><b>pii</b><span>.tools</span></span>
        </a>
        <nav className="site-nav">
          {page === 'landing' ? (
            <>
              <a href="#how">Jak to działa</a>
              <a href="#mcp">MCP</a>
              <a href="#privacy">Prywatność</a>
              <span className="pill pill-pl" title="pii.tools jest zoptymalizowany pod polskie dokumenty. Model multilang wzmacnia detekcję w polskich tekstach — nie służy do obsługi innych języków.">
                <span className="pl-tag">PL</span>
                <span className="pl-text">polskie dokumenty</span>
              </span>
              <a href="tool.html" className="btn btn-sm btn-primary">
                Otwórz narzędzie <Icon name="arrow-right" size={11}/>
              </a>
            </>
          ) : (
            <>
              <a href="index.html#how">Jak to działa</a>
              <a href="index.html#mcp">MCP</a>
              <span className="pill pill-pl" title="pii.tools jest zoptymalizowany pod polskie dokumenty. Model multilang wzmacnia detekcję w polskich tekstach — nie służy do obsługi innych języków.">
                <span className="pl-tag">PL</span>
                <span className="pl-text">polskie dokumenty</span>
              </span>
              <a href="index.html" className="btn btn-sm btn-ghost">
                ← Wróć do strony głównej
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

// ---------- Hero ----------
function Hero() {
  return (
    <section className="hero" id="top">
      <div className="wrap">
        <div className="eyebrow" style={{marginBottom: 24}}>
          <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
            <Icon name="shield" size={12}/>
            Anonimizacja PII · GDPR · EU AI Act
          </span>
        </div>
        <h1>
          Zanonimizuj dokument,
          <br/>
          zanim trafi do <em>LLM-a</em>.
        </h1>
        <p className="lede">
          pii.tools wykrywa 35 typów danych osobowych w dokumentach prawnych, medycznych
          i kadrowych — PDF, DOCX, skany i obrazy, wszystko lokalnie w przeglądarce na WASM + WebNN. Żadne dane nie opuszczają Twojego urządzenia.
        </p>
        <div className="hero-actions">
          <a href="tool.html" className="btn btn-primary">
            Otwórz narzędzie <Icon name="arrow-right" size={13}/>
          </a>
          <a href="#how" className="btn btn-ghost">
            Zobacz, jak to działa
          </a>
        </div>

        <div className="hero-meta">
          <div className="item">
            <span className="label">Kategorie PII</span>
            <span className="value">8 grup, 35 typów</span>
          </div>
          <div className="item">
            <span className="label">Modele NER</span>
            <span className="value">eu-pii pl + multilang</span>
          </div>
          <div className="item">
            <span className="label">Runtime</span>
            <span className="value">Transformers.js · WASM + WebNN</span>
          </div>
          <div className="item">
            <span className="label">Licencja</span>
            <span className="value">Apache 2.0 · open source</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Trust strip ----------
function TrustStrip() {
  return (
    <div className="trust-strip">
      <div className="cell">
        <span className="num">0</span>
        <span className="lbl">bajtów wysłanych do serwera</span>
      </div>
      <div className="cell">
        <span className="num">100%</span>
        <span className="lbl">lokalnie w przeglądarce</span>
      </div>
      <div className="cell">
        <span className="num">35</span>
        <span className="lbl">typów wykrywanych encji</span>
      </div>
      <div className="cell">
        <span className="num">~3s</span>
        <span className="lbl">średni czas analizy strony</span>
      </div>
    </div>
  );
}

// ---------- Features ----------
function Features() {
  const items = [
    { n: '01', icon: 'lock', t: 'Działa lokalnie', b: 'Modele Transformers.js działają w przeglądarce. Twoje dokumenty nigdy nie opuszczają urządzenia — żadnego API, żadnej telemetrii.' },
    { n: '02', icon: 'tag', t: 'Wybierz, co chronisz', b: 'Pełna kontrola nad każdą z 8 kategorii i 35 typów encji. Wyłącz to, co nieistotne dla Twojego przypadku — np. zostaw kwoty, zanonimizuj nazwiska.' },
    { n: '03', icon: 'edit', t: 'Edytor adnotacji', b: 'Zaznacz brakujące encje, popraw fałszywe trafienia, dodaj własne. Każda adnotacja zachowuje token i typ przy deanonimizacji.' },
    { n: '04', icon: 'file-text', t: 'PDF, DOCX, obrazy — z OCR', b: 'Wklej tekst albo wrzuć pliki: PDF, DOCX, JPG, PNG, skany. Wbudowany OCR czyta zdjęcia i strony bez warstwy tekstowej. Tokeny są spójne między dokumentami — ten sam Jan Kowalski to zawsze [PERSON_NAME_1].' },
    { n: '05', icon: 'plug', t: 'WebMCP dla LLM-ów', b: 'Połącz Claude Desktop bezpośrednio z narzędziem. LLM widzi tylko zanonimizowany tekst, a Ty otrzymujesz odpowiedź z odtworzonymi danymi.' },
    { n: '06', icon: 'sparkle', t: 'Pipeline od kuchni', b: 'Każdy krok przetwarzania (segmentacja → NER → postprocessing) widoczny w panelu debug. Dla zespołów ML i red-teamerów PII.' },
  ];
  return (
    <div className="feat-grid">
      {items.map(it => (
        <div className="feat" key={it.n}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span className="feat-num">{it.n}</span>
            <span style={{color:'var(--ink-4)'}}><Icon name={it.icon} size={16}/></span>
          </div>
          <h3 className="feat-title">{it.t}</h3>
          <p className="feat-body">{it.b}</p>
        </div>
      ))}
    </div>
  );
}

window.SiteHeader = SiteHeader;
window.Hero = Hero;
window.TrustStrip = TrustStrip;
window.Features = Features;

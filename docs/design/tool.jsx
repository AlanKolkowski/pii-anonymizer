// Tool — entity sidebar, document tabs, editor, progress

const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM } = React;

// Apply entity palette as CSS variables on inline style
function entityStyle(code) {
  const p = window.ENTITY_PALETTE[code];
  if (!p) return {};
  return { '--ec-bg': p.bg, '--ec-ink': p.ink, '--ec-line': p.line };
}

// ---------- Entity Sidebar ----------
function EntitySelector({ categories, setCategories }) {
  function toggleOpen(id) {
    setCategories(cats => cats.map(c => c.id === id ? { ...c, open: !c.open } : c));
  }
  function toggleEntity(catId, code) {
    setCategories(cats => cats.map(c => {
      if (c.id !== catId) return c;
      const items = c.items.map(it => it.code === code ? { ...it, on: !it.on } : it);
      const onCount = items.filter(it => it.on).length;
      return { ...c, items, count: `${onCount}/${items.length}` };
    }));
  }
  function toggleCategory(catId) {
    setCategories(cats => cats.map(c => {
      if (c.id !== catId) return c;
      const allOn = c.items.every(it => it.on);
      const items = c.items.map(it => ({ ...it, on: !allOn }));
      const onCount = items.filter(it => it.on).length;
      return { ...c, items, count: `${onCount}/${items.length}` };
    }));
  }
  const totalOn = categories.reduce((acc, c) => acc + c.items.filter(i => i.on).length, 0);
  const totalAll = categories.reduce((acc, c) => acc + c.items.length, 0);

  return (
    <div className="sidebar-section">
      <div className="sidebar-title">
        <h4>Encje do anonimizacji</h4>
        <span className="count">{totalOn}/{totalAll}</span>
      </div>
      <div>
        {categories.map(cat => {
          const onCount = cat.items.filter(i => i.on).length;
          const allOn = onCount === cat.items.length;
          const someOn = onCount > 0 && !allOn;
          return (
            <div key={cat.id} className={`ent-cat ${cat.open ? 'open' : ''}`}>
              <div className="ent-cat-head" onClick={() => toggleOpen(cat.id)}>
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={el => { if (el) el.indeterminate = someOn; }}
                  onChange={() => toggleCategory(cat.id)}
                  onClick={e => e.stopPropagation()}
                />
                <span className="ent-cat-name">
                  {cat.label}
                  {cat.special && <span style={{marginLeft:6,color:'var(--warn)',fontSize:10,fontFamily:'var(--mono)'}}>Art.9</span>}
                </span>
                <span className="ent-cat-count">{cat.count}</span>
                <Icon name="chevron" size={10} className="ent-cat-chev"/>
              </div>
              <div className="ent-list">
                {cat.items.map(it => (
                  <label key={it.code} className={`ent-row ${it.on ? 'checked' : ''}`} style={entityStyle(it.code)}>
                    <input
                      type="checkbox"
                      checked={it.on}
                      onChange={() => toggleEntity(cat.id, it.code)}
                    />
                    <span className="ent-name">{it.name}</span>
                    <span className="ent-code">{it.code}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Document list (sidebar) ----------
function DocList({ docs, activeId, setActiveId, onAdd }) {
  return (
    <div className="sidebar-section">
      <div className="sidebar-title">
        <h4>Dokumenty</h4>
        <span className="count">{docs.length}</span>
      </div>
      <div className="doc-list">
        {docs.map(d => (
          <div
            key={d.id}
            className={`doc-item ${activeId === d.id ? 'active' : ''}`}
            onClick={() => setActiveId(d.id)}
          >
            <Icon name={d.type === 'paste' ? 'paste' : 'doc'} size={13}/>
            <span className="name">{d.name}</span>
            <span className="meta">{d.status === 'anonymized' ? '✓' : d.status === 'pending' ? '·' : '…'}</span>
          </div>
        ))}
      </div>
      <div className="doc-add">
        <button className="btn btn-sm" onClick={onAdd}>
          <Icon name="plus" size={11}/> Dodaj
        </button>
      </div>
    </div>
  );
}

// ---------- Anonymized document renderer ----------
function RenderedDoc({ doc, annoStyle }) {
  if (!doc) return null;
  if (!doc.body) {
    return (
      <div className="editor-empty">
        <span className="glyph"><Icon name="file-text" size={20}/></span>
        <h3>Dokument oczekuje na analizę</h3>
        <p>Kliknij <b>Anonimizuj wszystkie</b>, aby przetworzyć ten dokument przez pipeline NER.</p>
      </div>
    );
  }
  return (
    <div className={`editor anno-style-${annoStyle}`}>
      {doc.body.map((part, i) => {
        if (part.t) return <span key={i}>{part.t}</span>;
        if (part.e) {
          const tok = `${part.e}_${part.n}`;
          const lbl = window.ENTITY_LABEL[part.e] || part.e;
          return (
            <span key={i} className="anno" style={entityStyle(part.e)} data-orig={part.orig} title={`${tok} · ${part.orig}`}>
              <span className="lbl">{lbl}</span>
              <span className="num">{part.n}</span>
            </span>
          );
        }
        return null;
      })}
    </div>
  );
}

// ---------- Empty editor state ----------
function EmptyEditor({ onPick }) {
  return (
    <div className="editor-empty">
      <span className="glyph"><Icon name="plus" size={20}/></span>
      <h3>Dodaj dokument do analizy</h3>
      <p>Wybierz źródło — Twoje dane nie opuszczają tego urządzenia.</p>
      <div className="ways">
        <button className="way" onClick={() => onPick('paste')}>
          <span className="ico"><Icon name="paste" size={16}/></span>
          <div className="lbl">Wklej tekst</div>
          <div className="hint">⌘V</div>
        </button>
        <button className="way" onClick={() => onPick('upload')}>
          <span className="ico"><Icon name="upload" size={16}/></span>
          <div className="lbl">Prześlij plik</div>
          <div className="hint">.txt .pdf .docx · .jpg .png (OCR)</div>
        </button>
        <button className="way" onClick={() => onPick('type')}>
          <span className="ico"><Icon name="edit" size={16}/></span>
          <div className="lbl">Pisz w edytorze</div>
          <div className="hint">nowy dokument</div>
        </button>
      </div>
    </div>
  );
}

// ---------- Progress overlay ----------
function ProgressOverlay({ pct, step, eta }) {
  const C = 2 * Math.PI * 28; // r=28
  const off = C * (1 - pct / 100);
  return (
    <div className="progress-overlay">
      <div className="progress-card">
        <div className="progress-head">
          <div className="progress-ring">
            <svg viewBox="0 0 64 64">
              <circle className="track" cx="32" cy="32" r="28"/>
              <circle className="fill" cx="32" cy="32" r="28" strokeDasharray={C} strokeDashoffset={off}/>
            </svg>
            <div className="pct">{Math.round(pct)}%</div>
          </div>
          <div className="progress-text">
            <span className="step-name">{step.label}</span>
            <span className="step-meta">
              <span>krok {step.idx + 1} z {step.total}</span>
              <span>·</span>
              <span>~{eta}s pozostało</span>
            </span>
          </div>
        </div>
        <div className="stepper">
          {PIPELINE_STEPS.map((s, i) => {
            const state = i < step.idx ? 'done' : i === step.idx ? 'active' : '';
            return (
              <div key={s.id} className={`step ${state}`}>
                <div className="step-dot">
                  {i < step.idx ? <Icon name="check" size={11}/> : <span>{String(i + 1).padStart(2, '0')}</span>}
                </div>
                <div className="step-label">{s.label}</div>
                <div className="step-time">{i < step.idx ? s.time : i === step.idx ? '...' : ''}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const PIPELINE_STEPS = [
  { id: 'load', label: 'Ładowanie modeli NER', time: '1.2s' },
  { id: 'pre', label: 'Preprocessing — normalizacja whitespace', time: '0.04s' },
  { id: 'seg', label: 'Segmentacja zdań (sentencex)', time: '0.18s' },
  { id: 'ner', label: 'Detekcja encji — eu-pii-pl + multilang', time: '2.4s' },
  { id: 'post', label: 'Postprocessing — granice słów, dedup, tokenizacja', time: '0.31s' },
  { id: 'rescan', label: 'Rescan tekstu pod kątem pominiętych PII', time: '0.21s' },
];

window.EntitySelector = EntitySelector;
window.DocList = DocList;
window.RenderedDoc = RenderedDoc;
window.EmptyEditor = EmptyEditor;
window.ProgressOverlay = ProgressOverlay;
window.PIPELINE_STEPS = PIPELINE_STEPS;

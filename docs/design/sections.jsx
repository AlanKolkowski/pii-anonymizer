// Sections — Tool, MCP, Legend/Debug, Footer
const { useState: useSt, useEffect: useEf, useRef: useRf } = React;

// ---------- The Tool ----------
function ToolApp({ standalone = false }) {
  const [mode, setMode] = useSt('anonymize'); // anonymize | deanonymize
  const [docs, setDocs] = useSt(window.SAMPLE_DOCS);
  const [activeId, setActiveId] = useSt('doc-1');
  const [categories, setCategories] = useSt(window.ENTITY_CATEGORIES);
  const [running, setRunning] = useSt(false);
  const [progress, setProgress] = useSt({ pct: 0, idx: 0 });
  const [annoStyle, setAnnoStyle] = useSt('pill'); // pill | highlight | underline

  // Listen for tweak events
  useEf(() => {
    const h = (e) => {
      if (e.detail && e.detail.annotationStyle) setAnnoStyle(e.detail.annotationStyle);
    };
    window.addEventListener('pii-tweaks', h);
    return () => window.removeEventListener('pii-tweaks', h);
  }, []);

  const activeDoc = docs.find(d => d.id === activeId);

  function handleAddDoc() {
    const id = 'doc-' + (docs.length + 1);
    const newDoc = { id, name: `nowy-${docs.length + 1}.txt`, size: '0 B', status: 'empty', type: 'paste', body: null };
    setDocs([...docs, newDoc]);
    setActiveId(id);
  }

  function runAnonymize() {
    setRunning(true);
    setProgress({ pct: 0, idx: 0 });
    let i = 0;
    const total = window.PIPELINE_STEPS.length;
    const tick = () => {
      i++;
      const pct = (i / total) * 100;
      setProgress({ pct, idx: Math.min(i, total - 1) });
      if (i >= total) {
        setTimeout(() => setRunning(false), 350);
      } else {
        setTimeout(tick, 700 + Math.random() * 600);
      }
    };
    setTimeout(tick, 500);
  }

  const stepInfo = {
    idx: progress.idx,
    total: window.PIPELINE_STEPS.length,
    label: window.PIPELINE_STEPS[progress.idx]?.label || '',
  };

  const totalEntities = docs.reduce((acc, d) => acc + (d.body?.filter(p => p.e).length || 0), 0);
  const eta = Math.max(1, Math.round((1 - progress.pct / 100) * 5));

  const inner = (
    <div className={`tool ${standalone ? 'tool-fullscreen' : ''}`}>
      <div className="tool-header">
        <div className="tool-tabs">
          <button className={`tool-tab ${mode === 'anonymize' ? 'active' : ''}`} onClick={() => setMode('anonymize')}>
            <span className="num">01</span>
            Anonimizuj
          </button>
          <button className={`tool-tab ${mode === 'deanonymize' ? 'active' : ''}`} onClick={() => setMode('deanonymize')}>
            <span className="num">02</span>
            Deanonimizuj
          </button>
        </div>
        <div className="tool-status">
          <span className="pulse"></span>
          <span>Modele załadowane · 84.2 MB · WebGPU</span>
        </div>
      </div>

      {mode === 'anonymize' ? (
        <AnonymizeWorkspace
          docs={docs} setDocs={setDocs}
          activeId={activeId} setActiveId={setActiveId}
          activeDoc={activeDoc}
          categories={categories} setCategories={setCategories}
          annoStyle={annoStyle}
          onAddDoc={handleAddDoc}
          onRun={runAnonymize}
          running={running}
          progress={progress}
          stepInfo={stepInfo}
          eta={eta}
          totalEntities={totalEntities}
        />
      ) : (
        <DeanonymizeWorkspace docs={docs} annoStyle={annoStyle} />
      )}
    </div>
  );

  if (standalone) return inner;

  return (
    <section className="section" id="tool">
      <div className="wrap">
        <div className="section-eyebrow">
          <span className="num">02 ·</span>
          <span className="eyebrow">narzędzie</span>
        </div>
        <h2 className="section-title">Twoja sesja anonimizacji.</h2>
        <p className="section-sub">
          Wybierz encje po lewej, dodaj dokumenty, zanonimizuj. Wklej odpowiedź LLM, aby
          odtworzyć oryginalne wartości.
        </p>
        {inner}
      </div>
    </section>
  );
}
const ToolSection = ToolApp;

function AnonymizeWorkspace({ docs, activeId, setActiveId, activeDoc, categories, setCategories, annoStyle, onAddDoc, onRun, running, progress, stepInfo, eta, totalEntities }) {
  return (
    <>
      <div className="tool-body">
        <aside className="tool-sidebar">
          <DocList docs={docs} activeId={activeId} setActiveId={setActiveId} onAdd={onAddDoc}/>
          <EntitySelector categories={categories} setCategories={setCategories}/>
        </aside>
        <main className="tool-main">
          <div className="workspace-tabs">
            {docs.map(d => (
              <button
                key={d.id}
                className={`ws-tab ${activeId === d.id ? 'active' : ''} ${d.status === 'anonymized' ? 'has-anon' : ''}`}
                onClick={() => setActiveId(d.id)}
              >
                <span className="dot"></span>
                <span>{d.name}</span>
                <span className="close"><Icon name="x" size={10}/></span>
              </button>
            ))}
            <button className="ws-tab-add" onClick={onAddDoc} title="Dodaj dokument">+</button>
          </div>
          <div className="editor-pane">
            <div className="editor-toolbar">
              <div className="left">
                <span className="meta">{activeDoc?.name}</span>
                <span className="meta">·</span>
                <span className="meta">{activeDoc?.size}</span>
                {activeDoc?.body && (
                  <>
                    <span className="meta">·</span>
                    <span className="meta" style={{color:'var(--accent-ink)'}}>
                      {activeDoc.body.filter(p => p.e).length} encji wykrytych
                    </span>
                  </>
                )}
              </div>
              <div className="right">
                <button className="btn btn-sm btn-ghost"><Icon name="edit" size={12}/> Edytuj</button>
                <button className="btn btn-sm btn-ghost"><Icon name="copy" size={12}/> Kopiuj</button>
              </div>
            </div>
            {activeDoc ? <RenderedDoc doc={activeDoc} annoStyle={annoStyle}/> : <EmptyEditor onPick={() => {}} />}
            {running && <ProgressOverlay pct={progress.pct} step={stepInfo} eta={eta}/>}
          </div>
        </main>
      </div>
      <div className="run-bar">
        <div className="left">
          <span><b style={{color:'var(--ink)'}}>{docs.length}</b> dokumenty · <b style={{color:'var(--ink)'}}>{totalEntities}</b> tokenów</span>
          <div className="meter"><div className="meter-fill" style={{width: running ? `${progress.pct}%` : '100%'}}></div></div>
          {!running && <span style={{color:'var(--accent-ink)',fontFamily:'var(--mono)',fontSize:11}}>✓ gotowe</span>}
          {running && <span style={{fontFamily:'var(--mono)',fontSize:11}}>{Math.round(progress.pct)}% · ~{eta}s</span>}
        </div>
        <div className="right">
          <button className="btn btn-sm"><Icon name="copy" size={12}/> Kopiuj wszystkie</button>
          <button className="btn btn-sm btn-primary" onClick={onRun} disabled={running}>
            <Icon name="play" size={11}/> Anonimizuj wszystkie <span className="kbd">⌘ ⏎</span>
          </button>
        </div>
      </div>
    </>
  );
}

function DeanonymizeWorkspace({ docs, annoStyle }) {
  const [outDocs, setOutDocs] = useSt([
    {
      id: 'out-1', name: 'odpowiedz-1.txt',
      input: 'Szanowny [PERSON_NAME_1],\n\nW odpowiedzi na Pana zapytanie z dnia [DATE_OF_BIRTH_1] dotyczące umowy najmu pod adresem [POSTAL_ADDRESS_1], informujemy, że miesięczny czynsz w wysokości [FINANCIAL_AMOUNT_1] należy wpłacać na [BANK_ACCOUNT_IDENTIFIER_1] prowadzony w [ORGANIZATION_NAME_1].\n\nZ wyrazami szacunku,\n[PERSON_NAME_2]',
    },
    {
      id: 'out-2', name: 'streszczenie-medyczne.txt',
      input: 'Pacjent [PERSON_NAME_3] (urodzony [DATE_OF_BIRTH_2], karta [ACCOUNT_IDENTIFIER_1]) wymaga kontynuacji leczenia: [HEALTH_DATA_1]. Lekarz prowadzący — [PERSON_ROLE_OR_TITLE_1].',
    },
  ]);
  const [activeOut, setActiveOut] = useSt('out-1');

  const legend = window.buildLegend(docs);
  const lookup = Object.fromEntries(legend.map(r => [r.token, r]));

  const cur = outDocs.find(d => d.id === activeOut);

  // Render with deanon highlights
  function renderDeanon(text) {
    const re = /\[([A-Z_]+_\d+)\]/g;
    const parts = [];
    let last = 0; let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push({ t: text.slice(last, m.index) });
      const row = lookup[m[1]];
      if (row) {
        parts.push({ tok: m[1], orig: row.orig, type: row.type });
      } else {
        parts.push({ t: m[0] });
      }
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ t: text.slice(last) });
    return parts;
  }

  return (
    <div className="tool-body" style={{gridTemplateColumns: '1fr 1fr'}}>
      <main className="tool-main" style={{borderRight: '1px solid var(--line)'}}>
        <div className="workspace-tabs">
          {outDocs.map(d => (
            <button key={d.id} className={`ws-tab ${activeOut === d.id ? 'active' : ''}`} onClick={() => setActiveOut(d.id)}>
              <span className="dot"></span>
              <span>{d.name}</span>
              <span className="close"><Icon name="x" size={10}/></span>
            </button>
          ))}
          <button className="ws-tab-add">+</button>
        </div>
        <div className="editor-pane">
          <div className="editor-toolbar">
            <div className="left">
              <span className="meta">wejście · z LLM</span>
              <span className="meta">·</span>
              <span className="meta">{cur?.input.length} znaków</span>
            </div>
            <div className="right">
              <button className="btn btn-sm btn-ghost"><Icon name="paste" size={12}/> Wklej</button>
            </div>
          </div>
          <div className="editor mono" style={{fontSize: 13, whiteSpace: 'pre-wrap'}}>
            {cur && renderDeanon(cur.input).map((p, i) =>
              p.t ? <span key={i}>{p.t}</span> :
              <span key={i} className="anno" style={entityStyleByType(p.type)} data-orig={p.orig} title={`${p.tok} → ${p.orig}`}>
                <span className="lbl">{window.ENTITY_LABEL[p.type] || p.type}</span>
                <span className="num">{p.tok.split('_').pop()}</span>
              </span>
            )}
          </div>
        </div>
      </main>
      <main className="tool-main">
        <div className="workspace-tabs">
          <button className="ws-tab active">
            <span className="dot" style={{background:'var(--accent)'}}></span>
            <span>{cur?.name.replace('.txt', '-deanon.txt')}</span>
          </button>
        </div>
        <div className="editor-pane">
          <div className="editor-toolbar">
            <div className="left">
              <span className="meta">wyjście · zdeanonimizowane</span>
              <span className="meta">·</span>
              <span className="meta" style={{color:'var(--accent-ink)'}}>✓ {(cur?.input.match(/\[[A-Z_]+_\d+\]/g) || []).length} tokenów odtworzonych</span>
            </div>
            <div className="right">
              <button className="btn btn-sm btn-primary"><Icon name="copy" size={12}/> Kopiuj</button>
            </div>
          </div>
          <div className={`editor anno-style-${annoStyle}`} style={{whiteSpace: 'pre-wrap'}}>
            {cur && renderDeanon(cur.input).map((p, i) =>
              p.t ? <span key={i}>{p.t}</span> :
              <span key={i} className="anno" style={entityStyleByType(p.type)} data-orig={p.orig}>
                <span className="lbl">{window.ENTITY_LABEL[p.type] || p.type}</span>
                <span className="num">{p.tok.split('_').pop()}</span>
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function entityStyleByType(code) {
  const p = window.ENTITY_PALETTE[code];
  if (!p) return {};
  return { '--ec-bg': p.bg, '--ec-ink': p.ink, '--ec-line': p.line };
}

// ---------- MCP integration ----------
function McpSection() {
  return (
    <section className="section section-tight" id="mcp">
      <div className="wrap">
        <div className="section-eyebrow">
          <span className="num">03 ·</span>
          <span className="eyebrow">integracja</span>
        </div>
        <h2 className="section-title">LLM widzi tylko tokeny.<br/>Ty widzisz oryginalny tekst.</h2>
        <p className="section-sub">
          pii.tools wystawia pięć narzędzi MCP do dowolnego klienta — Claude Desktop, Cursor, własny agent.
          Sources to zanonimizowane dokumenty wejściowe, outcomes to odpowiedzi modelu — i jedne, i drugie krążą wyłącznie w formie tokenów.
        </p>

        <div className="mcp-card">
          <div>
            <h3>WebMCP — sources &amp; outcomes w pętli z LLM-em</h3>
            <p>
              Wygeneruj token w kliencie MCP, wklej go w widget pii.tools. Od tego momentu LLM listuje
              i czyta zanonimizowane źródła, a swoje odpowiedzi zapisuje z powrotem w token-form.
              Deanonimizacja zachodzi tylko w Twojej przeglądarce, tylko dla Ciebie.
            </p>

            <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--ink-4)',textTransform:'uppercase',letterSpacing:'.08em',minWidth:72}}>sources →</span>
                <code style={{fontFamily:'var(--mono)',fontSize:12,padding:'5px 10px',background:'var(--bg-sunk)',border:'1px solid var(--line)',borderRadius:6}}>list_sources</code>
                <code style={{fontFamily:'var(--mono)',fontSize:12,padding:'5px 10px',background:'var(--bg-sunk)',border:'1px solid var(--line)',borderRadius:6}}>read_source</code>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--ink-4)',textTransform:'uppercase',letterSpacing:'.08em',minWidth:72}}>outcomes ↔</span>
                <code style={{fontFamily:'var(--mono)',fontSize:12,padding:'5px 10px',background:'var(--bg-sunk)',border:'1px solid var(--line)',borderRadius:6}}>list_outcomes</code>
                <code style={{fontFamily:'var(--mono)',fontSize:12,padding:'5px 10px',background:'var(--bg-sunk)',border:'1px solid var(--line)',borderRadius:6}}>read_outcome</code>
                <code style={{fontFamily:'var(--mono)',fontSize:12,padding:'5px 10px',background:'var(--bg-sunk)',border:'1px solid var(--line)',borderRadius:6}}>write_outcome</code>
              </div>
            </div>

            <div style={{marginTop:24,display:'flex',gap:10}}>
              <a className="btn btn-primary" href="#"><Icon name="plug" size={13}/> Skonfiguruj klienta</a>
              <a className="btn btn-ghost" href="#"><Icon name="github" size={13}/> Dokumentacja</a>
            </div>
          </div>
          <div className="mcp-flow">
            <div className="mcp-step">
              <div className="n">1</div>
              <div className="t">Użytkownik wrzuca dokumenty — pipeline anonimizuje je lokalnie do <em>sources</em></div>
              <div className="a">browser · wasm</div>
            </div>
            <div className="mcp-step client">
              <div className="n">2</div>
              <div className="t">LLM woła <code style={{fontFamily:'var(--mono)'}}>list_sources</code> / <code style={{fontFamily:'var(--mono)'}}>read_source</code> — widzi tylko tokeny</div>
              <div className="a">mcp</div>
            </div>
            <div className="mcp-step client">
              <div className="n">3</div>
              <div className="t">LLM zapisuje odpowiedź przez <code style={{fontFamily:'var(--mono)'}}>write_outcome</code> — nadal w token-form</div>
              <div className="a">mcp</div>
            </div>
            <div className="mcp-step client">
              <div className="n">4</div>
              <div className="t">Kolejne kroki agenta czytają poprzednie outcomes (<code style={{fontFamily:'var(--mono)'}}>read_outcome</code>) bez kontaktu z PII</div>
              <div className="a">mcp</div>
            </div>
            <div className="mcp-step">
              <div className="n">5</div>
              <div className="t">Przeglądarka deanonimizuje outcome wyłącznie w UI — dla Ciebie, nie dla modelu</div>
              <div className="a">browser</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Legend & Debug ----------
function LegendDebugSection() {
  const [tab, setTab] = useSt('legend');
  const legend = window.buildLegend(window.SAMPLE_DOCS);

  return (
    <section className="section section-tight">
      <div className="wrap">
        <div className="section-eyebrow">
          <span className="num">04 ·</span>
          <span className="eyebrow">pod maską</span>
        </div>
        <h2 className="section-title">Legenda i pipeline pod kontrolą.</h2>
        <p className="section-sub">
          Każdy token ma swoją wartość źródłową. Każdy krok pipeline'u jest wymierny —
          przydatne dla zespołów ML i osób oceniających jakość detekcji.
        </p>

        <div style={{display:'flex',gap:2,marginTop:32,marginBottom:18,background:'var(--bg-sunk)',padding:3,borderRadius:6,border:'1px solid var(--line)',width:'fit-content'}}>
          <button onClick={() => setTab('legend')} className="tool-tab" style={tab==='legend'?{background:'var(--bg-elev)',color:'var(--ink)',boxShadow:'var(--shadow-1)',border:'1px solid var(--line)'}:{}}>
            <span className="num">01</span> Legenda tokenów ({legend.length})
          </button>
          <button onClick={() => setTab('debug')} className="tool-tab" style={tab==='debug'?{background:'var(--bg-elev)',color:'var(--ink)',boxShadow:'var(--shadow-1)',border:'1px solid var(--line)'}:{}}>
            <span className="num">02</span> Debug pipeline'u
          </button>
        </div>

        {tab === 'legend' ? <LegendTable legend={legend}/> : <DebugPanel/>}
      </div>
    </section>
  );
}

function LegendTable({ legend }) {
  return (
    <div className="legend">
      <table>
        <thead>
          <tr>
            <th style={{width:'30%'}}>Token</th>
            <th style={{width:'45%'}}>Wartość oryginalna</th>
            <th style={{width:'25%'}}>Źródło</th>
          </tr>
        </thead>
        <tbody>
          {legend.map(r => (
            <tr key={r.token}>
              <td>
                <span className="tok" style={entityStyleByType(r.type)}>
                  [{r.token}]
                </span>
              </td>
              <td className="orig">{r.orig}</td>
              <td className="src">{r.src}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DebugPanel() {
  const rows = [
    { phase: true, name: 'PHASE: preprocess', delta: '', ms: '0.04s' },
    { num: 1, name: 'normalize-whitespace', delta: '−12 znaków', ms: '0.04s' },
    { phase: true, name: 'PHASE: segment', delta: '', ms: '0.18s' },
    { num: 2, name: 'split-sentences (sentencex)', delta: '+8 segmentów', ms: '0.16s' },
    { num: 3, name: 'chunk-long (max 900)', delta: '0 zmian', ms: '0.02s' },
    { phase: true, name: 'PHASE: ner', delta: '', ms: '2.41s' },
    { num: 4, name: 'eu-pii-pl', delta: '+18 encji', ms: '1.34s' },
    { num: 5, name: 'eu-pii-multilang', delta: '+4 encji', ms: '0.92s' },
    { num: 6, name: 'regex-iban-phone', delta: '+2 encji', ms: '0.15s' },
    { phase: true, name: 'PHASE: postprocess', delta: '', ms: '0.31s' },
    { num: 7, name: 'filter-allowed-types', delta: '−3 encji', ms: '0.02s' },
    { num: 8, name: 'snap-word-boundaries', delta: '21 zmodyfikowanych', ms: '0.05s' },
    { num: 9, name: 'filter-low-confidence', delta: '−1 encja', ms: '0.01s' },
    { num: 10, name: 'dedup-overlapping', delta: '−2 encje', ms: '0.04s' },
    { num: 11, name: 'merge-adjacent', delta: '4 połączenia', ms: '0.06s' },
    { num: 12, name: 'tokenize', delta: '18 tokenów', ms: '0.08s' },
    { num: 13, name: 'rescan-missed-pii', delta: '+0 encji', ms: '0.05s' },
  ];
  return (
    <div className="debug">
      {rows.map((r, i) => (
        <div key={i} className={`debug-row ${r.phase ? 'phase' : ''}`}>
          <span className="step-num">{r.phase ? '' : String(r.num).padStart(2, '0')}</span>
          <span className="name">{r.name}</span>
          <span className="delta">{r.delta}</span>
          <span className="ms">{r.ms}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Footer ----------
function SiteFooter() {
  return (
    <footer className="site-footer" id="privacy">
      <div className="wrap">
        <div className="row">
          <div className="col" style={{maxWidth: 360}}>
            <a className="brand" href="#top">
              <span className="brand-mark">π</span>
              <span className="brand-name"><b>pii</b><span>.tools</span></span>
            </a>
            <p style={{margin:'8px 0 0',color:'var(--ink-3)'}}>
              Anonimizacja PII w przeglądarce. Open-source, bez serwera, zgodne z GDPR i EU AI Act.
            </p>
          </div>
          <div className="col">
            <h5>Produkt</h5>
            <a href="#tool">Narzędzie</a>
            <a href="#mcp">WebMCP</a>
            <a href="#">Changelog</a>
          </div>
          <div className="col">
            <h5>Modele</h5>
            <a href="#">eu-pii-anonimization-pl</a>
            <a href="#">eu-pii-anonimization-multilang</a>
            <a href="#">bards.ai</a>
          </div>
          <div className="col">
            <h5>Open source</h5>
            <a href="#">GitHub</a>
            <a href="#">Apache 2.0</a>
            <a href="#">Issue tracker</a>
          </div>
        </div>
        <div className="meta">
          <span>© 2026 pii.tools · v0.4.2 · 84.2 MB modeli</span>
          <span>żadne dane nie opuszczają twojego urządzenia</span>
        </div>
      </div>
    </footer>
  );
}

window.ToolSection = ToolSection;
window.ToolApp = ToolApp;
window.McpSection = McpSection;
window.LegendDebugSection = LegendDebugSection;
window.SiteFooter = SiteFooter;

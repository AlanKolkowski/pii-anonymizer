# Lokalny anonimizator (desktop)

Offline'owa aplikacja desktopowa do anonimizacji danych osobowych (PII) w
polskich dokumentach prawnych. **Fork** projektu
[wjarka/pii-anonymizer](https://github.com/wjarka/pii-anonymizer) (pii.tools,
Apache-2.0), opakowany w Electrona tak, aby był **fizycznie niezdolny do
wysłania czegokolwiek do sieci** — modele NER i OCR są wbudowane w instalator
i ładowane wyłącznie z dysku. Szczegóły zabezpieczeń: [SECURITY.md](SECURITY.md).

Docelowy użytkownik: radca prawny / mała kancelaria, osoby nietechniczne.
Zero konfiguracji: instalator → uruchom → wklej/wczytaj dokument → anonimizuj.

## Relacja z upstreamem

- `origin`: https://github.com/AlanKolkowski/pii-anonymizer (ten fork)
- `upstream`: https://github.com/wjarka/pii-anonymizer

Moduły pipeline'u (`src/pipeline/**`) i cała logika aplikacji webowej pozostają
zgodne z upstreamem — zmiany desktopowe są **addytywne i bramkowane
zmiennymi builda** (`import.meta.env.VITE_*`), więc `git merge upstream/main`
pozostaje tani, a `npm run dev` / `npm run build` dalej budują czystą wersję
webową o niezmienionym zachowaniu.

### Zmiany względem upstreamu (wymóg Apache-2.0 §4b)

| Plik | Zmiana |
|---|---|
| `src/worker.js` | przy `VITE_LOCAL_MODELS=1`: transformers.js czyta modele z `/local-models/` (`allowRemoteModels=false`), ORT WASM z `VITE_ORT_WASM_PATHS` |
| `src/pipeline/model-download.js` | przy `VITE_LOCAL_MODELS=1` pre-download/cache modeli jest pomijany (modele są lokalne) |
| `src/pipeline/configs/entity-sources.js` | `VITE_MODEL_DTYPE` nadpisuje wariant ONNX (desktop: `q8`/INT8; warianty kwantyzowane wymuszają backend WASM) |
| `src/ocr/models.js` | przy `VITE_OCR_DET_LOCAL=1` model detekcji OCR z `/ocr-models/` zamiast CDN Baidu |
| `src/ocr/paddle.js` | `VITE_PADDLE_ORT_WASM_PATHS` nadpisuje ścieżkę WASM ORT dla PaddleOCR (zamiast jsDelivr) |
| `src/file-import/pdf.js` | `console.warn` połkniętego dotąd błędu OCR strony (diagnostyka, bez zmiany zachowania) |
| `src/pipeline/configs/entity-sources.js` | `VITE_MODEL_DTYPE` nadpisuje wariant ONNX; wartość pochodzi z `models/manifest.json` |
| `index.html` / `tool.html` | bez zmian w źródle; build desktopowy usuwa tagi Google Fonts i Buy-Me-a-Coffee (wtyczka w `vite.config.electron.js`) |
| nowe pliki | `electron/**`, `vite.config.electron.js`, `electron-builder.yml`, `scripts/fetch-models.mjs`, `scripts/dev-desktop.mjs`, `scripts/afterpack-fuses.cjs`, `scripts/make-icon.mjs`, `e2e/desktop-smoke.mjs`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `README.md` |

## Build

Wymagania: Node.js 22+, Windows 10/11 (build macOS: patrz TODO niżej).

```bash
npm install

# 1) Jednorazowo: pobierz modele do wbudowania (~590 MB, do models/)
#    MODEL_DTYPE=fp16 zbuduje wariant fp16; renderer sam się do niego dostroi,
#    bo czyta wariant z models/manifest.json.
npm run desktop:fetch-models

# 2) Zbuduj renderer (Vite, konfiguracja desktopowa -> dist-desktop/)
npm run desktop:build:renderer

# 3a) Uruchom bez instalatora (tryb produkcyjny: protokół app:// + modele z ./models)
npm run desktop:start

# 3b) Zbuduj instalator Windows (NSIS -> release/LokalnyAnonimizator-Setup-*.exe)
#     Najpierw weryfikuje integralność modeli (rozmiary + SHA-256).
npm run desktop:build

# Praca deweloperska (Vite HMR + Electron; jedyny tryb z dopuszczonym originem http)
npm run desktop:dev

# Weryfikacja
npm run desktop:verify-models     # bramka integralności modeli
npm test                          # m.in. testy whitelisty linków zewnętrznych
npm run desktop:smoke             # kryteria akceptacji, układ repo
npm run desktop:smoke:packaged    # to samo na spakowanej binarce (asar + resources/)
npm run desktop:smoke:offline     # spakowana binarka bez DNS (symulacja trybu samolotowego)
```

Test dymny sprawdza: boot offline, anonimizację na modelach lokalnych, OCR
skanu PDF, eksport DOCX oraz dowody braku wycieku — licznik zablokowanych
żądań, zablokowany kanarek z procesu głównego, zero pakietów UDP z WebRTC.

Uwaga (Node 22.0.x): jeśli `npm install` nie pobierze binarki Electrona
(`ERR_REQUIRE_ESM` w `electron/install.js`), pobierz `electron-v<wersja>-win32-x64.zip`
z GitHub Releases, rozpakuj do `node_modules/electron/dist` i zapisz
`node_modules/electron/path.txt` z treścią `electron.exe`. Node ≥ 22.12 nie ma
tego problemu. Z tego samego powodu projekt pinuje electron-builder 25.x
(26.x wymaga `require()` modułów ESM), a `electron-builder.yml` wskazuje
`electronDist: node_modules/electron/dist`.

## Architektura desktopu (skrót)

- **Renderer** = aplikacja webowa forka, budowana przez `vite.config.electron.js`
  (rozszerza `vite.config.js` bez modyfikowania go) do `dist-desktop/`.
- **`app://` protokół** (`electron/app-protocol.mjs`) serwuje renderer i modele
  z pakietu; nagłówki COOP/COEP jak w wersji webowej.
- **Modele** poza asar: `resources/models/{ner,ocr}` (electron-builder
  `extraResources`); NER pod `/local-models/…`, OCR pod `/ocr-models/…`.
- **Blokada sieci + licznik**: `electron/network-guard.mjs` — patrz SECURITY.md §3.
- **Fuses**: `scripts/afterpack-fuses.cjs`.
- Główne okno ładuje bezpośrednio `tool.html` (narzędzie); strona informacyjna
  (`index.html`) pozostaje dostępna z nagłówka aplikacji.

## Parytet funkcji z aplikacją webową

Zachowane w całości: pipeline (preprocess → segmentacja → NER 2×XLM-R + regex →
postprocessing), wybór 7 kategorii / 35 typów encji, edytor adnotacji, import
(tekst, PDF, DOCX, obrazy, HEIC, OCR PaddleOCR offline), spójność tokenów
między dokumentami, zakładki Anonimizuj/Deanonimizuj, eksport DOCX i PDF,
kod integracji WebMCP.

Świadome różnice / otwarte TODO:

- **TODO(mcp-transport):** WebMCP jest w UI, ale połączenie WebSocket jest
  zablokowane przez blokadę sieci — projekt transportu MCP na desktopie to
  decyzja architektoniczna etapu 2 (SECURITY.md §10). Kodu nie usuwamy.
- **TODO(parytet):** self-hosting fontów (Inter itd.) — dziś fonty systemowe.
- **TODO(parytet):** przycisk Buy-Me-a-Coffee (skrypt CDN + slot z linkiem
  zapasowym) usunięty z buildu desktopowego; slot i fallback pozostają
  nietknięte w źródłach forka, usuwa je dopiero wtyczka buildu.
- **TODO(parytet):** linki zewnętrzne spoza whitelisty §5 (m.in. karty modeli
  na HuggingFace, bards.ai) są w UI, ale ich kliknięcie nic nie robi. Do
  decyzji: dopisać do whitelisty albo ukryć w buildzie desktopowym.
- **TODO(parytet):** podpowiedź WebNN (chrome://flags) bez sensu w Electronie;
  do podmiany na przełącznik GPU w ustawieniach aplikacji.
- **TODO(trwałość-legendy):** legenda wyłącznie w pamięci sesji — SECURITY.md §9.
- **TODO(podpis-kodu):** miejsce na certyfikat w `electron-builder.yml`.
- **TODO(macos):** target mac nieskonfigurowany; architektura go nie blokuje.
- **TODO(branding):** ikona `build/icon.ico` to placeholder (π); nazwa robocza
  „Lokalny anonimizator" do decyzji.

## Licencje

Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). Atrybucja modeli
(bards.ai, XLM-RoBERTa, PaddleOCR) i bibliotek: 
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

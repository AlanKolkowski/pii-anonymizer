// Deterministic generator for test-data/adversarial – the adversarial corpus
// of EVAL-RECALL-AUDIT.md part B. Every document is 100% FICTIONAL: names,
// identifiers and case signatures are synthetic (PESEL/NIP/REGON/IBAN carry
// valid checksums so they are structurally real, but belong to no one).
// Documents are built from parts, so entity offsets are computed, never
// hand-counted; output is LF text + expected.json in the same convention as
// test-data/synthetic (offsets = UTF-16 code units into LF text). Re-running
// the script reproduces byte-identical files.
//
// Annotation policy (mirrors test-data/synthetic ground truth):
// - courts, ZUS, banks, companies → ORGANIZATION_NAME (public-institution
//   sensitivity is weighed later, in the leak register, not here);
// - own-case signatures, decision/invoice numbers → DOCUMENT_REFERENCE;
//   citations of published case law and statutes (art., Dz.U.) are NOT
//   annotated – they are public references, a false-positive trap;
// - salaries → FINANCIAL_AMOUNT (synthetic corpus precedent, pismo_05);
// - a whole address block (street + code + city, possibly multi-line) is a
//   single POSTAL_ADDRESS; a standalone city mention is LOCATION; locations
//   nested inside a larger annotated span are not annotated separately;
// - generic procedural roles (powód, pozwany) are NOT annotated; concrete
//   titles (adw., r. pr., Prezes Zarządu) are PERSON_ROLE_OR_TITLE;
// - OCR-garbled PII (l/1, O/0, spaced letters) IS annotated with its true
//   type: the sieve exists to protect professional secrecy, and a human can
//   still read the garbled value.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleHoldoutDocs, buildHoldoutDoc } from './corpus/holdout-templates.mjs';
import { collectIdentifyingValues, findDisjointnessViolations } from './corpus/holdout-disjointness.mjs';
import holdoutManifest from './corpus/holdout-manifest.json' with { type: 'json' };

const OUT_DIR = join(import.meta.dirname, '..', 'test-data', 'adversarial');
const HOLDOUT_OUT_DIR = join(import.meta.dirname, '..', 'test-data', 'adversarial-holdout');

const E = (entity_group, text) => ({ entity_group, text });
const PN = (t) => E('PERSON_NAME', t);
const ROLE = (t) => E('PERSON_ROLE_OR_TITLE', t);
const PID = (t) => E('PERSON_IDENTIFIER', t);
const OID = (t) => E('ORGANIZATION_IDENTIFIER', t);
const ORG = (t) => E('ORGANIZATION_NAME', t);
const ADR = (t) => E('POSTAL_ADDRESS', t);
const LOC = (t) => E('LOCATION', t);
const AMT = (t) => E('FINANCIAL_AMOUNT', t);
const IBAN = (t) => E('BANK_ACCOUNT_IDENTIFIER', t);
const TEL = (t) => E('PHONE_NUMBER', t);
const MAIL = (t) => E('EMAIL_ADDRESS', t);
const REF = (t) => E('DOCUMENT_REFERENCE', t);
const DOB = (t) => E('DATE_OF_BIRTH', t);
const ATTR = (t) => E('PERSON_ATTRIBUTE', t);
const VEH = (t) => E('VEHICLE_IDENTIFIER', t);
const HEALTH = (t) => E('HEALTH_DATA', t);
const CRIME = (t) => E('CRIMINAL_OFFENCE_DATA', t);
const UNION = (t) => E('TRADE_UNION_MEMBERSHIP', t);

// ── Corpus ──────────────────────────────────────────────────────────

export const DOCS = [

  {
    name: 'adw_01_nazwisko_dopelniacz',
    attack: 'Jednowyrazowe nazwisko odmienione przez przypadki: fuzzyBackfill żąda co najmniej dwóch słów wielką literą, więc pojedyncze „Żurawskiego” nie zostanie dosiane z rescanu.',
    parts: [
      'Powód ', PN('Konrad Żurawski'), ' wnosi o zasądzenie od pozwanej kwoty ',
      AMT('12 000,00 zł'), ' wraz z odsetkami ustawowymi za opóźnienie.\n\n',
      'W toku negocjacji pozwana dwukrotnie obiecywała zapłatę na rzecz ',
      PN('Żurawskiego'), ', czego jednak nie uczyniła. Pełnomocnik pozwanej przekazał ',
      PN('Żurawskiemu'), ' jedynie propozycję rozłożenia należności na raty, ',
      'której powód nie przyjął. Zdaniem ', PN('Żurawskiego'),
      ' rozłożenie na raty jest bezcelowe wobec wcześniejszych zaniechań pozwanej.\n\n',
      'Wobec powyższego wnoszę jak na wstępie.\n',
    ],
  },

  {
    name: 'adw_02_apozycja_rol',
    attack: 'Imię i nazwisko wyłącznie w apozycji do roli procesowej („pozwanemu Bartłomiejowi Czyżowi”): model zjada granicę rola–nazwisko, a odmieniona forma nie wraca do formy bazowej.',
    parts: [
      'W odpowiedzi na wezwanie doręczone pozwanemu ', PN('Bartłomiejowi Czyżowi'),
      ' w dniu 14 lutego 2025 r. podnoszę, że roszczenie powódki ', PN('Haliny Mroczek-Sowińskiej'),
      ' uległo przedawnieniu.\n\nPowódce ', PN('Halinie Mroczek-Sowińskiej'),
      ' doręczono odpis sprzeciwu. Pozwany ', PN('Bartłomiej Czyż'),
      ' wnosi o oddalenie powództwa w całości i zasądzenie od powódki na rzecz pozwanego ',
      'kosztów procesu według norm przepisanych.\n',
    ],
  },

  {
    name: 'adw_03_nazwisko_dywiz',
    attack: 'Nazwiska dwuczłonowe z dywizem w kilku przypadkach: „-” jest w klasie granic słowa snapu, więc dosunięcie do granic nie przejdzie przez dywiz, a model tnie człony na łączniku.',
    parts: [
      'Pełnomocnikiem wnioskodawczyni ', PN('Michaliny Krzemień-Zawadzkiej'),
      ' jest ', ROLE('r. pr.'), ' ', PN('Zdzisław Odrowąż-Pietraszek'),
      '.\n\nWnioskodawczyni ', PN('Michalina Krzemień-Zawadzka'),
      ' nabyła spadek z dobrodziejstwem inwentarza. Uczestnik postępowania zarzucił ',
      PN('Krzemień-Zawadzkiej'), ' zatajenie składników majątku, czemu pełnomocnik ',
      PN('Odrowąż-Pietraszek'), ' stanowczo zaprzeczył. Sąd zobowiązał ',
      PN('Michalinę Krzemień-Zawadzką'), ' do złożenia wykazu inwentarza w terminie 14 dni.\n',
    ],
  },

  {
    name: 'adw_04_nazwisko_nieodmienne',
    attack: 'Żeńskie nazwiska nieodmienne (Wilk, Kos): odmienia się tylko imię, więc heurystyka wspólnego rdzenia i normalizacja nazw łatwo rozjeżdżają wystąpienia tej samej osoby.',
    parts: [
      'Umowę zawarto z ', PN('Anielą Wilk'), ', zamieszkałą w ', LOC('Chełmnie'),
      '.\n\nZgodnie z § 4 umowy ', PN('Aniela Wilk'), ' zobowiązała się do wydania lokalu ',
      'do dnia 31 marca 2025 r. Wynajmująca wypowiedziała umowę ', PN('Anieli Wilk'),
      ' pismem z dnia 2 kwietnia 2025 r. Do pisma dołączono oświadczenie ',
      PN('Barbary Kos'), ', sąsiadki lokalu, o zakłócaniu spokoju. Pani ',
      PN('Kos'), ' potwierdziła gotowość zeznawania w charakterze świadka.\n',
    ],
  },

  {
    name: 'adw_05_nazwisko_pospolite',
    attack: 'Nazwiska będące wyrazami pospolitymi (Kowal, Zamek, Lis, Sad, Baran), także na początku zdania: dezambiguacja rzeczownik/nazwisko to najsłabszy punkt NER poza kontekstem roli.',
    parts: [
      'Pozwany ', PN('Seweryn Kowal'), ' zakwestionował autentyczność podpisu. ',
      PN('Kowal'), ' oświadczył, że w dniu zawarcia umowy przebywał w ', LOC('Grudziądzu'),
      '.\n\nŚwiadek ', PN('Iwona Lis'), ' zeznała odmiennie. ', PN('Lis'),
      ' wskazała, że widziała pozwanego pod zamkiem w ', LOC('Golubiu-Dobrzyniu'),
      ', gdzie odbywał się jarmark. Biegły ', PN('Marceli Baran'),
      ' sporządził opinię z zakresu badania pisma ręcznego. ', PN('Baran'),
      ' stwierdził, że podpis nakreślono ręką pozwanego. ', ROLE('Ogrodnik'), ' ', PN('Tadeusz Sad'),
      ' nie stawił się na rozprawę. ', PN('Sad'), ' usprawiedliwił nieobecność zwolnieniem lekarskim.\n',
    ],
  },

  {
    name: 'adw_06_inicjaly',
    attack: 'Inicjały i skróty („K. Żurawski”, „adw. J. M.”, parafka „M.K.”): znany przeciek z docs/RESULTS-ensemble-experiment.md, inicjał nie skleja się z nazwiskiem w jedną encję.',
    parts: [
      'Opinię sporządził biegły ', PN('K. Żurawski'), ', a zastrzeżenia do niej wniósł ',
      ROLE('adw.'), ' ', PN('J. M.'), ' w imieniu pozwanej.\n\n',
      'Na kopii pisma widnieje parafka ', PN('M.K.'), ' oraz dopisek ',
      ROLE('sekr. sąd.'), ' ', PN('E. W.'), ' o zwrocie załączników. Zgodność kopii z oryginałem potwierdziła ',
      PN('L. Szczygieł'), ', ', ROLE('apl. radc.'), '\n',
    ],
  },

  {
    name: 'adw_07_wolacz_cudzyslow',
    attack: 'Wołacz i nazwiska wewnątrz cytowanej wypowiedzi świadka: przypadki rzadkie w danych treningowych NER, cudzysłowy typograficzne przy granicach encji.',
    parts: [
      'Na rozprawie świadek zwrócił się do pełnomocnika: „Panie Mecenasie ',
      PN('Odrowążu-Pietraszku'), ', przecież pan wie, jak było”.\n\n',
      'Świadek ', PN('Dobrosława Zamek'), ' zeznała: „Widziałam, jak ', PN('Marceli Baran'),
      ' przekazywał kopertę ', PN('Sewerynowi Kowalowi'), ' na parkingu przy ',
      ADR('ul. Żeglarskiej 4 w Toruniu'), '”. Po odczytaniu protokołu świadek dodała: „',
      PN('Kowalowi'), ' zależało, żeby nikt tego nie widział”.\n',
    ],
  },

  {
    name: 'adw_08_lista_swiadkow',
    attack: 'Wyliczenie świadków w punktach z pełnymi danymi w jednej linii: segmentacja list, adres i PESEL sklejone w pozycji wyliczenia.',
    parts: [
      'Wnoszę o dopuszczenie dowodu z zeznań świadków:\n\n',
      '1. ', PN('Leokadia Szczygieł'), ', zam. ', ADR('ul. Klonowa 8/2, 87-100 Toruń'),
      ', PESEL ', PID('77122498763'), ';\n',
      '2. ', PN('Eustachy Gwóźdź'), ', zam. ', ADR('ul. Krucza 15, 86-300 Grudziądz'),
      ', tel. ', TEL('+48 566 123 456'), ';\n',
      '3. ', PN('Dobrosława Zamek'), ', zam. ', ADR('Rynek 2/4, 87-140 Chełmża'),
      ', e-mail: ', MAIL('d.zamek@poczta-testowa.pl'), ';\n',
      '4. ', PN('Marceli Baran'), ', ', ROLE('biegły z zakresu grafologii'),
      ', na okoliczność autentyczności podpisu.\n',
    ],
  },

  {
    name: 'adw_09_pesel_formaty',
    attack: 'PESEL sklejony z etykietą, rozdzielony spacjami i przełamany wierszem: regex \\b\\d{11}\\b znosi wyłącznie zapis ciągły.',
    parts: [
      'Dłużnik: ', PN('Konrad Żurawski'), ', PESEL:', PID('85030712349'),
      ' (zapis z systemu bez spacji po dwukropku).\n\n',
      'W formularzu ręcznym PESEL wpisano z odstępami: ', PID('850 307 123 49'),
      '.\nW skanie wniosku numer przełamano na końcu wiersza: PESEL ', PID('850307\n12349'),
      '.\nPESEL małżonki dłużnika: ', PID('92090156781'), ' (zapis ciągły, poprawny).\n',
    ],
  },

  {
    name: 'adw_10_nip_formaty',
    attack: 'NIP w grupowaniu 3-2-2-3 i w formacie VAT UE: regex zna wyłącznie grupowanie 3-3-2-2, pozostałe warianty widzi tylko model.',
    parts: [
      'Sprzedawca: ', ORG('Miedziak-Metal sp. z o.o.'), ' z siedzibą w ', LOC('Brodnicy'),
      ', NIP ', OID('524-987-12-30'), '.\n',
      'Nabywca: ', ORG('Zakład Ślusarski „Gwint” Eustachy Gwóźdź'), ', NIP ',
      OID('611-87-65-433'), ' (grupowanie jak na starych pieczątkach).\n',
      'Numer VAT UE nabywcy: ', OID('PL 9481234560'), '.\n',
      'NIP zapisany ciągiem w JPK: ', OID('7293847564'), '.\n',
    ],
  },

  {
    name: 'adw_11_regon_krs',
    attack: 'REGON 9- i 14-cyfrowy oraz KRS: żaden nie ma własnego wzorca regex, wykrycie zależy w całości od modelu.',
    parts: [
      ORG('Miedziak-Metal sp. z o.o.'), ', KRS ', OID('0000876123'),
      ', REGON ', OID('381245999'), ', kapitał zakładowy ', AMT('50 000,00 zł'), '.\n\n',
      'Oddział samobilansujący spółki posługuje się REGON czternastocyfrowym: ',
      OID('38124599900010'), '. Spółka jest wpisana do rejestru przedsiębiorców prowadzonego przez ',
      ORG('Sąd Rejonowy w Toruniu, VII Wydział Gospodarczy KRS'), '.\n',
    ],
  },

  {
    name: 'adw_12_iban_lamany',
    attack: 'NRB bez prefiksu PL, IBAN z dywizami i IBAN przełamany wierszem: regex rachunku wymaga literału „PL” i dopuszcza wyłącznie spacje między grupami.',
    parts: [
      'Zapłatę należy uiścić na rachunek: ', IBAN('75 1090 2776 0000 0001 9876 5432'),
      ' (numer krajowy bez prefiksu).\n\n',
      'W umowie wskazano rachunek w formacie z łącznikami: ',
      IBAN('PL41-1140-2004-0000-9876-5432-1098'), '.\n',
      'W skanie aneksu numer przełamano: rachunek ', IBAN('PL26 1600 1462 0000\n8765 4321 0987'),
      '.\nRachunek techniczny (zapis ciągły): ', IBAN('PL75109027760000000198765432'), '.\n',
    ],
  },

  {
    name: 'adw_13_telefony',
    attack: 'Telefon stacjonarny z numerem kierunkowym w nawiasie, siedmiocyfrowy numer lokalny i zapis z zerem wiodącym: oba wzorce regex wymagają 11–12 cyfr bez nawiasów.',
    parts: [
      'Sekretariat kancelarii: ', TEL('(56) 622-33-44'), ', wewnętrzny 102.\n',
      'Numer lokalny bez kierunkowego: ', TEL('622 33 44'), '.\n',
      'Telefon komórkowy pełnomocnika: ', TEL('501-234-567'), '.\n',
      'Archiwalny zapis z zerem wiodącym: tel. ', TEL('0 501 234 567'), '.\n',
      'Poprawny zapis międzynarodowy dla porównania: ', TEL('+48 56 622 33 44'), '.\n',
    ],
  },

  {
    name: 'adw_14_dokumenty_tozsamosci',
    attack: 'Numery dowodu osobistego, paszportu i prawa jazdy: identyfikatory osobiste bez dedykowanego wzorca regex, wykrywalne wyłącznie modelem.',
    parts: [
      'Tożsamość mocodawcy ustalono na podstawie dowodu osobistego seria i nr ',
      PID('DKR 744829'), ', wydanego przez ', ROLE('Prezydenta Miasta'), ' ', LOC('Torunia'), '.\n\n',
      'W aktach znajduje się kopia paszportu nr ', PID('EJ 1234567'),
      ' oraz prawa jazdy nr ', PID('00123/22/0611'), ' kat. B. Zbiorczy zapis z systemu: dow. os. ',
      PID('DKR744829'), ' (bez spacji).\n',
    ],
  },

  {
    name: 'adw_15_kwoty_formaty',
    attack: 'Kwoty z kropką tysięcy, bez groszy, w EUR i z walutą przed liczbą: regex kwot wymaga przecinka, groszy i literału „zł” po liczbie.',
    parts: [
      'Cena sprzedaży wynosi ', AMT('15.000,00 zł'), ' (zapis z kropką tysięcy ze skanu faktury).\n',
      'Zadatek: ', AMT('1500 zł'), ', płatny gotówką.\n',
      'Wartość kontraktu eksportowego: ', AMT('2 500 000,00 EUR'), '.\n',
      'W walucie przed liczbą: ', AMT('PLN 4.200'), ' miesięcznie.\n',
      'Zapis z twardą spacją: ', AMT('12 500,00 zł'), ' (poprawnie łapany przez wzorzec).\n',
      'Kara umowna: ', AMT('0,5% wartości kontraktu za każdy dzień, nie więcej niż 8 000,00 zł'), '.\n',
    ],
  },

  {
    name: 'adw_16_kwoty_slownie',
    attack: 'Kwoty wyrażone wyłącznie słownie oraz w nawiasie po zapisie cyfrowym: warstwa regex ich nie widzi, a model tnie długie frazy liczebnikowe.',
    parts: [
      'Pożyczkodawca przekazał pożyczkobiorcy kwotę ',
      AMT('dwadzieścia trzy tysiące czterysta złotych 00/100'), '.\n\n',
      'Strony ustaliły czynsz na ', AMT('2 100,00 zł'), ' (słownie: ',
      AMT('dwa tysiące sto złotych'), ') miesięcznie.\n',
      'Wadium w wysokości ', AMT('pięciu tysięcy stu złotych'),
      ' wniesiono w gotówce.\n',
    ],
  },

  {
    name: 'adw_17_wynagrodzenie',
    attack: 'Kwoty w kontekście płacowym (brutto, netto, stawka godzinowa): taksonomia modelu zna INCOME_COMPENSATION, a ground truth korpusu używa FINANCIAL_AMOUNT – pomyłka typu kosztuje podwójnie (FP+FN).',
    parts: [
      'Pracownikowi przysługuje wynagrodzenie zasadnicze w wysokości ',
      AMT('8 400,00 zł'), ' brutto miesięcznie oraz dodatek funkcyjny ',
      AMT('600,00 zł'), ' brutto.\n\n',
      'Za pracę w godzinach nadliczbowych strony ustaliły stawkę ',
      AMT('150,00 zł'), ' netto za godzinę. Premia roczna nie przekroczy ',
      AMT('dwukrotności wynagrodzenia zasadniczego'), '.\n',
    ],
  },

  {
    name: 'adw_18_naglowek_pisma',
    attack: 'Blok nadawcy i adresata w nagłówku pisma procesowego: krótkie linie bez czasowników wypadają z kontekstu zdaniowego, na którym trenowano model.',
    parts: [
      LOC('Toruń'), ', dnia 3 marca 2025 r.\n\n',
      'Powód:\n', PN('Konrad Żurawski'), '\n', ADR('ul. Polna 3/5\n87-100 Toruń'),
      '\nPESEL: ', PID('85030712349'), '\n\n',
      'Pozwana:\n', ORG('Miedziak-Metal sp. z o.o.'), '\n',
      ADR('ul. Przemysłowa 21\n86-300 Grudziądz'), '\nKRS: ', OID('0000876123'), '\n\n',
      ORG('Sąd Rejonowy w Toruniu\nI Wydział Cywilny'), '\n', ADR('ul. Młodzieżowa 31\n87-100 Toruń'), '\n\n',
      'POZEW O ZAPŁATĘ\n',
    ],
  },

  {
    name: 'adw_19_tabela_ascii',
    attack: 'Dane osobowe w tabeli tekstowej z separatorami pionowymi: kreski sklejają się z wartościami i psują granice słów oraz segmentację zdań.',
    parts: [
      'Zestawienie stron postępowania:\n\n',
      '| Lp. | Strona | Adres | PESEL |\n',
      '|-----|--------|-------|-------|\n',
      '| 1 | ', PN('Konrad Żurawski'), ' | ', ADR('ul. Polna 3/5, 87-100 Toruń'),
      ' | ', PID('85030712349'), ' |\n',
      '| 2 | ', PN('Aniela Wilk'), ' | ', ADR('ul. Wodna 11, 86-200 Chełmno'),
      ' | ', PID('61041876540'), ' |\n',
      '| 3 | ', PN('Eustachy Gwóźdź'), ' | ', ADR('ul. Krucza 15, 86-300 Grudziądz'),
      ' | ', PID('55060323457'), ' |\n',
    ],
  },

  {
    name: 'adw_20_adres_lamany',
    attack: 'Adres przełamany w środku nazwy ulicy (z dywizem przeniesienia) oraz kod pocztowy oddzielony od miejscowości końcem wiersza: scalanie adjacentnych encji ma lukę na granicy wiersza.',
    parts: [
      'Doręczenia należy kierować na adres: ', ADR('ul. Gene-\nralska 12 m. 4, 87-100 Toruń'),
      '.\n\nPoprzedni adres zameldowania strony: ', ADR('ul. Szeroka 40/2\n87-100\nToruń'),
      ' (kod i miejscowość w osobnych wierszach skanu).\n',
      'Adres do korespondencji elektronicznej: ', MAIL('k.zurawski@poczta-testowa.pl'), '.\n',
    ],
  },

  {
    name: 'adw_21_stopka_gesta',
    attack: 'Stopka kancelaryjna: wiele typów PII w jednej linii rozdzielonych kreskami pionowymi, bez zdań – kumulacja granic słów nieznanych snapowi.',
    parts: [
      'Z poważaniem\n', ROLE('r. pr.'), ' ', PN('Zdzisław Odrowąż-Pietraszek'), '\n\n',
      '─────────────────────────────\n',
      ORG('Kancelaria Radcy Prawnego „Żuraw i Partnerzy”'), ' | ',
      ADR('ul. Szeroka 40/2, 87-100 Toruń'), ' | NIP ', OID('8562349172'),
      ' | REGON ', OID('876543216'), ' | tel. ', TEL('(56) 622-33-44'),
      ' | ', MAIL('biuro@zuraw-partnerzy.pl'), ' | rachunek: ',
      IBAN('PL41 1140 2004 0000 9876 5432 1098'), '\n',
    ],
  },

  {
    name: 'adw_22_koperta',
    attack: 'Sam blok adresowy jak na kopercie, bez żadnego kontekstu zdaniowego: NER musi rozpoznać osobę i adres z samego układu wierszy.',
    parts: [
      'Sz. P.\n', PN('Michalina Krzemień-Zawadzka'), '\n',
      ADR('ul. Bydgoska 92 m. 7\n87-100 Toruń'), '\n\n',
      'polecony, za potwierdzeniem odbioru\n',
    ],
  },

  {
    name: 'adw_23_ocr_podmiany',
    attack: 'Podmiany glifów OCR (l↔1, O↔0) wewnątrz PESEL, NIP i rachunku: regexy cyfrowe wypadają całkowicie, a model widzi „słowa” zamiast liczb.',
    parts: [
      'PESEL dłużnika (skan niskiej jakości): ', PID('850307l2349'),
      ' – w oryginale cyfra 1, w skanie mała litera „l”.\n',
      'NIP wierzyciela: ', OID('524-987-12-3O'), ' (na końcu litera „O” zamiast zera).\n',
      'REGON: ', OID('38l245999'), '.\n',
      'Rachunek: ', IBAN('PL75 lO9O 2776 0000 0001 9876 5432'), '.\n',
      'Dla porównania zapis poprawny NIP: ', OID('5249871230'), '.\n',
    ],
  },

  {
    name: 'adw_24_ocr_rozstrzelone',
    attack: 'Rozstrzelone litery (spacja po każdym znaku) w nazwisku i numerze PESEL: tokenizacja subword rozpada się na pojedyncze znaki bez sygnału encji.',
    parts: [
      'Nagłówek skanu decyzji: ', ORG('Z A K Ł A D   U B E Z P I E C Z E Ń   S P O Ł E C Z N Y C H'), '\n\n',
      'Ubezpieczony: ', PN('K o n r a d   Ż u r a w s k i'), '\n',
      'P E S E L: ', PID('8 5 0 3 0 7 1 2 3 4 9'), '\n',
      'Zwykły zapis dla porównania: ', PN('Konrad Żurawski'), ', PESEL ', PID('85030712349'), '.\n',
    ],
  },

  {
    name: 'adw_25_ocr_sklejone',
    attack: 'Sklejone słowa bez spacji (imię z nazwiskiem, przyimek z miejscowością, ulica z numerem): granice słów znikają, snap nie ma czego dosunąć.',
    parts: [
      'Powód', PN('KonradŻurawski'), ' zam. w', LOC('Toruniu'), ' przy',
      ADR('ul.Polnej3/5'), ' wniósł o zwolnienie od kosztów.\n\n',
      'Pozwana', PN('AnielaWilk'), ' odebrała wezwanie dnia 12.02.2025r. pod adresem',
      ADR('ul.Wodna11,86-200Chełmno'), '.\n',
    ],
  },

  {
    name: 'adw_26_ocr_przenoszenie',
    attack: 'Przeniesienie wyrazu z dywizem na końcu wiersza w środku nazwiska i kwoty: encja rozcięta twardym łamaniem, którego żadna warstwa nie skleja.',
    parts: [
      'Zobowiązanie zaciągnięte przez pana ', PN('Żuraw-\nskiego'),
      ' wynosi ', AMT('23 400,00\nzł'), ' wraz z odsetkami.\n\n',
      'Poręczycielką jest pani ', PN('Mroczek-Sowiń-\nska'),
      ', która udzieliła poręczenia do kwoty ', AMT('10 000,00 zł'), '.\n',
    ],
  },

  {
    name: 'adw_27_pozew',
    attack: 'Kompletny pozew o zapłatę: kumulacja wszystkich mechanizmów naraz w długim dokumencie – chunking segmentów, powtórzenia encji, odmiana w uzasadnieniu i gęste dane w komparycji.',
    parts: [
      LOC('Toruń'), ', dnia 3 marca 2025 r.\n\n',
      ORG('Sąd Rejonowy w Toruniu\nI Wydział Cywilny'), '\n',
      ADR('ul. Młodzieżowa 31\n87-100 Toruń'), '\n\n',
      'Powód: ', PN('Konrad Żurawski'), ', PESEL ', PID('85030712349'),
      ', zam. ', ADR('ul. Polna 3/5, 87-100 Toruń'), ',\nreprezentowany przez ',
      ROLE('r. pr.'), ' ', PN('Zdzisława Odrowąża-Pietraszka'), ', ',
      ORG('Kancelaria „Żuraw i Partnerzy”'), ', ', ADR('ul. Szeroka 40/2, 87-100 Toruń'), '\n\n',
      'Pozwana: ', ORG('Miedziak-Metal sp. z o.o.'), ', KRS ', OID('0000876123'),
      ', NIP ', OID('5249871230'), ', z siedzibą w ', LOC('Grudziądzu'), ', ',
      ADR('ul. Przemysłowa 21, 86-300 Grudziądz'), '\n\n',
      'Wartość przedmiotu sporu: ', AMT('23 400,00 zł'), '\nOpłata sądowa: ', AMT('1 170,00 zł'), '\n\n',
      'POZEW O ZAPŁATĘ\nW POSTĘPOWANIU UPOMINAWCZYM\n\n',
      'Działając w imieniu powoda (pełnomocnictwo w załączeniu), wnoszę o:\n\n',
      '1. zasądzenie od pozwanej na rzecz powoda kwoty ', AMT('23 400,00 zł'),
      ' (słownie: ', AMT('dwadzieścia trzy tysiące czterysta złotych 00/100'),
      ') wraz z odsetkami ustawowymi za opóźnienie od dnia 15 stycznia 2025 r. do dnia zapłaty;\n',
      '2. zasądzenie kosztów procesu, w tym kosztów zastępstwa procesowego, według norm przepisanych;\n',
      '3. rozpoznanie sprawy w postępowaniu upominawczym.\n\n',
      'UZASADNIENIE\n\n',
      'Powoda i pozwaną łączyła umowa o dzieło nr ', REF('UD/2024/091'),
      ' z dnia 12 września 2024 r., na mocy której ', PN('Żurawski'),
      ' wykonał i dostarczył pozwanej ślusarkę aluminiową. Odbiór dzieła nastąpił ',
      'bez zastrzeżeń, co potwierdza protokół podpisany przez ', ROLE('kierownika produkcji'),
      ' pozwanej, pana ', PN('Eustachego Gwoździa'), '.\n\n',
      'Z tytułu wykonania dzieła powód wystawił fakturę VAT nr ', REF('FV/2024/09/0144'),
      ' na kwotę ', AMT('23 400,00 zł'), ' z terminem płatności do dnia 14 stycznia 2025 r. ',
      'Pozwana nie uiściła należności w terminie. Wezwanie do zapłaty doręczono pozwanej ',
      'dnia 3 lutego 2025 r.; pozostało bezskuteczne.\n\n',
      'W rozmowie telefonicznej z dnia 10 lutego 2025 r. ', ROLE('prezes zarządu'),
      ' pozwanej, pan ', PN('Marceli Baran'), ', obiecał ', PN('Żurawskiemu'),
      ' zapłatę „do końca miesiąca”, jednak obietnicy nie dotrzymał. Zgodnie z art. 481 § 1 k.c. ',
      'wierzycielowi należą się odsetki za czas opóźnienia. Roszczenie stało się wymagalne ',
      'dnia 15 stycznia 2025 r.\n\n',
      'Zapłata winna nastąpić na rachunek powoda: ', IBAN('PL75 1090 2776 0000 0001 9876 5432'), '.\n\n',
      'Załączniki:\n1. odpis pozwu z załącznikami;\n2. umowa nr ', REF('UD/2024/091'),
      ';\n3. faktura VAT nr ', REF('FV/2024/09/0144'), ';\n4. wezwanie do zapłaty z potwierdzeniem doręczenia;\n',
      '5. pełnomocnictwo wraz z dowodem uiszczenia opłaty skarbowej.\n\n',
      ROLE('r. pr.'), ' ', PN('Zdzisław Odrowąż-Pietraszek'), '\n',
    ],
  },

  {
    name: 'adw_28_odpowiedz_na_pozew',
    attack: 'Odpowiedź na pozew z odmianą nazwisk stron w narracji i odesłaniami do sygnatury: nazwisko pojawia się niemal wyłącznie w przypadkach zależnych.',
    parts: [
      'Sygn. akt ', REF('I C 1445/25'), '\n\n',
      'ODPOWIEDŹ NA POZEW\n\n',
      'Działając w imieniu pozwanej ', PN('Ireny Maj'),
      ' (pełnomocnictwo w załączeniu), wnoszę o oddalenie powództwa w całości.\n\n',
      'Powód wywodzi roszczenie z umowy pożyczki, której pozwana ', PN('Irenie Maj'),
      ' nigdy nie udzielono w kwocie wskazanej w pozwie. Przekazana ', PN('Mai'),
      ' suma wyniosła ', AMT('8 000,00 zł'), ', nie zaś ', AMT('18 000,00 zł'),
      '. Różnica wynika z dopisania cyfry na pokwitowaniu, co pozwana wykaże opinią biegłego.\n\n',
      'Ponadto powód pominął, że ', PN('Maj'), ' zwróciła już ', AMT('6 500,00 zł'),
      ' przelewami na rachunek powoda: ', IBAN('PL26 1600 1462 0000 8765 4321 0987'),
      '. Na rozprawie stawi się mąż pozwanej, ', PN('Grzegorz Maj'),
      ', obecny przy przekazaniu gotówki.\n\n',
      ROLE('adw.'), ' ', PN('J. M.'), '\n',
    ],
  },

  {
    name: 'adw_29_umowa_kredytu',
    attack: 'Fragment umowy kredytu: wysoka gęstość liczb, z których tylko część to PII – oprocentowanie i marża kuszą model do fałszywych kwot, a dane kredytobiorcy giną w szumie liczbowym.',
    parts: [
      'UMOWA KREDYTU GOTÓWKOWEGO NR ', REF('KG/2025/02/00871'), '\n\n',
      'zawarta w ', LOC('Toruniu'), ' dnia 20 lutego 2025 r. pomiędzy:\n',
      ORG('Bank Pomorski Spółka Akcyjna'), ' z siedzibą w ', LOC('Gdańsku'),
      ', KRS ', OID('0000123987'), ', NIP ', OID('9481234560'),
      ', zwanym dalej Bankiem,\na\n',
      PN('Michaliną Krzemień-Zawadzką'), ', PESEL ', PID('77122498763'),
      ', zam. ', ADR('ul. Bydgoska 92 m. 7, 87-100 Toruń'), ', zwaną dalej Kredytobiorcą.\n\n',
      '§ 1. Bank udziela Kredytobiorcy kredytu w kwocie ', AMT('45 000,00 zł'),
      ' na okres 60 miesięcy.\n',
      '§ 2. Oprocentowanie kredytu jest zmienne i wynosi w dniu zawarcia umowy 11,45% w stosunku rocznym, ',
      'na co składa się wskaźnik referencyjny WIRON 1M oraz marża Banku 4,20 p.p.\n',
      '§ 3. Prowizja za udzielenie kredytu wynosi ', AMT('1 350,00 zł'),
      '. RRSO: 13,87%.\n',
      '§ 4. Rata kapitałowo-odsetkowa wynosi ', AMT('989,12 zł'),
      ' i jest płatna do 15. dnia każdego miesiąca na rachunek: ',
      IBAN('PL41 1140 2004 0000 9876 5432 1098'), '.\n',
      '§ 5. Kredytobiorca oświadcza, że jego średnie miesięczne wynagrodzenie wynosi ',
      AMT('9 100,00 zł'), ' netto.\n',
    ],
  },

  {
    name: 'adw_30_protokol',
    attack: 'Protokół rozprawy: dane świadków podawane w toku narracji (wiek, zawód, adres w jednym zdaniu), atrybuty osobowe obok nazwisk.',
    parts: [
      'Sygn. akt ', REF('II K 87/23'), '\n\nPROTOKÓŁ ROZPRAWY GŁÓWNEJ\n\n',
      'Przewodniczący: ', ROLE('SSR'), ' ', PN('Dorota Jarzębina'), '\n',
      'Protokolant: ', ROLE('st. sekr. sąd.'), ' ', PN('E. W.'), '\n',
      'Prokurator: ', PN('Rafał Cis'), '\n\n',
      'Wywołano sprawę. Stawił się oskarżony ', PN('Seweryn Kowal'), ', ',
      ATTR('lat 43'), ', ', ROLE('ślusarz'), ', zam. ', ADR('ul. Krucza 15, 86-300 Grudziądz'),
      ', ', ATTR('żonaty, dwoje dzieci'), ', niekarany.\n\n',
      'Świadek ', PN('Dobrosława Zamek'), ', ', ATTR('lat 57'), ', ', ROLE('księgowa'),
      ', zam. ', LOC('Chełmża'), ', pouczona o odpowiedzialności karnej za składanie ',
      'fałszywych zeznań, zeznaje: potwierdzam, że w dniu zdarzenia widziałam oskarżonego ',
      'przy bramie magazynu. Oskarżony ', PN('Kowal'), ' oświadczył, że nie kwestionuje ',
      'swojej obecności, zaprzecza jednak zaborowi mienia.\n',
    ],
  },

  {
    name: 'adw_31_komornik',
    attack: 'Zawiadomienie komornicze: identyfikator pojazdu (rejestracja i VIN) oraz sygnatura KM – typy rzadkie, bez wzorca regex, w gęstym piśmie egzekucyjnym.',
    parts: [
      'Komornik Sądowy przy ', ORG('Sądzie Rejonowym w Toruniu'), ' ',
      PN('Waldemar Sosna'), '\nSygn. akt ', REF('KM 1552/25'), '\n\n',
      'ZAWIADOMIENIE O ZAJĘCIU RUCHOMOŚCI\n\n',
      'W sprawie z wniosku wierzyciela: ', ORG('Miedziak-Metal sp. z o.o.'),
      ', KRS ', OID('0000876123'), ',\nprzeciwko dłużnikowi: ', PN('Konrad Żurawski'),
      ', PESEL ', PID('85030712349'), ', zam. ', ADR('ul. Polna 3/5, 87-100 Toruń'), ',\n\n',
      'zawiadamiam o zajęciu w dniu 11 marca 2025 r. ruchomości dłużnika:\n',
      '1. samochód osobowy marki Astra Kombi, nr rej. ', VEH('CT 4567K'),
      ', VIN ', VEH('VF1BB05CF12345678'), ', rok prod. 2016;\n',
      '2. przyczepa lekka, nr rej. ', VEH('CTR 88812'), '.\n\n',
      'Egzekwowane roszczenie wynosi ', AMT('23 400,00 zł'), ' należności głównej, ',
      AMT('1 912,44 zł'), ' odsetek oraz ', AMT('1 470,00 zł'), ' kosztów egzekucyjnych.\n',
    ],
  },

  {
    name: 'adw_32_pulapki_prawne',
    attack: 'Pułapka na fałszywe pozytywy: cytowania przepisów, pozycje Dz.U. i sygnatury publikowanego orzecznictwa NIE są danymi osobowymi klienta i nie wolno ich maskować.',
    parts: [
      'Zgodnie z art. 385¹ § 1 ustawy z dnia 23 kwietnia 1964 r. – Kodeks cywilny ',
      '(Dz.U. z 2024 r. poz. 1061 ze zm.) postanowienia umowy zawieranej z konsumentem ',
      'nieuzgodnione indywidualnie nie wiążą go, jeżeli kształtują jego prawa i obowiązki ',
      'w sposób sprzeczny z dobrymi obyczajami.\n\n',
      'Analogiczne stanowisko zajęto w uchwale składu siedmiu sędziów (sygn. akt III CZP 87/22) ',
      'oraz w wyroku z dnia 14 maja 2021 r. (V CSKP 12/21). Zastosowanie znajdują także ',
      'art. 405 i art. 410 § 2 k.c. oraz art. 189 k.p.c. Ustawa o kredycie konsumenckim ',
      '(Dz.U. z 2023 r. poz. 1028) przewiduje w art. 45 sankcję kredytu darmowego.\n\n',
      'Pełnomocnik powoda ', PN('Konrad Żurawski'),
      ' podnosi te zarzuty z ostrożności procesowej.\n',
    ],
  },

  {
    name: 'adw_33_pulapki_nazwy',
    attack: 'Pułapka na fałszywe pozytywy: rzeka, numer działki, nazwa ulicy pochodząca od nazwiska i rzeczowniki pospolite wielką literą na początku zdania nie są osobami.',
    parts: [
      'Nieruchomość położona jest nad Wisłą, w sąsiedztwie dawnego ', ORG('Hotelu Zamek'),
      ', przy drodze prowadzącej do przeprawy promowej. Sad owocowy na działce nr 112/4 ',
      'nie wchodzi w skład masy spadkowej. ', PN('Wilk'), ' to w tej sprawie nazwisko pozwanej, ',
      'a nie zwierzę: pozwana ', PN('Aniela Wilk'), ' zamieszkuje przy ',
      ADR('ul. Kowalskiego 12/8, 87-100 Toruń'),
      ' (ulica nosi nazwisko patrona, co nie czyni jej danymi osobowymi).\n\n',
      'Zamek w ', LOC('Golubiu-Dobrzyniu'), ' był miejscem zawarcia umowy. ',
      'Kowal to rzemieślnik zajmujący się obróbką metalu; wzmianka ma charakter czysto językowy ',
      'i nie dotyczy pana ', PN('Seweryna Kowala'),
      '. Prace ziemne prowadzono wzdłuż ulicy Rzemieślniczej.\n',
    ],
  },

  {
    name: 'adw_34_role_generyczne',
    attack: 'Pułapka na fałszywe pozytywy: tekst wyłącznie z rolami procesowymi bez żadnego nazwiska – każde oznaczenie roli jako osoby to czysty fałszywy alarm.',
    parts: [
      'Powód wniósł o zabezpieczenie roszczenia. Pozwana zażądała oddalenia wniosku. ',
      'Biegły nie stawił się na termin, wobec czego przewodniczący zarządził przerwę. ',
      'Komornik poinformował wierzyciela o bezskuteczności egzekucji z rachunku dłużnika. ',
      'Pełnomocnik wnioskodawczyni cofnął wniosek dowodowy, a uczestnik postępowania ',
      'przychylił się do stanowiska kuratora. Zamawiający odstąpił od umowy z wykonawcą, ',
      'kredytobiorca zaś spłacił kredytodawcę przed terminem.\n',
    ],
  },

  {
    name: 'adw_35_email_nietypowe',
    attack: 'Adresy e-mail z plus-tagiem, wielkimi literami, kropką zdaniową tuż za adresem i obfuskacją „(at)”: wzorzec e-mail działa, ale granice i obfuskacja go wyprowadzają.',
    parts: [
      'Korespondencję proszę kierować na adres ', MAIL('k.zurawski+spory@kancelaria-zuraw.com.pl'),
      '.\n\nW stopce klient wpisał adres wielkimi literami: ', MAIL('BIURO@ZURAW-PARTNERZY.PL'),
      '.\nZgłoszenie wysłano na ', MAIL('reklamacje@miedziak-metal.pl'),
      '.\nW treści SMS podano adres w formie ukrytej: ', MAIL('a.wilk(at)poczta-testowa.pl'),
      ' – zapis ma utrudnić spam, nie anonimizację.\n',
    ],
  },

  {
    name: 'adw_36_daty_urodzenia',
    attack: 'Data urodzenia w formatach cyfrowych (7.03.1985, 1985-03-07) obok zwykłych dat czynności: DATE_OF_BIRTH wymaga rozumienia kontekstu „ur.”, inne daty to pułapka FP.',
    parts: [
      'Wnioskodawca ', PN('Konrad Żurawski'), ', ur. ', DOB('7.03.1985 r.'),
      ' w ', LOC('Toruniu'), ', syn ', PN('Marka'), ' i ', PN('Grażyny'), '.\n',
      'Uczestniczka ', PN('Leokadia Szczygieł'), ', urodzona dnia ',
      DOB('29 sierpnia 1959 roku'), ' w ', LOC('Chełmnie'), '.\n',
      'W systemie ewidencji zapisano: data urodzenia: ', DOB('1985-03-07'), '.\n\n',
      'Umowę zawarto dnia 20 lutego 2025 r., a wypowiedziano 11 marca 2025 r. ',
      'Termin rozprawy wyznaczono na 4 czerwca 2025 r., godz. 9:30.\n',
    ],
  },

  {
    name: 'adw_37_sygnatury_formaty',
    attack: 'Sygnatury własnych spraw w różnych repertoriach (C, GC upr, K, Ns, KM): każda ma inny układ, a żadna nie ma wzorca regex – wykrycie zależy od modelu.',
    parts: [
      'Sprawy z udziałem dłużnika prowadzone są pod sygnaturami: ',
      REF('I C 1445/25'), ' (', ORG('Sąd Rejonowy w Toruniu'), '), ',
      REF('VI GC 212/24 upr'), ' (', ORG('Sąd Rejonowy w Bydgoszczy'), '), ',
      REF('II K 87/23'), ' oraz ', REF('I Ns 310/24'), '.\n\n',
      'Egzekucję prowadzi komornik pod sygn. ', REF('KM 1552/25'),
      '. Skarga na czynności komornika z dnia 12 marca 2025 r. otrzymała sygnaturę ',
      REF('I Co 219/25'), '. Terminy biegną zgodnie z art. 767 § 1 k.p.c.\n',
    ],
  },

  {
    name: 'adw_38_kategorie_szczegolne',
    attack: 'Dane szczególnych kategorii (zdrowie, karalność, związki zawodowe) w jednym piśmie: najcięższe wagowo dla tajemnicy zawodowej, wykrywane wyłącznie modelem.',
    parts: [
      'Powódka ', PN('Michalina Krzemień-Zawadzka'), ' od 2019 r. ',
      HEALTH('choruje na cukrzycę typu 2'), ' i pozostaje pod opieką poradni diabetologicznej w ',
      LOC('Toruniu'), '. W okresie objętym sporem przebywała na zwolnieniu z powodu ',
      HEALTH('epizodu depresyjnego'), '.\n\n',
      'Pozwany był uprzednio ', CRIME('skazany prawomocnym wyrokiem za przywłaszczenie mienia'),
      ', co ma znaczenie dla oceny jego wiarygodności. Powódka jest ',
      UNION('członkinią Związku Zawodowego Pracowników Przetwórstwa Spożywczego'),
      ' i z tego tytułu korzystała z ochrony przed wypowiedzeniem.\n',
    ],
  },

];

// ── Builder ─────────────────────────────────────────────────────────

export function build(parts) {
  let text = '';
  const expected = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      text += p;
      continue;
    }
    expected.push({
      entity_group: p.entity_group,
      start: text.length,
      end: text.length + p.text.length,
      text: p.text,
    });
    text += p.text;
  }
  return { text, expected };
}

export function selfCheck(name, text, expected) {
  for (const e of expected) {
    if (text.slice(e.start, e.end) !== e.text) {
      throw new Error(`${name}: offset mismatch at [${e.start}:${e.end}]`);
    }
  }
  const sorted = [...expected].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(`${name}: overlapping expected entities at ${sorted[i].start}`);
    }
  }
  if (/\r/.test(text)) throw new Error(`${name}: CR found – corpus must be LF-only`);
}

// Shared writer for both pools: builds + self-checks + writes .txt/.expected.json
// for every doc, then writes README.md from the caller's template. Identical
// for dev/holdout except *what* docs/build function/output dir/README it's
// given — dev's own byte-identical-on-rerun behavior is preserved exactly
// because this is the same code path it always ran through.
async function writeCorpus(docs, buildFn, outDir, buildReadme) {
  await mkdir(outDir, { recursive: true });

  const readmeRows = [];
  let totalEntities = 0;

  for (const doc of docs) {
    const { text, expected } = buildFn(doc.parts);
    selfCheck(doc.name, text, expected);
    totalEntities += expected.length;
    await writeFile(join(outDir, `${doc.name}.txt`), text, 'utf-8');
    await writeFile(
      join(outDir, `${doc.name}.expected.json`),
      JSON.stringify(expected, null, 2) + '\n',
      'utf-8',
    );
    readmeRows.push(`| \`${doc.name}\` | ${expected.length} | ${doc.attack} |`);
  }

  await writeFile(join(outDir, 'README.md'), buildReadme(docs, readmeRows, totalEntities), 'utf-8');
  console.log(`Wrote ${docs.length} documents (${totalEntities} expected entities) to ${outDir}`);
  return totalEntities;
}

function buildDevReadme(docs, readmeRows, totalEntities) {
  return `# Korpus kontradyktoryjny (test-data/adversarial)

Wygenerowany deterministycznie przez \`scripts/generate-adversarial-corpus.mjs\`
(uruchomienie odtwarza pliki co do bajtu). **Wszystkie dane są w 100% fikcyjne**:
osoby, adresy, spółki i sygnatury nie istnieją, a PESEL/NIP/REGON/IBAN mają
poprawne sumy kontrolne, ale nie należą do nikogo.

Cel: korpus ATAKUJE sito detekcji, zamiast je potwierdzać. Każdy dokument
łamie jeden konkretny mechanizm (kolumna „wektor ataku”). Offsety w
\`*.expected.json\` to jednostki UTF-16 względem tekstu z końcami linii LF –
tak samo jak w \`test-data/synthetic\` (strażnik: \`src/eval/ground-truth.test.js\`).

Uruchomienie ewaluacji na tym korpusie:

\`\`\`bash
npm run eval -- --dir=test-data/adversarial --label=<slug>
npm run eval:score
\`\`\`

## Polityka anotacji

Zgodna z korpusem syntetycznym (szczegóły i uzasadnienie:
EVAL-RECALL-AUDIT.md):

- sądy, ZUS, banki, spółki → \`ORGANIZATION_NAME\` (waga „instytucja publiczna
  vs dane klienta” jest nadawana dopiero w rejestrze przecieków, nie w GT);
- sygnatury WŁASNYCH spraw i numery dokumentów → \`DOCUMENT_REFERENCE\`;
  cytowania publikowanego orzecznictwa i przepisów (art., Dz.U., sygnatury
  uchwał) NIE są anotowane – to pułapki na fałszywe pozytywy;
- wynagrodzenia → \`FINANCIAL_AMOUNT\` (precedens: pismo_05);
- pełny blok adresowy = jeden \`POSTAL_ADDRESS\`; samodzielna miejscowość =
  \`LOCATION\`; encje zagnieżdżone w większym spanie nie są anotowane osobno;
- role generyczne (powód, pozwany) nieanotowane; konkretne tytuły
  (adw., r. pr., Prezes Zarządu) → \`PERSON_ROLE_OR_TITLE\`;
- PII zniekształcone przez OCR jest anotowane swoim prawdziwym typem:
  sito ma chronić tajemnicę zawodową, a człowiek zniekształcony numer
  nadal odczyta.

## Dokumenty (${docs.length}, ${totalEntities} encji oczekiwanych)

| Dokument | Encje | Wektor ataku |
|---|---|---|
${readmeRows.join('\n')}
`;
}

// ── Holdout: quota self-check (RECALL-90-DESIGN.md §3.4 point 2 —
// "kwota jest kontraktem, nie nadzieją") + disjointness gate (point 1). Both
// run BEFORE any file is written; either failure aborts with no output. ──

function checkHoldoutQuota(built) {
  const byType = {};
  const byTag = {};
  for (const { expected, tagCounts } of built) {
    for (const e of expected) byType[e.entity_group] = (byType[e.entity_group] || 0) + 1;
    for (const [tag, n] of Object.entries(tagCounts)) byTag[tag] = (byTag[tag] || 0) + n;
  }

  const shortfalls = [];
  for (const [type, min] of Object.entries(holdoutManifest.byType)) {
    const actual = byType[type] || 0;
    if (actual < min) shortfalls.push(`byType.${type}: need >=${min}, got ${actual}`);
  }
  for (const [subtype, min] of Object.entries(holdoutManifest.identifierSubtypes)) {
    if (subtype === '_comment') continue;
    const actual = byTag[`identifier:${subtype}`] || 0;
    if (actual < min) shortfalls.push(`identifierSubtypes.${subtype}: need >=${min}, got ${actual}`);
  }
  for (const [cls, min] of Object.entries(holdoutManifest.ocrClasses)) {
    if (cls === '_comment') continue;
    const actual = byTag[`ocr:${cls}`] || 0;
    if (actual < min) shortfalls.push(`ocrClasses.${cls}: need >=${min}, got ${actual}`);
  }
  const total = Object.values(byType).reduce((a, b) => a + b, 0);
  if (total < holdoutManifest.targetTotalEntities.min) {
    shortfalls.push(`targetTotalEntities: need >=${holdoutManifest.targetTotalEntities.min}, got ${total}`);
  }

  if (shortfalls.length > 0) {
    console.error('Holdout quota self-check FAILED — refusing to write output (holdout-manifest.json is a contract, not an estimate):');
    for (const s of shortfalls) console.error(`  ${s}`);
    throw new Error(`Holdout corpus under quota: ${shortfalls.length} shortfall(s).`);
  }
  console.log(
    `Quota self-check PASSED: all ${Object.keys(holdoutManifest.byType).length} byType, `
    + `${Object.keys(holdoutManifest.identifierSubtypes).length - 1} identifier subtypes, `
    + `${Object.keys(holdoutManifest.ocrClasses).length - 1} OCR classes meet their minimums (total ${total} entities).`,
  );
}

function buildHoldoutReadme(docs, readmeRows, totalEntities) {
  return `# Korpus sprawdzianowy (test-data/adversarial-holdout)

Wygenerowany deterministycznie przez \`scripts/generate-adversarial-corpus.mjs --pool=holdout\`
(\`scripts/corpus/holdout-templates.mjs\` + \`holdout-people.mjs\` + \`holdout-pools.mjs\`,
uruchomienie odtwarza pliki co do bajtu). **Wszystkie dane są w 100% fikcyjne**
(RECALL-90-DESIGN.md §3.4 pkt 4): osoby, adresy, spółki i sygnatury nie
istnieją; PESEL/NIP/REGON/IBAN mają poprawne sumy kontrolne, ale nie należą
do nikogo.

## Czym różni się od test-data/adversarial (dev)

\`test-data/adversarial/\` jest korpusem **strojeniowym** — na nim kalibrowane
były progi (A7), leksykony (B3/B4) i wzorce planu A. Wynik zmierzony na
korpusie, którym stroniono, jest optymistycznie obciążony w sposób
niemierzalny (RECALL-90-DESIGN.md §3.1). Ten katalog jest **sprawdzianem**:
rozłączne przestrzenie wartości (nazwiska, PESEL-e, numery IBAN — żadna
wartość identyfikująca z dev nie występuje tutaj, strażnik:
\`scripts/corpus/holdout-disjointness.test.js\`) ORAZ rozłączne szablony
dokumentów (nowe kształty zdań/dokumentów w \`holdout-templates.mjs\`, nie
tylko nowe nazwiska wstawione w stare zdania dev) — inaczej sprawdzian
mierzyłby pamięć szablonów, nie generalizację.

## Polityka zamrożenia (RECALL-90-DESIGN.md §3.2 — WIĄŻĄCE)

1. **Ten katalog jest zamrożony natychmiast po wygenerowaniu.** Żadna zmiana
   ręczna w \`*.txt\`/\`*.expected.json\` — jedyny legalny sposób modyfikacji to
   ponowne uruchomienie generatora (co przy tym samym kodzie i manifeście
   daje bajtowo identyczny wynik) albo świadoma regeneracja wg pkt 3 poniżej.
2. **Dziennik pomiarów jest obowiązkowy.** Każdy przebieg \`npm run eval\` na
   tym katalogu (\`--dir=test-data/adversarial-holdout\`) ma być odnotowany
   (data, run ID, cel pomiaru, wynik) w raporcie bramki GATE-RECALL-90 albo w
   notatce sesji, która go wykonała — warunek G8 bramki (RECALL-90-DESIGN.md
   §4.2). Pomiar bramkowy ma być 1.–2. pomiarem tego katalogu w historii.
3. **Skażenie = obowiązkowa regeneracja z NOWYM seedem.** Jeżeli ktokolwiek
   zacznie naprawiać moduły detekcji „pod holdout" (dopisując wzorzec, próg
   albo leksykon w reakcji na konkretny przypadek z TEGO katalogu), korpus
   przestaje być sprawdzianem. Wtedy: (a) odnotować incydent w notatce sesji,
   (b) zmienić namespace seedów w \`holdout-templates.mjs\` (np.
   \`holdout/odmiana/\` → \`holdout/odmiana-v2/\`) tak, aby wszystkie wartości i
   kombinacje szablonów wypadły inaczej, (c) ponownie uruchomić generator,
   (d) zacząć dziennik pomiarów od nowa. Ten akapit istnieje, żeby przyszłe
   sesje nie odtwarzały tej polityki z pamięci ani jej nie pomijały.
4. **Podzbiór holdout-human jest osobnym, ręcznym zadaniem** (5–10 dokumentów
   pisanych ręcznie, wzorowanych na realnej praktyce, anotowanych przez inną
   osobę/sesję niż autor dokumentu) — RECALL-90-DESIGN.md §3.2. Generator NIE
   go tworzy; to świadomie odłożone follow-up dla Alana (CORPUS-2.0-NOTES.md).

## Delty polityki anotacji względem test-data/adversarial (§3.5)

Dziedziczy politykę dev w całości (patrz \`test-data/adversarial/README.md\`),
z trzema doprecyzowaniami rozstrzygniętymi PRZED generacją tego katalogu:

1. **Taksonomia wynagrodzeń (decyzja Alana R0a, PRODUCT-DECISIONS.md):**
   klasa ekwiwalencji \`{FINANCIAL_AMOUNT, INCOME_COMPENSATION}\` w scoringu —
   scoring ma raportować OBIE liczby (ścisłą i po ekwiwalencji), bramka liczy
   po ekwiwalencji. Ten korpus anotuje wynagrodzenia jako \`FINANCIAL_AMOUNT\`
   (ten sam precedens co dev), więc deklaracja klasy ekwiwalencji jest
   obowiązkiem konfiguracji scoringu, nie generatora.
2. **Frazy opisowe art. 9–10:** anotowany span to minimalna fraza niosąca
   fakt szczególny (kotwica + dopełnienie), NIE całe zdanie, i napisana z
   definicji faktu — NIGDY „pod wzorce B3". Rozbieżność GT↔B3 jest sygnałem
   do poprawy B3, nigdy do przepisania GT.
3. **Diakrytyki:** wystąpienie zdegradowane (klasa \`ocr:diacritics\`,
   \`scripts/corpus/diacritics.mjs\`) anotowane prawdziwym typem i pełnym
   spanem — spójnie z istniejącą polityką OCR.

## Manifest kwot

\`scripts/corpus/holdout-manifest.json\` (RECALL-90-DESIGN.md §3.3). Generator
odmawia zapisu, jeżeli którakolwiek kwota (byType/identifierSubtypes/
ocrClasses/targetTotalEntities) nie jest osiągnięta — kwota jest kontraktem
egzekwowanym w kodzie (\`checkHoldoutQuota\` w tym pliku), nie deklaracją.

Uruchomienie ewaluacji na tym korpusie:

\`\`\`bash
npm run eval -- --dir=test-data/adversarial-holdout --label=<slug>
npm run eval:score
\`\`\`

## Dokumenty (${docs.length}, ${totalEntities} encji oczekiwanych)

| Dokument | Encje | Wektor ataku |
|---|---|---|
${readmeRows.join('\n')}
`;
}

async function generateHoldout() {
  const holdoutDocs = assembleHoldoutDocs();
  const built = holdoutDocs.map((doc) => ({ doc, ...buildHoldoutDoc(doc.parts) }));

  for (const { doc, text, expected } of built) selfCheck(doc.name, text, expected);

  checkHoldoutQuota(built);

  const devValues = collectIdentifyingValues(DOCS.map((doc) => build(doc.parts)));
  const violations = findDisjointnessViolations(devValues, built);
  if (violations.length > 0) {
    console.error(`Disjointness violation: ${violations.length} holdout identifying value(s) collide with dev (test-data/adversarial):`);
    for (const v of violations.slice(0, 20)) console.error(`  "${v}"`);
    throw new Error('Holdout corpus is not disjoint from dev — refusing to write output. See RECALL-90-DESIGN.md §3.4 point 1.');
  }
  console.log(`Disjointness check PASSED: 0 of ${devValues.size} dev identifying values collide with holdout.`);

  await writeCorpus(holdoutDocs, buildHoldoutDoc, HOLDOUT_OUT_DIR, buildHoldoutReadme);
}

async function main() {
  const args = process.argv.slice(2);
  const pool = args.find((a) => a.startsWith('--pool='))?.slice('--pool='.length) || 'dev';
  if (pool !== 'dev' && pool !== 'holdout') {
    console.error(`Unknown --pool value "${pool}" (expected "dev" or "holdout")`);
    process.exit(1);
  }

  if (pool === 'dev') {
    await writeCorpus(DOCS, build, OUT_DIR, buildDevReadme);
    return;
  }

  await generateHoldout();
}

// CLI entry only. Importing this module (tests use DOCS/build) must NOT run
// main(): doing so regenerated the corpus on import, and parallel vitest
// workers raced on the file writes, truncating .expected.json files (the
// "cause unknown" corruption in CORPUS-2.0-NOTES.md, root-caused at the Opus
// gate). Generation now happens only via `node scripts/generate-adversarial-corpus.mjs`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Generation failed:', err);
    process.exit(1);
  });
}

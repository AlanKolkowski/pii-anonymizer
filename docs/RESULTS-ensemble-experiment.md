# Ensemble NER Experiment Results

## Branch: feat/ensemble-ner

## What was tested

### Hypothesis 1: Extended regex + address merge (IMPLEMENTED, WORKS)
- Extended `findRegexEntities` with PESEL, NIP, IBAN, phone patterns (score 1.0)
- Added `mergeAdjacentEntities` — merges adjacent POSTAL_ADDRESS/LOCATION with ≤3 char gap
- Model: multilang (bardsai/eu-pii-anonimization-multilang) q8

**Result: significant improvement**
- Address "ul. Różana 18/3\n31-505 Kraków" went from 4 tokens → 1 token
- Page headers (Marszałkowska address) now consistent across all 3 pages
- Address dedup reduced from 7 unique tokens → 4
- Regex catches emails, PESEL, NIP, IBAN reliably regardless of NER quality

### Hypothesis 2: Dual-model ensemble (NOT TESTED YET)
- Run both bardsai models, merge results
- PL-only for addresses (it gets them as single entities), multilang for everything else
- Downside: 2x download, 2x inference time

### Hypothesis 3: Other models tested (REJECTED)
- `tabularisai/eu-pii-safeguard` (XLM-RoBERTa-large, 0.6B) — terrible on Polish text
  - Low confidence (0.4-0.6), fragmented names, mangled addresses
  - Split IBAN into credit card + phone + national ID
  - No ONNX available, 2.2GB fp32 too large for single ONNX file (protobuf 2GB limit)

## Remaining issues (model boundary artifacts)
These appear in all models and can't be fixed with post-processing:
- `N[PERSON_ROLE_OR_TITLE_1]` — "Nadawca:" eaten by model
- `[PERSON_ROLE_OR_TITLE_2]ariusz` — "notariusz" partially detected
- `n[PERSON_ROLE_OR_TITLE_4]` — "nadzieję" eaten by model
- `[PERSON_NAME_7]` = "T. Wiśniewski" (abbreviation not matched to "Tomasz")

## Model comparison (Python fp32, first 512 tokens)

| Model | Entities | Addresses | Names | Amounts | Speed |
|-------|----------|-----------|-------|---------|-------|
| multilang | 37 | fragmented (4 parts) | all correct | detected | 0.17s |
| PL-only | 33 | single entities | "Joan"+"na Kwiatkowska" | not detected | 1.57s |
| safeguard | 32 | partial, low confidence | partial | not detected | 0.20s |

## Precision comparison (multilang model)

| Format | Entities | Quality | Notes |
|--------|----------|---------|-------|
| PyTorch fp32 | 37 | baseline | gold standard |
| ONNX fp32 | 37 | identical to PyTorch | bit-for-bit match |
| ONNX int8 | 43 | worse (more fragmentation) | lower scores, split PESELs |

## Recommendation
Stay with multilang q8 + regex + address merge. The regex layer compensates for NER
fragmentation on structured PII. The address merge handles the main visual complaint
(4 tokens → 1). Dual model is unnecessary overhead for marginal improvement.

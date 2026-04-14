"""Test all model × dtype combos with regex + address merge post-processing."""
from transformers import pipeline as hf_pipeline
from optimum.onnxruntime import ORTModelForTokenClassification
import sys
import time
import re

TEXT_FILE = sys.argv[1] if len(sys.argv) > 1 else "../przykladowe_pismo_testowe.txt"
with open(TEXT_FILE, "r") as f:
    text = f.read()

# --- Post-processing (mirrors JS anonymizer.js) ---

def find_regex_entities(text):
    patterns = [
        ("EMAIL_ADDRESS", r"[\w.+-]+@[\w.-]+\.\w{2,}"),
        ("PERSON_IDENTIFIER", r"\b\d{11}\b"),
        ("ORGANIZATION_IDENTIFIER", r"\b\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}\b"),
        ("BANK_ACCOUNT_IDENTIFIER", r"\bPL\s?\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}\b"),
        ("PHONE_NUMBER", r"\+?\d{2}[\s-]?\d{2,3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b"),
    ]
    entities = []
    for group, pattern in patterns:
        for m in re.finditer(pattern, text):
            entities.append({
                "entity_group": group,
                "start": m.start(),
                "end": m.end(),
                "score": 1.0,
                "word": text[m.start():m.end()],
            })
    return entities

def dedup(entities):
    if len(entities) <= 1:
        return entities
    entities.sort(key=lambda e: (e["start"], -e["score"]))
    result = [entities[0]]
    for curr in entities[1:]:
        prev = result[-1]
        if curr["start"] < prev["end"]:
            if curr["score"] > prev["score"]:
                result[-1] = curr
        else:
            result.append(curr)
    return result

ADDRESS_TYPES = {"POSTAL_ADDRESS", "LOCATION"}

def merge_adjacent(entities, text):
    if len(entities) <= 1:
        return entities
    entities.sort(key=lambda e: e["start"])
    result = [entities[0]]
    for curr in entities[1:]:
        prev = result[-1]
        if (prev["entity_group"] in ADDRESS_TYPES and
            curr["entity_group"] in ADDRESS_TYPES and
            curr["start"] - prev["end"] <= 3):
            gap = text[prev["end"]:curr["start"]]
            if all(c in " ,\n\r\t" for c in gap):
                result[-1] = {
                    "entity_group": "POSTAL_ADDRESS",
                    "start": prev["start"],
                    "end": curr["end"],
                    "score": max(prev["score"], curr["score"]),
                    "word": text[prev["start"]:curr["end"]],
                }
                continue
        result.append(curr)
    return result

# --- Test configs ---

CONFIGS = [
    ("multilang-fp32", "bardsai/eu-pii-anonimization-multilang", "pytorch", None),
    ("multilang-q8",   "bardsai/eu-pii-anonimization-multilang", "onnx", "onnx/model_quantized.onnx"),
    ("pl-fp32",        "bardsai/eu-pii-anonimization",           "pytorch", None),
    ("pl-q8",          "bardsai/eu-pii-anonimization",           "onnx", "onnx/model_quantized.onnx"),
]

# Known problem spots to check
CHECKS = {
    "Nadawca intact":      lambda t: "Nadawca:" in t or "Nadawca:\n" in t,
    "notariusz intact":    lambda t: "notariusz " in t.lower() or "[PERSON_ROLE_OR_TITLE" in t[1170:1200],
    "nadzieję intact":     lambda t: "nadzieję" in t or "Mam nadzieję" in t,
    "Różana 1 token":      lambda t: t.count("[POSTAL_ADDRESS") < t.count("[LOCATION") + 8,  # heuristic
    "email full":          lambda t: "nowak" not in t.split("[EMAIL")[0][-30:] if "[EMAIL" in t else False,
    "Kwiatkowska intact":  lambda t: "Joan\n" not in t and "Joan " not in t,  # not split
}

all_results = {}

for label, model_id, backend, onnx_file in CONFIGS:
    print(f"\n{'='*80}")
    print(f"  {label}")
    print(f"{'='*80}")

    if backend == "onnx":
        model = ORTModelForTokenClassification.from_pretrained(model_id, file_name=onnx_file)
        ner = hf_pipeline("token-classification", model=model, tokenizer=model_id, aggregation_strategy="simple")
    else:
        ner = hf_pipeline("token-classification", model=model_id, aggregation_strategy="simple")

    start = time.time()
    raw_entities = ner(text)
    elapsed = time.time() - start

    # Apply post-processing
    all_ents = list(raw_entities) + find_regex_entities(text)
    deduped = dedup(all_ents)
    merged = merge_adjacent(deduped, text)

    # Build anonymized text for checks
    merged_sorted = sorted(merged, key=lambda e: e["start"], reverse=True)
    anon = text
    for ent in merged_sorted:
        token = f"[{ent['entity_group']}]"
        anon = anon[:ent["start"]] + token + anon[ent["end"]:]

    print(f"  Time: {elapsed:.2f}s | Raw: {len(raw_entities)} | After post-process: {len(merged)}")
    print()

    # Show entities
    for ent in merged:
        val = ent["word"].strip() if "word" in ent else text[ent["start"]:ent["end"]].strip()
        if len(val) > 55:
            val = val[:52] + "..."
        print(f"  {ent['entity_group']:30s}  {ent['score']:.3f}  [{ent['start']:4d}-{ent['end']:4d}]  {val}")

    print(f"\n  --- Quality checks ---")
    checks_result = {}
    for check_name, check_fn in CHECKS.items():
        passed = check_fn(anon)
        checks_result[check_name] = passed
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {check_name}")

    all_results[label] = {
        "entities": len(merged),
        "time": elapsed,
        "checks": checks_result,
    }

# Summary table
print(f"\n\n{'='*80}")
print("SUMMARY")
print(f"{'='*80}")
print(f"{'Config':25s} {'Entities':>8s} {'Time':>8s}  " + "  ".join(f"{c:>18s}" for c in CHECKS.keys()))
for label, r in all_results.items():
    checks_str = "  ".join(f"{'PASS':>18s}" if r["checks"][c] else f"{'FAIL':>18s}" for c in CHECKS.keys())
    print(f"{label:25s} {r['entities']:8d} {r['time']:7.2f}s  {checks_str}")

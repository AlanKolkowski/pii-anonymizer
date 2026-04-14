"""Test dual-model ensemble: run both models, merge results."""
from transformers import pipeline as hf_pipeline
import sys
import time
import re

TEXT_FILE = sys.argv[1] if len(sys.argv) > 1 else "../przykladowe_pismo_testowe.txt"
with open(TEXT_FILE, "r") as f:
    text = f.read()

# --- Post-processing ---

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
            entities.append({"entity_group": group, "start": m.start(), "end": m.end(), "score": 1.0, "word": text[m.start():m.end()]})
    return entities

def dedup(entities):
    if len(entities) <= 1:
        return entities
    entities.sort(key=lambda e: (e["start"], -e["score"]))
    result = [entities[0]]
    for curr in entities[1:]:
        prev = result[-1]
        if curr["start"] < prev["end"]:
            # Prefer wider span, then higher score
            if (curr["end"] - curr["start"]) > (prev["end"] - prev["start"]):
                result[-1] = curr
            elif (curr["end"] - curr["start"]) == (prev["end"] - prev["start"]) and curr["score"] > prev["score"]:
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
        if (prev["entity_group"] in ADDRESS_TYPES and curr["entity_group"] in ADDRESS_TYPES
            and curr["start"] - prev["end"] <= 3):
            gap = text[prev["end"]:curr["start"]]
            if all(c in " ,\n\r\t" for c in gap):
                result[-1] = {"entity_group": "POSTAL_ADDRESS", "start": prev["start"], "end": curr["end"],
                              "score": max(prev["score"], curr["score"]), "word": text[prev["start"]:curr["end"]]}
                continue
        result.append(curr)
    return result

# --- Load models ---

print("Loading multilang...")
ner_multi = hf_pipeline("token-classification", model="bardsai/eu-pii-anonimization-multilang", aggregation_strategy="simple")
print("Loading pl...")
ner_pl = hf_pipeline("token-classification", model="bardsai/eu-pii-anonimization", aggregation_strategy="simple")

# --- Run configs ---

configs = [
    ("multilang only", lambda t: list(ner_multi(t))),
    ("pl only",        lambda t: list(ner_pl(t))),
    ("DUAL: both",     lambda t: list(ner_multi(t)) + list(ner_pl(t))),
]

for label, run_fn in configs:
    print(f"\n{'='*80}")
    print(f"  {label}")
    print(f"{'='*80}")

    start = time.time()
    raw = run_fn(text)
    elapsed = time.time() - start

    all_ents = raw + find_regex_entities(text)
    deduped = dedup(all_ents)
    merged = merge_adjacent(deduped, text)

    # Anonymize
    merged_sorted = sorted(merged, key=lambda e: e["start"], reverse=True)
    anon = text
    for ent in merged_sorted:
        anon = anon[:ent["start"]] + f"[{ent['entity_group']}]" + anon[ent["end"]:]

    print(f"  Time: {elapsed:.2f}s | Raw: {len(raw)} | Final: {len(merged)}")
    print()

    for ent in merged:
        val = ent["word"].strip() if "word" in ent else text[ent["start"]:ent["end"]].strip()
        if len(val) > 55:
            val = val[:52] + "..."
        print(f"  {ent['entity_group']:30s}  {ent['score']:.3f}  [{ent['start']:4d}-{ent['end']:4d}]  {val}")

    # Problem spot checks
    print(f"\n  --- Problem spots in anonymized text ---")
    # Check for leaked PII (plain text that should be anonymized)
    leaked = []
    for name in ["Nowak", "Wiśniewski", "Jabłoński", "Kwiatkowska", "Kowalczyk", "Zając", "Dąbrowska",
                  "85030712345", "77091534521", "527-234-56-78", "+48 22 456 78 90"]:
        if name in anon:
            # Check it's not inside a token
            idx = anon.index(name)
            before = anon[max(0,idx-1):idx]
            if before != "[":
                leaked.append(name)
    if leaked:
        print(f"  LEAKED: {', '.join(leaked)}")
    else:
        print(f"  No leaked PII detected")

    # Check N[ROLE] artifact
    if "N[PERSON_ROLE" in anon:
        print(f"  ARTIFACT: N[PERSON_ROLE...] present")
    else:
        print(f"  OK: No N[ROLE] artifact")

    if "ariusz" in anon and "[" in anon[anon.index("ariusz")-30:anon.index("ariusz")]:
        print(f"  ARTIFACT: [ROLE]ariusz present")
    else:
        print(f"  OK: No [ROLE]ariusz artifact")

    if "nadzieję" in anon:
        print(f"  OK: 'nadzieję' intact")
    elif "n[PERSON_ROLE" in anon.lower():
        print(f"  ARTIFACT: n[ROLE] ate 'nadzieję'")
    else:
        print(f"  OK: nadzieję handled")

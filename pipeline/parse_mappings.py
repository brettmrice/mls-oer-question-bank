"""Parse ASCP BOC guideline mapping Markdown files (*_guideline_mapping.md)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

DISCIPLINE_NAMES: dict[str, str] = {
    "BB": "Blood Banking",
    "CH": "Clinical Chemistry",
    "HE": "Hematology",
    "IM": "Clinical Immunology",
    "LO": "Laboratory Operations",
    "MB": "Molecular Biology",
    "MI": "Clinical Microbiology",
    "UA": "Urinalysis",
    "BF": "Body Fluids",
}

DISCIPLINE_ALIASES: dict[str, str] = {}

UABF_SPLIT_PREFIXES: tuple[tuple[str, str, str], ...] = (
    ("UABF_01", "UA_01", "UA"),
    ("UABF_02", "BF_02", "BF"),
)

UABF_SPLIT_WEIGHTS: dict[str, tuple[float, float, str]] = {
    "UA": (2.0, 5.0, "2–5%"),
    "BF": (3.0, 5.0, "3–5%"),
}


def normalize_taxonomic_code(tax_code: str) -> str:
    """Split legacy UABF_01/UABF_02 taxonomic prefixes into UA_01/BF_02."""
    for old_prefix, new_prefix, _ in UABF_SPLIT_PREFIXES:
        if tax_code.startswith(old_prefix):
            return new_prefix + tax_code[len(old_prefix) :]
    return tax_code


class BlueprintWeight(BaseModel):
    """Exam weighting metadata for a certification track (MLT, MLS, Specialist)."""

    track: str
    raw_label: str
    raw_value: str
    min_pct: float | None = None
    max_pct: float | None = None


class MappingEntry(BaseModel):
    """Single row from a *_guideline_mapping.md table."""

    input_folder: str
    taxonomic_code: str
    discipline_code: str
    discipline_name: str
    level2_name: str
    ascp_subtopic: str
    leaf_topic: str
    segments: list[str]
    ascp_path: str


class DisciplineInfo(BaseModel):
    """Discipline metadata and ASCP BOC exam weightings."""

    discipline_code: str
    discipline_name: str
    weights: dict[str, BlueprintWeight] = Field(default_factory=dict)
    total_mapped_topics: int = 0


class GuidelineMappings(BaseModel):
    """Complete mapping index across all 8 MLS disciplines."""

    disciplines: dict[str, DisciplineInfo] = Field(default_factory=dict)
    by_folder: dict[str, MappingEntry] = Field(default_factory=dict)
    by_code: dict[str, MappingEntry] = Field(default_factory=dict)
    entries: list[MappingEntry] = Field(default_factory=list)


_H1_RE = re.compile(r"^#\s+(.+?)\s*\(([A-Z]+)\)")
_BULLET_RE = re.compile(r"^\*\s+\*\*([^*:]+):\*\*\s*(.+)$")
_PCT_RANGE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)%")
_CODE_PREFIX_RE = re.compile(r"^([A-Z]+_\d{2}(?:-[A-Za-z0-9]+)*?)(?:-__|_|$)")


def extract_taxonomic_code(slug_or_filename: str) -> str:
    """Extract canonical taxonomic code (e.g., BB_01-A-01 or UA_01-A-00-a) from a slug or filename."""
    cleaned = slug_or_filename.strip().strip("`")
    cleaned = re.sub(r"_(?:Raw_Discussion|Actual_Covered)(?:_Audit)?\.md$", "", cleaned)
    cleaned = re.sub(r"\.md$", "", cleaned)
    match = _CODE_PREFIX_RE.match(cleaned)
    raw_code = match.group(1) if match else cleaned
    return normalize_taxonomic_code(raw_code)


def _parse_weight_bullet(key: str, val: str) -> BlueprintWeight | None:
    key_clean = key.strip()
    if key_clean.startswith("["):
        return None
    val_clean = val.strip()
    paren_match = re.search(r"\(([^)]+)\)\s*$", val_clean)
    raw_value = paren_match.group(1).strip() if paren_match else val_clean
    raw_label = val_clean[: paren_match.start()].strip() if paren_match else val_clean

    track_key = key_clean
    if key_clean not in ("MLT", "MLS"):
        track_key = "Specialist"

    min_pct: float | None = None
    max_pct: float | None = None
    pct_match = _PCT_RANGE_RE.search(raw_value)
    if pct_match:
        min_pct = float(pct_match.group(1))
        max_pct = float(pct_match.group(2))

    return BlueprintWeight(
        track=key_clean,
        raw_label=f"{key_clean}: {raw_label}".strip(),
        raw_value=raw_value,
        min_pct=min_pct,
        max_pct=max_pct,
    )


def _strip_md_bold(text: str) -> str:
    return text.replace("**", "").replace("`", "").strip()


def load_guideline_mappings(mappings_dir: Path) -> GuidelineMappings:
    """Load and index all *_guideline_mapping.md files in mappings_dir."""
    result = GuidelineMappings()
    files = sorted(mappings_dir.glob("*_guideline_mapping.md"))
    if not files:
        raise FileNotFoundError(f"No *_guideline_mapping.md files found in {mappings_dir}")

    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()

        disc_code = path.name.split("_", 1)[0].upper()
        disc_name = DISCIPLINE_NAMES.get(disc_code, disc_code)
        weights: dict[str, BlueprintWeight] = {}

        for line in lines:
            h1 = _H1_RE.match(line.strip())
            if h1:
                disc_name = h1.group(1).strip()
                disc_code = h1.group(2).strip().upper()
                continue

            bullet = _BULLET_RE.match(line.strip())
            if bullet:
                parsed_w = _parse_weight_bullet(bullet.group(1), bullet.group(2))
                if parsed_w is not None:
                    slot = parsed_w.track if parsed_w.track in ("MLT", "MLS") else "Specialist"
                    weights[slot] = parsed_w
                continue

            if line.startswith("| `"):
                cols = [c.strip() for c in line.strip("|").split("|")]
                if len(cols) < 2:
                    continue
                input_folder = cols[0].strip("`").strip()
                raw_mapping = cols[1]
                segments = [_strip_md_bold(seg) for seg in raw_mapping.split(">") if _strip_md_bold(seg)]
                if not segments:
                    continue

                tax_code = extract_taxonomic_code(input_folder)
                entry_disc_code = disc_code
                entry_disc_name = disc_name
                if disc_code == "UABF":
                    entry_disc_code = tax_code.split("_", 1)[0]
                    entry_disc_name = DISCIPLINE_NAMES.get(entry_disc_code, entry_disc_code)

                path_segments = (
                    segments[1:]
                    if segments[0].lower() == entry_disc_name.lower()
                    else segments
                )
                if not path_segments:
                    path_segments = segments
                level2_name = path_segments[0]
                ascp_subtopic = (
                    path_segments[1] if len(path_segments) >= 3 else path_segments[0]
                )
                leaf_topic = path_segments[-1]
                ascp_path = " > ".join([entry_disc_name, *path_segments])

                entry = MappingEntry(
                    input_folder=input_folder,
                    taxonomic_code=tax_code,
                    discipline_code=entry_disc_code,
                    discipline_name=entry_disc_name,
                    level2_name=level2_name,
                    ascp_subtopic=ascp_subtopic,
                    leaf_topic=leaf_topic,
                    segments=segments,
                    ascp_path=ascp_path,
                )
                result.entries.append(entry)
                result.by_folder[input_folder] = entry
                result.by_code[tax_code] = entry

        if disc_code == "UABF":
            for split_code, (min_pct, max_pct, raw_value) in UABF_SPLIT_WEIGHTS.items():
                mapped_for_split = sum(1 for e in result.entries if e.discipline_code == split_code)
                split_weights = {
                    k: w.model_copy(
                        update={
                            "raw_value": raw_value,
                            "min_pct": min_pct,
                            "max_pct": max_pct,
                        }
                    )
                    for k, w in weights.items()
                }
                result.disciplines[split_code] = DisciplineInfo(
                    discipline_code=split_code,
                    discipline_name=DISCIPLINE_NAMES[split_code],
                    weights=split_weights,
                    total_mapped_topics=mapped_for_split,
                )
        else:
            mapped_for_disc = sum(1 for e in result.entries if e.discipline_code == disc_code)
            result.disciplines[disc_code] = DisciplineInfo(
                discipline_code=disc_code,
                discipline_name=disc_name,
                weights=weights,
                total_mapped_topics=mapped_for_disc,
            )

    return result


_SHORT_CODE_RE = re.compile(r"^([A-Z]+_\d{2}-[A-Za-z0-9]+-\d{2}(?:-[a-z])?)")

_EXTRA_CODE_ALIASES: dict[str, str] = {
    "BF_02-A-00-g": "BF_02-A-00-f",
    "BF_02-B-00-h": "BF_02-B-00-g",
}


def resolve_ascp_metadata(
    mappings: GuidelineMappings,
    source_line: str,
    discipline_code: str,
    fallback_topic_name: str,
    fallback_leaf: str,
) -> tuple[str, str, str, str]:
    """Resolve (taxonomic_code, ascp_subtopic, leaf_topic, ascp_path) from Source metadata and mappings."""
    src_parts = [p.strip() for p in source_line.split("|")]
    src_file = src_parts[0] if src_parts else ""
    cleaned_slug = re.sub(r"_(?:Raw_Discussion|Actual_Covered)(?:_Audit)?\.md$", "", src_file)
    cleaned_slug = re.sub(r"\.md$", "", cleaned_slug)
    tax_code = extract_taxonomic_code(cleaned_slug)

    entry = mappings.by_folder.get(cleaned_slug) or mappings.by_code.get(tax_code)
    if entry is None and tax_code:
        short_m = _SHORT_CODE_RE.match(tax_code)
        if short_m:
            short_code = short_m.group(1)
            entry = mappings.by_code.get(short_code) or mappings.by_code.get(
                _EXTRA_CODE_ALIASES.get(short_code, "")
            )
    if entry is None and not tax_code:
        if "UABF_02-A-00-f" in fallback_leaf:
            entry = mappings.by_code.get("BF_02-A-00-f")
        elif fallback_leaf == "Quantitative Urinalysis":
            entry = mappings.by_code.get("UA_01-A-00-b")
    if entry is not None:
        return entry.taxonomic_code, entry.ascp_subtopic, entry.leaf_topic, entry.ascp_path

    # Fallback: parse ASCP string from Source line if present
    disc_name = DISCIPLINE_NAMES.get(discipline_code, discipline_code)
    ascp_str = ""
    for part in src_parts[1:]:
        if part.upper().startswith("ASCP:"):
            ascp_str = part.split(":", 1)[1].strip()
            break
    if ascp_str:
        segs = [s.strip() for s in ascp_str.split(">") if s.strip()]
        if segs and segs[0].lower() == disc_name.lower():
            segs = segs[1:]
        subtopic = segs[1] if len(segs) >= 3 else (segs[0] if segs else fallback_topic_name)
        leaf = segs[-1] if segs else fallback_leaf
        full_path = " > ".join([disc_name, *segs]) if segs else f"{disc_name} > {fallback_topic_name} > {leaf}"
        return tax_code, subtopic, leaf, full_path

    leaf = fallback_leaf or fallback_topic_name
    return tax_code, fallback_topic_name, leaf, f"{disc_name} > {fallback_topic_name} > {leaf}"


def build_ascp_tree(mappings: GuidelineMappings) -> dict[str, Any]:
    """Build nested 4-level ASCP hierarchy dictionary for manifest.json."""
    tree: dict[str, Any] = {}
    for disc_code, disc_info in sorted(mappings.disciplines.items()):
        weights_json = {
            k: {
                "track": w.track,
                "rawLabel": w.raw_label,
                "rawValue": w.raw_value,
                "minPct": w.min_pct,
                "maxPct": w.max_pct,
            }
            for k, w in disc_info.weights.items()
        }
        tree[disc_code] = {
            "disciplineCode": disc_code,
            "disciplineName": disc_info.discipline_name,
            "blueprintWeights": weights_json,
            "totalMappedTopics": disc_info.total_mapped_topics,
            "level2Topics": {},
        }

    for entry in mappings.entries:
        disc_node = tree.get(entry.discipline_code)
        if not disc_node:
            continue
        l2 = disc_node["level2Topics"].setdefault(entry.level2_name, {})
        sub = l2.setdefault(entry.ascp_subtopic, [])
        if entry.leaf_topic not in sub:
            sub.append(entry.leaf_topic)

    return tree

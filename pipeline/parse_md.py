"""Parse all MLS assessment pool Markdown files into canonical deduplicated records."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from pipeline.parse_mappings import (
    DISCIPLINE_ALIASES,
    DISCIPLINE_NAMES,
    GuidelineMappings,
    resolve_ascp_metadata,
)

BLOOM_MAP: dict[str, str] = {
    "remember": "RE",
    "re": "RE",
    "understand": "UN",
    "un": "UN",
    "apply": "AP",
    "ap": "AP",
    "analyze": "AN",
    "analyse": "AN",
    "an": "AN",
}

CANONICAL_TOPIC_NAMES: dict[str, str] = {
    "BB_01": "Blood Products",
    "BB_02": "Blood Group Systems",
    "BB_03": "Immunology & Physiology",
    "BB_04": "Serologic and Molecular Testing",
    "BB_05": "Transfusion Practice",
    "BB_06": "Laboratory Operations",
    "CH_01": "General Chemistry",
    "CH_02": "Proteins & Enzymes",
    "CH_03": "Acid-Base, Blood Gases & Electrolytes",
    "CH_04": "Special Chemistry",
    "HE_01": "Physiology",
    "HE_02": "Disease States",
    "HE_03": "Laboratory Testing",
    "HE_04": "Hemostasis",
    "HE_05": "Laboratory Operations",
    "IM_01": "Principles of Immunology",
    "IM_02": "Diseases of the Immune System",
    "LO_01": "Laboratory Operations",
    "MB_01": "Molecular Science",
    "MB_02": "Molecular Techniques",
    "MB_03": "Applications of Molecular Testing",
    "MB_04": "Laboratory Operations",
    "MI_01": "Preanalytic Procedures",
    "MI_02": "Analytic Procedures for Bacteriology",
    "MI_03": "Mycobacteriology and Nocardia",
    "MI_04": "Virology",
    "MI_05": "Parasitology",
    "MI_06": "Mycology",
    "MI_07": "Serology",
    "UA_01": "Urinalysis",
    "BF_02": "Body Fluids",
}

TOPIC_ALIASES: dict[str, str] = {
    "UABF_01": "UA_01",
    "UABF_02": "BF_02",
}

_BLOCK_SPLIT_RE = re.compile(r"(?=^\*\*(?:Question|Variant)\s+\d+)", re.M)
_HEADER_TOPIC_RE = re.compile(r">\s*\*\*Topic\*\*:\s*`([^`]+)`\s*(.+)")
_HEADER_BLOOM_RE = re.compile(r">\s*\*\*(?:Cognitive Level|Cognitive Tier)\*\*:\s*.*?\b(Remember|Understand|Apply|Analyze)\b", re.I)
_FILE_TOPIC_RE = re.compile(r"\b((?:BB|CH|HE|IM|LO|MB|MI|UABF|UA|BF)_\d{2})\b")
_FILE_BLOOM_RE = re.compile(r"_(RE|UN|AP|AN)(?:_Set)?\.md$", re.I)
_OPTION_LINE_RE = re.compile(r"^([A-F])\)\s*(.+)$")
_QTYPE_CODE_RE = re.compile(r"`([A-Z]+)`")
_INT_RE = re.compile(r"\d+")
_DIFF_SECTION_RE = re.compile(r"\*\*Difficulty Rationale?:\*\*", re.I)

_KNOWN_FIELDS = (
    "Question Type",
    "Bloom's Taxonomy Level",
    "Assessment Objective",
    "Topic",
    "Question Text",
    "Options",
    "Feedback",
    "Hint",
    "Difficulty Level",
    "Difficulty Rational",
    "Difficulty Rationale",
    "Source",
)
_FIELD_MARKER_RE = re.compile(
    r"^\*\*(" + "|".join(re.escape(f) for f in _KNOWN_FIELDS) + r"):\*\*\s*(.*)$",
    re.M,
)


class QuestionOption(BaseModel):
    """Single answer option within a question."""

    label: str
    text: str
    weight: int
    feedback: str


class QuestionRecord(BaseModel):
    """Canonical deduplicated question schema for Parquet export."""

    id: str
    display_id: str
    discipline_code: str
    discipline_name: str
    topic_code: str
    topic_name: str
    taxonomic_code: str
    ascp_subtopic: str
    leaf_topic: str
    ascp_path: str
    subset_tags_json: str
    bloom_level: str
    difficulty: int
    difficulty_rationale: str
    question_type: str
    objective: str
    question_text: str
    options_json: str
    hint: str
    similar_ids_json: str = "[]"
    source_files_json: str


class ParseWarning(BaseModel):
    """Diagnostic entry for malformed or ambiguous source blocks."""

    file: str
    block_label: str
    reason: str


class ParseResult(BaseModel):
    """Aggregated result from parsing a corpus."""

    records: list[QuestionRecord]
    warnings: list[ParseWarning]
    subset_memberships: dict[str, list[str]]
    stats: dict[str, Any]


def normalize_for_hash(text: str) -> str:
    """Normalize text for deterministic content-hash deduplication."""
    return re.sub(r"\s+", " ", text.strip().lower())


def compute_content_hash(question_text: str, option_texts: list[str]) -> str:
    """Compute SHA-256 over normalized stem and sorted normalized option texts."""
    norm_stem = normalize_for_hash(question_text)
    norm_opts = sorted(normalize_for_hash(opt) for opt in option_texts)
    payload = norm_stem + "\n" + "\n".join(norm_opts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _extract_last_fields(block: str) -> dict[str, str]:
    """Extract all known bold fields from a block, keeping the LAST occurrence of each."""
    matches = list(_FIELD_MARKER_RE.finditer(block))
    fields: dict[str, str] = {}
    for idx, m in enumerate(matches):
        field_name = m.group(1)
        inline_val = m.group(2).strip()
        start_body = m.end()
        end_body = matches[idx + 1].start() if idx + 1 < len(matches) else len(block)
        trailing = block[start_body:end_body]
        # Stop at horizontal rule or italicized draft self-correction notes
        trailing_lines: list[str] = []
        for raw_line in trailing.splitlines():
            stripped = raw_line.strip()
            if stripped == "---" or stripped.startswith("*Wait,") or stripped.startswith("*(Correction") or stripped.startswith("*(Self-Correction"):
                break
            trailing_lines.append(raw_line.rstrip())
        body_text = "\n".join(trailing_lines).strip()
        combined = f"{inline_val}\n{body_text}".strip() if (inline_val and body_text) else (inline_val or body_text)
        # Normalize Difficulty Rational -> Difficulty Rationale
        norm_name = "Difficulty Rationale" if field_name == "Difficulty Rational" else field_name
        fields[norm_name] = combined
    return fields


def _parse_lettered_lines(section_text: str) -> dict[str, str]:
    items: dict[str, str] = {}
    current_label: str | None = None
    for raw_line in section_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        m = _OPTION_LINE_RE.match(line)
        if m:
            current_label = m.group(1).upper()
            items[current_label] = m.group(2).strip()
        elif current_label is not None and not line.startswith("*"):
            items[current_label] = f"{items[current_label]} {line}".strip()
    return items


def _is_correct_feedback(fb_text: str) -> bool:
    cleaned = re.sub(r"^[*_`\[\(]+", "", fb_text.strip())
    if re.match(r"^correct\s+(?:choice|option|answer)\s+is\b", cleaned, re.I):
        return False
    return bool(re.match(r"^correct(?:\s*[\]\):.\-!]|\s|$)", cleaned, re.I))


def _normalize_qtype(raw_qtype: str) -> str:
    m = _QTYPE_CODE_RE.search(raw_qtype)
    if m:
        return m.group(1).upper()
    cleaned = raw_qtype.strip().lower()
    if cleaned in ("analyze", "analyse", "apply", "understand", "remember", "multiple choice", ""):
        return "MC"
    if "multi" in cleaned and "select" in cleaned:
        return "MS"
    if "true" in cleaned and "false" in cleaned:
        return "TF"
    return "MC"


def _normalize_bloom(raw_bloom: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z]", " ", raw_bloom).strip().lower()
    for token in cleaned.split():
        if token in BLOOM_MAP:
            return BLOOM_MAP[token]
    return fallback


def _classify_file(rel_parts: tuple[str, ...]) -> tuple[int, list[str], str | None]:
    """Return (priority_tier, subset_tags, active_subset_name)."""
    is_old = rel_parts[0].lower() == "old"
    inner = rel_parts[1:] if is_old else rel_parts
    top = inner[0] if inner else ""
    is_subset = bool(re.match(r"^A\d+_", top))

    if not is_old and not is_subset:
        return 0, ["Core_Pool"], None
    if not is_old and is_subset:
        return 1, [top], top
    if is_old and not is_subset:
        return 2, ["Archive_old"], None
    return 3, ["Archive_old", f"old/{top}"], None


def _infer_file_topic_and_bloom(path: Path, header_text: str) -> tuple[str, str, str]:
    """Infer (topic_code, topic_name, fallback_bloom) from file header and name."""
    topic_code = ""
    topic_name = ""
    m_topic = _HEADER_TOPIC_RE.search(header_text)
    if m_topic:
        topic_code = TOPIC_ALIASES.get(m_topic.group(1).strip().upper(), m_topic.group(1).strip().upper())
        raw_tname = m_topic.group(2).strip()
        topic_name = CANONICAL_TOPIC_NAMES.get(topic_code, raw_tname.strip("()"))

    if not topic_code:
        m_file = _FILE_TOPIC_RE.search(path.name)
        if m_file:
            topic_code = TOPIC_ALIASES.get(m_file.group(1).upper(), m_file.group(1).upper())
            topic_name = CANONICAL_TOPIC_NAMES.get(topic_code, topic_code)

    fallback_bloom = "AP"
    m_hb = _HEADER_BLOOM_RE.search(header_text)
    if m_hb:
        fallback_bloom = BLOOM_MAP[m_hb.group(1).lower()]
    else:
        m_fb = _FILE_BLOOM_RE.search(path.name)
        if m_fb:
            fallback_bloom = m_fb.group(1).upper()

    return topic_code, topic_name, fallback_bloom


def _build_display_id(rel_parts: tuple[str, ...], topic_code: str, bloom: str, idx: int) -> str:
    is_old = rel_parts[0].lower() == "old"
    inner = rel_parts[1:] if is_old else rel_parts
    prefix = "OLD-" if is_old else ""
    top = inner[0] if inner else ""
    if re.match(r"^A\d+_", top):
        slot_m = re.match(r"^(Q\d+)_", rel_parts[-1])
        slot = slot_m.group(1) if slot_m else f"Q{idx:03d}"
        return f"{prefix}{top}-{slot}-V{idx:02d}"
    return f"{prefix}{topic_code}-{bloom}-{idx:04d}"


def parse_all_markdown(
    input_dir: Path,
    mappings: GuidelineMappings,
    topics_filter: set[str] | None = None,
) -> ParseResult:
    """Recursively parse all .md question pools and deduplicate by normalized stem+options."""
    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")

    norm_filter = {TOPIC_ALIASES.get(t.upper(), t.upper()) for t in topics_filter} if topics_filter else None

    discovered: list[tuple[int, str, Path, tuple[str, ...], list[str], str | None]] = []
    for path in input_dir.rglob("*.md"):
        rel = path.relative_to(input_dir)
        # Skip top-level manifest/audit summaries with no questions
        if len(rel.parts) == 1:
            continue
        priority, file_tags, active_subset = _classify_file(rel.parts)
        discovered.append((priority, rel.as_posix(), path, rel.parts, file_tags, active_subset))

    # Deterministic priority order: current core pools -> current subsets -> old pools -> old subsets
    discovered.sort(key=lambda item: (item[0], item[1]))

    dedup_map: dict[str, dict[str, Any]] = {}
    warnings: list[ParseWarning] = []
    subset_memberships: dict[str, list[str]] = {}
    subset_seen: dict[str, set[str]] = {}

    files_scanned = 0
    files_skipped_filter = 0
    raw_blocks_seen = 0
    duplicates_merged = 0

    for _priority, rel_posix, path, rel_parts, file_tags, active_subset in discovered:
        text = path.read_text(encoding="utf-8", errors="replace")
        if "**Question Text:**" not in text:
            continue

        header_preview = text[:1200]
        file_topic_code, file_topic_name, fallback_bloom = _infer_file_topic_and_bloom(path, header_preview)

        if norm_filter and file_topic_code and file_topic_code not in norm_filter:
            files_skipped_filter += 1
            continue

        files_scanned += 1
        blocks = _BLOCK_SPLIT_RE.split(text)

        for idx, block in enumerate(blocks[1:], start=1):
            raw_blocks_seen += 1
            first_line = block.splitlines()[0].strip().strip("*")
            fields = _extract_last_fields(block)

            q_text = re.sub(r"\s+", " ", fields.get("Question Text", "")).strip()
            if not q_text:
                warnings.append(ParseWarning(file=rel_posix, block_label=first_line, reason="Missing Question Text"))
                continue

            opt_map = _parse_lettered_lines(fields.get("Options", ""))
            if len(opt_map) < 2:
                warnings.append(
                    ParseWarning(
                        file=rel_posix,
                        block_label=first_line,
                        reason=f"Insufficient options parsed ({len(opt_map)})",
                    )
                )
                continue

            fb_map = _parse_lettered_lines(fields.get("Feedback", ""))
            options: list[QuestionOption] = []
            for label in sorted(opt_map.keys()):
                fb_val = fb_map.get(label, "")
                weight = 100 if _is_correct_feedback(fb_val) else 0
                options.append(QuestionOption(label=label, text=opt_map[label], weight=weight, feedback=fb_val))

            q_type = _normalize_qtype(fields.get("Question Type", "MC"))
            correct_count = sum(1 for o in options if o.weight == 100)
            if q_type == "MC" and correct_count != 1:
                warnings.append(
                    ParseWarning(
                        file=rel_posix,
                        block_label=first_line,
                        reason=f"MC block has {correct_count} correct options (expected 1)",
                    )
                )
                continue

            bloom = _normalize_bloom(fields.get("Bloom's Taxonomy Level", ""), fallback_bloom)
            source_line = fields.get("Source", "")
            # Infer topic_code if header lacked it
            t_code = file_topic_code
            if not t_code and source_line:
                m_sc = _FILE_TOPIC_RE.search(source_line)
                if m_sc:
                    t_code = TOPIC_ALIASES.get(m_sc.group(1).upper(), m_sc.group(1).upper())
            if not t_code:
                warnings.append(ParseWarning(file=rel_posix, block_label=first_line, reason="Could not determine topic_code"))
                continue

            if norm_filter and t_code not in norm_filter:
                continue

            disc_code = t_code.split("_", 1)[0]
            disc_code = DISCIPLINE_ALIASES.get(disc_code, disc_code)
            disc_name = DISCIPLINE_NAMES.get(disc_code, disc_code)
            t_name = CANONICAL_TOPIC_NAMES.get(t_code, file_topic_name or t_code)

            fallback_leaf = fields.get("Topic", "").strip() or t_name
            tax_code, ascp_subtopic, leaf_topic, ascp_path = resolve_ascp_metadata(
                mappings=mappings,
                source_line=source_line,
                discipline_code=disc_code,
                fallback_topic_name=t_name,
                fallback_leaf=fallback_leaf,
            )

            diff_match = _INT_RE.search(fields.get("Difficulty Level", "5"))
            difficulty = max(1, min(10, int(diff_match.group(0)))) if diff_match else 5
            diff_rationale = re.sub(r"\s+", " ", fields.get("Difficulty Rationale", "")).strip()
            objective = re.sub(r"\s+", " ", fields.get("Assessment Objective", "")).strip()
            hint = re.sub(r"\s+", " ", fields.get("Hint", "")).strip()

            content_hash = compute_content_hash(q_text, [o.text for o in options])
            uid = f"q_{content_hash[:12]}"

            if uid in dedup_map:
                duplicates_merged += 1
                existing = dedup_map[uid]
                for tag in file_tags:
                    if tag not in existing["subset_tags"]:
                        existing["subset_tags"].append(tag)
                if rel_posix not in existing["source_files"]:
                    existing["source_files"].append(rel_posix)
            else:
                display_id = _build_display_id(rel_parts, t_code, bloom, idx)
                dedup_map[uid] = {
                    "id": uid,
                    "display_id": display_id,
                    "discipline_code": disc_code,
                    "discipline_name": disc_name,
                    "topic_code": t_code,
                    "topic_name": t_name,
                    "taxonomic_code": tax_code,
                    "ascp_subtopic": ascp_subtopic,
                    "leaf_topic": leaf_topic,
                    "ascp_path": ascp_path,
                    "subset_tags": list(file_tags),
                    "bloom_level": bloom,
                    "difficulty": difficulty,
                    "difficulty_rationale": diff_rationale,
                    "question_type": q_type,
                    "objective": objective,
                    "question_text": q_text,
                    "options": [o.model_dump() for o in options],
                    "hint": hint,
                    "source_files": [rel_posix],
                }

            if active_subset is not None:
                seen_set = subset_seen.setdefault(active_subset, set())
                if uid not in seen_set:
                    seen_set.add(uid)
                    subset_memberships.setdefault(active_subset, []).append(uid)

    records: list[QuestionRecord] = []
    for entry in dedup_map.values():
        records.append(
            QuestionRecord(
                id=entry["id"],
                display_id=entry["display_id"],
                discipline_code=entry["discipline_code"],
                discipline_name=entry["discipline_name"],
                topic_code=entry["topic_code"],
                topic_name=entry["topic_name"],
                taxonomic_code=entry["taxonomic_code"],
                ascp_subtopic=entry["ascp_subtopic"],
                leaf_topic=entry["leaf_topic"],
                ascp_path=entry["ascp_path"],
                subset_tags_json=json.dumps(entry["subset_tags"], ensure_ascii=False),
                bloom_level=entry["bloom_level"],
                difficulty=entry["difficulty"],
                difficulty_rationale=entry["difficulty_rationale"],
                question_type=entry["question_type"],
                objective=entry["objective"],
                question_text=entry["question_text"],
                options_json=json.dumps(entry["options"], ensure_ascii=False),
                hint=entry["hint"],
                similar_ids_json="[]",
                source_files_json=json.dumps(entry["source_files"], ensure_ascii=False),
            )
        )

    stats = {
        "files_scanned": files_scanned,
        "files_skipped_by_topic_filter": files_skipped_filter,
        "raw_blocks_seen": raw_blocks_seen,
        "unique_questions": len(records),
        "duplicates_merged": duplicates_merged,
        "warnings_count": len(warnings),
    }
    return ParseResult(
        records=records,
        warnings=warnings,
        subset_memberships=subset_memberships,
        stats=stats,
    )

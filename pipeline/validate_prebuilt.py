from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any

import pyarrow.parquet as pq


class PrebuiltValidationError(ValueError):
    """Raised when a community Pre-Built quiz submission fails schema or UID validation."""


def extract_json_payload_from_markdown(text: str) -> dict[str, Any]:
    """Extract JSON payload from a GitHub Issue markdown body or raw JSON text."""
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            data = json.loads(stripped)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError as exc:
            raise PrebuiltValidationError(f"Invalid raw JSON payload: {exc}") from exc

    fence_matches = re.findall(
        r"```(?:json)?\s*\r?\n(\{[\s\S]*?\})\s*\r?\n```",
        text,
        flags=re.IGNORECASE,
    )
    for candidate in fence_matches:
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            continue

    raise PrebuiltValidationError(
        "Could not find a valid fenced ```json { ... } ``` block in the submission body."
    )


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug[:48] or "community_quiz"


def load_question_index_from_data_dir(data_dir: Path) -> dict[str, dict[str, Any]]:
    """Load minimal question metadata keyed by immutable question UID from Parquet shards."""
    parquet_files: list[Path] = []
    manifest_path = data_dir / "manifest.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for shard in manifest.get("shards", []):
                rel = shard.get("parquet", {}).get("path")
                if isinstance(rel, str) and rel.strip():
                    candidate = data_dir / rel
                    if candidate.exists():
                        parquet_files.append(candidate)
        except Exception:
            parquet_files = []

    if not parquet_files:
        for folder in ("topics", "shards"):
            candidate_dir = data_dir / folder
            if candidate_dir.exists():
                parquet_files.extend(sorted(candidate_dir.glob("*.parquet")))

    if not parquet_files:
        parquet_files = sorted(data_dir.rglob("*.parquet"))

    if not parquet_files:
        raise PrebuiltValidationError(f"No Parquet shard files found under data dir: {data_dir}")

    index: dict[str, dict[str, Any]] = {}
    for pq_path in parquet_files:
        table = pq.read_table(
            pq_path,
            columns=["id", "discipline_code", "bloom_level", "difficulty"],
        )
        for row in table.to_pylist():
            index[row["id"]] = row

    if not index:
        raise PrebuiltValidationError(f"No Parquet question rows loaded from {data_dir}")
    return index


def validate_prebuilt_submission(
    raw_payload: dict[str, Any],
    question_index: dict[str, dict[str, Any]],
    *,
    quiz_id: str | None = None,
) -> dict[str, Any]:
    """Validate submission fields & UIDs and compute authoritative summary statistics."""
    title = raw_payload.get("title")
    if not isinstance(title, str) or not title.strip():
        raise PrebuiltValidationError('Field "title" must be a non-empty string.')
    clean_title = title.strip()

    raw_qids = raw_payload.get("questionIds")
    if not isinstance(raw_qids, list) or len(raw_qids) == 0:
        raise PrebuiltValidationError('Field "questionIds" must be a non-empty array of UIDs.')

    seen: set[str] = set()
    clean_qids: list[str] = []
    invalid_format: list[str] = []
    for item in raw_qids:
        if not isinstance(item, str) or not item.strip():
            invalid_format.append(repr(item))
            continue
        qid = item.strip()
        if qid not in seen:
            seen.add(qid)
            clean_qids.append(qid)

    if invalid_format:
        raise PrebuiltValidationError(
            f"Invalid question ID entries: {', '.join(invalid_format[:5])}"
        )

    missing_uids = [qid for qid in clean_qids if qid not in question_index]
    if missing_uids:
        sample = ", ".join(missing_uids[:10])
        suffix = f" (+{len(missing_uids) - 10} more)" if len(missing_uids) > 10 else ""
        raise PrebuiltValidationError(
            f"Unknown question UID(s) not present in current dataset: {sample}{suffix}"
        )

    license_val = raw_payload.get("license")
    if license_val is not None and str(license_val).strip().upper() not in {"CC0-1.0", "CC0"}:
        raise PrebuiltValidationError(
            f'Unsupported license "{license_val}". Community Pre-Built quizzes must use CC0-1.0.'
        )

    disc_counts: Counter[str] = Counter()
    bloom_counts: Counter[str] = Counter()
    diff_sum = 0.0
    for qid in clean_qids:
        meta = question_index[qid]
        disc_counts[str(meta["discipline_code"])] += 1
        bloom_counts[str(meta["bloom_level"])] += 1
        diff_sum += float(meta["difficulty"])

    tags_raw = raw_payload.get("tags") or []
    tags = [str(t).strip() for t in tags_raw if isinstance(t, str) and t.strip()]

    author = str(raw_payload.get("author") or "Community Contributor").strip()
    institution_raw = raw_payload.get("institution")
    institution = str(institution_raw).strip() if isinstance(institution_raw, str) and institution_raw.strip() else None
    description = str(raw_payload.get("description") or "").strip()

    resolved_id = quiz_id or str(raw_payload.get("id") or f"community_{_slugify(clean_title)}").strip()

    entry: dict[str, Any] = {
        "id": resolved_id,
        "title": clean_title,
        "description": description or f"Community-curated Pre-Built quiz ({len(clean_qids)} questions).",
        "author": author,
        "license": "CC0-1.0",
        "tags": tags or ["community"],
        "questionIds": clean_qids,
        "questionCount": len(clean_qids),
        "disciplineCounts": dict(sorted(disc_counts.items())),
        "bloomCounts": dict(sorted(bloom_counts.items())),
        "avgDifficulty": round(diff_sum / len(clean_qids), 2),
        "estimatedMinutes": max(5, round(len(clean_qids) * 1.2)),
    }
    if institution:
        entry["institution"] = institution
    return entry


def apply_prebuilt_entry_to_data_dir(data_dir: Path, entry: dict[str, Any]) -> None:
    """Upsert validated quiz into prebuilt_quizzes.json and refresh manifest.json digest."""
    prebuilt_path = data_dir / "prebuilt_quizzes.json"
    existing: list[dict[str, Any]] = []
    if prebuilt_path.exists():
        loaded = json.loads(prebuilt_path.read_text(encoding="utf-8"))
        if isinstance(loaded, list):
            existing = [item for item in loaded if isinstance(item, dict)]

    replaced = False
    for idx, item in enumerate(existing):
        if item.get("id") == entry["id"]:
            existing[idx] = entry
            replaced = True
            break
    if not replaced:
        existing.append(entry)

    prebuilt_bytes = json.dumps(existing, indent=2).encode("utf-8")
    prebuilt_path.write_bytes(prebuilt_bytes)

    manifest_path = data_dir / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["prebuiltCatalog"] = {
            "path": "prebuilt_quizzes.json",
            "bytes": len(prebuilt_bytes),
            "sha256": hashlib.sha256(prebuilt_bytes).hexdigest(),
            "count": len(existing),
        }
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def format_validation_report_md(entry: dict[str, Any]) -> str:
    disc_summary = ", ".join(f"{k}: {v}" for k, v in entry["disciplineCounts"].items())
    bloom_summary = ", ".join(f"{k}: {v}" for k, v in entry["bloomCounts"].items())
    return "\n".join(
        [
            "### Pre-Built Quiz Validation Passed",
            "",
            f"- **ID:** `{entry['id']}`",
            f"- **Title:** {entry['title']}",
            f"- **Author:** {entry['author']}"
            + (f" ({entry['institution']})" if entry.get("institution") else ""),
            f"- **Question Count:** {entry['questionCount']}",
            f"- **Disciplines:** {disc_summary}",
            f"- **Bloom Levels:** {bloom_summary}",
            f"- **Mean Difficulty:** {entry['avgDifficulty']} / 10",
            f"- **Estimated Time:** {entry['estimatedMinutes']} min",
            f"- **License:** `{entry['license']}`",
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate a community Pre-Built quiz submission against MLS OER Parquet shards."
    )
    parser.add_argument("--data-dir", type=Path, default=Path("local_data"))
    parser.add_argument("--issue-body-file", type=Path, default=None)
    parser.add_argument("--issue-body-env", type=str, default=None)
    parser.add_argument("--quiz-id", type=str, default=None)
    parser.add_argument("--apply", action="store_true", help="Write validated quiz to prebuilt_quizzes.json & manifest.json.")
    parser.add_argument("--report-md", type=Path, default=None, help="Optional Markdown summary output file.")
    args = parser.parse_args()

    if args.issue_body_file is not None:
        raw_text = args.issue_body_file.read_text(encoding="utf-8")
    elif args.issue_body_env is not None:
        raw_text = os.environ.get(args.issue_body_env, "")
    else:
        raise SystemExit("Provide either --issue-body-file or --issue-body-env.")

    try:
        payload = extract_json_payload_from_markdown(raw_text)
        question_index = load_question_index_from_data_dir(args.data_dir)
        entry = validate_prebuilt_submission(payload, question_index, quiz_id=args.quiz_id)
        if args.apply:
            apply_prebuilt_entry_to_data_dir(args.data_dir, entry)
        report = format_validation_report_md(entry)
        if args.report_md is not None:
            args.report_md.write_text(report, encoding="utf-8")
        print(report)
        return 0
    except PrebuiltValidationError as exc:
        err_report = f"### Pre-Built Quiz Validation Failed\n\n- **Reason:** {exc}"
        if args.report_md is not None:
            args.report_md.write_text(err_report, encoding="utf-8")
        print(err_report)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

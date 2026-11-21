"""Build sharded Parquet files, int8 vector shards, centroids, manifest, and Pre-Built quizzes."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import torch
from sentence_transformers import SentenceTransformer

from pipeline.parse_mappings import GuidelineMappings, build_ascp_tree, load_guideline_mappings
from pipeline.parse_md import QuestionRecord, parse_all_markdown

DEFAULT_INPUT_DIR = Path(
    r"C:\Users\brett\OneDrive - Augusta University\_Teach\AYs\2026-27\CLSC_4903-7903\AI_REV\discussions\_D2L_Exit_Exam"
)
EMBEDDING_MODEL_ID = "BAAI/bge-small-en-v1.5"
CLIENT_EMBEDDING_MODEL_ID = "Xenova/bge-small-en-v1.5"
EMBEDDING_DIM = 384

_PARQUET_SCHEMA = pa.schema(
    [
        ("id", pa.string()),
        ("display_id", pa.string()),
        ("discipline_code", pa.string()),
        ("discipline_name", pa.string()),
        ("topic_code", pa.string()),
        ("topic_name", pa.string()),
        ("taxonomic_code", pa.string()),
        ("ascp_subtopic", pa.string()),
        ("leaf_topic", pa.string()),
        ("ascp_path", pa.string()),
        ("subset_tags_json", pa.string()),
        ("bloom_level", pa.string()),
        ("difficulty", pa.int32()),
        ("difficulty_rationale", pa.string()),
        ("question_type", pa.string()),
        ("objective", pa.string()),
        ("question_text", pa.string()),
        ("options_json", pa.string()),
        ("hint", pa.string()),
        ("similar_ids_json", pa.string()),
        ("source_files_json", pa.string()),
    ]
)

_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
    "what", "which", "when", "where", "why", "how", "who", "whom", "into",
    "than", "then", "have", "has", "had", "will", "would", "could", "should",
    "may", "might", "must", "can", "not", "but", "all", "any", "each", "both",
    "such", "more", "most", "less", "least", "only", "also", "very", "often",
    "patient", "presents", "following", "likely", "indicated", "indicates",
    "explain", "explains", "identify", "determine", "describe", "represents",
    "associated", "between", "during", "after", "before", "under", "over",
    "within", "without", "using", "based", "found", "observed", "measured",
    "result", "results", "finding", "findings", "test", "testing", "clinical",
    "laboratory", "values", "value", "normal", "abnormal", "high", "low",
    "elevated", "decreased", "increased", "causes", "cause", "caused", "true",
    "false", "best", "primary", "correct", "incorrect", "option", "question",
    "objective", "assessment", "level", "rate", "time", "type", "system",
}

_PREBUILT_TITLES: dict[str, tuple[str, str]] = {
    "A0_EE-A0": ("Exit Exam 0 (Baseline Comprehensive)", "Comprehensive MLS baseline assessment pool across all 8 ASCP disciplines."),
    "A1_EE-A1": ("Exit Exam 1 (Comprehensive)", "Comprehensive MLS exit assessment pool calibrated across AN/AP/UN/RE Bloom's tiers."),
    "A2_RV-BB": ("Categorical Review: Blood Banking", "Focused Immunohematology / Blood Banking board review pool."),
    "A3_RV-CH-IM": ("Categorical Review: Chemistry & Immunology", "Focused Clinical Chemistry and Immunology review pool."),
    "A4_RV-HE": ("Categorical Review: Hematology", "Focused Hematology and Hemostasis review pool."),
    "A5_RV-MI": ("Categorical Review: Microbiology", "Focused Clinical Microbiology review pool."),
    "A6_RV-MB-UA-BF-LO": ("Categorical Review: MB, UA/BF & Lab Ops", "Focused Molecular Biology, Urinalysis/Body Fluids, and Lab Operations review pool."),
    "A7_EE-A2": ("Exit Exam 2 (Comprehensive)", "Second comprehensive MLS exit assessment pool across all 8 ASCP disciplines."),
    "A8_EE-A3": ("Exit Exam 3 (Comprehensive)", "Third comprehensive MLS exit assessment pool across all 8 ASCP disciplines."),
    "A9_EE-A4": ("Exit Exam 4 (Comprehensive)", "Fourth comprehensive MLS exit assessment pool across all 8 ASCP disciplines."),
}

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9\-]{2,}")


def sha256_file(path: Path) -> tuple[int, str]:
    """Return (byte_size, sha256_hex) for a file on disk."""
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        while chunk := fh.read(65536):
            size += len(chunk)
            h.update(chunk)
    return size, h.hexdigest()


def _extract_correct_answer_text(options_json: str) -> str:
    opts = json.loads(options_json)
    for opt in opts:
        if opt.get("weight", 0) == 100:
            return str(opt.get("text", ""))
    return str(opts[0].get("text", "")) if opts else ""


def _build_embedding_texts(records: list[QuestionRecord]) -> list[str]:
    texts: list[str] = []
    for rec in records:
        ans = _extract_correct_answer_text(rec.options_json)
        texts.append(
            f"{rec.ascp_path} | Objective: {rec.objective} | Question: {rec.question_text} | Answer: {ans}"
        )
    return texts


def _compute_similar_ids(
    records: list[QuestionRecord],
    embeddings: np.ndarray,
    threshold: float = 0.90,
    top_k: int = 5,
    chunk_size: int = 2048,
) -> int:
    """Compute up to top_k neighbor UIDs with cosine similarity > threshold (in-place on records)."""
    n = len(records)
    if n <= 1:
        return 0

    use_cuda = torch.cuda.is_available()
    device = torch.device("cuda" if use_cuda else "cpu")
    mat = torch.from_numpy(embeddings).to(device=device, dtype=torch.float32)

    with_siblings = 0
    for start in range(0, n, chunk_size):
        end = min(start + chunk_size, n)
        sims = mat[start:end] @ mat.T  # (batch, N)
        row_indices = torch.arange(start, end, device=device)
        sims[torch.arange(end - start, device=device), row_indices] = -2.0

        k = min(top_k, n - 1)
        top_vals, top_idx = torch.topk(sims, k=k, dim=1)
        vals_np = top_vals.cpu().numpy()
        idx_np = top_idx.cpu().numpy()

        for offset in range(end - start):
            row_i = start + offset
            neighbors: list[str] = []
            for j in range(k):
                if float(vals_np[offset, j]) > threshold:
                    neighbors.append(records[int(idx_np[offset, j])].id)
            if neighbors:
                with_siblings += 1
            records[row_i].similar_ids_json = json.dumps(neighbors)

    return with_siblings


def _extract_shard_keywords(
    shard_records: dict[str, list[QuestionRecord]],
    top_n: int = 30,
) -> dict[str, list[str]]:
    """Compute top distinctive clinical terms per shard via TF-IDF across shards."""
    shard_tfs: dict[str, Counter[str]] = {}
    doc_freq: Counter[str] = Counter()

    for shard_id, recs in shard_records.items():
        tf: Counter[str] = Counter()
        for rec in recs:
            ans = _extract_correct_answer_text(rec.options_json)
            blob = f"{rec.leaf_topic} {rec.leaf_topic} {rec.ascp_subtopic} {rec.objective} {rec.question_text} {ans}".lower()
            for tok in _TOKEN_RE.findall(blob):
                if tok in _STOPWORDS or tok.isdigit():
                    continue
                tf[tok] += 1
        shard_tfs[shard_id] = tf
        for tok in tf:
            doc_freq[tok] += 1

    num_shards = max(1, len(shard_records))
    result: dict[str, list[str]] = {}
    for shard_id, tf in shard_tfs.items():
        scored: list[tuple[float, str]] = []
        for tok, count in tf.items():
            # Smooth IDF so sample builds with 2 shards still rank domain terms cleanly
            idf = math.log((num_shards + 1.0) / (doc_freq[tok] + 0.5)) + 1.0
            scored.append((count * idf, tok))
        scored.sort(key=lambda pair: (-pair[0], pair[1]))
        result[shard_id] = [tok for _, tok in scored[:top_n]]
    return result


def _write_parquet_shard(path: Path, recs: list[QuestionRecord]) -> None:
    columns: dict[str, list[Any]] = {field.name: [] for field in _PARQUET_SCHEMA}
    for r in recs:
        columns["id"].append(r.id)
        columns["display_id"].append(r.display_id)
        columns["discipline_code"].append(r.discipline_code)
        columns["discipline_name"].append(r.discipline_name)
        columns["topic_code"].append(r.topic_code)
        columns["topic_name"].append(r.topic_name)
        columns["taxonomic_code"].append(r.taxonomic_code)
        columns["ascp_subtopic"].append(r.ascp_subtopic)
        columns["leaf_topic"].append(r.leaf_topic)
        columns["ascp_path"].append(r.ascp_path)
        columns["subset_tags_json"].append(r.subset_tags_json)
        columns["bloom_level"].append(r.bloom_level)
        columns["difficulty"].append(int(r.difficulty))
        columns["difficulty_rationale"].append(r.difficulty_rationale)
        columns["question_type"].append(r.question_type)
        columns["objective"].append(r.objective)
        columns["question_text"].append(r.question_text)
        columns["options_json"].append(r.options_json)
        columns["hint"].append(r.hint)
        columns["similar_ids_json"].append(r.similar_ids_json)
        columns["source_files_json"].append(r.source_files_json)

    table = pa.Table.from_pydict(columns, schema=_PARQUET_SCHEMA)
    pq.write_table(table, path, row_group_size=5000, compression="zstd")


def _build_prebuilt_quizzes(
    subset_memberships: dict[str, list[str]],
    records_by_id: dict[str, QuestionRecord],
) -> list[dict[str, Any]]:
    prebuilt: list[dict[str, Any]] = []
    for subset_key in sorted(subset_memberships.keys()):
        q_ids = [qid for qid in subset_memberships[subset_key] if qid in records_by_id]
        if not q_ids:
            continue
        disc_counts: Counter[str] = Counter()
        bloom_counts: Counter[str] = Counter()
        diff_sum = 0
        for qid in q_ids:
            rec = records_by_id[qid]
            disc_counts[rec.discipline_code] += 1
            bloom_counts[rec.bloom_level] += 1
            diff_sum += rec.difficulty
        title, desc = _PREBUILT_TITLES.get(
            subset_key,
            (f"Assessment Subset {subset_key}", f"Curated question pool from {subset_key}."),
        )
        prebuilt.append(
            {
                "id": f"prebuilt_{subset_key.lower()}",
                "subsetKey": subset_key,
                "title": title,
                "description": desc,
                "author": "MLS OER Core Collection",
                "institution": "Augusta University",
                "license": "CC0-1.0",
                "tags": [subset_key, "curated"],
                "questionIds": q_ids,
                "questionCount": len(q_ids),
                "disciplineCounts": dict(sorted(disc_counts.items())),
                "bloomCounts": dict(sorted(bloom_counts.items())),
                "avgDifficulty": round(diff_sum / len(q_ids), 2),
                "estimatedMinutes": max(5, round(len(q_ids) * 1.2)),
            }
        )
    return prebuilt


def run_etl(
    input_dir: Path,
    mappings_dir: Path,
    output_dir: Path,
    topics_filter: set[str] | None = None,
    batch_size: int = 256,
    similarity_threshold: float = 0.90,
    max_rows_per_shard: int = 50000,
) -> dict[str, Any]:
    """Execute the full ETL pipeline and return the generated manifest dictionary."""
    output_dir.mkdir(parents=True, exist_ok=True)
    topics_dir = output_dir / "topics"
    vectors_dir = output_dir / "vectors"
    topics_dir.mkdir(parents=True, exist_ok=True)
    vectors_dir.mkdir(parents=True, exist_ok=True)

    # Clear stale shards in output_dir when rebuilding
    for old_f in topics_dir.glob("*.parquet"):
        old_f.unlink()
    for old_f in vectors_dir.glob("*"):
        if old_f.is_file():
            old_f.unlink()

    mappings: GuidelineMappings = load_guideline_mappings(mappings_dir)
    parse_res = parse_all_markdown(input_dir=input_dir, mappings=mappings, topics_filter=topics_filter)
    records = parse_res.records
    if not records:
        raise ValueError("No valid questions parsed; check input_dir and topics filter.")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[ETL] Parsed {len(records)} unique questions ({parse_res.stats['duplicates_merged']} duplicates merged). Embedding on {device}...")

    model = SentenceTransformer(EMBEDDING_MODEL_ID, device=device)
    embed_texts = _build_embedding_texts(records)
    embeddings = model.encode(
        embed_texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=True,
    ).astype(np.float32)

    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    embeddings = (embeddings / np.maximum(norms, 1e-12)).astype(np.float32)

    print(f"[ETL] Computing top-5 nearest neighbors (cosine > {similarity_threshold})...")
    with_siblings = _compute_similar_ids(
        records=records,
        embeddings=embeddings,
        threshold=similarity_threshold,
        top_k=5,
    )

    # Group by topic_code
    grouped: dict[str, list[tuple[QuestionRecord, np.ndarray]]] = defaultdict(list)
    for rec, vec in zip(records, embeddings, strict=True):
        grouped[rec.topic_code].append((rec, vec))

    shard_items: dict[str, list[tuple[QuestionRecord, np.ndarray]]] = {}
    for topic_code in sorted(grouped.keys()):
        items = sorted(
            grouped[topic_code],
            key=lambda pair: (pair[0].bloom_level, pair[0].difficulty, pair[0].leaf_topic, pair[0].id),
        )
        if len(items) <= max_rows_per_shard:
            shard_items[topic_code] = items
        else:
            for part_idx, start in enumerate(range(0, len(items), max_rows_per_shard), start=1):
                shard_items[f"{topic_code}_p{part_idx:02d}"] = items[start : start + max_rows_per_shard]

    shard_records_only = {sid: [p[0] for p in pairs] for sid, pairs in shard_items.items()}
    shard_keywords = _extract_shard_keywords(shard_records_only, top_n=30)

    shard_order = sorted(shard_items.keys())
    centroid_rows: list[np.ndarray] = []
    manifest_shards: list[dict[str, Any]] = []
    all_subset_tags: set[str] = set()

    for shard_id in shard_order:
        pairs = shard_items[shard_id]
        recs = [p[0] for p in pairs]
        vecs = np.stack([p[1] for p in pairs], axis=0).astype(np.float32)

        parquet_rel = f"topics/{shard_id}.parquet"
        vec_rel = f"vectors/{shard_id}.vec.bin"
        ids_rel = f"vectors/{shard_id}.ids.json"

        parquet_path = output_dir / parquet_rel
        vec_path = output_dir / vec_rel
        ids_path = output_dir / ids_rel

        _write_parquet_shard(parquet_path, recs)

        quantized = np.clip(np.round(vecs * 127.0), -127, 127).astype(np.int8)
        vec_path.write_bytes(quantized.tobytes())
        ids_path.write_text(json.dumps([r.id for r in recs], separators=(",", ":")), encoding="utf-8")

        mean_vec = vecs.mean(axis=0).astype(np.float32)
        mean_norm = float(np.linalg.norm(mean_vec))
        if mean_norm > 1e-12:
            mean_vec = (mean_vec / mean_norm).astype(np.float32)
        centroid_rows.append(mean_vec)

        p_bytes, p_sha = sha256_file(parquet_path)
        v_bytes, v_sha = sha256_file(vec_path)
        i_bytes, i_sha = sha256_file(ids_path)

        bloom_hist: Counter[str] = Counter()
        diff_hist: Counter[str] = Counter()
        qtype_hist: Counter[str] = Counter()
        for r in recs:
            bloom_hist[r.bloom_level] += 1
            diff_hist[str(r.difficulty)] += 1
            qtype_hist[r.question_type] += 1
            for tag in json.loads(r.subset_tags_json):
                all_subset_tags.add(tag)

        first = recs[0]
        manifest_shards.append(
            {
                "shardId": shard_id,
                "topicCode": first.topic_code,
                "topicName": first.topic_name,
                "disciplineCode": first.discipline_code,
                "disciplineName": first.discipline_name,
                "questionCount": len(recs),
                "parquet": {"path": parquet_rel, "bytes": p_bytes, "sha256": p_sha},
                "vectors": {"path": vec_rel, "bytes": v_bytes, "sha256": v_sha},
                "ids": {"path": ids_rel, "bytes": i_bytes, "sha256": i_sha},
                "bloomHistogram": dict(sorted(bloom_hist.items())),
                "difficultyHistogram": dict(sorted(diff_hist.items(), key=lambda kv: int(kv[0]))),
                "questionTypeHistogram": dict(sorted(qtype_hist.items())),
                "topKeywords": shard_keywords.get(shard_id, []),
            }
        )

    centroids_rel = "vectors/topic_centroids.bin"
    centroids_path = output_dir / centroids_rel
    centroid_mat = np.stack(centroid_rows, axis=0).astype(np.float32)
    centroids_path.write_bytes(centroid_mat.tobytes())
    c_bytes, c_sha = sha256_file(centroids_path)

    records_by_id = {r.id: r for r in records}
    prebuilt_quizzes = _build_prebuilt_quizzes(parse_res.subset_memberships, records_by_id)
    prebuilt_path = output_dir / "prebuilt_quizzes.json"
    prebuilt_path.write_text(json.dumps(prebuilt_quizzes, indent=2), encoding="utf-8")
    pb_bytes, pb_sha = sha256_file(prebuilt_path)

    warnings_path = output_dir / "parse_warnings.json"
    warnings_path.write_text(
        json.dumps([w.model_dump() for w in parse_res.warnings], indent=2),
        encoding="utf-8",
    )

    manifest: dict[str, Any] = {
        "version": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "license": "CC0-1.0",
        "totalQuestions": len(records),
        "questionsWithSiblings": with_siblings,
        "similarityThreshold": similarity_threshold,
        "embeddingModel": CLIENT_EMBEDDING_MODEL_ID,
        "sourceEmbeddingModel": EMBEDDING_MODEL_ID,
        "embeddingDim": EMBEDDING_DIM,
        "vectorQuantization": "int8",
        "centroids": {
            "path": centroids_rel,
            "bytes": c_bytes,
            "sha256": c_sha,
            "dtype": "float32",
            "dim": EMBEDDING_DIM,
            "shardOrder": shard_order,
        },
        "prebuiltCatalog": {
            "path": "prebuilt_quizzes.json",
            "bytes": pb_bytes,
            "sha256": pb_sha,
            "count": len(prebuilt_quizzes),
        },
        "disciplines": build_ascp_tree(mappings),
        "shards": manifest_shards,
        "subsetTags": sorted(all_subset_tags),
        "parseSummary": parse_res.stats,
    }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[ETL] Wrote {len(manifest_shards)} shards, manifest.json, and {len(prebuilt_quizzes)} Pre-Built quizzes to {output_dir}")
    return manifest


def main() -> None:
    """CLI entrypoint for building Parquet and vector shards."""
    parser = argparse.ArgumentParser(description="Build MLS OER Parquet and int8 vector shards.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR, help="Path to _D2L_Exit_Exam directory.")
    parser.add_argument("--mappings-dir", type=Path, default=None, help="Directory with *_guideline_mapping.md files.")
    parser.add_argument("--output-dir", type=Path, default=Path("./local_data"), help="Output directory for shards.")
    parser.add_argument("--topics", nargs="*", default=None, help="Optional topic codes to filter (e.g. BB_01 CH_01).")
    parser.add_argument("--batch-size", type=int, default=256, help="Embedding batch size.")
    parser.add_argument("--similarity-threshold", type=float, default=0.90, help="Cosine threshold for similar_ids.")
    parser.add_argument("--max-rows-per-shard", type=int, default=50000, help="Max rows per Parquet/vector shard.")
    args = parser.parse_args()

    mappings_dir = args.mappings_dir or args.input_dir.parent
    topics_filter = set(args.topics) if args.topics else None
    run_etl(
        input_dir=args.input_dir,
        mappings_dir=mappings_dir,
        output_dir=args.output_dir,
        topics_filter=topics_filter,
        batch_size=args.batch_size,
        similarity_threshold=args.similarity_threshold,
        max_rows_per_shard=args.max_rows_per_shard,
    )


if __name__ == "__main__":
    main()

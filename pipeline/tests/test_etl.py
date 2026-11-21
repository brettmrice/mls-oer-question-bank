"""Automated tests for ASCP mappings, markdown ETL parsing, shard building, int8 recall, and local.py."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import pytest
import torch
from sentence_transformers import SentenceTransformer

from local import create_data_server, verify_local_data_server
from pipeline.build_shards import (
    DEFAULT_INPUT_DIR,
    EMBEDDING_DIM,
    EMBEDDING_MODEL_ID,
    run_etl,
    sha256_file,
)
from pipeline.parse_mappings import load_guideline_mappings, resolve_ascp_metadata
from pipeline.parse_md import compute_content_hash, parse_all_markdown

MAPPINGS_DIR = DEFAULT_INPUT_DIR.parent

pytestmark = pytest.mark.skipif(
    not DEFAULT_INPUT_DIR.exists(),
    reason="Local MLS OER source corpus not present in this environment.",
)


def test_parse_mappings_all_eight() -> None:
    mappings = load_guideline_mappings(MAPPINGS_DIR)
    expected_discs = {"BB", "CH", "HE", "IM", "LO", "MB", "MI", "UA", "BF"}
    assert set(mappings.disciplines.keys()) == expected_discs
    for code in expected_discs:
        info = mappings.disciplines[code]
        assert "MLS" in info.weights
        assert "MLT" in info.weights
        assert info.total_mapped_topics > 0

    assert mappings.disciplines["UA"].weights["MLS"].min_pct == 2.0
    assert mappings.disciplines["UA"].weights["MLS"].max_pct == 5.0
    assert mappings.disciplines["UA"].weights["MLT"].raw_value == "2–5%"
    assert mappings.disciplines["BF"].weights["MLS"].min_pct == 3.0
    assert mappings.disciplines["BF"].weights["MLS"].max_pct == 5.0
    assert mappings.disciplines["BF"].weights["MLT"].raw_value == "3–5%"

    tax_code, subtopic, leaf, ascp_path = resolve_ascp_metadata(
        mappings=mappings,
        source_line=(
            "UABF_01-A-00-a_Color-Clarity_Actual_Covered_Audit.md | "
            "ASCP: Clinical Laboratory Science > Clinical Laboratory Science Category 01 > UABF_01-A-00-a"
        ),
        discipline_code="UA",
        fallback_topic_name="Urinalysis",
        fallback_leaf="Color Clarity",
    )
    assert tax_code == "UA_01-A-00-a"
    assert subtopic == "Physical Examination"
    assert leaf == "Color Clarity"
    assert ascp_path == "Urinalysis > Urinalysis > Physical Examination > Color Clarity"

    bf_tax, bf_sub, bf_leaf, bf_path = resolve_ascp_metadata(
        mappings=mappings,
        source_line="UABF_02-A-00-a_Physiology_Actual_Covered_Audit.md",
        discipline_code="BF",
        fallback_topic_name="Body Fluids",
        fallback_leaf="Physiology",
    )
    assert bf_tax == "BF_02-A-00-a"
    assert bf_sub == "Cerebrospinal Fluid (CSF)"
    assert bf_leaf == "Physiology"
    assert bf_path == "Body Fluids > Body Fluids > Cerebrospinal Fluid (CSF) > Physiology"


def test_parse_md_splits_uabf_to_ua_and_bf(tmp_path: Path) -> None:
    mappings = load_guideline_mappings(MAPPINGS_DIR)
    corpus = tmp_path / "corpus"
    (corpus / "UABF" / "UABF_01").mkdir(parents=True)
    (corpus / "UABF" / "UABF_02").mkdir(parents=True)

    ua_md = """# UABF_01 (Urinalysis)
> **Topic**: `UABF_01` (Urinalysis)
> **Cognitive Level**: Remember (`RE`)

**Question 1**
**Question Type:** `MC`
**Bloom's Taxonomy Level:** Remember
**Topic:** Color Clarity
**Question Text:** What causes amber urine?
**Options:**
A) Bilirubin
B) Glucose
**Feedback:**
A) Correct! Bilirubin darkens urine.
B) Incorrect.
**Difficulty Level:** 3
**Source:** UABF_01-A-00-a_Color-Clarity_Actual_Covered_Audit.md
"""
    bf_md = """# UABF_02 (Body Fluids)
> **Topic**: `UABF_02` (Body Fluids)
> **Cognitive Level**: Apply (`AP`)

**Question 1**
**Question Type:** `MC`
**Bloom's Taxonomy Level:** Apply
**Topic:** Physiology
**Question Text:** Where is CSF produced?
**Options:**
A) Choroid plexus
B) Renal cortex
**Feedback:**
A) Correct! Produced in the choroid plexus.
B) Incorrect.
**Difficulty Level:** 4
**Source:** UABF_02-A-00-a_Physiology_Actual_Covered_Audit.md
"""
    (corpus / "UABF" / "UABF_01" / "UABF_01-Urinalysis_MC_RE.md").write_text(ua_md, encoding="utf-8")
    (corpus / "UABF" / "UABF_02" / "UABF_02-Body-Fluids_MC_AP.md").write_text(bf_md, encoding="utf-8")

    res = parse_all_markdown(corpus, mappings)
    by_topic = {r.topic_code: r for r in res.records}
    assert set(by_topic.keys()) == {"UA_01", "BF_02"}
    assert by_topic["UA_01"].discipline_code == "UA"
    assert by_topic["UA_01"].discipline_name == "Urinalysis"
    assert by_topic["UA_01"].taxonomic_code == "UA_01-A-00-a"
    assert by_topic["UA_01"].display_id == "UA_01-RE-0001"
    assert by_topic["BF_02"].discipline_code == "BF"
    assert by_topic["BF_02"].discipline_name == "Body Fluids"
    assert by_topic["BF_02"].taxonomic_code == "BF_02-A-00-a"
    assert by_topic["BF_02"].display_id == "BF_02-AP-0001"


def test_parse_md_self_corrected_and_dedup(tmp_path: Path) -> None:
    mappings = load_guideline_mappings(MAPPINGS_DIR)
    corpus = tmp_path / "corpus"
    (corpus / "BB" / "BB_01").mkdir(parents=True)
    (corpus / "A1_EE-A1" / "BB" / "md").mkdir(parents=True)

    # Core file includes a self-corrected block (duplicate Feedback), a period-style Correct.,
    # and a block with "Correct choice is D." non-key distractors.
    core_md = """# BB_01-Blood-Products - Analyze (AN) Assessment Pool (3 Questions)
> **Discipline**: Blood Banking (`BB`)
> **Topic**: `BB_01` Blood Products
> **Cognitive Level**: Bloom's Taxonomy Level: Analyze

---

**Question 1**
**Question Type:** Multiple Choice (`MC`)
**Bloom's Taxonomy Level:** Analyze
**Assessment Objective:** Identify CPDA-1 storage limit.
**Topic:** CPDA-1 Expiration
**Question Text:** What is the shelf life of CPDA-1 RBCs?

**Options:**
A) 21 days
B) 35 days
C) 42 days
D) 50 days

**Feedback:**
A) Correct: Wrong draft key.
B) Correct: Also marked right in draft.
C) Incorrect: Additive solution limit.
D) Incorrect: Too long.

*(Correction in draft note: Exactly one key correct: Option B)*

**Feedback:**
A) Incorrect: ACD/CPD limit.
B) Correct: CPDA-1 preserves RBCs for 35 days.
C) Incorrect: Additive solution limit.
D) Incorrect: Exceeds standard shelf life.

**Hint:** Adenine extends storage to 35 days.
**Difficulty Level:** 2
**Difficulty Rational:** Recall of regulatory shelf life.
**Source:** BB_01-C-05_Expiration_Actual_Covered_Audit.md | ASCP: Blood Banking > Blood Products > Expiration

---

**Question 2**
**Question Type:** Analyze
**Bloom's Taxonomy Level:** Analyze
**Assessment Objective:** Verify bracket and period feedback formats.
**Topic:** Compatibility
**Question Text:** Which antibody binds complement efficiently?

**Options:**
A) Anti-IgM
B) Anti-Jk(a)
C) Anti-A1
D) Anti-Fy(a)

**Feedback:**
A) Correct choice is B. Not an alloantibody.
B) [Correct]. Anti-Jk(a) classically fixes complement.
C) Incorrect. Often cold-reactive.
D) Incorrect. Variable reactivity.

**Hint:** Think Kidd system.
**Difficulty Level:** 6
**Difficulty Rationale:** Antibody characterization.
**Source:** BB_02-B-01_Kidd_Actual_Covered_Audit.md | ASCP: Blood Banking > Blood Group Systems > Kidd
"""
    (corpus / "BB" / "BB_01" / "BB_01-Blood-Products_MC_AN.md").write_text(core_md, encoding="utf-8")

    subset_md = """# A1_EE-A1 | Question Slot 001 - BB_01-Blood-Products (AN)
> **Assessment**: `A1_EE-A1`
> **Slot Position**: `Q001` (Discipline: `BB`)
> **Topic**: `BB_01` (BB_01-Blood-Products)
> **Cognitive Tier**: Bloom's Taxonomy Level: Analyze

---

**Variant 1 (Candidate Question)**
**Question Type:** Multiple Choice (`MC`)
**Bloom's Taxonomy Level:** Analyze
**Assessment Objective:** Identify CPDA-1 storage limit.
**Topic:** CPDA-1 Expiration
**Question Text:** What is the   shelf life of CPDA-1 RBCs?

**Options:**
D) 50 days
B) 35 days
A) 21 days
C) 42 days

**Feedback:**
A) Incorrect: ACD/CPD limit.
B) Correct: CPDA-1 preserves RBCs for 35 days.
C) Incorrect: Additive solution limit.
D) Incorrect: Exceeds standard shelf life.

**Hint:** Adenine extends storage to 35 days.
**Difficulty Level:** 2
**Difficulty Rational:** Recall of regulatory shelf life.
**Source:** BB_01-C-05_Expiration_Actual_Covered_Audit.md | ASCP: Blood Banking > Blood Products > Expiration
"""
    (corpus / "A1_EE-A1" / "BB" / "md" / "Q001_BB_01-Blood-Products_AN_Set.md").write_text(
        subset_md, encoding="utf-8"
    )

    res = parse_all_markdown(corpus, mappings)
    assert res.stats["warnings_count"] == 0
    assert res.stats["unique_questions"] == 2
    assert res.stats["duplicates_merged"] == 1

    rec1 = next(r for r in res.records if "CPDA-1" in r.question_text)
    expected_hash = compute_content_hash(
        "What is the shelf life of CPDA-1 RBCs?",
        ["21 days", "35 days", "42 days", "50 days"],
    )
    assert rec1.id == f"q_{expected_hash[:12]}"
    assert rec1.display_id == "BB_01-AN-0001"
    assert json.loads(rec1.subset_tags_json) == ["Core_Pool", "A1_EE-A1"]
    opts1 = json.loads(rec1.options_json)
    assert [o["label"] for o in opts1 if o["weight"] == 100] == ["B"]

    rec2 = next(r for r in res.records if "complement" in r.question_text)
    assert rec2.question_type == "MC"
    opts2 = json.loads(rec2.options_json)
    assert [o["label"] for o in opts2 if o["weight"] == 100] == ["B"]
    assert res.subset_memberships["A1_EE-A1"] == [rec1.id]


def test_full_corpus_parse_zero_crashes() -> None:
    mappings = load_guideline_mappings(MAPPINGS_DIR)
    res = parse_all_markdown(DEFAULT_INPUT_DIR, mappings)

    assert res.stats["files_scanned"] >= 1640
    assert res.stats["unique_questions"] > 50000
    assert res.stats["duplicates_merged"] > 20000
    # Fewer than 0.5% malformed blocks in raw source drafts
    assert res.stats["warnings_count"] / max(1, res.stats["raw_blocks_seen"]) < 0.005

    seen_ids = set()
    seen_norm_keys = set()
    for rec in res.records:
        assert rec.id.startswith("q_") and len(rec.id) == 14
        assert rec.id not in seen_ids
        seen_ids.add(rec.id)
        opts = json.loads(rec.options_json)
        norm_key = compute_content_hash(rec.question_text, [o["text"] for o in opts])
        assert norm_key not in seen_norm_keys
        seen_norm_keys.add(norm_key)

    for subset_idx in range(10):
        assert any(k.startswith(f"A{subset_idx}_") for k in res.subset_memberships)


def test_build_shards_sample_and_int8_recall(tmp_path: Path) -> None:
    out_dir = tmp_path / "sample_data"
    manifest = run_etl(
        input_dir=DEFAULT_INPUT_DIR,
        mappings_dir=MAPPINGS_DIR,
        output_dir=out_dir,
        topics_filter={"BB_01", "CH_01"},
        batch_size=256,
        similarity_threshold=0.90,
    )

    assert [s["shardId"] for s in manifest["shards"]] == ["BB_01", "CH_01"]
    assert manifest["totalQuestions"] > 1500
    assert manifest["questionsWithSiblings"] > 0

    required_cols = {
        "id",
        "display_id",
        "discipline_code",
        "topic_code",
        "taxonomic_code",
        "ascp_subtopic",
        "leaf_topic",
        "ascp_path",
        "subset_tags_json",
        "bloom_level",
        "difficulty",
        "question_type",
        "objective",
        "question_text",
        "options_json",
        "hint",
        "similar_ids_json",
        "source_files_json",
    }

    all_ids: set[str] = set()
    rows_by_id: dict[str, dict] = {}
    vec_map: dict[str, np.ndarray] = {}

    for shard_meta in manifest["shards"]:
        pq_path = out_dir / shard_meta["parquet"]["path"]
        vec_path = out_dir / shard_meta["vectors"]["path"]
        ids_path = out_dir / shard_meta["ids"]["path"]

        assert sha256_file(pq_path) == (shard_meta["parquet"]["bytes"], shard_meta["parquet"]["sha256"])
        assert sha256_file(vec_path) == (shard_meta["vectors"]["bytes"], shard_meta["vectors"]["sha256"])
        assert sha256_file(ids_path) == (shard_meta["ids"]["bytes"], shard_meta["ids"]["sha256"])

        table = pq.read_table(pq_path)
        assert required_cols.issubset(set(table.column_names))
        rows = table.to_pylist()
        assert len(rows) == shard_meta["questionCount"]

        # Verify Parquet rows are sorted by (bloom_level, difficulty, leaf_topic, id)
        sort_keys = [(r["bloom_level"], r["difficulty"], r["leaf_topic"], r["id"]) for r in rows]
        assert sort_keys == sorted(sort_keys)

        shard_ids = json.loads(ids_path.read_text(encoding="utf-8"))
        assert shard_ids == [r["id"] for r in rows]

        int8_mat = np.frombuffer(vec_path.read_bytes(), dtype=np.int8).reshape(len(rows), EMBEDDING_DIM)
        for row, qvec in zip(rows, int8_mat, strict=True):
            all_ids.add(row["id"])
            rows_by_id[row["id"]] = row
            vec_map[row["id"]] = qvec.astype(np.float32) / 127.0

    # Verify centroids binary
    centroids_path = out_dir / manifest["centroids"]["path"]
    assert sha256_file(centroids_path) == (manifest["centroids"]["bytes"], manifest["centroids"]["sha256"])
    centroids = np.frombuffer(centroids_path.read_bytes(), dtype=np.float32).reshape(2, EMBEDDING_DIM)
    centroid_norms = np.linalg.norm(centroids, axis=1)
    assert np.allclose(centroid_norms, 1.0, atol=1e-4)

    # Verify prebuilt_quizzes.json references only valid UIDs in built shards
    prebuilt = json.loads((out_dir / "prebuilt_quizzes.json").read_text(encoding="utf-8"))
    assert len(prebuilt) > 0
    for qz in prebuilt:
        assert len(qz["questionIds"]) == qz["questionCount"] > 0
        assert all(qid in all_ids for qid in qz["questionIds"])

    # Verify similar_ids reference valid UIDs with cosine > 0.90 (using dequantized vectors ~0.90 tolerance)
    checked_siblings = 0
    for r in rows_by_id.values():
        sims = json.loads(r["similar_ids_json"])
        if sims:
            v_self = vec_map[r["id"]]
            for sib in sims:
                assert sib in all_ids and sib != r["id"]
                cos = float(np.dot(v_self, vec_map[sib]))
                assert cos > 0.88
            checked_siblings += 1
            if checked_siblings >= 25:
                break
    assert checked_siblings > 0

    # Measure int8 top-10 recall vs float32 across 100 sampled queries on BB_01
    bb_rows = pq.read_table(out_dir / "topics" / "BB_01.parquet").to_pylist()
    bb_int8 = (
        np.frombuffer((out_dir / "vectors" / "BB_01.vec.bin").read_bytes(), dtype=np.int8)
        .reshape(len(bb_rows), EMBEDDING_DIM)
        .astype(np.float32)
        / 127.0
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(EMBEDDING_MODEL_ID, device=device)

    doc_texts = []
    for r in bb_rows:
        opts = json.loads(r["options_json"])
        ans = next((o["text"] for o in opts if o["weight"] == 100), "")
        doc_texts.append(f"{r['ascp_path']} | Objective: {r['objective']} | Question: {r['question_text']} | Answer: {ans}")

    bb_f32 = model.encode(doc_texts, batch_size=256, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)

    rng = np.random.default_rng(42)
    sample_idx = rng.choice(len(bb_rows), size=min(100, len(bb_rows)), replace=False)
    queries = [
        f"Represent this sentence for searching relevant passages: {bb_rows[i]['question_text']}"
        for i in sample_idx
    ]
    q_vecs = model.encode(queries, batch_size=64, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)

    recalls: list[float] = []
    for q_vec in q_vecs:
        scores_f32 = bb_f32 @ q_vec
        scores_i8 = bb_int8 @ q_vec
        top10_f32 = set(np.argsort(-scores_f32)[:10].tolist())
        top10_i8 = set(np.argsort(-scores_i8)[:10].tolist())
        recalls.append(len(top10_f32 & top10_i8) / 10.0)

    mean_recall = float(np.mean(recalls))
    print(f"[TEST] Measured int8 top-10 recall vs float32 over 100 queries: {mean_recall:.4f}")
    assert mean_recall >= 0.95


def test_local_server_range_cors_and_throttle(tmp_path: Path) -> None:
    data_dir = tmp_path / "sample_data"
    run_etl(
        input_dir=DEFAULT_INPUT_DIR,
        mappings_dir=MAPPINGS_DIR,
        output_dir=data_dir,
        topics_filter={"BB_01"},
        batch_size=256,
    )

    assert verify_local_data_server(data_dir)

    server = create_data_server(data_dir, host="127.0.0.1", port=0, throttle_mbps=20.0, quiet=True)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{port}"

    try:
        # Test 206 partial content on vectors file
        vec_file = data_dir / "vectors" / "BB_01.vec.bin"
        expected = vec_file.read_bytes()
        req = urllib.request.Request(
            f"{base_url}/vectors/BB_01.vec.bin",
            headers={"Range": "bytes=100-599"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            assert resp.status == 206
            assert resp.headers.get("Access-Control-Allow-Origin") == "*"
            assert resp.headers.get("Content-Range") == f"bytes 100-599/{len(expected)}"
            assert resp.read() == expected[100:600]

        # Test 416 on out-of-bounds range
        bad_req = urllib.request.Request(
            f"{base_url}/vectors/BB_01.vec.bin",
            headers={"Range": f"bytes={len(expected) + 100}-"},
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(bad_req, timeout=10)
        assert exc_info.value.code == 416

        # Test throttled full download preserves exact byte integrity
        with urllib.request.urlopen(f"{base_url}/vectors/BB_01.vec.bin", timeout=15) as resp:
            assert resp.status == 200
            assert resp.read() == expected
    finally:
        server.shutdown()
        server.server_close()


def test_validate_prebuilt_issue_submission(tmp_path: Path) -> None:
    from pipeline.validate_prebuilt import (
        PrebuiltValidationError,
        apply_prebuilt_entry_to_data_dir,
        extract_json_payload_from_markdown,
        load_question_index_from_data_dir,
        validate_prebuilt_submission,
    )

    data_dir = tmp_path / "prebuilt_data"
    run_etl(
        input_dir=DEFAULT_INPUT_DIR,
        mappings_dir=MAPPINGS_DIR,
        output_dir=data_dir,
        topics_filter={"BB_01"},
        batch_size=256,
    )

    index = load_question_index_from_data_dir(data_dir)
    sample_uids = list(index.keys())[:4]

    issue_md = f"""
### Community Pre-Built Quiz Submission (CC0 1.0)

- **Title:** Donor Deferral Essentials
- **Author / Institution:** Prof. Smith (Augusta University)

```json
{{
  "title": "Donor Deferral Essentials",
  "description": "4 high-yield BB_01 items.",
  "author": "Prof. Smith",
  "institution": "Augusta University",
  "tags": ["donor", "bb01"],
  "questionIds": {json.dumps(sample_uids)},
  "license": "CC0-1.0"
}}
```
"""
    payload = extract_json_payload_from_markdown(issue_md)
    entry = validate_prebuilt_submission(payload, index, quiz_id="community_issue_55")
    assert entry["id"] == "community_issue_55"
    assert entry["questionCount"] == 4
    assert entry["disciplineCounts"] == {"BB": 4}

    apply_prebuilt_entry_to_data_dir(data_dir, entry)
    updated_manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    updated_prebuilt = json.loads((data_dir / "prebuilt_quizzes.json").read_text(encoding="utf-8"))
    assert any(item["id"] == "community_issue_55" for item in updated_prebuilt)
    assert updated_manifest["prebuiltCatalog"]["count"] == len(updated_prebuilt)

    with pytest.raises(PrebuiltValidationError, match="Unknown question UID"):
        validate_prebuilt_submission(
            {"title": "Bad Quiz", "questionIds": ["q_doesnotexist00"], "license": "CC0-1.0"},
            index,
        )

    with pytest.raises(PrebuiltValidationError, match="CC0-1.0"):
        validate_prebuilt_submission(
            {"title": "Proprietary Quiz", "questionIds": sample_uids, "license": "MIT"},
            index,
        )


def test_publish_data_to_orphan_branch(tmp_path: Path) -> None:
    import shutil
    import subprocess
    import sys

    from local import ROOT_DIR, publish_data_to_orphan_branch

    git_exe = shutil.which("git")
    assert git_exe is not None, "git must be installed on PATH for publish tests"

    data_dir = tmp_path / "publish_data"
    run_etl(
        input_dir=DEFAULT_INPUT_DIR,
        mappings_dir=MAPPINGS_DIR,
        output_dir=data_dir,
        topics_filter={"BB_01"},
        batch_size=256,
    )

    bare_repo = tmp_path / "data_remote.git"
    subprocess.run([git_exe, "init", "--bare", str(bare_repo)], check=True)

    # First publish + second publish must replace history with a single orphan commit
    publish_data_to_orphan_branch(
        data_dir,
        repo_url=str(bare_repo),
        branch="gh-pages",
        commit_message="Initial publish",
    )
    publish_data_to_orphan_branch(
        data_dir,
        repo_url=str(bare_repo),
        branch="gh-pages",
        commit_message="Second publish",
    )

    count_res = subprocess.run(
        [git_exe, "--git-dir", str(bare_repo), "rev-list", "--count", "gh-pages"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert count_res.stdout.strip() == "1"

    clone_dir = tmp_path / "cloned_gh_pages"
    subprocess.run(
        [git_exe, "clone", "--branch", "gh-pages", str(bare_repo), str(clone_dir)],
        check=True,
    )
    assert (clone_dir / ".nojekyll").is_file()
    for rel in (
        "manifest.json",
        "prebuilt_quizzes.json",
        "topics/BB_01.parquet",
        "vectors/BB_01.vec.bin",
    ):
        assert (clone_dir / rel).read_bytes() == (data_dir / rel).read_bytes()

    # CLI guardrail: --sample + --publish without --allow-sample-publish exits with code 2 before ETL
    guard_res = subprocess.run(
        [
            sys.executable,
            "local.py",
            "--sample",
            "--publish",
            "--publish-repo",
            str(bare_repo),
            "--data-dir",
            str(tmp_path / "unused_sample_out"),
        ],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
    )
    assert guard_res.returncode == 2
    assert "--allow-sample-publish" in guard_res.stderr
    assert not (tmp_path / "unused_sample_out").exists()

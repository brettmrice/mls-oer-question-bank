# MLS Open Educational Resource (OER) Question Bank

A \$0-cost, 100% static Open Educational Resource (OER) web application and ETL pipeline for Medical Laboratory Science (MLS) educators, licensed under **CC0 1.0 Universal**.

## Architecture Overview

- **ETL Pipeline (`pipeline/`)**: Parses ASCP BOC guideline mappings (`*_guideline_mapping.md`) and all Markdown assessment pools, deduplicates strictly by normalized stem + sorted options into immutable content-addressed UIDs (`q_<12-char sha256>`), builds ZSTD-compressed Parquet shards (`topics/*.parquet`), embeds with `BAAI/bge-small-en-v1.5`, precomputes top-5 nearest neighbors (`similar_ids`), quantizes vectors to `int8` (`vectors/*.vec.bin`), builds `topic_centroids.bin`, and writes `manifest.json` + `prebuilt_quizzes.json`.
- **Local Testing Harness (`local.py`)**: Runs sample or full ETL into `./local_data/`, serves shards over an HTTP `206 Partial Content` + CORS server (with optional `--throttle-mbps` simulation), and launches the Vite SPA when present.
- **Static SPA (`src/`, upcoming phases)**: DuckDB-WASM over remote Parquet shards, consent-gated multi-shard hybrid semantic + BM25 search, Dexie.js multi-quiz workspace with ASCP blueprint balance meters, dual-mode Pre-Built quiz sharing (Educator Remix & Student Self-Practice), LMS/Word exports, and GitHub-backed collaboration.

## Quickstart (Phase 1 ETL & Local Testing)

Run a fast 2-topic sample build (`BB_01` and `CH_01`) and automated HTTP `206` Range / CORS / SHA-256 verification:

```bash
pipeline/.venv/Scripts/python.exe local.py --sample --check
```

Run the full ETL across all disciplines and subsets and serve `./local_data/` locally:

```bash
pipeline/.venv/Scripts/python.exe local.py --full --data-only
```

Run automated ETL tests:

```bash
pipeline/.venv/Scripts/python.exe -m pytest pipeline/tests/test_etl.py -v
```

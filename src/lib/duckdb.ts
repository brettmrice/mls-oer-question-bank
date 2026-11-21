import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

import { getAssetUrl } from '@/config/dataSource';
import {
  buildFacetQuery,
  buildQuestionQuery,
  buildSemanticCandidateQueries,
  escapeSqlString,
  formatParquetSource,
  selectTargetShards,
} from '@/lib/queryBuilder';
import type {
  FilterState,
  ManifestData,
  QuestionOption,
  QuestionRecord,
  ShardManifest,
  SubtopicFacet,
} from '@/types/question';

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdb_wasm,
    mainWorker: mvp_worker,
  },
  eh: {
    mainModule: duckdb_wasm_eh,
    mainWorker: eh_worker,
  },
};

let dbInitPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection }> | null = null;
const registeredShards = new Set<string>();

export async function getDuckDB(): Promise<{
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
}> {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.VoidLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      return { db, conn };
    })();
  }
  return dbInitPromise;
}

export async function ensureShardsRegistered(
  db: duckdb.AsyncDuckDB,
  shards: ShardManifest[],
): Promise<void> {
  for (const shard of shards) {
    const key = shard.parquet.path;
    if (registeredShards.has(key)) continue;
    await db.registerFileURL(
      key,
      getAssetUrl(key),
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    );
    registeredShards.add(key);
  }
}

function safeParseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function mapRowToQuestion(row: Record<string, unknown>): QuestionRecord {
  return {
    id: String(row.id ?? ''),
    displayId: String(row.display_id ?? ''),
    disciplineCode: String(row.discipline_code ?? ''),
    disciplineName: String(row.discipline_name ?? ''),
    topicCode: String(row.topic_code ?? ''),
    topicName: String(row.topic_name ?? ''),
    taxonomicCode: String(row.taxonomic_code ?? ''),
    ascpSubtopic: String(row.ascp_subtopic ?? ''),
    leafTopic: String(row.leaf_topic ?? ''),
    ascpPath: String(row.ascp_path ?? ''),
    subsetTags: safeParseJsonArray<string>(row.subset_tags_json),
    bloomLevel: String(row.bloom_level ?? ''),
    difficulty: Number(row.difficulty ?? 5),
    difficultyRationale: String(row.difficulty_rationale ?? ''),
    questionType: String(row.question_type ?? 'MC'),
    objective: String(row.objective ?? ''),
    questionText: String(row.question_text ?? ''),
    options: safeParseJsonArray<QuestionOption>(row.options_json),
    hint: String(row.hint ?? ''),
    similarIds: safeParseJsonArray<string>(row.similar_ids_json),
    sourceFiles: safeParseJsonArray<string>(row.source_files_json),
  };
}

export async function queryQuestions(
  manifest: ManifestData,
  filters: FilterState,
): Promise<{ total: number; items: QuestionRecord[]; shardsQueried: number; elapsedMs: number }> {
  const start = performance.now();
  const targetShards = selectTargetShards(manifest, filters);
  if (targetShards.length === 0) {
    return { total: 0, items: [], shardsQueried: 0, elapsedMs: 0 };
  }

  const { db, conn } = await getDuckDB();
  await ensureShardsRegistered(db, targetShards);

  const parquetPaths = targetShards.map((s) => s.parquet.path);
  const { countSql, rowsSql } = buildQuestionQuery(parquetPaths, filters);

  const countTable = await conn.query(countSql);
  const countRow = countTable.toArray()[0]?.toJSON() as Record<string, unknown> | undefined;
  const total = Number(countRow?.total ?? 0);

  if (total === 0) {
    return {
      total: 0,
      items: [],
      shardsQueried: targetShards.length,
      elapsedMs: Math.round(performance.now() - start),
    };
  }

  const rowsTable = await conn.query(rowsSql);
  const items = rowsTable
    .toArray()
    .map((r) => mapRowToQuestion(r.toJSON() as Record<string, unknown>));

  return {
    total,
    items,
    shardsQueried: targetShards.length,
    elapsedMs: Math.round(performance.now() - start),
  };
}

export async function querySubtopicFacets(
  manifest: ManifestData,
  filters: FilterState,
): Promise<SubtopicFacet[]> {
  if (filters.disciplines.length === 0 && filters.topicCodes.length === 0) {
    return [];
  }
  const targetShards = selectTargetShards(manifest, filters);
  if (targetShards.length === 0) {
    return [];
  }

  const { db, conn } = await getDuckDB();
  await ensureShardsRegistered(db, targetShards);

  const sql = buildFacetQuery(
    targetShards.map((s) => s.parquet.path),
    filters,
  );
  const table = await conn.query(sql);
  return table.toArray().map((r) => {
    const obj = r.toJSON() as Record<string, unknown>;
    return {
      ascpSubtopic: String(obj.ascp_subtopic ?? ''),
      leafTopic: String(obj.leaf_topic ?? ''),
      count: Number(obj.cnt ?? 0),
    };
  });
}

export async function fetchQuestionsByIds(
  manifest: ManifestData,
  ids: string[],
  candidateShards?: ShardManifest[],
): Promise<QuestionRecord[]> {
  if (ids.length === 0) return [];
  const { db, conn } = await getDuckDB();

  const searchShards =
    candidateShards && candidateShards.length > 0 ? candidateShards : manifest.shards;

  const queryBatch = async (shards: ShardManifest[], remainingIds: string[]): Promise<QuestionRecord[]> => {
    if (shards.length === 0 || remainingIds.length === 0) return [];
    await ensureShardsRegistered(db, shards);
    const source = formatParquetSource(shards.map((s) => s.parquet.path));
    const inList = remainingIds.map((id) => `'${escapeSqlString(id)}'`).join(', ');
    const sql = `
      SELECT
        id, display_id, discipline_code, discipline_name, topic_code, topic_name,
        taxonomic_code, ascp_subtopic, leaf_topic, ascp_path, subset_tags_json,
        bloom_level, difficulty, difficulty_rationale, question_type, objective,
        question_text, options_json, hint, similar_ids_json, source_files_json
      FROM ${source}
      WHERE id IN (${inList})
    `.trim();
    const res = await conn.query(sql);
    return res.toArray().map((r) => mapRowToQuestion(r.toJSON() as Record<string, unknown>));
  };

  const found = await queryBatch(searchShards, ids);
  const foundMap = new Map(found.map((q) => [q.id, q]));

  // If any requested sibling IDs live in another topic shard, scan remaining shards
  const missingIds = ids.filter((id) => !foundMap.has(id));
  if (missingIds.length > 0 && candidateShards && candidateShards.length < manifest.shards.length) {
    const searchedSet = new Set(searchShards.map((s) => s.shardId));
    const restShards = manifest.shards.filter((s) => !searchedSet.has(s.shardId));
    const extra = await queryBatch(restShards, missingIds);
    for (const q of extra) {
      foundMap.set(q.id, q);
    }
  }

  return ids.map((id) => foundMap.get(id)).filter((q): q is QuestionRecord => q !== undefined);
}

export async function querySemanticCandidates(
  manifest: ManifestData,
  activeShardIds: string[],
  filters: FilterState,
  denseTopIds: string[],
  clinicalTokens: string[],
): Promise<QuestionRecord[]> {
  if (activeShardIds.length === 0) return [];
  const activeSet = new Set(activeShardIds);
  const shards = manifest.shards.filter((s) => activeSet.has(s.shardId));
  if (shards.length === 0) return [];

  const { db, conn } = await getDuckDB();
  await ensureShardsRegistered(db, shards);

  const { denseSql, keywordSql } = buildSemanticCandidateQueries(
    shards.map((s) => s.parquet.path),
    filters,
    denseTopIds,
    clinicalTokens,
    150,
  );

  const byId = new Map<string, QuestionRecord>();
  if (denseSql) {
    const denseTable = await conn.query(denseSql);
    for (const r of denseTable.toArray()) {
      const q = mapRowToQuestion(r.toJSON() as Record<string, unknown>);
      byId.set(q.id, q);
    }
  }
  if (keywordSql) {
    const kwTable = await conn.query(keywordSql);
    for (const r of kwTable.toArray()) {
      const q = mapRowToQuestion(r.toJSON() as Record<string, unknown>);
      if (!byId.has(q.id)) {
        byId.set(q.id, q);
      }
    }
  }

  return Array.from(byId.values());
}

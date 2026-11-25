import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

import { getRemixedQuestionsByIds } from '@/lib/remixStore';
import { loadOrFetchParquetShard } from '@/lib/shardCache';
import {
  buildAscpPathFacetQuery,
  buildBloomFacetQuery,
  buildFacetQuery,
  buildOrderByClause,
  buildQuestionsByIdsQuery,
  buildSemanticCandidateQueries,
  buildVariantIndexQuery,
  buildWhereClause,
  escapeSqlString,
  formatParquetSource,
  selectTargetShards,
} from '@/lib/queryBuilder';
import {
  buildQuestionRanges,
  groupVariantItemsWithCounts,
  type QuestionRange,
} from '@/lib/variantGrouping';
import type {
  AscpPathFacet,
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
const inFlightRegistrations = new Map<string, Promise<void>>();

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
  const pending: Promise<void>[] = [];
  for (const shard of shards) {
    const key = shard.parquet.path;
    if (registeredShards.has(key)) continue;

    let regPromise = inFlightRegistrations.get(key);
    if (!regPromise) {
      regPromise = (async () => {
        const buffer = await loadOrFetchParquetShard(shard);
        await db.registerFileBuffer(key, buffer);
        registeredShards.add(key);
      })().finally(() => {
        inFlightRegistrations.delete(key);
      });
      inFlightRegistrations.set(key, regPromise);
    }
    pending.push(regPromise);
  }
  if (pending.length > 0) {
    await Promise.all(pending);
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

interface CachedVariantGroupIndex {
  representativeIds: string[];
  groupCounts: number[];
  rawTotal: number;
}

const MAX_VARIANT_INDEX_CACHE_ENTRIES = 12;
const variantGroupIndexCache = new Map<string, CachedVariantGroupIndex>();

function getCachedVariantGroupIndex(cacheKey: string): CachedVariantGroupIndex | undefined {
  const cached = variantGroupIndexCache.get(cacheKey);
  if (!cached) return undefined;
  variantGroupIndexCache.delete(cacheKey);
  variantGroupIndexCache.set(cacheKey, cached);
  return cached;
}

function setCachedVariantGroupIndex(cacheKey: string, entry: CachedVariantGroupIndex): void {
  if (variantGroupIndexCache.has(cacheKey)) {
    variantGroupIndexCache.delete(cacheKey);
  } else if (variantGroupIndexCache.size >= MAX_VARIANT_INDEX_CACHE_ENTRIES) {
    const oldestKey = variantGroupIndexCache.keys().next().value;
    if (oldestKey !== undefined) {
      variantGroupIndexCache.delete(oldestKey);
    }
  }
  variantGroupIndexCache.set(cacheKey, entry);
}

export async function queryQuestions(
  manifest: ManifestData,
  filters: FilterState,
): Promise<{
  total: number;
  rawTotal: number;
  items: QuestionRecord[];
  questionRanges: Record<string, QuestionRange>;
  shardsQueried: number;
  elapsedMs: number;
}> {
  const start = performance.now();
  const targetShards = selectTargetShards(manifest, filters);
  if (targetShards.length === 0) {
    return {
      total: 0,
      rawTotal: 0,
      items: [],
      questionRanges: {},
      shardsQueried: 0,
      elapsedMs: 0,
    };
  }

  const { db, conn } = await getDuckDB();
  await ensureShardsRegistered(db, targetShards);

  const parquetPaths = targetShards.map((s) => s.parquet.path);
  const cacheKey = JSON.stringify({
    parquetPaths,
    where: buildWhereClause(filters),
    orderBy: buildOrderByClause(filters.sortBy),
  });

  let cachedIndex = getCachedVariantGroupIndex(cacheKey);
  if (!cachedIndex) {
    const indexSql = buildVariantIndexQuery(parquetPaths, filters);
    const indexTable = await conn.query(indexSql);
    const indexRows = indexTable.toArray().map((r) => r.toJSON() as Record<string, unknown>);

    const groupedEntries = groupVariantItemsWithCounts(
      indexRows,
      (row) => String(row.id ?? ''),
      (row) => {
        const raw = row.similar_ids_json;
        if (typeof raw !== 'string' || raw.length === 0 || raw === '[]') {
          return [];
        }
        return safeParseJsonArray<string>(raw);
      },
    );
    cachedIndex = {
      representativeIds: groupedEntries.map((entry) => String(entry.item.id ?? '')),
      groupCounts: groupedEntries.map((entry) => entry.count),
      rawTotal: indexRows.length,
    };
    setCachedVariantGroupIndex(cacheKey, cachedIndex);
  }

  const { representativeIds, groupCounts, rawTotal } = cachedIndex;
  const total = representativeIds.length;
  if (total === 0) {
    return {
      total: 0,
      rawTotal,
      items: [],
      questionRanges: {},
      shardsQueried: targetShards.length,
      elapsedMs: Math.round(performance.now() - start),
    };
  }

  const pageSize = Math.max(1, Math.min(200, Math.floor(filters.pageSize)));
  const page = Math.max(1, Math.floor(filters.page));
  const offset = (page - 1) * pageSize;
  const pageIds = representativeIds.slice(offset, offset + pageSize);

  if (pageIds.length === 0) {
    return {
      total,
      rawTotal,
      items: [],
      questionRanges: {},
      shardsQueried: targetShards.length,
      elapsedMs: Math.round(performance.now() - start),
    };
  }

  let pageStartPosition = 1;
  for (let i = 0; i < offset; i += 1) {
    pageStartPosition += groupCounts[i] ?? 1;
  }
  const pageCounts = groupCounts.slice(offset, offset + pageIds.length);
  const questionRanges = buildQuestionRanges(pageIds, pageCounts, pageStartPosition);

  const rowsSql = buildQuestionsByIdsQuery(parquetPaths, pageIds);
  const rowsTable = await conn.query(rowsSql);
  const byId = new Map<string, QuestionRecord>();
  for (const r of rowsTable.toArray()) {
    const q = mapRowToQuestion(r.toJSON() as Record<string, unknown>);
    byId.set(q.id, q);
  }
  const items = pageIds
    .map((id) => byId.get(id))
    .filter((q): q is QuestionRecord => q !== undefined);

  return {
    total,
    rawTotal,
    items,
    questionRanges,
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

export async function queryAscpPathFacets(
  shards: ShardManifest[],
  filters: FilterState,
): Promise<AscpPathFacet[]> {
  if (shards.length === 0) {
    return [];
  }
  const { db, conn } = await getDuckDB();
  await ensureShardsRegistered(db, shards);

  const sql = buildAscpPathFacetQuery(
    shards.map((s) => s.parquet.path),
    filters,
  );
  const table = await conn.query(sql);
  return table.toArray().map((r) => {
    const obj = r.toJSON() as Record<string, unknown>;
    return {
      topicCode: String(obj.topic_code ?? ''),
      ascpPath: String(obj.ascp_path ?? ''),
      count: Number(obj.cnt ?? 0),
    };
  });
}

const BLOOM_LEVEL_ORDER = ['RE', 'UN', 'AP', 'AN'] as const;

export async function queryAvailableBloomLevels(
  shards: ShardManifest[],
  filters: FilterState,
): Promise<string[]> {
  if (shards.length === 0) {
    return [];
  }
  const { db, conn } = await getDuckDB();
  await ensureShardsRegistered(db, shards);

  const sql = buildBloomFacetQuery(
    shards.map((s) => s.parquet.path),
    filters,
  );
  const table = await conn.query(sql);
  const present = new Set(
    table.toArray().map((r) => String((r.toJSON() as Record<string, unknown>).bloom_level ?? '').trim()),
  );
  return BLOOM_LEVEL_ORDER.filter((code) => present.has(code));
}

export async function fetchQuestionsByIds(
  manifest: ManifestData,
  ids: string[],
  candidateShards?: ShardManifest[],
): Promise<QuestionRecord[]> {
  if (ids.length === 0) return [];

  const localRemixes = await getRemixedQuestionsByIds(ids);
  const foundMap = new Map<string, QuestionRecord>(localRemixes.map((q) => [q.id, q]));
  const remainingFromBank = ids.filter((id) => !foundMap.has(id));
  if (remainingFromBank.length === 0) {
    return ids.map((id) => foundMap.get(id)).filter((q): q is QuestionRecord => q !== undefined);
  }

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

  const found = await queryBatch(searchShards, remainingFromBank);
  for (const q of found) {
    foundMap.set(q.id, q);
  }

  // If any requested sibling IDs live in another topic shard, scan remaining shards
  const missingIds = remainingFromBank.filter((id) => !foundMap.has(id));
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

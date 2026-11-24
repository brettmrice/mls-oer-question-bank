import { describe, expect, it } from 'vitest';
import {
  buildAscpPathFacetQuery,
  buildBloomFacetQuery,
  buildFacetQuery,
  buildOrderByClause,
  buildQuestionQuery,
  buildQuestionsByIdsQuery,
  buildSemanticCandidateQueries,
  buildVariantIndexQuery,
  buildWhereClause,
  escapeSqlString,
  formatParquetSource,
  selectTargetShards,
} from '@/lib/queryBuilder';
import { DEFAULT_FILTERS, type ManifestData } from '@/types/question';

const MOCK_MANIFEST: ManifestData = {
  version: '1.0.0',
  generatedAt: '2026-11-21T00:00:00Z',
  license: 'CC0-1.0',
  totalQuestions: 300,
  questionsWithSiblings: 50,
  similarityThreshold: 0.9,
  embeddingModel: 'Xenova/bge-small-en-v1.5',
  sourceEmbeddingModel: 'BAAI/bge-small-en-v1.5',
  embeddingDim: 384,
  vectorQuantization: 'int8',
  centroids: {
    path: 'vectors/topic_centroids.bin',
    bytes: 3072,
    sha256: 'abc',
    dtype: 'float32',
    dim: 384,
    shardOrder: ['BB_01', 'CH_01'],
  },
  prebuiltCatalog: {
    path: 'prebuilt_quizzes.json',
    bytes: 100,
    sha256: 'def',
    count: 1,
  },
  disciplines: {},
  shards: [
    {
      shardId: 'BB_01',
      topicCode: 'BB_01',
      topicName: 'Blood Products',
      disciplineCode: 'BB',
      disciplineName: 'Blood Banking',
      questionCount: 150,
      parquet: { path: 'topics/BB_01.parquet', bytes: 1000, sha256: '1' },
      vectors: { path: 'vectors/BB_01.vec.bin', bytes: 1000, sha256: '2' },
      ids: { path: 'vectors/BB_01.ids.json', bytes: 500, sha256: '3' },
      bloomHistogram: { AN: 150 },
      difficultyHistogram: { '5': 150 },
      questionTypeHistogram: { MC: 150 },
      topKeywords: ['donor'],
    },
    {
      shardId: 'CH_01',
      topicCode: 'CH_01',
      topicName: 'General Chemistry',
      disciplineCode: 'CH',
      disciplineName: 'Clinical Chemistry',
      questionCount: 150,
      parquet: { path: 'topics/CH_01.parquet', bytes: 1000, sha256: '4' },
      vectors: { path: 'vectors/CH_01.vec.bin', bytes: 1000, sha256: '5' },
      ids: { path: 'vectors/CH_01.ids.json', bytes: 500, sha256: '6' },
      bloomHistogram: { AP: 150 },
      difficultyHistogram: { '4': 150 },
      questionTypeHistogram: { MC: 150 },
      topKeywords: ['glucose'],
    },
  ],
  subsetTags: ['A1_EE-A1', 'Core_Pool'],
  parseSummary: {},
};

describe('queryBuilder', () => {
  it('escapes SQL single quotes', () => {
    expect(escapeSqlString("patient's hgb")).toBe("patient''s hgb");
  });

  it('prunes target shards by topicCodes first, then disciplines, else all', () => {
    expect(selectTargetShards(MOCK_MANIFEST, { disciplines: [], topicCodes: [] })).toHaveLength(2);
    expect(selectTargetShards(MOCK_MANIFEST, { disciplines: ['BB'], topicCodes: [] }).map((s) => s.shardId)).toEqual(['BB_01']);
    expect(selectTargetShards(MOCK_MANIFEST, { disciplines: ['BB', 'CH'], topicCodes: ['CH_01'] }).map((s) => s.shardId)).toEqual(['CH_01']);
  });

  it('formats single vs multi-file read_parquet sources', () => {
    expect(formatParquetSource(['topics/BB_01.parquet'])).toBe("read_parquet('topics/BB_01.parquet')");
    expect(formatParquetSource(['topics/BB_01.parquet', 'topics/CH_01.parquet'])).toBe(
      "read_parquet(['topics/BB_01.parquet', 'topics/CH_01.parquet'])",
    );
  });

  it('builds WHERE clause across all 4 ASCP levels, Bloom, difficulty, subset, and multi-word keyword', () => {
    const where = buildWhereClause({
      ...DEFAULT_FILTERS,
      disciplines: ['BB'],
      topicCodes: ['BB_01'],
      subtopics: ['Donors'],
      leafTopics: ['Qualification'],
      bloomLevels: ['AN', 'AP'],
      difficultyMin: 4,
      difficultyMax: 8,
      subsetTags: ['A1_EE-A1'],
      questionTypes: ['MC'],
      keyword: 'athlete bradycardia',
    });

    expect(where).toContain("discipline_code IN ('BB')");
    expect(where).toContain("topic_code IN ('BB_01')");
    expect(where).toContain("ascp_subtopic IN ('Donors')");
    expect(where).toContain("leaf_topic IN ('Qualification')");
    expect(where).toContain("bloom_level IN ('AN', 'AP')");
    expect(where).toContain('difficulty BETWEEN 4 AND 8');
    expect(where).toContain(`subset_tags_json ILIKE '%"A1\\_EE-A1"%' ESCAPE '\\'`);
    expect(where).toContain("question_text ILIKE '%athlete%'");
    expect(where).toContain("question_text ILIKE '%bradycardia%'");
  });

  it('excludes subtopics and leafTopics when building facet queries', () => {
    const sql = buildFacetQuery(['topics/BB_01.parquet'], {
      ...DEFAULT_FILTERS,
      disciplines: ['BB'],
      subtopics: ['Donors'],
      leafTopics: ['Qualification'],
    });
    expect(sql).toContain("discipline_code IN ('BB')");
    expect(sql).not.toContain('ascp_subtopic IN');
    expect(sql).not.toContain('leaf_topic IN');
  });

  it('applies sort allowlist and pagination LIMIT/OFFSET', () => {
    expect(buildOrderByClause(DEFAULT_FILTERS.sortBy)).toBe(
      'ORDER BY difficulty ASC, topic_code ASC, display_id ASC',
    );
    expect(buildOrderByClause('bloom_asc')).toContain(
      "CASE bloom_level WHEN 'RE' THEN 1 WHEN 'UN' THEN 2 WHEN 'AP' THEN 3 WHEN 'AN' THEN 4 ELSE 5 END ASC",
    );
    expect(buildOrderByClause('bloom_desc')).toContain("WHEN 'AN' THEN 4");
    expect(buildOrderByClause('topic_asc')).toContain('ORDER BY topic_code ASC');
    expect(buildOrderByClause('topic_desc')).toContain('ORDER BY topic_code DESC');
    const { countSql, rowsSql } = buildQuestionQuery(['topics/BB_01.parquet'], {
      ...DEFAULT_FILTERS,
      sortBy: 'difficulty_desc',
      page: 3,
      pageSize: 50,
    });
    expect(countSql).toContain('SELECT COUNT(*) AS total FROM read_parquet');
    expect(rowsSql).toContain('ORDER BY difficulty DESC');
    expect(rowsSql).toContain('LIMIT 50 OFFSET 100');
  });

  it('separates dense top-ID fetch from kw_hits-ordered keyword candidates', () => {
    const { denseSql, keywordSql } = buildSemanticCandidateQueries(
      ['topics/BB_01.parquet', 'topics/CH_01.parquet'],
      { ...DEFAULT_FILTERS, disciplines: ['BB'], bloomLevels: ['AN'] },
      ['q_111', 'q_222'],
      ['hemolytic', 'hba1c'],
      150,
    );

    expect(denseSql).toContain("id IN ('q_111', 'q_222')");
    expect(denseSql).toContain("bloom_level IN ('AN')");
    expect(denseSql).not.toContain('discipline_code IN');
    expect(denseSql).not.toContain('LIMIT');

    expect(keywordSql).toContain('AS kw_hits');
    expect(keywordSql).toContain('ORDER BY kw_hits DESC');
    expect(keywordSql).toContain('LIMIT 150');
  });

  it('filters by scoped ascpPaths and builds ascp_path facet queries', () => {
    const shards = selectTargetShards(MOCK_MANIFEST, {
      disciplines: [],
      topicCodes: [],
      ascpPaths: ['Blood Banking > Blood Group Systems > ABO'],
    });
    expect(shards.map((s) => s.shardId)).toEqual(['BB_01']);

    const where = buildWhereClause({
      ...DEFAULT_FILTERS,
      ascpPaths: [
        'Body Fluids > Cerebrospinal > Chemical Testing',
        'Laboratory Operations > Safety > Programs/Practices',
      ],
    });
    expect(where).toContain(
      "(ascp_path = 'Body Fluids > Cerebrospinal > Chemical Testing' OR ascp_path LIKE 'Body Fluids > Cerebrospinal > Chemical Testing > %' ESCAPE '\\')",
    );
    expect(where).toContain(
      "(ascp_path = 'Laboratory Operations > Safety > Programs/Practices' OR ascp_path LIKE 'Laboratory Operations > Safety > Programs/Practices > %' ESCAPE '\\')",
    );

    const facetSql = buildAscpPathFacetQuery(['topics/BB_01.parquet'], {
      ...DEFAULT_FILTERS,
      disciplines: ['CH'],
      ascpPaths: ['Body Fluids > Cerebrospinal'],
      bloomLevels: ['AP'],
    });
    expect(facetSql).toContain('GROUP BY topic_code, ascp_path');
    expect(facetSql).toContain('ORDER BY topic_code ASC, MIN(taxonomic_code) ASC, ascp_path ASC');
    expect(facetSql).toContain("bloom_level IN ('AP')");
    expect(facetSql).not.toContain('discipline_code IN');
    expect(facetSql).not.toContain('ascp_path =');
  });

  it('builds Bloom facet query scoped to selected topics while ignoring non-topic filters', () => {
    const sql = buildBloomFacetQuery(['topics/BB_01.parquet'], {
      ...DEFAULT_FILTERS,
      disciplines: ['BB'],
      bloomLevels: ['AN'],
      difficultyMin: 3,
      difficultyMax: 8,
      questionTypes: ['MCQ'],
      keyword: 'antigen',
    });
    expect(sql).toContain('SELECT DISTINCT bloom_level');
    expect(sql).toContain("discipline_code IN ('BB')");
    expect(sql).not.toContain('bloom_level IN');
    expect(sql).not.toContain('difficulty BETWEEN');
    expect(sql).not.toContain('question_type IN');
    expect(sql).not.toContain('ILIKE');
  });

  it('builds variant index and ID-batch queries for deduplicated paging', () => {
    const indexSql = buildVariantIndexQuery(['topics/BB_01.parquet'], {
      ...DEFAULT_FILTERS,
      disciplines: ['BB'],
      sortBy: 'difficulty_desc',
    });
    expect(indexSql).toContain('SELECT\n      id,\n      similar_ids_json');
    expect(indexSql).toContain("discipline_code IN ('BB')");
    expect(indexSql).toContain('ORDER BY difficulty DESC');
    expect(indexSql).not.toContain('LIMIT');

    const rowsSql = buildQuestionsByIdsQuery(['topics/BB_01.parquet'], ['q_1', "q_'2"]);
    expect(rowsSql).toContain("WHERE id IN ('q_1', 'q_''2')");
  });

  it('applies markConstraint includeIds, excludeIds, and includeUnmarked in WHERE clause', () => {
    const emptyInclude = buildWhereClause({
      ...DEFAULT_FILTERS,
      markConstraint: { includeIds: [], excludeIds: ['q_h'] },
    });
    expect(emptyInclude).toContain('1 = 0');
    expect(emptyInclude).toContain("id NOT IN ('q_h')");

    const goodOrUnmarked = buildWhereClause({
      ...DEFAULT_FILTERS,
      markConstraint: {
        includeIds: ['q_1'],
        includeUnmarked: true,
        allMarkedIds: ['q_1', 'q_2'],
        excludeIds: ['q_2'],
      },
    });
    expect(goodOrUnmarked).toContain("(id IN ('q_1') OR id NOT IN ('q_1', 'q_2'))");
    expect(goodOrUnmarked).toContain("id NOT IN ('q_2')");
  });
});

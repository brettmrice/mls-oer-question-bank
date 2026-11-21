import { describe, expect, it } from 'vitest';
import {
  computeHybridRrfRanking,
  extractClinicalQueryTokens,
  recommendShardsByCentroids,
  recommendShardsByKeywords,
  scoreInt8MultiShard,
} from '@/lib/hybridRanker';
import { getShardCacheStatus } from '@/lib/shardCache';
import type { ManifestData, QuestionRecord, ShardManifest } from '@/types/question';

const SHARD_BB: ShardManifest = {
  shardId: 'BB_01',
  topicCode: 'BB_01',
  topicName: 'Blood Products',
  disciplineCode: 'BB',
  disciplineName: 'Blood Banking',
  questionCount: 2,
  parquet: { path: 'topics/BB_01.parquet', bytes: 1000, sha256: 'pq1' },
  vectors: { path: 'vectors/BB_01.vec.bin', bytes: 768, sha256: 'vec1' },
  ids: { path: 'vectors/BB_01.ids.json', bytes: 50, sha256: 'ids1' },
  bloomHistogram: { AN: 2 },
  difficultyHistogram: { '5': 2 },
  questionTypeHistogram: { MC: 2 },
  topKeywords: ['donor', 'bradycardia', 'cpda-1', 'plateletpheresis'],
};

const SHARD_CH: ShardManifest = {
  shardId: 'CH_01',
  topicCode: 'CH_01',
  topicName: 'General Chemistry',
  disciplineCode: 'CH',
  disciplineName: 'Clinical Chemistry',
  questionCount: 2,
  parquet: { path: 'topics/CH_01.parquet', bytes: 1000, sha256: 'pq2' },
  vectors: { path: 'vectors/CH_01.vec.bin', bytes: 768, sha256: 'vec2' },
  ids: { path: 'vectors/CH_01.ids.json', bytes: 50, sha256: 'ids2' },
  bloomHistogram: { AN: 2 },
  difficultyHistogram: { '6': 2 },
  questionTypeHistogram: { MC: 2 },
  topKeywords: ['glucose', 'hba1c', 'hemolytic', 'glycation'],
};

const MOCK_MANIFEST: ManifestData = {
  version: '1.0.0',
  generatedAt: '2026-11-21T00:00:00Z',
  license: 'CC0-1.0',
  totalQuestions: 4,
  questionsWithSiblings: 0,
  similarityThreshold: 0.9,
  embeddingModel: 'Xenova/bge-small-en-v1.5',
  sourceEmbeddingModel: 'BAAI/bge-small-en-v1.5',
  embeddingDim: 4,
  vectorQuantization: 'int8',
  centroids: {
    path: 'vectors/topic_centroids.bin',
    bytes: 32,
    sha256: 'cent',
    dtype: 'float32',
    dim: 4,
    shardOrder: ['BB_01', 'CH_01'],
  },
  prebuiltCatalog: { path: 'prebuilt_quizzes.json', bytes: 10, sha256: 'pb', count: 0 },
  disciplines: {
    BB: {
      disciplineCode: 'BB',
      disciplineName: 'Blood Banking',
      blueprintWeights: {},
      totalMappedTopics: 1,
      level2Topics: {
        'Blood Products': { Donors: ['Qualification', 'Deferral'] },
      },
    },
    CH: {
      disciplineCode: 'CH',
      disciplineName: 'Clinical Chemistry',
      blueprintWeights: {},
      totalMappedTopics: 1,
      level2Topics: {
        'General Chemistry': { Carbohydrates: ['HbA1c Interference'] },
      },
    },
  },
  shards: [SHARD_BB, SHARD_CH],
  subsetTags: ['Core_Pool'],
  parseSummary: {},
};

function makeQuestion(id: string, text: string, optionText: string): QuestionRecord {
  return {
    id,
    displayId: id,
    disciplineCode: 'BB',
    disciplineName: 'Blood Banking',
    topicCode: 'BB_01',
    topicName: 'Blood Products',
    taxonomicCode: 'BB_01-A-01',
    ascpSubtopic: 'Donors',
    leafTopic: 'Qualification',
    ascpPath: 'Blood Banking > Blood Products > Donors > Qualification',
    subsetTags: ['Core_Pool'],
    bloomLevel: 'AN',
    difficulty: 5,
    difficultyRationale: '',
    questionType: 'MC',
    objective: 'Clinical evaluation',
    questionText: text,
    options: [{ label: 'A', text: optionText, weight: 100, feedback: 'Correct' }],
    hint: '',
    similarIds: [],
    sourceFiles: [],
  };
}

describe('hybridRanker & shardCache', () => {
  it('merges and ranks int8 cosine similarity across multiple shards', () => {
    const query = new Float32Array([1, 0, 0, 0]);
    const hits = scoreInt8MultiShard(
      query,
      [
        {
          shardId: 'BB_01',
          ids: ['q_bb1', 'q_bb2'],
          vectors: new Int8Array([64, 0, 0, 0, 120, 0, 0, 0]),
          dim: 4,
        },
        {
          shardId: 'CH_01',
          ids: ['q_ch1'],
          vectors: new Int8Array([127, 0, 0, 0]),
          dim: 4,
        },
      ],
      2,
    );

    expect(hits.map((h) => h.id)).toEqual(['q_ch1', 'q_bb2']);
    expect(hits[0].cosine).toBeCloseTo(1.0, 2);
  });

  it('preserves clinical hyphenated/parenthesized tokens and boosts exact matches via Hybrid RRF', () => {
    const tokens = extractClinicalQueryTokens('delayed hemolytic reaction anti-Jk(a) P2Y12');
    expect(tokens).toContain('anti-jk(a)');
    expect(tokens).toContain('p2y12');

    const q1 = makeQuestion(
      'q_generic',
      'A patient develops delayed hemolysis after transfusion.',
      'Kidd system antibody screen',
    );
    const q2 = makeQuestion(
      'q_exact',
      'Which specificity causes delayed hemolytic transfusion reaction with anti-Jk(a) evanescence?',
      'anti-Jk(a) antibody',
    );

    const ranked = computeHybridRrfRanking(
      [q1, q2],
      'anti-Jk(a)',
      [
        { id: 'q_generic', cosine: 0.85 },
        { id: 'q_exact', cosine: 0.84 },
      ],
    );

    expect(ranked[0].question.id).toBe('q_exact');
    expect(ranked[0].keywordMatched).toBe(true);
  });

  it('recommends Stage 1 shards by keywords and Stage 2 non-active shards by centroids', () => {
    const recs = recommendShardsByKeywords(MOCK_MANIFEST, 'hemolytic anemia HbA1c', 2);
    expect(recs[0].shard.shardId).toBe('CH_01');
    expect(recs[0].matchedTerms).toContain('hba1c');

    const centroids = new Float32Array([
      0.1, 0.9, 0, 0, // BB_01
      0.95, 0.05, 0, 0, // CH_01
    ]);
    const suggestions = recommendShardsByCentroids(
      new Float32Array([1, 0, 0, 0]),
      centroids,
      ['BB_01', 'CH_01'],
      4,
      new Set(['BB_01']),
      0.4,
      3,
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].shardId).toBe('CH_01');
  });

  it('detects cached vs stale update_available shards via sha256', () => {
    expect(getShardCacheStatus(SHARD_BB, null)).toBe('not_downloaded');
    expect(
      getShardCacheStatus(SHARD_BB, {
        shardId: 'BB_01',
        topicCode: 'BB_01',
        vecSha256: 'vec1',
        idsSha256: 'ids1',
        totalBytes: 818,
        cachedAt: '2026-11-21T00:00:00Z',
      }),
    ).toBe('cached');
    expect(
      getShardCacheStatus(SHARD_BB, {
        shardId: 'BB_01',
        topicCode: 'BB_01',
        vecSha256: 'old_vec_hash',
        idsSha256: 'ids1',
        totalBytes: 818,
        cachedAt: '2026-11-21T00:00:00Z',
      }),
    ).toBe('update_available');
  });
});

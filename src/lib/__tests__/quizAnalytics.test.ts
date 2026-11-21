import { describe, expect, it } from 'vitest';
import {
  encodeCatalogHashUrl,
  encodePrebuiltHashUrl,
  parsePrebuiltLocationHash,
} from '@/lib/prebuiltShare';
import { computeQuizBlueprint, detectEnemyPairs } from '@/lib/quizAnalytics';
import type { ManifestData, QuestionRecord } from '@/types/question';

const MOCK_MANIFEST: ManifestData = {
  version: '1.0.0',
  generatedAt: '2026-11-21T00:00:00Z',
  license: 'CC0-1.0',
  totalQuestions: 10,
  questionsWithSiblings: 2,
  similarityThreshold: 0.9,
  embeddingModel: 'Xenova/bge-small-en-v1.5',
  sourceEmbeddingModel: 'BAAI/bge-small-en-v1.5',
  embeddingDim: 384,
  vectorQuantization: 'int8',
  centroids: {
    path: 'vectors/topic_centroids.bin',
    bytes: 1536,
    sha256: 'c',
    dtype: 'float32',
    dim: 384,
    shardOrder: ['BB_01'],
  },
  prebuiltCatalog: { path: 'prebuilt_quizzes.json', bytes: 10, sha256: 'p', count: 1 },
  disciplines: {
    BB: {
      disciplineCode: 'BB',
      disciplineName: 'Blood Banking',
      blueprintWeights: {
        MLS: {
          track: 'MLS',
          rawLabel: 'MLS',
          rawValue: '17–22%',
          minPct: 17,
          maxPct: 22,
        },
        MLT: {
          track: 'MLT',
          rawLabel: 'MLT',
          rawValue: '15–20%',
          minPct: 15,
          maxPct: 20,
        },
      },
      totalMappedTopics: 10,
      level2Topics: {},
    },
    CH: {
      disciplineCode: 'CH',
      disciplineName: 'Clinical Chemistry',
      blueprintWeights: {
        MLS: {
          track: 'MLS',
          rawLabel: 'MLS',
          rawValue: '17–22%',
          minPct: 17,
          maxPct: 22,
        },
      },
      totalMappedTopics: 10,
      level2Topics: {},
    },
  },
  shards: [],
  subsetTags: [],
  parseSummary: {},
};

function makeQ(
  id: string,
  disc: string,
  bloom: 'RE' | 'UN' | 'AP' | 'AN',
  diff: number,
  similarIds: string[] = [],
): QuestionRecord {
  return {
    id,
    displayId: id.toUpperCase(),
    disciplineCode: disc,
    disciplineName: disc === 'BB' ? 'Blood Banking' : 'Clinical Chemistry',
    topicCode: `${disc}_01`,
    topicName: 'Topic',
    taxonomicCode: `${disc}_01-A-01`,
    ascpSubtopic: 'Sub',
    leafTopic: 'Leaf',
    ascpPath: `${disc} > Topic > Sub > Leaf`,
    subsetTags: ['Core_Pool'],
    bloomLevel: bloom,
    difficulty: diff,
    difficultyRationale: '',
    questionType: 'MC',
    objective: 'Obj',
    questionText: `Question ${id}`,
    options: [{ label: 'A', text: 'Ans', weight: 100, feedback: 'Correct' }],
    hint: '',
    similarIds,
    sourceFiles: [],
  };
}

describe('quizAnalytics & prebuiltShare', () => {
  it('computes MLS blueprint coverage status, Bloom counts, and estimated time', () => {
    const qs = [
      makeQ('q1', 'BB', 'AN', 6),
      makeQ('q2', 'CH', 'RE', 2),
      makeQ('q3', 'CH', 'AP', 4),
      makeQ('q4', 'CH', 'UN', 3),
      makeQ('q5', 'CH', 'AN', 5),
    ];

    const summary = computeQuizBlueprint(qs, MOCK_MANIFEST, 'MLS');
    expect(summary.totalQuestions).toBe(5);
    expect(summary.bloomCounts).toEqual({ RE: 1, UN: 1, AP: 1, AN: 2 });
    expect(summary.avgDifficulty).toBe(4.0);
    // 3 * 1.5 (AN/AP) + 2 * 1.0 (RE/UN) = 6.5 -> rounded 7 min
    expect(summary.estimatedMinutes).toBe(7);

    const bb = summary.disciplineRows.find((r) => r.disciplineCode === 'BB')!;
    const ch = summary.disciplineRows.find((r) => r.disciplineCode === 'CH')!;
    expect(bb.actualPct).toBe(20);
    expect(bb.status).toBe('in_range'); // 17-22%
    expect(ch.actualPct).toBe(80);
    expect(ch.status).toBe('over');
  });

  it('detects enemy question pairs symmetrically without duplicates', () => {
    const q1 = makeQ('q1', 'BB', 'AN', 5, ['q2']);
    const q2 = makeQ('q2', 'BB', 'AP', 5, ['q1']);
    const q3 = makeQ('q3', 'CH', 'RE', 2, []);
    const pairs = detectEnemyPairs([q1, q2, q3]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.id).toBe('q1');
    expect(pairs[0].b.id).toBe('q2');
  });

  it('roundtrips compressed #prebuilt=lz:... and #prebuilt=catalog:... links in both modes', () => {
    const url = encodePrebuiltHashUrl(
      {
        title: 'Donor Eligibility Drill',
        description: 'Key BB_01 cases',
        author: 'Dr. Smith',
        tags: ['BB_01'],
        questionIds: ['q_1', 'q_2'],
        customPoints: { q_1: 2 },
        license: 'CC0-1.0',
      },
      'practice',
      'https://oer.example.edu/',
    );

    expect(url).toContain('#prebuilt=lz:');
    expect(url).toContain('&mode=practice');

    const parsed = parsePrebuiltLocationHash(url);
    expect(parsed?.kind).toBe('lz');
    expect(parsed?.mode).toBe('practice');
    expect(parsed?.payload?.title).toBe('Donor Eligibility Drill');
    expect(parsed?.payload?.questionIds).toEqual(['q_1', 'q_2']);
    expect(parsed?.payload?.customPoints).toEqual({ q_1: 2 });

    const catUrl = encodeCatalogHashUrl('prebuilt_a1_ee-a1', 'educator', 'https://oer.example.edu/');
    const parsedCat = parsePrebuiltLocationHash(catUrl);
    expect(parsedCat?.kind).toBe('catalog');
    expect(parsedCat?.mode).toBe('educator');
    expect(parsedCat?.refId).toBe('prebuilt_a1_ee-a1');
  });
});

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticSearchModal } from '@/components/SemanticSearchModal';
import type { SemanticDownloadSnapshot } from '@/lib/semanticClient';
import type { ManifestData } from '@/types/question';

const mockDownloadAndActivateShards = vi.fn();
const mockCancelActiveDownloads = vi.fn();
const mockClearSemanticCache = vi.fn();

vi.mock('@/lib/semanticClient', () => ({
  downloadAndActivateShards: (...args: unknown[]) => mockDownloadAndActivateShards(...args),
  cancelActiveDownloads: () => mockCancelActiveDownloads(),
  clearSemanticCache: () => mockClearSemanticCache(),
}));

vi.mock('@/lib/shardCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shardCache')>();
  return {
    ...actual,
    getDownloadedShardsMap: vi.fn().mockResolvedValue(new Map()),
    isSemanticModelPreviouslyCached: vi.fn().mockResolvedValue(false),
  };
});

const MOCK_MANIFEST: ManifestData = {
  version: '1.0.0',
  generatedAt: '2026-11-21T00:00:00Z',
  license: 'CC0-1.0',
  totalQuestions: 3755,
  questionsWithSiblings: 2517,
  similarityThreshold: 0.9,
  embeddingModel: 'Xenova/bge-small-en-v1.5',
  sourceEmbeddingModel: 'BAAI/bge-small-en-v1.5',
  embeddingDim: 384,
  vectorQuantization: 'int8',
  centroids: {
    path: 'vectors/topic_centroids.bin',
    bytes: 3072,
    sha256: 'cent',
    dtype: 'float32',
    dim: 384,
    shardOrder: ['BB_01', 'CH_01'],
  },
  prebuiltCatalog: { path: 'prebuilt_quizzes.json', bytes: 100, sha256: 'pb', count: 1 },
  disciplines: {
    BB: {
      disciplineCode: 'BB',
      disciplineName: 'Blood Banking',
      blueprintWeights: {},
      totalMappedTopics: 1,
      level2Topics: {},
    },
    CH: {
      disciplineCode: 'CH',
      disciplineName: 'Clinical Chemistry',
      blueprintWeights: {},
      totalMappedTopics: 1,
      level2Topics: {},
    },
  },
  shards: [
    {
      shardId: 'BB_01',
      topicCode: 'BB_01',
      topicName: 'Blood Products',
      disciplineCode: 'BB',
      disciplineName: 'Blood Banking',
      questionCount: 1959,
      parquet: { path: 'topics/BB_01.parquet', bytes: 699450, sha256: 'p1' },
      vectors: { path: 'vectors/BB_01.vec.bin', bytes: 752256, sha256: 'v1' },
      ids: { path: 'vectors/BB_01.ids.json', bytes: 33304, sha256: 'i1' },
      bloomHistogram: {},
      difficultyHistogram: {},
      questionTypeHistogram: { MC: 1959 },
      topKeywords: ['donor', 'bradycardia'],
    },
    {
      shardId: 'CH_01',
      topicCode: 'CH_01',
      topicName: 'General Chemistry',
      disciplineCode: 'CH',
      disciplineName: 'Clinical Chemistry',
      questionCount: 1796,
      parquet: { path: 'topics/CH_01.parquet', bytes: 650000, sha256: 'p2' },
      vectors: { path: 'vectors/CH_01.vec.bin', bytes: 689664, sha256: 'v2' },
      ids: { path: 'vectors/CH_01.ids.json', bytes: 30000, sha256: 'i2' },
      bloomHistogram: {},
      difficultyHistogram: {},
      questionTypeHistogram: { MC: 1796 },
      topKeywords: ['hemolytic', 'hba1c', 'glucose'],
    },
  ],
  subsetTags: ['Core_Pool'],
  parseSummary: {},
};

describe('SemanticSearchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('locks download until shard selected and consent checked, recommends shards, and renders progress + cancel', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onClose = vi.fn();

    let emitProgress!: (snap: SemanticDownloadSnapshot) => void;
    let resolveDownload!: (ids: string[]) => void;

    mockDownloadAndActivateShards.mockImplementation(
      (_manifest: ManifestData, _ids: string[], onSnapshot: (s: SemanticDownloadSnapshot) => void) => {
        emitProgress = onSnapshot;
        return new Promise<string[]>((resolve) => {
          resolveDownload = resolve;
        });
      },
    );

    render(
      <SemanticSearchModal
        open={true}
        manifest={MOCK_MANIFEST}
        activeShardIds={[]}
        onClose={onClose}
        onActivate={onActivate}
      />,
    );

    const downloadBtn = screen.getByRole('button', { name: /Agree & Download Shards/i });
    expect(downloadBtn).toBeDisabled();

    // Stage 1 pre-consent recommender highlights CH_01 for HbA1c
    const recInput = screen.getByLabelText(/Smart Shard Recommender/i);
    await user.type(recInput, 'hemolytic anemia HbA1c');
    const selectRecBtn = await screen.findByRole('button', { name: /Select Recommended/i });
    await user.click(selectRecBtn);

    // Also select BB_01 via Blood Banking Select All
    const selectAllButtons = screen.getAllByRole('button', { name: /Select All/i });
    await user.click(selectAllButtons[0]);

    expect(screen.getByText(/Select 1 or More ASCP Topic Shards \(2 selected\)/i)).toBeInTheDocument();
    // Still disabled without explicit consent checkbox
    expect(downloadBtn).toBeDisabled();

    const consentCheckbox = screen.getByRole('checkbox', { name: /I agree to download/i });
    await user.click(consentCheckbox);
    expect(downloadBtn).toBeEnabled();

    await user.click(downloadBtn);
    expect(mockDownloadAndActivateShards).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitProgress({
        isDownloading: true,
        model: {
          status: 'cached',
          loaded: 1,
          total: 1,
          percent: 100,
        },
        shards: {
          BB_01: { status: 'downloading', loaded: 350000, total: 785560, percent: 45 },
          CH_01: { status: 'queued', loaded: 0, total: 719664, percent: 0 },
        },
        overallPercent: 48,
      });
    });

    expect(screen.getByText(/Overall Semantic Setup Progress/i)).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /Cancel Downloads/i });
    await user.click(cancelBtn);
    expect(mockCancelActiveDownloads).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDownload(['BB_01', 'CH_01']);
    });
    expect(onActivate).toHaveBeenCalledWith(['BB_01', 'CH_01'], 'hemolytic anemia HbA1c');
  });
});

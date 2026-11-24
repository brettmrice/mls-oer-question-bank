import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterSidebar } from '@/components/FilterSidebar';
import { QuestionCard } from '@/components/QuestionCard';
import { DEFAULT_FILTERS, type ManifestData, type QuestionRecord } from '@/types/question';

const sampleQuestion: QuestionRecord = {
  id: 'q_test_1',
  displayId: 'BB-01-001',
  disciplineCode: 'BB',
  disciplineName: 'Blood Bank',
  topicCode: 'BB_01',
  topicName: 'Donors',
  taxonomicCode: 'BB_01_A',
  ascpSubtopic: 'Donors',
  leafTopic: 'Qualification',
  ascpPath: 'Blood Bank > Donors > Qualification',
  subsetTags: [],
  bloomLevel: 'RE',
  difficulty: 3,
  difficultyRationale: 'Basic recall',
  questionType: 'MC',
  objective: 'Recall donor deferral criteria',
  questionText: 'Which donor is deferred?',
  options: [
    { label: 'A', text: 'Option A', weight: 100, feedback: 'Correct' },
    { label: 'B', text: 'Option B', weight: 0, feedback: 'Incorrect' },
  ],
  hint: '',
  similarIds: [],
  sourceFiles: [],
};

const minimalManifest: ManifestData = {
  version: '1.0',
  generatedAt: '2026-01-01T00:00:00Z',
  license: 'CC0-1.0',
  totalQuestions: 10,
  questionsWithSiblings: 0,
  similarityThreshold: 0.8,
  embeddingModel: 'test',
  sourceEmbeddingModel: 'test',
  embeddingDim: 384,
  vectorQuantization: 'int8',
  centroids: { path: 'c.bin', bytes: 0, sha256: '', dtype: 'float32', dim: 384, shardOrder: [] },
  prebuiltCatalog: { path: 'p.json', bytes: 0, sha256: '', count: 0 },
  disciplines: {
    BB: {
      disciplineCode: 'BB',
      disciplineName: 'Blood Bank',
      blueprintWeights: {},
      totalMappedTopics: 1,
      level2Topics: {},
    },
  },
  shards: [
    {
      shardId: 'BB_01',
      topicCode: 'BB_01',
      topicName: 'Donors',
      disciplineCode: 'BB',
      disciplineName: 'Blood Bank',
      questionCount: 10,
      parquet: { path: 'topics/BB_01.parquet', bytes: 100, sha256: 'abc' },
      vectors: { path: 'vectors/BB_01.vec.bin', bytes: 100, sha256: 'abc' },
      ids: { path: 'vectors/BB_01.ids.json', bytes: 100, sha256: 'abc' },
      bloomHistogram: { RE: 10 },
      difficultyHistogram: { '3': 10 },
      questionTypeHistogram: { MC: 10 },
      topKeywords: [],
    },
  ],
  subsetTags: [],
  parseSummary: {},
};

describe('QuestionCard Mark/Marked panel', () => {
  it('shows Mark when unmarked, opens pop-in options, and highlights Marked when active', async () => {
    const user = userEvent.setup();
    const onUpdateMark = vi.fn();

    const { rerender } = render(
      <QuestionCard
        question={sampleQuestion}
        globalReveal={false}
        mark={null}
        onUpdateMark={onUpdateMark}
      />,
    );

    const markBtn = screen.getByRole('button', { name: /Mark question/i });
    expect(markBtn).toHaveTextContent('Mark');

    await user.click(markBtn);
    expect(screen.getByRole('button', { name: 'Good' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bad' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));
    expect(onUpdateMark).toHaveBeenCalledWith('q_test_1', { rating: 'good' });

    await user.click(screen.getByRole('button', { name: 'Notes' }));
    const noteInput = screen.getByLabelText('Question note');
    await user.type(noteInput, 'Check reference{Enter}');
    expect(onUpdateMark).toHaveBeenCalledWith('q_test_1', { personalNote: 'Check reference' });

    rerender(
      <QuestionCard
        question={sampleQuestion}
        globalReveal={false}
        mark={{
          questionId: 'q_test_1',
          bookmarkedAt: '2026-01-01T00:00:00Z',
          personalNote: 'Check reference',
          rating: 'good',
        }}
        onUpdateMark={onUpdateMark}
      />,
    );

    const markedBtn = screen.getByRole('button', { name: /Edit question marks/i });
    expect(markedBtn).toHaveTextContent('Marked');
    expect(markedBtn.className).toContain('bg-amber-50');
  });
});

describe('FilterSidebar Marks section', () => {
  it('renders Marks filter chips and toggles filters.marks', async () => {
    const user = userEvent.setup();
    const onUpdateFilters = vi.fn();

    render(
      <FilterSidebar
        manifest={minimalManifest}
        filters={DEFAULT_FILTERS}
        ascpPathFacets={[]}
        markCounts={{ good: 2, bad: 1, notes: 3 }}
        facetsLoading={false}
        onEnsureTopicFacets={vi.fn()}
        activeSemanticShards={[]}
        semanticPrompt=""
        semanticLoading={false}
        onUpdateFilters={onUpdateFilters}
        onResetFilters={vi.fn()}
        onOpenSemanticModal={vi.fn()}
        onSubmitSemanticPrompt={vi.fn()}
        onClearSemanticPrompt={vi.fn()}
      />,
    );

    const goodChip = screen.getByRole('button', { name: /Good/i });
    expect(goodChip).toHaveTextContent('(2)');
    expect(screen.queryByRole('button', { name: /Hidden/i })).not.toBeInTheDocument();
    await user.click(goodChip);
    expect(onUpdateFilters).toHaveBeenCalledWith({ marks: ['good'], page: 1 });
  });
});

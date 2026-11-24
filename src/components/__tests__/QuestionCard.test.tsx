import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuestionCard } from '@/components/QuestionCard';
import { buildCompactHeaderSteps } from '@/lib/utils';
import type { QuestionRecord } from '@/types/question';

const SAMPLE_QUESTION: QuestionRecord = {
  id: 'q_abc123def456',
  displayId: 'BB_01-AN-0001',
  disciplineCode: 'BB',
  disciplineName: 'Blood Banking',
  topicCode: 'BB_01',
  topicName: 'Blood Products',
  taxonomicCode: 'BB_01-A-01',
  ascpSubtopic: 'Donors',
  leafTopic: 'Qualification',
  ascpPath: 'Blood Banking > Blood Products > Donors > Qualification',
  subsetTags: ['Core_Pool', 'A1_EE-A1'],
  bloomLevel: 'AN',
  difficulty: 6,
  difficultyRationale: 'Requires correlating athletic physiology with donor standards.',
  questionType: 'MC',
  objective: 'Evaluate asymptomatic bradycardia in conditioned donors.',
  questionText: 'An asymptomatic marathon runner presents with a regular pulse of 46 bpm. What action is required?',
  options: [
    {
      label: 'A',
      text: 'Permanent deferral',
      weight: 0,
      feedback: 'Incorrect: Sinus bradycardia in an athlete is physiological.',
    },
    {
      label: 'B',
      text: 'Qualify upon medical director approval',
      weight: 100,
      feedback: 'Correct: Conditioned athletes with pulse <50 bpm may qualify with sign-off.',
    },
  ],
  hint: 'Consider high vagal tone in conditioned athletes.',
  similarIds: ['q_111222333444'],
  sourceFiles: ['BB/BB_01/BB_01-Blood-Products_MC_AN.md'],
};

const VARIANT_QUESTION: QuestionRecord = {
  ...SAMPLE_QUESTION,
  id: 'q_111222333444',
  displayId: 'BB_01-AN-0002',
  difficulty: 7,
  questionText: 'A conditioned cyclist has a resting pulse of 44 bpm and feels well. What is the next step?',
};

describe('QuestionCard', () => {
  it('renders header bloom/difficulty, removes metadata aside, and switches variants with slide direction', async () => {
    const user = userEvent.setup();
    const onLoadVariants = vi.fn().mockResolvedValue([VARIANT_QUESTION]);

    const { container } = render(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={true}
        onLoadVariants={onLoadVariants}
      />,
    );

    expect(screen.getByText(/BLOOM: Analyze \| DIFFICULTY: 6 \/ 10/)).toBeInTheDocument();
    expect(screen.getByText(/An asymptomatic marathon runner/)).toBeInTheDocument();
    expect(screen.getByText('Qualify upon medical director approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Suggest\/Discuss/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Metadata/i })).not.toBeInTheDocument();
    expect(container.querySelector('aside')).not.toBeInTheDocument();

    const variantBtn = screen.getByRole('button', { name: /Variants\/Remix \(2\)/i });
    await user.click(variantBtn);

    expect(onLoadVariants).toHaveBeenCalledWith(SAMPLE_QUESTION);
    const v2Btn = await screen.findByRole('button', { name: 'V2' });
    expect(v2Btn).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /\+ Remix/i })).toBeInTheDocument();

    await user.click(v2Btn);
    expect(screen.getByText(/A conditioned cyclist/)).toBeInTheDocument();
    expect(screen.getByText(/BLOOM: Analyze \| DIFFICULTY: 7 \/ 10/)).toBeInTheDocument();
    expect(container.querySelector('.animate-slide-in-right')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'V1' }));
    expect(screen.getByText(/An asymptomatic marathon runner/)).toBeInTheDocument();
    expect(container.querySelector('.animate-slide-in-left')).toBeInTheDocument();
  });

  it('keeps correct radial visible when feedback is hidden, toggles per-card feedback, and syncs with globalReveal', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={false}
      />,
    );

    expect(screen.getByLabelText('Correct answer')).toBeInTheDocument();
    expect(screen.queryByText(/Conditioned athletes with pulse <50 bpm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evaluate asymptomatic bradycardia in conditioned donors\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Consider high vagal tone/)).not.toBeInTheDocument();

    const feedbackBtn = screen.getByRole('button', { name: /Show feedback/i });
    await user.click(feedbackBtn);

    expect(screen.getByText(/Conditioned athletes with pulse <50 bpm/)).toBeInTheDocument();
    expect(screen.getByText(/Evaluate asymptomatic bradycardia in conditioned donors\./)).toBeInTheDocument();
    expect(screen.getByText(/Consider high vagal tone/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Hide feedback/i }));
    expect(screen.queryByText(/Evaluate asymptomatic bradycardia in conditioned donors\./)).not.toBeInTheDocument();

    rerender(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={true}
      />,
    );
    expect(screen.getByText(/Consider high vagal tone/)).toBeInTheDocument();
    expect(screen.getByText(/Evaluate asymptomatic bradycardia in conditioned donors\./)).toBeInTheDocument();
  });

  it('keeps Variants/Remix clickable when similarIds is empty, shows R1 for local remixes, and triggers onOpenRemix', async () => {
    const user = userEvent.setup();
    const onOpenRemix = vi.fn();
    const soloQuestion: QuestionRecord = { ...SAMPLE_QUESTION, similarIds: [] };
    const localRemixRecord = {
      id: 'remix_1',
      parentQuestionId: soloQuestion.id,
      remixedFromId: soloQuestion.id,
      createdAt: '2026-11-22T12:00:00Z',
      updatedAt: '2026-11-22T12:00:00Z',
      question: {
        ...soloQuestion,
        id: 'remix_1',
        displayId: 'BB_01-AN-0001-REMIX',
        questionText: 'Remixed donor bradycardia stem for local quiz.',
      },
    };

    render(
      <QuestionCard
        question={soloQuestion}
        globalReveal={false}
        localRemixes={[localRemixRecord]}
        onOpenRemix={onOpenRemix}
      />,
    );

    const variantBtn = screen.getByRole('button', { name: /Variants\/Remix \(2\)/i });
    expect(variantBtn).not.toBeDisabled();
    await user.click(variantBtn);

    const r1Btn = screen.getByRole('button', { name: 'R1' });
    await user.click(r1Btn);
    expect(screen.getByText(/Remixed donor bradycardia stem for local quiz\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /\+ Remix/i }));
    expect(onOpenRemix).toHaveBeenCalledWith(localRemixRecord.question, soloQuestion.id);
  });

  it('shows trash icon and removes from active quiz when In [Quiz] button is clicked', async () => {
    const user = userEvent.setup();
    const onRemoveFromQuiz = vi.fn();
    const activeQuiz = {
      id: 'quiz_1',
      name: 'Midterm 1',
      description: '',
      questionIds: [SAMPLE_QUESTION.id],
      customPoints: {},
      createdAt: '2026-11-22T12:00:00Z',
      updatedAt: '2026-11-22T12:00:00Z',
    };

    render(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={false}
        quizzes={[activeQuiz]}
        activeQuizId="quiz_1"
        onRemoveFromQuiz={onRemoveFromQuiz}
      />,
    );

    const removeBtn = screen.getByRole('button', {
      name: /Remove BB_01-AN-0001 from Midterm 1/i,
    });
    expect(removeBtn).not.toBeDisabled();
    expect(removeBtn).toHaveTextContent('In Use');
    expect(removeBtn.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByText(/Added to/i)).toHaveTextContent('Added to Midterm 1');

    await user.click(removeBtn);
    expect(onRemoveFromQuiz).toHaveBeenCalledWith('quiz_1', SAMPLE_QUESTION.id);
  });

  it('shows Add to Quiz when not in the active quiz', () => {
    const activeQuiz = {
      id: 'quiz_1',
      name: 'Midterm 1',
      description: '',
      questionIds: [],
      customPoints: {},
      createdAt: '2026-11-22T12:00:00Z',
      updatedAt: '2026-11-22T12:00:00Z',
    };

    render(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={false}
        quizzes={[activeQuiz]}
        activeQuizId="quiz_1"
      />,
    );

    expect(screen.getByRole('button', { name: /Add to Quiz/i })).toBeInTheDocument();
    expect(screen.queryByText(/Added to/i)).not.toBeInTheDocument();
  });

  it('applies focus emphasis when isFocused is true and dims when isFocused is false', () => {
    const { container, rerender } = render(
      <QuestionCard question={SAMPLE_QUESTION} globalReveal={false} isFocused={true} />,
    );

    const focusedCard = container.querySelector('[data-focused="true"]');
    expect(focusedCard).not.toBeNull();
    expect(focusedCard?.className).toContain('ring-2');
    expect(focusedCard?.className).toContain('shadow-md');

    rerender(<QuestionCard question={SAMPLE_QUESTION} globalReveal={false} isFocused={false} />);

    const dimmedCard = container.querySelector('[data-focused="false"]');
    expect(dimmedCard).not.toBeNull();
    expect(dimmedCard?.className).toContain('opacity-65');
  });

  it('shows Reveal All when feedback is visible and toggles global reveal', async () => {
    const user = userEvent.setup();
    const onToggleGlobalReveal = vi.fn();
    const { rerender } = render(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={false}
        onToggleGlobalReveal={onToggleGlobalReveal}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /Reveal feedback for all questions/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show feedback/i }));

    const revealAllBtn = screen.getByRole('button', {
      name: /Reveal feedback for all questions/i,
    });
    expect(revealAllBtn).toBeInTheDocument();
    await user.click(revealAllBtn);
    expect(onToggleGlobalReveal).toHaveBeenCalledTimes(1);

    rerender(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={true}
        onToggleGlobalReveal={onToggleGlobalReveal}
      />,
    );

    const hideAllBtn = screen.getByRole('button', {
      name: /Hide feedback for all questions/i,
    });
    expect(hideAllBtn).toBeInTheDocument();
    await user.click(hideAllBtn);
    expect(onToggleGlobalReveal).toHaveBeenCalledTimes(2);
  });

  it('strips leading "Clinical " from the ASCP breadcrumb', () => {
    render(
      <QuestionCard
        question={{
          ...SAMPLE_QUESTION,
          ascpPath: 'Clinical Chemistry > General Chemistry > Carbohydrates > Properties',
        }}
        globalReveal={false}
      />,
    );

    expect(
      screen.getByText('Chemistry > General Chemistry > Carbohydrates > Properties'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Clinical Chemistry > General Chemistry > Carbohydrates > Properties'),
    ).not.toBeInTheDocument();
  });

  it('builds progressive header compaction steps preserving the leaf and compacting bloom/difficulty', () => {
    const steps = buildCompactHeaderSteps(
      'Clinical Microbiology > Preanalytic Procedures > Specimen Processing, Media Selection, and Staining Procedures > Digestion Decontamination',
      'MI',
      'Analyze',
      'AN',
      3,
    );

    expect(steps).toEqual([
      {
        breadcrumb:
          'Microbiology > Preanalytic Procedures > Specimen Processing, Media Selection, and Staining Procedures > Digestion Decontamination',
        meta: 'BLOOM: Analyze | DIFFICULTY: 3 / 10',
      },
      {
        breadcrumb: 'Microbiology > Preanalytic Procedures > ... > Digestion Decontamination',
        meta: 'BLOOM: Analyze | DIFFICULTY: 3 / 10',
      },
      {
        breadcrumb: 'Microbiology > ... > Digestion Decontamination',
        meta: 'BLOOM: Analyze | DIFFICULTY: 3 / 10',
      },
      {
        breadcrumb: 'Microbiology > ... > Digestion Decontamination',
        meta: 'BL: AN | DIFF: 3 / 10',
      },
      {
        breadcrumb: 'MI > ... > Digestion Decontamination',
        meta: 'BL: AN | DIFF: 3 / 10',
      },
      {
        breadcrumb: 'MI > ... > Digestion Decontamination',
        meta: 'AN | 3 / 10',
      },
    ]);
  });

  it('compacts QuestionCard header based on row width and wraps at ultra-narrow widths to keep leaf visible', () => {
    const origGetBCR = HTMLElement.prototype.getBoundingClientRect;

    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        width: 420,
        height: 20,
        top: 0,
        left: 0,
        right: 420,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    };

    try {
      const { rerender } = render(
        <QuestionCard
          question={{
            ...SAMPLE_QUESTION,
            disciplineCode: 'MI',
            ascpPath:
              'Clinical Microbiology > Preanalytic Procedures > Specimen Processing > Digestion Decontamination',
          }}
          globalReveal={false}
        />,
      );

      expect(screen.getByText('MI > ... > Digestion Decontamination')).toBeInTheDocument();
      expect(screen.getByText('BL: AN | DIFF: 6 / 10')).toBeInTheDocument();

      HTMLElement.prototype.getBoundingClientRect = function () {
        return {
          width: 180,
          height: 20,
          top: 0,
          left: 0,
          right: 180,
          bottom: 20,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      };

      rerender(
        <QuestionCard
          question={{
            ...SAMPLE_QUESTION,
            id: 'q_narrow_test',
            disciplineCode: 'MI',
            ascpPath:
              'Clinical Microbiology > Preanalytic Procedures > Specimen Processing > Digestion Decontamination',
          }}
          globalReveal={false}
        />,
      );

      const leafEl = screen.getByText('MI > ... > Digestion Decontamination');
      expect(leafEl).toBeInTheDocument();
      expect(leafEl).not.toHaveClass('truncate');
      expect(screen.getByText('AN | 6 / 10')).toBeInTheDocument();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origGetBCR;
    }
  });
});

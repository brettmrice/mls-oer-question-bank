import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuestionCard } from '@/components/QuestionCard';
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

describe('QuestionCard', () => {
  it('hides rationales, hint, and difficulty rationale until Educator Reveal is clicked', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();

    render(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={false}
        onInspect={onInspect}
      />,
    );

    expect(screen.getByText(/An asymptomatic marathon runner/)).toBeInTheDocument();
    expect(screen.getByText('Qualify upon medical director approval')).toBeInTheDocument();
    expect(screen.queryByText(/Conditioned athletes with pulse <50 bpm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Consider high vagal tone/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reveal Answer & Rationales/i }));

    expect(screen.getByText(/Conditioned athletes with pulse <50 bpm/)).toBeInTheDocument();
    expect(screen.getByText(/Consider high vagal tone/)).toBeInTheDocument();
    expect(screen.getByText(/Requires correlating athletic physiology/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Inspect Details/i }));
    expect(onInspect).toHaveBeenCalledWith(SAMPLE_QUESTION);
  });

  it('synchronizes local reveal state with globalReveal', () => {
    const { rerender } = render(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={false}
        onInspect={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Consider high vagal tone/)).not.toBeInTheDocument();

    rerender(
      <QuestionCard
        question={SAMPLE_QUESTION}
        globalReveal={true}
        onInspect={vi.fn()}
      />,
    );
    expect(screen.getByText(/Consider high vagal tone/)).toBeInTheDocument();
  });
});

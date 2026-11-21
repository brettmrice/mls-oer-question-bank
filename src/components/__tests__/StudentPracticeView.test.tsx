import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StudentPracticeView } from '@/components/StudentPracticeView';
import type { QuestionRecord } from '@/types/question';

const PRACTICE_QUESTIONS: QuestionRecord[] = [
  {
    id: 'q_1',
    displayId: 'BB_01-AN-0001',
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
    objective: 'Assess athlete pulse rules.',
    questionText: 'An athlete has a resting pulse of 46 bpm. What is required?',
    options: [
      { label: 'A', text: 'Permanent deferral', weight: 0, feedback: 'Incorrect: Physiological adaptation.' },
      { label: 'B', text: 'Medical director approval', weight: 100, feedback: 'Correct: Requires medical director sign-off.' },
    ],
    hint: 'High vagal tone in marathon runners.',
    similarIds: [],
    sourceFiles: [],
  },
];

describe('StudentPracticeView', () => {
  it('hides answers and rationales until submitted, toggles hint, and scores attempt', async () => {
    const user = userEvent.setup();
    render(
      <StudentPracticeView
        title="BB Practice Set"
        questions={PRACTICE_QUESTIONS}
        onExit={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Requires medical director sign-off/)).not.toBeInTheDocument();
    expect(screen.queryByText(/High vagal tone in marathon runners/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show Hint/i }));
    expect(screen.getByText(/High vagal tone in marathon runners/)).toBeInTheDocument();

    const optB = screen.getByRole('radio', { name: /Medical director approval/i });
    await user.click(optB);

    await user.click(screen.getByRole('button', { name: /Submit Attempt & Review Rationales/i }));

    expect(screen.getByText(/Attempt Score: 1 \/ 1 \(100%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Requires medical director sign-off/)).toBeInTheDocument();
  });
});

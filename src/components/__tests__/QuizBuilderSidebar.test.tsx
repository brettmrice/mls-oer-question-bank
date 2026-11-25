import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuizBuilderSidebar } from '@/components/QuizBuilderSidebar';
import type { ManifestData } from '@/types/question';

const mockManifest = {
  totalQuestions: 100,
  shards: [],
  prebuiltCatalog: {
    count: 4,
    items: [],
  },
} as unknown as ManifestData;

describe('QuizBuilderSidebar', () => {
  it('renders Quiz Builder title and all options in order and fires callbacks', async () => {
    const user = userEvent.setup();
    const onSelectPrebuilt = vi.fn();
    const onOpenMyQuizzes = vi.fn();
    const onCreateNewQuiz = vi.fn();

    render(
      <QuizBuilderSidebar
        manifest={mockManifest}
        activeView="explore"
        quizCount={2}
        activeQuizQuestionCount={5}
        backupStatus={{
          syncMode: 'local_only',
          unsyncedQuizCount: 0,
          unsyncedBookmarkCount: 0,
          lastGistSyncAt: null,
          lastBackupAt: null,
          totalQuizzes: 2,
          totalBookmarks: 0,
        }}
        onSelectPrebuilt={onSelectPrebuilt}
        onOpenMyQuizzes={onOpenMyQuizzes}
        onCreateNewQuiz={onCreateNewQuiz}
      />,
    );

    const heading = screen.getByRole('heading', { name: 'Quiz Builder' });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass('text-center');

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Pre-Built4',
      'My Quizzes2 (5)',
      'New Quiz',
    ]);

    await user.click(screen.getByRole('button', { name: /Pre-Built/i }));
    await user.click(screen.getByRole('button', { name: /My Quizzes/i }));
    await user.click(screen.getByRole('button', { name: /New Quiz/i }));

    expect(onSelectPrebuilt).toHaveBeenCalledTimes(1);
    expect(onOpenMyQuizzes).toHaveBeenCalledTimes(1);
    expect(onCreateNewQuiz).toHaveBeenCalledTimes(1);
  });
});

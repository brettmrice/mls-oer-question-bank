import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionRemixModal } from '@/components/QuestionRemixModal';
import { db } from '@/lib/db';
import type { GitHubSession } from '@/lib/githubAuth';
import type { QuestionRecord } from '@/types/question';

const QUESTION: QuestionRecord = {
  id: 'q_remix_ui_01',
  displayId: 'BB_01-AP-0010',
  disciplineCode: 'BB',
  disciplineName: 'Blood Banking',
  topicCode: 'BB_01',
  topicName: 'Blood Products',
  taxonomicCode: 'BB_01-A-02',
  ascpSubtopic: 'Storage',
  leafTopic: 'RBC Additive Solutions',
  ascpPath: 'Blood Banking > Blood Products > Storage > RBC Additive Solutions',
  subsetTags: ['Core_Pool'],
  bloomLevel: 'AP',
  difficulty: 5,
  difficultyRationale: 'Shelf-life standard check.',
  questionType: 'MC',
  objective: 'State RBC expiration under additive solution AS-1.',
  questionText: 'What is the maximum storage duration for AS-1 red blood cells at 1–6 °C?',
  options: [
    { label: 'A', text: '35 days', weight: 0, feedback: '35 days applies to CPDA-1.' },
    { label: 'B', text: '42 days', weight: 100, feedback: 'Correct for additive solutions.' },
  ],
  hint: 'Additive solutions extend shelf life by 1 week vs CPDA-1.',
  similarIds: [],
  sourceFiles: ['BB/BB_01/BB_01-Storage.md'],
};

const SESSION: GitHubSession = {
  accessToken: 'ghp_ui_token',
  username: 'reviewer_one',
  name: 'Reviewer One',
  avatarUrl: null,
  authMethod: 'pat',
  scopes: ['public_repo', 'gist'],
  connectedAt: '2026-11-21T12:00:00Z',
};

describe('QuestionRemixModal', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.remixedQuestions.clear();
  });

  it('allows editing topic-leaf & stem, saves locally, and submits variant issue to OER Question Bank', async () => {
    const user = userEvent.setup();
    const onSavedLocal = vi.fn();
    const onSubmittedCommunity = vi.fn();
    const captured: { body: Record<string, unknown> | null } = { body: null };

    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/issues') && init?.method === 'POST') {
        captured.body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            number: 88,
            html_url: 'https://github.com/mls-oer-question-bank/mls-oer-question-bank/issues/88',
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QuestionRemixModal
        open={true}
        sourceQuestion={QUESTION}
        parentQuestionId={QUESTION.id}
        githubSession={SESSION}
        onClose={vi.fn()}
        onSavedLocal={onSavedLocal}
        onSubmittedCommunity={onSubmittedCommunity}
      />,
    );

    // Expand Classification, Topic-Leaf & Metadata
    await user.click(screen.getByRole('button', { name: /Classification, Topic-Leaf & Metadata/i }));
    const leafInput = screen.getByPlaceholderText('e.g., Qualification');
    await user.clear(leafInput);
    await user.type(leafInput, 'CPDA-1 Storage');

    // Update stem
    const stemInput = screen.getByLabelText('Question Stem');
    await user.clear(stemInput);
    await user.type(stemInput, 'What is the maximum storage duration for CPDA-1 red blood cells?');

    // Mark option A as correct
    await user.click(screen.getByLabelText('Mark option A as correct'));

    // Save locally first
    await user.click(screen.getByRole('button', { name: /Save Locally/i }));
    await waitFor(() => expect(onSavedLocal).toHaveBeenCalledTimes(1));
    const savedRec = onSavedLocal.mock.calls[0][0];
    expect(savedRec.question.leafTopic).toBe('CPDA-1 Storage');
    expect(savedRec.question.ascpPath).toContain('CPDA-1 Storage');
    expect(savedRec.question.options[0].weight).toBe(100);

    // Submit to OER Question Bank
    await user.click(screen.getByRole('button', { name: /Submit to OER Question Bank/i }));
    await waitFor(() => expect(onSubmittedCommunity).toHaveBeenCalledTimes(1));

    expect(captured.body).not.toBeNull();
    expect(captured.body?.labels).toEqual(['question-variant', 'community-contribution']);
    expect(String(captured.body?.body)).toContain('CPDA-1 Storage');
    expect(String(captured.body?.body)).toContain('question-variant-v1');
    expect(screen.getByText(/View Issue #88 on GitHub/i)).toBeInTheDocument();
  });
});

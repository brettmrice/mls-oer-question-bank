import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionErrataModal } from '@/components/QuestionErrataModal';
import type { GitHubSession } from '@/lib/githubAuth';
import type { QuestionRecord } from '@/types/question';

const QUESTION: QuestionRecord = {
  id: 'q_errata_ui_01',
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

describe('QuestionErrataModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tracks live field diffs and submits structured errata issue to GitHub', async () => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    const captured: { body: Record<string, unknown> | null } = { body: null };

    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/issues') && init?.method === 'POST') {
        const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
        captured.body = parsed;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            number: 42,
            html_url: 'https://github.com/mls-oer-question-bank/mls-oer-question-bank/issues/42',
            title: String(parsed.title),
            state: 'open',
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QuestionErrataModal
        open={true}
        question={QUESTION}
        githubSession={SESSION}
        onClose={vi.fn()}
        onSubmitted={onSubmitted}
      />,
    );

    expect(screen.getByText('q_errata_ui_01')).toBeInTheDocument();

    const stemBox = screen.getByLabelText(/Proposed Question Stem/i);
    await user.clear(stemBox);
    await user.type(stemBox, 'What is the AABB maximum storage duration for AS-1 RBCs?');

    const rationaleBox = screen.getByLabelText(/Clinical \/ Pedagogical Rationale/i);
    await user.type(rationaleBox, 'Added explicit AABB standard reference.');

    expect(screen.getByText('questionText')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Submit Correction to GitHub/i }));

    expect(await screen.findByText(/#42/)).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalledWith(
      'https://github.com/mls-oer-question-bank/mls-oer-question-bank/issues/42',
      42,
    );
    expect(captured.body).not.toBeNull();
    expect(captured.body?.labels).toEqual(['question-errata']);
    expect(String(captured.body?.body)).toContain('q_errata_ui_01');
  });
});

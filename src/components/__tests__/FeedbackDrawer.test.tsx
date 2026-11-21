import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackDrawer } from '@/components/FeedbackDrawer';
import { db } from '@/lib/db';
import type { GitHubSession } from '@/lib/githubAuth';

describe('FeedbackDrawer', () => {
  beforeEach(async () => {
    await db.appState.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('supports PAT connection, issue submission, Live Tracker +1 display, and My Activity', async () => {
    const user = userEvent.setup();
    const sessionBox: { current: GitHubSession | null } = { current: null };
    const onSessionChange = vi.fn((next: GitHubSession | null) => {
      sessionBox.current = next;
    });

    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target === 'https://api.github.com/user') {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-oauth-scopes': 'gist, public_repo' }),
          json: async () => ({ login: 'dr_mls', name: 'Dr. MLS', avatar_url: null }),
        } as Response;
      }
      if (target.includes('/repos/') && target.includes('/issues') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            number: 99,
            html_url: 'https://github.com/mls-oer-question-bank/mls-oer-question-bank/issues/99',
            title: 'Add dark mode toggle',
            state: 'open',
          }),
        } as Response;
      }
      if (target.includes('/search/issues')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                number: 17,
                title: '[Errata] Clarify VDRL titer interpretation',
                state: 'closed',
                html_url: 'https://github.com/mls-oer-question-bank/mls-oer-question-bank/issues/17',
                created_at: '2026-11-19T10:00:00Z',
                updated_at: '2026-11-20T15:00:00Z',
                comments: 2,
                reactions: { '+1': 5 },
                labels: [{ name: 'question-errata' }],
                user: { login: 'dr_mls' },
                body: 'Fixed explanation.',
              },
            ],
          }),
        } as Response;
      }
      if (target.includes('/repos/') && target.includes('/issues')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              number: 99,
              title: 'Add keyboard shortcuts for Student Self-Practice',
              state: 'open',
              html_url: 'https://github.com/mls-oer-question-bank/mls-oer-question-bank/issues/99',
              created_at: '2026-11-21T10:00:00Z',
              updated_at: '2026-11-21T11:00:00Z',
              comments: 3,
              reactions: { '+1': 12 },
              labels: [{ name: 'enhancement' }],
              user: { login: 'dr_mls' },
              body: 'Arrow keys would be great.',
            },
          ],
        } as Response;
      }
      throw new Error(`Unexpected URL: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <FeedbackDrawer
        open={true}
        onClose={vi.fn()}
        githubSession={sessionBox.current}
        onSessionChange={onSessionChange}
      />,
    );

    // Connect with PAT
    await user.click(screen.getByRole('button', { name: /Connect with GitHub PAT/i }));
    await user.type(screen.getByLabelText(/GitHub Personal Access Token/i), 'ghp_abc_123');
    await user.click(screen.getByRole('button', { name: /Connect Token/i }));

    expect(onSessionChange).toHaveBeenCalled();
    expect(sessionBox.current?.username).toBe('dr_mls');

    rerender(
      <FeedbackDrawer
        open={true}
        onClose={vi.fn()}
        githubSession={sessionBox.current}
        onSessionChange={onSessionChange}
      />,
    );

    expect(screen.getByText(/Signed in as @dr_mls/i)).toBeInTheDocument();

    // Submit issue
    await user.type(screen.getByLabelText(/^Title$/i), 'Add dark mode toggle');
    await user.type(screen.getByLabelText(/^Details$/i), 'Helpful for late-night studying.');
    await user.click(screen.getByRole('button', { name: /Submit via GitHub API/i }));
    expect(await screen.findByText(/Submitted Issue #99 successfully/i)).toBeInTheDocument();

    // Live Tracker tab
    await user.click(screen.getByRole('button', { name: /Live Tracker/i }));
    expect(
      await screen.findByText(/#99 Add keyboard shortcuts for Student Self-Practice/i),
    ).toBeInTheDocument();
    expect(screen.getByText('+12')).toBeInTheDocument();

    // My Activity tab
    await user.click(screen.getByRole('button', { name: /My Activity/i }));
    expect(
      await screen.findByText(/#17 \[Errata\] Clarify VDRL titer interpretation/i),
    ).toBeInTheDocument();
  });
});

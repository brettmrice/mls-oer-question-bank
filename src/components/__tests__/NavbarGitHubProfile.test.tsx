import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Navbar } from '@/components/Navbar';
import { db } from '@/lib/db';
import {
  completeGitHubOAuthCallback,
  isEducatorContributor,
  isEmailAllowed,
  type GitHubSession,
} from '@/lib/githubAuth';
import type { ManifestData } from '@/types/question';

const SAMPLE_SESSION: GitHubSession = {
  accessToken: 'gho_test_token',
  username: 'dr_mls',
  name: 'Dr. MLS',
  avatarUrl: 'https://avatars.githubusercontent.com/u/12345?v=4',
  authMethod: 'oauth',
  scopes: ['gist', 'public_repo'],
  connectedAt: '2026-11-24T12:00:00.000Z',
};

describe('Navbar GitHub profile UI', () => {
  it('shows connected indicator and opens profile popover with account info and actions', async () => {
    const user = userEvent.setup();
    const onOpenQuizManager = vi.fn();
    const onOpenFeedback = vi.fn();
    const onGitHubLogout = vi.fn();

    render(
      <Navbar
        manifest={
          {
            totalQuestions: 10,
            shards: [],
            license: 'CC0-1.0',
          } as unknown as ManifestData
        }
        activeView="explore"
        activeSemanticShardCount={0}
        quizCount={1}
        activeQuizQuestionCount={5}
        backupStatus={null}
        githubSession={SAMPLE_SESSION}
        onSelectView={vi.fn()}
        onOpenSemanticModal={vi.fn()}
        onOpenQuizManager={onOpenQuizManager}
        onOpenFeedback={onOpenFeedback}
        onGitHubLogin={vi.fn()}
        onGitHubLogout={onGitHubLogout}
      />,
    );

    const profileTrigger = screen.getByRole('button', { name: /@dr_mls/i });
    expect(profileTrigger).toBeInTheDocument();
    expect(screen.getByAltText('@dr_mls')).toHaveAttribute('src', SAMPLE_SESSION.avatarUrl);

    await user.click(profileTrigger);

    const menu = screen.getByRole('menu', { name: /GitHub profile menu/i });
    expect(menu).toBeInTheDocument();
    expect(screen.getByText('Dr. MLS')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/gist, public_repo/)).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /View GitHub Profile/i })).toHaveAttribute(
      'href',
      'https://github.com/dr_mls',
    );

    await user.click(screen.getByRole('menuitem', { name: /Feedback & My Activity/i }));
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);

    await user.click(profileTrigger);
    await user.click(screen.getByRole('menuitem', { name: /Sign Out/i }));
    expect(onGitHubLogout).toHaveBeenCalledTimes(1);
  });

  it('shows Signing in... while OAuth callback is in flight', () => {
    render(
      <Navbar
        manifest={null}
        activeView="explore"
        activeSemanticShardCount={0}
        quizCount={0}
        activeQuizQuestionCount={0}
        backupStatus={null}
        githubSession={null}
        githubAuthBusy={true}
        onSelectView={vi.fn()}
        onOpenSemanticModal={vi.fn()}
        onOpenQuizManager={vi.fn()}
        onOpenFeedback={vi.fn()}
        onGitHubLogin={vi.fn()}
      />,
    );

    const btn = screen.getByRole('button', { name: /Signing in.../i });
    expect(btn).toBeDisabled();
  });
});

describe('completeGitHubOAuthCallback', () => {
  beforeEach(async () => {
    await db.appState.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('deduplicates concurrent OAuth callback exchanges for the same code', async () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'test_client_id');
    vi.stubEnv('VITE_OAUTH_RELAY_URL', 'https://relay.example.com');
    window.sessionStorage.setItem('mls_oer_github_oauth_state', 'state_123');
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const target = String(url);
      if (target.endsWith('/oauth/exchange')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'gho_abc', scope: 'gist public_repo' }),
        } as Response;
      }
      if (target === 'https://api.github.com/user') {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            login: 'dr_mls',
            name: 'Dr. MLS',
            avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
          }),
        } as Response;
      }
      if (target === 'https://api.github.com/user/emails') {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { email: 'brrice@augusta.edu', primary: true, verified: true },
            { email: 'unverified@augusta.edu', primary: false, verified: false },
          ],
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [r1, r2] = await Promise.all([
      completeGitHubOAuthCallback('?code=code_xyz&state=state_123'),
      completeGitHubOAuthCallback('?code=code_xyz&state=state_123'),
    ]);

    expect(r1.handled).toBe(true);
    expect(r1.session?.username).toBe('dr_mls');
    expect(r1.session?.verifiedEmails).toEqual(['brrice@augusta.edu']);
    expect(r2).toEqual(r1);
    const exchangeCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/oauth/exchange'),
    );
    expect(exchangeCalls).toHaveLength(1);
  });

  it('handles OAuth error query parameters cleanly', async () => {
    const res = await completeGitHubOAuthCallback(
      '?error=access_denied&error_description=User+cancelled+login',
    );
    expect(res.handled).toBe(true);
    expect(res.error).toBe('User cancelled login');
  });
});

describe('educator email allowlist helpers', () => {
  it('supports both exact email addresses and domain entries case-insensitively', () => {
    expect(isEmailAllowed('BRRICE@augusta.edu', ['brrice@augusta.edu'])).toBe(true);
    expect(isEmailAllowed('other@augusta.edu', ['brrice@augusta.edu'])).toBe(false);
    expect(isEmailAllowed('faculty@augusta.edu', ['augusta.edu'])).toBe(true);
    expect(isEmailAllowed('faculty@augusta.edu', ['@augusta.edu'])).toBe(true);
    expect(isEmailAllowed('evilaugusta.edu', ['augusta.edu'])).toBe(false);
  });

  it('checks verifiedEmails on GitHubSession', () => {
    expect(isEducatorContributor(null, ['brrice@augusta.edu'])).toBe(false);
    expect(
      isEducatorContributor({ ...SAMPLE_SESSION, verifiedEmails: [] }, ['brrice@augusta.edu']),
    ).toBe(false);
    expect(
      isEducatorContributor({ ...SAMPLE_SESSION, verifiedEmails: ['brrice@augusta.edu'] }, [
        'brrice@augusta.edu',
      ]),
    ).toBe(true);
  });
});

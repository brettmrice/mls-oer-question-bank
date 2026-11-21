import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import {
  buildErrataDiffMarkdown,
  buildFallbackIssueUrl,
  fetchPrebuiltFromGist,
  publishPrebuiltGist,
  restoreWorkspaceFromPrivateGist,
  syncWorkspaceToPrivateGist,
  WORKSPACE_GIST_FILENAME,
} from '@/lib/githubApi';
import {
  getGitHubSession,
  signInWithPersonalToken,
  signOutGitHub,
} from '@/lib/githubAuth';
import { createQuiz, getBackupStatus, listQuizzes } from '@/lib/quizStore';
import type { QuestionRecord } from '@/types/question';

const SAMPLE_QUESTION: QuestionRecord = {
  id: 'q_errata123456',
  displayId: 'HE_02-AN-0007',
  disciplineCode: 'HE',
  disciplineName: 'Hematology',
  topicCode: 'HE_02',
  topicName: 'Hemostasis & Coagulation',
  taxonomicCode: 'HE_02-B-03',
  ascpSubtopic: 'Platelets',
  leafTopic: 'Function Tests',
  ascpPath: 'Hematology > Hemostasis > Platelets > Function Tests',
  subsetTags: ['Core_Pool'],
  bloomLevel: 'AN',
  difficulty: 6,
  difficultyRationale: 'Correlates aggregometry curve with receptor defect.',
  questionType: 'MC',
  objective: 'Differentiate Bernard-Soulier syndrome from Glanzmann thrombasthenia.',
  questionText: 'Which agonist response is absent in Bernard-Soulier syndrome?',
  options: [
    { label: 'A', text: 'Ristocetin', weight: 100, feedback: 'Correct: GPIb-IX-V deficiency prevents vWF-ristocetin agglutination.' },
    { label: 'B', text: 'ADP', weight: 0, feedback: 'Incorrect: ADP aggregation remains normal in Bernard-Soulier.' },
  ],
  hint: 'Think of platelet adhesion defect involving GPIb.',
  similarIds: [],
  sourceFiles: ['HE/HE_02/HE_02-Platelets.md'],
};

describe('githubAuth & githubApi', () => {
  beforeEach(async () => {
    await db.quizzes.clear();
    await db.savedQuestions.clear();
    await db.appState.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds structured errata diff Markdown and JSON patch tied to immutable UID', () => {
    const updatedOptions = [
      { ...SAMPLE_QUESTION.options[0], weight: 0 },
      { ...SAMPLE_QUESTION.options[1], weight: 100, text: 'Collagen & ADP' },
    ];
    const diff = buildErrataDiffMarkdown({
      question: SAMPLE_QUESTION,
      proposedStem: `${SAMPLE_QUESTION.questionText} (Revised)`,
      proposedOptions: updatedOptions,
      proposedHint: 'Focus on platelet receptor complex',
      proposedDifficulty: 7,
      rationaleNote: 'CLSI H59 platelet aggregometry terminology clarification.',
      reporterRole: '@prof_mls',
    });

    expect(diff.changedFields).toEqual([
      'questionText',
      'correctOption',
      'options',
      'hint',
      'difficulty',
    ]);
    expect(diff.suggestedTitle).toContain('[Errata] q_errata123456 (HE_02-AN-0007)');
    expect(diff.markdownBody).toContain('**Immutable UID:** `q_errata123456`');
    expect(diff.markdownBody).toContain('errata-patch');
    expect(diff.patchJson.question_uid).toBe('q_errata123456');

    const issueUrl = buildFallbackIssueUrl({
      title: diff.suggestedTitle,
      body: diff.markdownBody,
      labels: ['question-errata'],
      repo: 'org/repo',
    });
    expect(issueUrl).toContain('https://github.com/org/repo/issues/new?');
    expect(issueUrl).toContain('labels=question-errata');
  });

  it('validates PAT sign-in, saves session to IndexedDB, and signs out cleanly', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/user')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-oauth-scopes': 'gist, public_repo' }),
          json: async () => ({ login: 'mls_educator', name: 'Dr. MLS', avatar_url: null }),
        } as Response;
      }
      throw new Error(`Unexpected URL ${String(url)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const session = await signInWithPersonalToken('ghp_test_token_123');
    expect(session.username).toBe('mls_educator');
    expect(session.scopes).toEqual(['gist', 'public_repo']);
    expect((await getGitHubSession())?.username).toBe('mls_educator');

    await signOutGitHub();
    expect(await getGitHubSession()).toBeNull();
  });

  it('syncs workspace to a private GitHub Gist and restores on another device', async () => {
    await createQuiz('Coagulation Quiz 1', 'Platelet disorders', {
      questionIds: ['q_errata123456'],
      activate: true,
    });

    let storedGistContent = '';
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/gists?per_page=50')) {
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      if (target.endsWith('/gists') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          public: boolean;
          files: Record<string, { content: string }>;
        };
        expect(body.public).toBe(false);
        storedGistContent = body.files[WORKSPACE_GIST_FILENAME].content;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'gist_private_sync_01',
            html_url: 'https://gist.github.com/gist_private_sync_01',
            public: false,
            files: { [WORKSPACE_GIST_FILENAME]: { content: storedGistContent } },
          }),
        } as Response;
      }
      if (target.endsWith('/gists/gist_private_sync_01') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'gist_private_sync_01',
            html_url: 'https://gist.github.com/gist_private_sync_01',
            public: false,
            files: { [WORKSPACE_GIST_FILENAME]: { content: storedGistContent } },
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const syncRes = await syncWorkspaceToPrivateGist('ghp_token');
    expect(syncRes.gistId).toBe('gist_private_sync_01');
    const statusAfterSync = await getBackupStatus();
    expect(statusAfterSync.syncMode).toBe('gist_synced');

    // Simulate clearing local quizzes on a second device (keeping syncGistId or discovering it)
    await db.quizzes.clear();
    expect(await listQuizzes()).toHaveLength(0);

    const restoreRes = await restoreWorkspaceFromPrivateGist('ghp_token', 'replace');
    expect(restoreRes.importedQuizzes).toBe(1);
    const restoredQuizzes = await listQuizzes();
    expect(restoredQuizzes[0].name).toBe('Coagulation Quiz 1');
    expect(restoredQuizzes[0].questionIds).toEqual(['q_errata123456']);
  });

  it('publishes and fetches public Pre-Built Gist share links', async () => {
    let savedJson = '';
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/gists') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          public: boolean;
          files: Record<string, { content: string }>;
        };
        expect(body.public).toBe(true);
        savedJson = Object.values(body.files)[0].content;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'abc123def4567890',
            html_url: 'https://gist.github.com/abc123def4567890',
            public: true,
            files: {},
          }),
        } as Response;
      }
      if (target.endsWith('/gists/abc123def4567890')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'abc123def4567890',
            html_url: 'https://gist.github.com/abc123def4567890',
            public: true,
            files: {
              'mls-oer-prebuilt-quiz.json': { content: savedJson },
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const pub = await publishPrebuiltGist('ghp_token', {
      title: 'Shared Heme Midterm',
      description: 'Public Gist quiz',
      author: 'Dr. Brett',
      tags: ['hematology'],
      questionIds: ['q_errata123456'],
      license: 'CC0-1.0',
    });

    expect(pub.shareUrl).toContain('#prebuilt=gist:abc123def4567890');
    expect(pub.practiceShareUrl).toContain('#prebuilt=gist:abc123def4567890&mode=practice');

    const loaded = await fetchPrebuiltFromGist('abc123def4567890');
    expect(loaded.title).toBe('Shared Heme Midterm');
    expect(loaded.questionIds).toEqual(['q_errata123456']);

    await expect(fetchPrebuiltFromGist('bad/id!')).rejects.toThrow(/Invalid GitHub Gist ID/i);
  });
});

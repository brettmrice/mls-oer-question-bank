import { getGitHubConfig } from '@/config/github';
import type { QuestionOption, QuestionRecord } from '@/types/question';
import { db } from './db';
import type { PrebuiltSharePayload } from './prebuiltShare';
import { exportWorkspaceBackupJson, importWorkspaceBackupJson } from './quizStore';

export const WORKSPACE_GIST_FILENAME = 'mls-oer-workspace-backup.json';
export const PREBUILT_GIST_FILENAME = 'mls-oer-prebuilt-quiz.json';

const SYNC_GIST_ID_KEY = 'syncGistId';
const LAST_GIST_SYNC_AT_KEY = 'lastGistSyncAt';
const LAST_BACKUP_AT_KEY = 'lastBackupAt';

interface GitHubGistFile {
  filename?: string;
  content?: string;
  raw_url?: string;
  truncated?: boolean;
}

interface GitHubGistResponse {
  id: string;
  html_url: string;
  public: boolean;
  description?: string | null;
  updated_at?: string;
  files: Record<string, GitHubGistFile>;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: 'open' | 'closed' | string;
  html_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  plusOneCount: number;
  labels: { name: string; color?: string }[];
  authorLogin: string;
  body: string;
}

export interface ErrataProposalInput {
  question: QuestionRecord;
  proposedStem: string;
  proposedOptions: QuestionOption[];
  proposedHint: string;
  proposedDifficulty: number;
  rationaleNote: string;
  reporterRole?: string;
}

export interface ErrataDiffSummary {
  changedFields: string[];
  patchJson: Record<string, unknown>;
  suggestedTitle: string;
  markdownBody: string;
}

async function githubFetch<T>(
  urlOrPath: string,
  options: {
    method?: string;
    token?: string | null;
    body?: unknown;
  } = {},
): Promise<T> {
  const url = urlOrPath.startsWith('http')
    ? urlOrPath
    : `https://api.github.com${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let message = `GitHub API error (${response.status})`;
    try {
      const errData = (await response.json()) as { message?: string };
      if (errData?.message) {
        message = `GitHub API error (${response.status}): ${errData.message}`;
      }
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function findExistingWorkspaceSyncGistId(token: string): Promise<string | null> {
  const saved = await db.appState.get(SYNC_GIST_ID_KEY);
  if (saved && typeof saved.value === 'string' && saved.value.trim().length > 0) {
    return saved.value.trim();
  }

  const gists = await githubFetch<GitHubGistResponse[]>('/gists?per_page=50', { token });
  const match = gists.find(
    (gist) => gist.files && Object.prototype.hasOwnProperty.call(gist.files, WORKSPACE_GIST_FILENAME),
  );
  return match?.id ?? null;
}

export async function syncWorkspaceToPrivateGist(token: string): Promise<{
  gistId: string;
  htmlUrl: string;
  syncedAt: string;
}> {
  const backupJson = await exportWorkspaceBackupJson();
  const existingGistId = await findExistingWorkspaceSyncGistId(token);

  const payload = {
    description:
      'MLS OER Question Bank — Private Workspace & Quiz Backup (No personal data stored on OER servers)',
    public: false,
    files: {
      [WORKSPACE_GIST_FILENAME]: {
        content: backupJson,
      },
    },
  };

  let gist: GitHubGistResponse;
  if (existingGistId) {
    try {
      gist = await githubFetch<GitHubGistResponse>(`/gists/${existingGistId}`, {
        method: 'PATCH',
        token,
        body: payload,
      });
    } catch (err) {
      // If user deleted the gist on GitHub, recreate cleanly on 404
      if (err instanceof Error && err.message.includes('(404)')) {
        gist = await githubFetch<GitHubGistResponse>('/gists', {
          method: 'POST',
          token,
          body: payload,
        });
      } else {
        throw err;
      }
    }
  } else {
    gist = await githubFetch<GitHubGistResponse>('/gists', {
      method: 'POST',
      token,
      body: payload,
    });
  }

  const syncedAt = new Date().toISOString();
  await Promise.all([
    db.appState.put({ key: SYNC_GIST_ID_KEY, value: gist.id }),
    db.appState.put({ key: LAST_GIST_SYNC_AT_KEY, value: syncedAt }),
    db.appState.put({ key: LAST_BACKUP_AT_KEY, value: syncedAt }),
  ]);

  return {
    gistId: gist.id,
    htmlUrl: gist.html_url,
    syncedAt,
  };
}

export async function restoreWorkspaceFromPrivateGist(
  token: string,
  mode: 'merge' | 'replace' = 'merge',
): Promise<{
  gistId: string;
  importedQuizzes: number;
  importedBookmarks: number;
  restoredAt: string;
}> {
  const gistId = await findExistingWorkspaceSyncGistId(token);
  if (!gistId) {
    throw new Error(
      'No existing private workspace backup Gist ("mls-oer-workspace-backup.json") was found on your GitHub account.',
    );
  }

  const gist = await githubFetch<GitHubGistResponse>(`/gists/${gistId}`, { token });
  const file = gist.files?.[WORKSPACE_GIST_FILENAME];
  if (!file) {
    throw new Error(`Backup Gist ${gistId} does not contain ${WORKSPACE_GIST_FILENAME}.`);
  }

  let content = file.content ?? '';
  if (file.truncated && file.raw_url) {
    const rawRes = await fetch(file.raw_url);
    if (!rawRes.ok) {
      throw new Error(`Failed to fetch full Gist backup content (${rawRes.status}).`);
    }
    content = await rawRes.text();
  }

  if (!content.trim()) {
    throw new Error('The private backup Gist file is empty.');
  }

  const result = await importWorkspaceBackupJson(content, mode);
  const restoredAt = new Date().toISOString();
  await Promise.all([
    db.appState.put({ key: SYNC_GIST_ID_KEY, value: gist.id }),
    db.appState.put({ key: LAST_GIST_SYNC_AT_KEY, value: restoredAt }),
    db.appState.put({ key: LAST_BACKUP_AT_KEY, value: restoredAt }),
  ]);

  return {
    gistId: gist.id,
    importedQuizzes: result.importedQuizzes,
    importedBookmarks: result.importedBookmarks,
    restoredAt,
  };
}

export async function publishPrebuiltGist(
  token: string,
  payload: PrebuiltSharePayload,
): Promise<{
  gistId: string;
  htmlUrl: string;
  shareUrl: string;
  practiceShareUrl: string;
}> {
  const serialized = JSON.stringify(
    {
      schemaVersion: 1,
      publishedAt: new Date().toISOString(),
      ...payload,
      license: 'CC0-1.0',
    },
    null,
    2,
  );

  const gist = await githubFetch<GitHubGistResponse>('/gists', {
    method: 'POST',
    token,
    body: {
      description: `MLS OER Pre-Built Quiz: ${payload.title} (${payload.questionIds.length} questions, CC0 1.0)`,
      public: true,
      files: {
        [PREBUILT_GIST_FILENAME]: {
          content: serialized,
        },
      },
    },
  });

  const base =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://mls-oer-question-bank.github.io/';
  return {
    gistId: gist.id,
    htmlUrl: gist.html_url,
    shareUrl: `${base}#prebuilt=gist:${gist.id}`,
    practiceShareUrl: `${base}#prebuilt=gist:${gist.id}&mode=practice`,
  };
}

export async function fetchPrebuiltFromGist(gistId: string): Promise<PrebuiltSharePayload> {
  const cleanId = gistId.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(cleanId)) {
    throw new Error('Invalid GitHub Gist ID format.');
  }

  const gist = await githubFetch<GitHubGistResponse>(`/gists/${cleanId}`);
  const files = Object.values(gist.files ?? {});
  const targetFile =
    gist.files?.[PREBUILT_GIST_FILENAME] ??
    files.find((f) => f.filename?.toLowerCase().endsWith('.json')) ??
    files[0];

  if (!targetFile) {
    throw new Error(`Gist ${cleanId} does not contain any quiz JSON file.`);
  }

  let content = targetFile.content ?? '';
  if (targetFile.truncated && targetFile.raw_url) {
    const rawRes = await fetch(targetFile.raw_url);
    if (!rawRes.ok) {
      throw new Error(`Unable to fetch full Gist file (${rawRes.status}).`);
    }
    content = await rawRes.text();
  }

  const parsed = JSON.parse(content) as Partial<PrebuiltSharePayload>;
  if (!parsed || !Array.isArray(parsed.questionIds) || parsed.questionIds.length === 0) {
    throw new Error('Gist JSON is missing a non-empty "questionIds" array.');
  }

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Shared Gist Quiz',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    author: typeof parsed.author === 'string' ? parsed.author : undefined,
    institution: typeof parsed.institution === 'string' ? parsed.institution : undefined,
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : [],
    questionIds: parsed.questionIds.filter((id): id is string => typeof id === 'string'),
    customPoints: parsed.customPoints,
    license: 'CC0-1.0',
  };
}

export function buildErrataDiffMarkdown(input: ErrataProposalInput): ErrataDiffSummary {
  const { question } = input;
  const changedFields: string[] = [];

  const cleanStem = input.proposedStem.trim();
  if (cleanStem !== question.questionText.trim()) {
    changedFields.push('questionText');
  }

  const origCorrect = question.options.find((o) => o.weight > 0)?.label ?? '';
  const propCorrect = input.proposedOptions.find((o) => o.weight > 0)?.label ?? '';
  if (origCorrect !== propCorrect) {
    changedFields.push('correctOption');
  }

  const origOptionsSig = JSON.stringify(question.options);
  const propOptionsSig = JSON.stringify(input.proposedOptions);
  if (origOptionsSig !== propOptionsSig) {
    changedFields.push('options');
  }

  const cleanHint = input.proposedHint.trim();
  if (cleanHint !== (question.hint ?? '').trim()) {
    changedFields.push('hint');
  }

  if (Number(input.proposedDifficulty) !== Number(question.difficulty)) {
    changedFields.push('difficulty');
  }

  const patchJson: Record<string, unknown> = {
    question_uid: question.id,
    display_id: question.displayId,
    ascp_path: question.ascpPath,
    changed_fields: changedFields,
    reporter_role: input.reporterRole ?? 'MLS Educator / Reviewer',
    rationale: input.rationaleNote.trim(),
    original: {
      question_text: question.questionText,
      difficulty: question.difficulty,
      hint: question.hint,
      options: question.options,
    },
    proposed: {
      question_text: cleanStem,
      difficulty: input.proposedDifficulty,
      hint: cleanHint,
      options: input.proposedOptions,
    },
    submitted_at: new Date().toISOString(),
  };

  const diffLines: string[] = [];
  if (changedFields.includes('questionText')) {
    diffLines.push(
      '### Question Stem\n```diff\n- ' +
        question.questionText.replace(/\n/g, '\n- ') +
        '\n+ ' +
        cleanStem.replace(/\n/g, '\n+ ') +
        '\n```',
    );
  }
  if (changedFields.includes('options') || changedFields.includes('correctOption')) {
    const formatOpt = (opt: QuestionOption, prefix: string) =>
      `${prefix} ${opt.label}) [${opt.weight}%] ${opt.text}` +
      (opt.feedback ? ` — Feedback: ${opt.feedback}` : '');
    const optDiff: string[] = [];
    const maxLen = Math.max(question.options.length, input.proposedOptions.length);
    for (let i = 0; i < maxLen; i += 1) {
      const oldOpt = question.options[i];
      const newOpt = input.proposedOptions[i];
      if (!oldOpt && newOpt) {
        optDiff.push(formatOpt(newOpt, '+'));
      } else if (oldOpt && !newOpt) {
        optDiff.push(formatOpt(oldOpt, '-'));
      } else if (oldOpt && newOpt && JSON.stringify(oldOpt) !== JSON.stringify(newOpt)) {
        optDiff.push(formatOpt(oldOpt, '-'));
        optDiff.push(formatOpt(newOpt, '+'));
      } else if (newOpt) {
        optDiff.push(formatOpt(newOpt, ' '));
      }
    }
    diffLines.push('### Options & Answer Key\n```diff\n' + optDiff.join('\n') + '\n```');
  }
  if (changedFields.includes('hint')) {
    diffLines.push(
      `### Study Hint\n\`\`\`diff\n- ${question.hint || '(none)'}\n+ ${cleanHint || '(none)'}\n\`\`\``,
    );
  }
  if (changedFields.includes('difficulty')) {
    diffLines.push(
      `### Difficulty\n\`\`\`diff\n- Level ${question.difficulty}\n+ Level ${input.proposedDifficulty}\n\`\`\``,
    );
  }

  const changedSummary = changedFields.length > 0 ? changedFields.join(', ') : 'general note';
  const suggestedTitle = `[Errata] ${question.id} (${question.displayId}) — ${changedSummary}`;

  const markdownBody = [
    `## Question Errata / Correction Proposal`,
    `- **Immutable UID:** \`${question.id}\``,
    `- **Display ID:** \`${question.displayId}\``,
    `- **ASCP Taxonomy:** ${question.ascpPath}`,
    `- **Changed Fields:** ${changedFields.length > 0 ? changedFields.map((f) => `\`${f}\``).join(', ') : '_None (reviewer note only)_'}`,
    `- **Source Files:** ${question.sourceFiles.length > 0 ? question.sourceFiles.map((f) => `\`${f}\``).join(', ') : 'Unknown'}`,
    '',
    '### Clinical / Pedagogical Rationale',
    input.rationaleNote.trim() || '_No additional rationale provided._',
    '',
    diffLines.length > 0 ? diffLines.join('\n\n') : '_No field diffs detected._',
    '',
    '<details>',
    '<summary>Structured Machine-Readable Patch JSON (<code>errata-patch</code>)</summary>',
    '',
    '```json',
    JSON.stringify(patchJson, null, 2),
    '```',
    '</details>',
  ].join('\n');

  return {
    changedFields,
    patchJson,
    suggestedTitle,
    markdownBody,
  };
}

export interface VariantSubmissionInput {
  sourceQuestion: QuestionRecord;
  parentQuestionId: string;
  remixedQuestion: QuestionRecord;
  rationaleNote: string;
  contributorRole: string;
}

export interface VariantSubmissionSummary {
  suggestedTitle: string;
  markdownBody: string;
  variantJson: Record<string, unknown>;
}

export function buildVariantSubmissionMarkdown(
  input: VariantSubmissionInput,
): VariantSubmissionSummary {
  const { sourceQuestion, parentQuestionId, remixedQuestion } = input;
  const suggestedTitle = `[Question Variant] ${sourceQuestion.displayId} (${remixedQuestion.disciplineCode} / ${remixedQuestion.topicCode})`;

  const variantJson: Record<string, unknown> = {
    schema: 'mls-oer-question-variant-v1',
    parentQuestionId,
    remixedFromId: sourceQuestion.id,
    remixedFromDisplayId: sourceQuestion.displayId,
    contributor: input.contributorRole,
    rationaleNote: input.rationaleNote.trim(),
    question: remixedQuestion,
  };

  const optionLines = remixedQuestion.options.map((opt) => {
    const marker = opt.weight === 100 ? '[x]' : '[ ]';
    return `- ${marker} **${opt.label}.** ${opt.text}${opt.feedback ? `\n  - _Feedback:_ ${opt.feedback}` : ''}`;
  });

  const markdownBody = [
    '### Community Question Variant / Remix Contribution',
    `- **Parent Question ID:** \`${parentQuestionId}\``,
    `- **Remixed From:** \`${sourceQuestion.displayId}\` (\`${sourceQuestion.id}\`)`,
    `- **ASCP Path / Topic-Leaf:** ${remixedQuestion.ascpPath}`,
    `- **Discipline / Topic:** ${remixedQuestion.disciplineCode} (${remixedQuestion.disciplineName}) / ${remixedQuestion.topicCode} (${remixedQuestion.topicName})`,
    `- **Subtopic / Leaf:** ${remixedQuestion.ascpSubtopic} > ${remixedQuestion.leafTopic}`,
    `- **Bloom Level / Difficulty:** ${remixedQuestion.bloomLevel} | ${remixedQuestion.difficulty} / 10`,
    `- **Question Type:** ${remixedQuestion.questionType}`,
    `- **Contributor:** ${input.contributorRole}`,
    '',
    '### Remix / Pedagogical Rationale',
    input.rationaleNote.trim() || '_No additional rationale provided._',
    '',
    '### Learning Objective',
    remixedQuestion.objective || '_None provided._',
    '',
    '### Question Stem',
    remixedQuestion.questionText,
    '',
    '### Options',
    ...optionLines,
    '',
    '### Hint & Difficulty Rationale',
    `- **Hint:** ${remixedQuestion.hint || '_None_'}`,
    `- **Difficulty Rationale:** ${remixedQuestion.difficultyRationale || '_None_'}`,
    '',
    '<details>',
    '<summary>Structured Machine-Readable Variant JSON (<code>question-variant-v1</code>)</summary>',
    '',
    '```json',
    JSON.stringify(variantJson, null, 2),
    '```',
    '</details>',
  ].join('\n');

  return {
    suggestedTitle,
    markdownBody,
    variantJson,
  };
}

export async function createGitHubIssue(
  token: string,
  params: {
    title: string;
    body: string;
    labels?: string[];
    repo?: string;
  },
): Promise<{
  number: number;
  html_url: string;
  title: string;
  state: string;
}> {
  const targetRepo = params.repo ?? getGitHubConfig().repo;
  return githubFetch<{
    number: number;
    html_url: string;
    title: string;
    state: string;
  }>(`/repos/${targetRepo}/issues`, {
    method: 'POST',
    token,
    body: {
      title: params.title,
      body: params.body,
      labels: params.labels && params.labels.length > 0 ? params.labels : undefined,
    },
  });
}

interface RawGitHubIssueItem {
  number: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  body?: string | null;
  pull_request?: unknown;
  reactions?: { '+1'?: number };
  labels?: Array<{ name?: string; color?: string } | string>;
  user?: { login?: string } | null;
}

function normalizeIssue(raw: RawGitHubIssueItem): GitHubIssueSummary {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    html_url: raw.html_url,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    comments: raw.comments ?? 0,
    plusOneCount: raw.reactions?.['+1'] ?? 0,
    labels: (raw.labels ?? []).map((lbl) =>
      typeof lbl === 'string'
        ? { name: lbl }
        : { name: lbl.name ?? '', color: lbl.color },
    ),
    authorLogin: raw.user?.login ?? 'anonymous',
    body: raw.body ?? '',
  };
}

export async function fetchRepoIssues(params: {
  label?: string;
  state?: 'open' | 'closed' | 'all';
  perPage?: number;
  token?: string | null;
  repo?: string;
} = {}): Promise<GitHubIssueSummary[]> {
  const targetRepo = params.repo ?? getGitHubConfig().repo;
  const search = new URLSearchParams({
    state: params.state ?? 'open',
    per_page: String(params.perPage ?? 30),
    sort: 'updated',
    direction: 'desc',
  });
  if (params.label && params.label !== 'all') {
    search.set('labels', params.label);
  }

  const rawItems = await githubFetch<RawGitHubIssueItem[]>(
    `/repos/${targetRepo}/issues?${search.toString()}`,
    { token: params.token },
  );

  return rawItems.filter((item) => !item.pull_request).map(normalizeIssue);
}

export async function fetchMyActivity(
  username: string,
  token?: string | null,
  repo?: string,
): Promise<{
  authoredIssues: GitHubIssueSummary[];
  involvedIssues: GitHubIssueSummary[];
}> {
  const targetRepo = repo ?? getGitHubConfig().repo;
  const authoredRaw = await githubFetch<RawGitHubIssueItem[]>(
    `/repos/${targetRepo}/issues?creator=${encodeURIComponent(username)}&state=all&per_page=30`,
    { token },
  );
  const authoredIssues = authoredRaw.filter((item) => !item.pull_request).map(normalizeIssue);

  let involvedIssues = authoredIssues;
  try {
    const query = encodeURIComponent(`repo:${targetRepo} is:issue involves:${username}`);
    const searchRes = await githubFetch<{ items?: RawGitHubIssueItem[] }>(
      `/search/issues?q=${query}&sort=updated&order=desc&per_page=30`,
      { token },
    );
    if (Array.isArray(searchRes.items)) {
      involvedIssues = searchRes.items.map(normalizeIssue);
    }
  } catch {
    // Search API may hit secondary rate limit when unauthenticated; keep creator results
    involvedIssues = authoredIssues;
  }

  return { authoredIssues, involvedIssues };
}

export function buildFallbackIssueUrl(params: {
  title: string;
  body: string;
  labels?: string[];
  repo?: string;
}): string {
  const targetRepo = params.repo ?? getGitHubConfig().repo;
  const truncatedBody =
    params.body.length > 5500
      ? `${params.body.slice(0, 5400)}\n\n...(truncated for URL length — paste full diff from clipboard)`
      : params.body;
  const query = new URLSearchParams({
    title: params.title,
    body: truncatedBody,
  });
  if (params.labels && params.labels.length > 0) {
    query.set('labels', params.labels.join(','));
  }
  return `https://github.com/${targetRepo}/issues/new?${query.toString()}`;
}

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LogOut,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  ThumbsUp,
} from 'lucide-react';
import { GitHubIcon } from '@/components/ui/GitHubIcon';
import { getGitHubConfig } from '@/config/github';
import {
  buildFallbackIssueUrl,
  createGitHubIssue,
  fetchMyActivity,
  fetchRepoIssues,
  type GitHubIssueSummary,
} from '@/lib/githubApi';
import {
  signInWithPersonalToken,
  signOutGitHub,
  startGitHubOAuthFlow,
  type GitHubSession,
} from '@/lib/githubAuth';
import { Badge, Button, Card, Drawer, Input } from './ui/primitives';

export type FeedbackTab = 'submit' | 'tracker' | 'activity';

export interface FeedbackDrawerProps {
  open: boolean;
  onClose: () => void;
  githubSession: GitHubSession | null;
  onSessionChange: (session: GitHubSession | null) => void;
  onNotice?: (message: string) => void;
  initialTab?: FeedbackTab;
}

const FEEDBACK_CATEGORIES: Array<{
  id: string;
  label: string;
  apiLabel: string;
  placeholder: string;
}> = [
  {
    id: 'enhancement',
    label: 'Feature Idea',
    apiLabel: 'enhancement',
    placeholder: 'Describe an improvement for the MLS OER Question Bank or Pre-Built quizzes...',
  },
  {
    id: 'bug',
    label: 'Bug Report',
    apiLabel: 'bug',
    placeholder: 'Steps to reproduce, expected behavior, and browser details...',
  },
  {
    id: 'taxonomy',
    label: 'Taxonomy / Mapping',
    apiLabel: 'taxonomy',
    placeholder: 'Which ASCP topic code or question mapping looks mismatched?',
  },
  {
    id: 'prebuilt',
    label: 'Pre-Built Quiz Submission',
    apiLabel: 'prebuilt-quiz',
    placeholder: 'Share title, target course/track, and Pre-Built share JSON / Gist URL...',
  },
];

const TRACKER_LABEL_FILTERS = [
  { id: 'all', label: 'All Issues' },
  { id: 'question-errata', label: 'Errata' },
  { id: 'enhancement', label: 'Features' },
  { id: 'bug', label: 'Bugs' },
  { id: 'prebuilt-quiz', label: 'Pre-Built Quizzes' },
];

function IssueRow({ issue }: { issue: GitHubIssueSummary }): React.ReactElement {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <a
          href={issue.html_url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-[var(--text-primary)] hover:text-indigo-700 inline-flex items-start gap-1"
        >
          <span>
            #{issue.number} {issue.title}
          </span>
          <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--text-secondary)]" />
        </a>
        <Badge
          variant="default"
          className={
            issue.state === 'open'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200 shrink-0'
              : 'bg-slate-200 dark:bg-slate-700 text-[var(--text-primary)] border-[var(--border-color)] shrink-0'
          }
        >
          {issue.state}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>by @{issue.authorLogin}</span>
        <span>Updated {new Date(issue.updated_at).toLocaleDateString()}</span>
        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)] font-medium">
          <ThumbsUp className="h-3 w-3" />
          +{issue.plusOneCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageCircle className="h-3 w-3" />
          {issue.comments}
        </span>
        {issue.labels.map((lbl) => (
          <Badge key={lbl.name} variant="outline" className="text-[10px] py-0">
            {lbl.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function FeedbackDrawer({
  open,
  onClose,
  githubSession,
  onSessionChange,
  onNotice,
  initialTab = 'submit',
}: FeedbackDrawerProps): React.ReactElement | null {
  const cfg = getGitHubConfig();
  const [activeTab, setActiveTab] = useState<FeedbackTab>(initialTab);

  // Auth / PAT state
  const [showPatInput, setShowPatInput] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Submit form state
  const [categoryId, setCategoryId] = useState<string>('enhancement');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [submittingIssue, setSubmittingIssue] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdIssue, setCreatedIssue] = useState<{ number: number; url: string } | null>(null);

  // Live Tracker state
  const [trackerLabel, setTrackerLabel] = useState<string>('all');
  const [trackerState, setTrackerState] = useState<'open' | 'closed' | 'all'>('open');
  const [trackerIssues, setTrackerIssues] = useState<GitHubIssueSummary[]>([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState<string | null>(null);

  // My Activity state
  const [authoredIssues, setAuthoredIssues] = useState<GitHubIssueSummary[]>([]);
  const [involvedIssues, setInvolvedIssues] = useState<GitHubIssueSummary[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  const loadTracker = useCallback(async () => {
    setTrackerLoading(true);
    setTrackerError(null);
    try {
      const items = await fetchRepoIssues({
        label: trackerLabel,
        state: trackerState,
        token: githubSession?.accessToken,
      });
      setTrackerIssues(items);
    } catch (err) {
      setTrackerError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrackerLoading(false);
    }
  }, [trackerLabel, trackerState, githubSession?.accessToken]);

  const loadActivity = useCallback(async () => {
    if (!githubSession) return;
    setActivityLoading(true);
    setActivityError(null);
    try {
      const result = await fetchMyActivity(githubSession.username, githubSession.accessToken);
      setAuthoredIssues(result.authoredIssues);
      setInvolvedIssues(result.involvedIssues);
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivityLoading(false);
    }
  }, [githubSession]);

  useEffect(() => {
    if (!open) return;
    if (activeTab === 'tracker') {
      void loadTracker();
    } else if (activeTab === 'activity' && githubSession) {
      void loadActivity();
    }
  }, [open, activeTab, githubSession, loadTracker, loadActivity]);

  const handleOAuthClick = () => {
    setAuthError(null);
    try {
      startGitHubOAuthFlow();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
      setShowPatInput(true);
    }
  };

  const handlePatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const session = await signInWithPersonalToken(patInput);
      onSessionChange(session);
      setPatInput('');
      setShowPatInput(false);
      onNotice?.(`Signed in to GitHub as @${session.username}.`);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOutGitHub();
    onSessionChange(null);
    setAuthoredIssues([]);
    setInvolvedIssues([]);
    onNotice?.('Signed out of GitHub session (removed token from local IndexedDB).');
  };

  const selectedCategory =
    FEEDBACK_CATEGORIES.find((c) => c.id === categoryId) ?? FEEDBACK_CATEGORIES[0];

  const handleSubmitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubSession) return;
    if (!issueTitle.trim()) {
      setSubmitError('Please enter a short issue title.');
      return;
    }

    setSubmittingIssue(true);
    setSubmitError(null);
    setCreatedIssue(null);
    try {
      const created = await createGitHubIssue(githubSession.accessToken, {
        title: issueTitle.trim(),
        body: issueBody.trim() || '_Submitted via MLS OER Feedback Drawer._',
        labels: [selectedCategory.apiLabel],
      });
      setCreatedIssue({ number: created.number, url: created.html_url });
      setIssueTitle('');
      setIssueBody('');
      onNotice?.(`Created GitHub Issue #${created.number}.`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingIssue(false);
    }
  };

  const fallbackIssueHref = buildFallbackIssueUrl({
    title: issueTitle.trim() || `[${selectedCategory.label}] `,
    body: issueBody.trim(),
    labels: [selectedCategory.apiLabel],
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Community Feedback, Issues & Activity"
      subtitle={`GitHub-backed public tracker (${cfg.repo}) — zero OER backend database`}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-5">
        {/* GitHub Session Card */}
        <Card className="p-4 border-indigo-200 bg-indigo-50/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <GitHubIcon className="h-4 w-4 text-indigo-700 mt-0.5 shrink-0" />
              <div className="min-w-0">
                {githubSession ? (
                  <div className="flex items-center gap-2.5">
                    {githubSession.avatarUrl && (
                      <img
                        src={githubSession.avatarUrl}
                        alt={`@${githubSession.username}`}
                        className="h-7 w-7 rounded-full object-cover border border-[var(--border-color)] shrink-0"
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        Signed in as @{githubSession.username}
                      </span>
                      {githubSession.name && (
                        <span className="text-xs text-[var(--text-secondary)]">
                          ({githubSession.name})
                        </span>
                      )}
                      <Badge variant="accent" className="text-[10px] uppercase">
                        {githubSession.authMethod}
                      </Badge>
                      <a
                        href={`https://github.com/${githubSession.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline dark:text-indigo-400"
                      >
                        Profile
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    Connect GitHub (Optional — Required for In-App Submission &amp; Private Gist Sync)
                  </p>
                )}
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span>
                    We don&apos;t store your account info on any server — your sign-in stays privately in your browser.
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {githubSession ? (
                <Button variant="outline" size="sm" onClick={handleSignOut}>
                  <LogOut className="h-3.5 w-3.5" />
                  Sign Out
                </Button>
              ) : (
                <>
                  {cfg.isOAuthConfigured && (
                    <Button variant="primary" size="sm" onClick={handleOAuthClick}>
                      <GitHubIcon className="h-3.5 w-3.5" />
                      Sign in with GitHub
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPatInput((prev) => !prev)}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {cfg.isOAuthConfigured ? 'Use Token (PAT)' : 'Connect with GitHub PAT'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {!githubSession && !cfg.isOAuthConfigured && (
            <p className="text-[11px] text-[var(--text-secondary)]">
              1-click OAuth is waiting on <code className="font-mono">VITE_GITHUB_CLIENT_ID</code> &amp;{' '}
              <code className="font-mono">VITE_OAUTH_RELAY_URL</code>. You can connect immediately using a GitHub Personal Access Token (
              <code className="font-mono">gist</code>, <code className="font-mono">public_repo</code>) or submit via pre-filled GitHub links.
            </p>
          )}

          {showPatInput && !githubSession && (
            <form onSubmit={handlePatSubmit} className="pt-2 border-t border-indigo-200/70 flex flex-wrap gap-2">
              <Input
                type="password"
                value={patInput}
                onChange={(e) => setPatInput(e.target.value)}
                placeholder="Paste ghp_... or github_pat_... token"
                aria-label="GitHub Personal Access Token"
                className="flex-1 min-w-[220px] h-8 text-xs bg-[var(--bg-surface)]"
              />
              <Button type="submit" variant="primary" size="sm" disabled={authBusy}>
                {authBusy ? 'Verifying...' : 'Connect Token'}
              </Button>
            </form>
          )}

          {authError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {authError}
            </div>
          )}
        </Card>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
          {[
            { id: 'submit' as const, label: 'Submit Feedback' },
            { id: 'tracker' as const, label: 'Live Tracker' },
            { id: 'activity' as const, label: 'My Activity' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[var(--bg-surface)] text-indigo-700 shadow-2xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Submit Feedback */}
        {activeTab === 'submit' && (
          <form onSubmit={handleSubmitIssue} className="space-y-4">
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)] mb-2">
                Feedback Type
              </span>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      categoryId === cat.id
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                        : 'border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-primary)]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="feedback-title" className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)] mb-1.5">
                Title
              </label>
              <Input
                id="feedback-title"
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder={`Short summary (${selectedCategory.label})`}
              />
            </div>

            <div>
              <label htmlFor="feedback-body" className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)] mb-1.5">
                Details
              </label>
              <textarea
                id="feedback-body"
                rows={5}
                value={issueBody}
                onChange={(e) => setIssueBody(e.target.value)}
                placeholder={selectedCategory.placeholder}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {submitError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            {createdIssue && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Submitted Issue #{createdIssue.number} successfully!
                </span>
                <a
                  href={createdIssue.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold underline"
                >
                  Open on GitHub
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <a
                href={fallbackIssueHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
              >
                <GitHubIcon className="h-3.5 w-3.5" />
                Open Pre-Filled Issue on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>

              {githubSession && (
                <Button type="submit" variant="primary" size="sm" disabled={submittingIssue}>
                  <Send className="h-3.5 w-3.5" />
                  {submittingIssue ? 'Submitting...' : 'Submit via GitHub API'}
                </Button>
              )}
            </div>
          </form>
        )}

        {/* Tab 2: Live Tracker */}
        {activeTab === 'tracker' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {TRACKER_LABEL_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setTrackerLabel(f.id)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                      trackerLabel === f.id
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="Issue state filter"
                  value={trackerState}
                  onChange={(e) => setTrackerState(e.target.value as 'open' | 'closed' | 'all')}
                  className="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="all">All</option>
                </select>
                <Button variant="outline" size="sm" onClick={() => void loadTracker()} disabled={trackerLoading}>
                  <RefreshCw className={`h-3.5 w-3.5 ${trackerLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>

            {trackerError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Could not fetch issues from <code className="font-mono">{cfg.repo}</code>: {trackerError}
              </div>
            )}

            {trackerLoading ? (
              <p className="text-xs text-[var(--text-secondary)] py-4 text-center">Loading repository issues...</p>
            ) : trackerIssues.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-color)] p-6 text-center text-xs text-[var(--text-secondary)]">
                No matching issues found in <code className="font-mono">{cfg.repo}</code>.
              </div>
            ) : (
              <div className="space-y-2.5">
                {trackerIssues.map((issue) => (
                  <IssueRow key={issue.number} issue={issue} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: My Activity */}
        {activeTab === 'activity' && (
          <div className="space-y-4">
            {!githubSession ? (
              <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] p-6 text-center space-y-2">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Sign in with GitHub to inspect your authored errata &amp; discussions
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Once signed in above via OAuth or a Personal Access Token, this tab queries GitHub Issues you created or participated in.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">
                    Activity for <span className="text-indigo-700">@{githubSession.username}</span> in{' '}
                    <code className="font-mono">{cfg.repo}</code>
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void loadActivity()} disabled={activityLoading}>
                    <RefreshCw className={`h-3.5 w-3.5 ${activityLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>

                {activityError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    {activityError}
                  </div>
                )}

                {activityLoading ? (
                  <p className="text-xs text-[var(--text-secondary)] py-4 text-center">Loading your GitHub activity...</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">
                        Authored Issues &amp; Errata ({authoredIssues.length})
                      </h4>
                      {authoredIssues.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)]">You have not opened any issues in this repository yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {authoredIssues.map((issue) => (
                            <IssueRow key={`authored-${issue.number}`} issue={issue} />
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">
                        All Involved Threads ({involvedIssues.length})
                      </h4>
                      {involvedIssues.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)]">No involved threads found.</p>
                      ) : (
                        <div className="space-y-2">
                          {involvedIssues.map((issue) => (
                            <IssueRow key={`involved-${issue.number}`} issue={issue} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

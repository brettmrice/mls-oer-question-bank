import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Cloud,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  GitBranch,
  Github,
  GraduationCap,
  HardDrive,
  KeyRound,
  LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { BlueprintBalanceMeter } from '@/components/BlueprintBalanceMeter';
import { FormattedText } from '@/components/FormattedText';
import { QuizExportButtons } from '@/components/QuizExportButtons';
import { Badge, Button, Drawer, Input, Separator, Skeleton } from '@/components/ui/primitives';
import { getGitHubConfig } from '@/config/github';
import type { QuizWorkspaceRecord } from '@/lib/db';
import { fetchQuestionsByIds } from '@/lib/duckdb';
import { sanitizeFilename, triggerTextDownload } from '@/lib/exporters/download';
import {
  publishPrebuiltGist,
  restoreWorkspaceFromPrivateGist,
  syncWorkspaceToPrivateGist,
} from '@/lib/githubApi';
import {
  signInWithPersonalToken,
  signOutGitHub,
  startGitHubOAuthFlow,
  type GitHubSession,
} from '@/lib/githubAuth';
import {
  buildPrebuiltCatalogIssueUrl,
  encodePrebuiltHashUrl,
  type PrebuiltSharePayload,
} from '@/lib/prebuiltShare';
import { detectEnemyPairs } from '@/lib/quizAnalytics';
import {
  createQuiz,
  deleteQuiz,
  duplicateQuiz,
  exportWorkspaceBackupJson,
  importWorkspaceBackupJson,
  removeQuestionFromQuiz,
  renameQuiz,
  reorderQuizQuestion,
  setQuestionPoints,
  swapQuizQuestion,
  type BackupStatus,
} from '@/lib/quizStore';
import { BLOOM_META, cn, DISCIPLINE_COLORS } from '@/lib/utils';
import type { ManifestData, QuestionRecord } from '@/types/question';

export interface QuizManagerDrawerProps {
  open: boolean;
  focusNewQuizRequest?: number;
  manifest: ManifestData;
  quizzes: QuizWorkspaceRecord[];
  activeQuizId: string | null;
  backupStatus: BackupStatus | null;
  githubSession: GitHubSession | null;
  onGitHubSessionChange: (session: GitHubSession | null) => void;
  onOpenFeedbackDrawer?: () => void;
  onClose: () => void;
  onWorkspaceChanged: (nextActiveId?: string | null) => Promise<void>;
  onSelectActiveQuiz: (quizId: string) => Promise<void>;
  onLaunchPractice: (title: string, questions: QuestionRecord[], subtitle?: string) => void;
  onNotice: (msg: string) => void;
}

type ManagerTab = 'questions' | 'blueprint' | 'export' | 'share';

export function QuizManagerDrawer({
  open,
  focusNewQuizRequest = 0,
  manifest,
  quizzes,
  activeQuizId,
  backupStatus,
  githubSession,
  onGitHubSessionChange,
  onOpenFeedbackDrawer,
  onClose,
  onWorkspaceChanged,
  onSelectActiveQuiz,
  onLaunchPractice,
  onNotice,
}: QuizManagerDrawerProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<ManagerTab>('questions');
  const [newQuizName, setNewQuizName] = useState('');
  const newQuizInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || focusNewQuizRequest <= 0) return;
    const timer = window.setTimeout(() => {
      newQuizInputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [open, focusNewQuizRequest]);
  const [editingName, setEditingName] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');

  const [quizQuestions, setQuizQuestions] = useState<QuestionRecord[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);

  // Swap Variant inline picker state
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  const [swapCandidates, setSwapCandidates] = useState<QuestionRecord[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);

  // Share as Pre-Built fields
  const [shareAuthor, setShareAuthor] = useState('');
  const [shareInstitution, setShareInstitution] = useState('');
  const [shareTags, setShareTags] = useState('');
  const [copiedMode, setCopiedMode] = useState<string | null>(null);

  // GitHub Gist Sync & Public Pre-Built Gist state
  const [gistSyncBusy, setGistSyncBusy] = useState(false);
  const [showPatBox, setShowPatBox] = useState(false);
  const [patDraft, setPatDraft] = useState('');
  const [publishedPrebuiltGist, setPublishedPrebuiltGist] = useState<{
    gistId: string;
    htmlUrl: string;
    shareUrl: string;
    practiceShareUrl: string;
  } | null>(null);
  const [publishingGist, setPublishingGist] = useState(false);

  const githubConfig = getGitHubConfig();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeQuiz = useMemo(
    () => quizzes.find((q) => q.id === activeQuizId) ?? quizzes[0] ?? null,
    [quizzes, activeQuizId],
  );

  useEffect(() => {
    if (activeQuiz) {
      setRenameDraft(activeQuiz.name);
      setDescDraft(activeQuiz.description);
    }
    setEditingName(false);
    setSwapTargetId(null);
  }, [activeQuiz?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!open || !activeQuiz || activeQuiz.questionIds.length === 0) {
      setQuizQuestions([]);
      setQuestionsLoading(false);
      return;
    }

    setQuestionsLoading(true);
    fetchQuestionsByIds(manifest, activeQuiz.questionIds)
      .then((res) => {
        if (!cancelled) {
          setQuizQuestions(res);
          setQuestionsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuizQuestions([]);
          setQuestionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, manifest, activeQuiz?.id, activeQuiz?.questionIds]);

  const enemyPairs = useMemo(() => detectEnemyPairs(quizQuestions), [quizQuestions]);
  const activeQuestionIdSet = useMemo(
    () => new Set(activeQuiz?.questionIds ?? []),
    [activeQuiz?.questionIds],
  );

  const handleCreateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newQuizName.trim();
    if (!trimmed) return;
    const created = await createQuiz(trimmed, '', { activate: true });
    setNewQuizName('');
    await onWorkspaceChanged(created.id);
  };

  const handleSaveRename = async () => {
    if (!activeQuiz || !renameDraft.trim()) return;
    await renameQuiz(activeQuiz.id, renameDraft, descDraft);
    setEditingName(false);
    await onWorkspaceChanged(activeQuiz.id);
  };

  const handleDuplicate = async () => {
    if (!activeQuiz) return;
    const copy = await duplicateQuiz(activeQuiz.id);
    if (copy) {
      await onWorkspaceChanged(copy.id);
    }
  };

  const handleDelete = async () => {
    if (!activeQuiz) return;
    await deleteQuiz(activeQuiz.id);
    await onWorkspaceChanged();
  };

  const handleDownloadBackup = async () => {
    const json = await exportWorkspaceBackupJson();
    const dateStamp = new Date().toISOString().slice(0, 10);
    triggerTextDownload(
      json,
      `mls_oer_workspace_backup_${dateStamp}.json`,
      'application/json;charset=utf-8',
    );
    await onWorkspaceChanged(activeQuiz?.id);
    onNotice('Downloaded JSON recovery snapshot of your quizzes and saved questions.');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importWorkspaceBackupJson(text, 'merge');
      await onWorkspaceChanged();
      onNotice(
        `Imported ${res.importedQuizzes} quiz(zes) and ${res.importedBookmarks} bookmark(s) into local IndexedDB.`,
      );
    } catch (err: unknown) {
      onNotice(
        `Backup import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const openSwapPicker = async (question: QuestionRecord) => {
    if (swapTargetId === question.id) {
      setSwapTargetId(null);
      return;
    }
    setSwapTargetId(question.id);
    setSwapLoading(true);
    try {
      const candidates = await fetchQuestionsByIds(manifest, question.similarIds);
      setSwapCandidates(candidates);
    } catch {
      setSwapCandidates([]);
    } finally {
      setSwapLoading(false);
    }
  };

  const handleSwap = async (oldId: string, newId: string) => {
    if (!activeQuiz) return;
    await swapQuizQuestion(activeQuiz.id, oldId, newId);
    setSwapTargetId(null);
    await onWorkspaceChanged(activeQuiz.id);
  };

  const sharePayload: PrebuiltSharePayload | null = useMemo(() => {
    if (!activeQuiz || activeQuiz.questionIds.length === 0) return null;
    const parsedTags = shareTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    return {
      title: activeQuiz.name,
      description: activeQuiz.description,
      author: shareAuthor.trim() || undefined,
      institution: shareInstitution.trim() || undefined,
      tags: parsedTags.length > 0 ? parsedTags : activeQuiz.tags ?? ['educator-shared'],
      questionIds: activeQuiz.questionIds,
      customPoints: activeQuiz.customPoints,
      license: 'CC0-1.0',
    };
  }, [activeQuiz, shareAuthor, shareInstitution, shareTags]);

  const copyShareUrl = async (mode: 'educator' | 'practice') => {
    if (!sharePayload) return;
    const url = encodePrebuiltHashUrl(sharePayload, mode);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedMode(mode);
      window.setTimeout(() => setCopiedMode(null), 2000);
    } catch {
      onNotice(`Share URL ready: ${url}`);
    }
  };

  const handleSyncGist = async () => {
    if (!githubSession) return;
    setGistSyncBusy(true);
    try {
      const res = await syncWorkspaceToPrivateGist(githubSession.accessToken);
      await onWorkspaceChanged(activeQuiz?.id ?? null);
      onNotice(`Synced workspace to private GitHub Gist (${res.gistId.slice(0, 8)}…).`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setGistSyncBusy(false);
    }
  };

  const handleRestoreGist = async () => {
    if (!githubSession) return;
    setGistSyncBusy(true);
    try {
      const res = await restoreWorkspaceFromPrivateGist(githubSession.accessToken, 'merge');
      await onWorkspaceChanged(activeQuiz?.id ?? null);
      onNotice(
        `Restored ${res.importedQuizzes} quiz(zes) and ${res.importedBookmarks} bookmark(s) from private GitHub Gist.`,
      );
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setGistSyncBusy(false);
    }
  };

  const handleConnectPat = async (e: React.FormEvent) => {
    e.preventDefault();
    setGistSyncBusy(true);
    try {
      const session = await signInWithPersonalToken(patDraft);
      onGitHubSessionChange(session);
      setPatDraft('');
      setShowPatBox(false);
      onNotice(`Connected GitHub Gist Sync as @${session.username}.`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setGistSyncBusy(false);
    }
  };

  const handlePublishPrebuiltGist = async () => {
    if (!githubSession || !sharePayload) return;
    setPublishingGist(true);
    try {
      const res = await publishPrebuiltGist(githubSession.accessToken, sharePayload);
      setPublishedPrebuiltGist(res);
      onNotice(`Published public Pre-Built Gist (${res.gistId.slice(0, 8)}…).`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishingGist(false);
    }
  };

  const unsyncedTotal =
    (backupStatus?.unsyncedQuizCount ?? 0) + (backupStatus?.unsyncedBookmarkCount ?? 0);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      title="My Quizzes & Export Workspace"
      subtitle="Manage multiple quizzes, inspect ASCP blueprint coverage, export to LMS/Word, or share as Pre-Built."
    >
      <div className="space-y-5">
        {/* Explicit No-Cloud-Backend Usage Storage Disclosure & Backup Guardrail */}
        <div
          className={cn(
            'rounded-xl border p-3.5 text-xs space-y-2.5',
            unsyncedTotal > 0
              ? 'border-amber-300 bg-amber-50/80 text-amber-950'
              : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]',
          )}
        >
          <div className="flex items-start gap-2">
            <HardDrive className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
            <div className="space-y-1">
              <p className="font-semibold">
                Local Browser Storage Only — No Cloud User Database
              </p>
              <p className="leading-relaxed opacity-90">
                Because this $0 static OER does not store personal usage on a dedicated cloud
                server, your quizzes, bookmarks, and notes live strictly in this browser&apos;s
                IndexedDB. Downloading a <strong>JSON Backup</strong> or connecting{' '}
                <strong>Private GitHub Gist Sync</strong> is <strong>required</strong> to
                preserve and track usage across devices or browser clears.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-amber-200/70">
            <span className="font-medium">
              {unsyncedTotal > 0 ? (
                <>
                  Unsaved changes: <strong>{backupStatus?.unsyncedQuizCount ?? 0}</strong>{' '}
                  quiz(zes), <strong>{backupStatus?.unsyncedBookmarkCount ?? 0}</strong>{' '}
                  bookmark(s) since last backup
                </>
              ) : (
                <>
                  Workspace backed up ({backupStatus?.totalQuizzes ?? quizzes.length} quizzes)
                </>
              )}
            </span>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="bg-[var(--bg-surface)] h-7 text-xs"
              >
                <Upload className="h-3 w-3" />
                Import JSON
              </Button>
              <Button
                variant={unsyncedTotal > 0 ? 'primary' : 'outline'}
                size="sm"
                onClick={handleDownloadBackup}
                className="h-7 text-xs"
              >
                <Download className="h-3 w-3" />
                Download Recovery Snapshot
              </Button>
            </div>
          </div>

          {/* GitHub Private Gist Sync Controls */}
          <div className="pt-2 border-t border-amber-200/70 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px]">
                <Github className="h-3.5 w-3.5 text-[var(--text-primary)]" />
                {githubSession ? (
                  <span>
                    GitHub Gist Sync connected as <strong>@{githubSession.username}</strong>
                    {backupStatus?.syncMode === 'gist_synced' && ' (Synced)'}
                  </span>
                ) : (
                  <span>Optional: Sync quizzes across devices using your own Private GitHub Gist</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {githubSession ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={gistSyncBusy}
                      onClick={handleSyncGist}
                      className="bg-[var(--bg-surface)] h-7 text-xs"
                    >
                      <Cloud className="h-3 w-3 text-indigo-600" />
                      {gistSyncBusy ? 'Syncing...' : 'Sync to Private Gist'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={gistSyncBusy}
                      onClick={handleRestoreGist}
                      className="bg-[var(--bg-surface)] h-7 text-xs"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Restore Gist
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await signOutGitHub();
                        onGitHubSessionChange(null);
                      }}
                      className="h-7 text-xs"
                    >
                      <LogOut className="h-3 w-3" />
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <>
                    {githubConfig.isOAuthConfigured && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          try {
                            startGitHubOAuthFlow();
                          } catch (err) {
                            onNotice(err instanceof Error ? err.message : String(err));
                          }
                        }}
                        className="bg-[var(--bg-surface)] h-7 text-xs"
                      >
                        <Github className="h-3 w-3" />
                        Sign in with GitHub
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPatBox((prev) => !prev)}
                      className="bg-[var(--bg-surface)] h-7 text-xs"
                    >
                      <KeyRound className="h-3 w-3" />
                      Connect via Token (PAT)
                    </Button>
                    {onOpenFeedbackDrawer && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onOpenFeedbackDrawer}
                        className="h-7 text-xs"
                      >
                        Auth Options
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {showPatBox && !githubSession && (
              <form onSubmit={handleConnectPat} className="flex flex-wrap gap-2">
                <Input
                  type="password"
                  value={patDraft}
                  onChange={(e) => setPatDraft(e.target.value)}
                  placeholder="Paste GitHub PAT (with gist scope)..."
                  aria-label="GitHub PAT for private gist sync"
                  className="h-7 flex-1 min-w-[200px] text-xs bg-[var(--bg-surface)]"
                />
                <Button type="submit" variant="primary" size="sm" disabled={gistSyncBusy} className="h-7 text-xs">
                  {gistSyncBusy ? 'Connecting...' : 'Connect'}
                </Button>
              </form>
            )}
          </div>
        </div>

        {/* Create Quiz & Switch Active Quiz */}
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 space-y-3">
          <form onSubmit={handleCreateQuiz} className="flex flex-wrap gap-2">
            <Input
              ref={newQuizInputRef}
              aria-label="New quiz name"
              value={newQuizName}
              onChange={(e) => setNewQuizName(e.target.value)}
              placeholder="Create a new quiz (e.g., Fall 2026 Hematology Midterm)..."
              className="flex-1 min-w-[220px]"
            />
            <Button type="submit" variant="primary" disabled={!newQuizName.trim()}>
              <Plus className="h-4 w-4" />
              Create Quiz
            </Button>
          </form>

          {quizzes.length > 0 && activeQuiz && (
            <div className="pt-3 border-t border-[var(--border-color)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                  <label
                    htmlFor="active-quiz-select"
                    className="text-xs font-semibold text-[var(--text-secondary)] shrink-0"
                  >
                    Active Quiz:
                  </label>
                  <select
                    id="active-quiz-select"
                    value={activeQuiz.id}
                    onChange={(e) => onSelectActiveQuiz(e.target.value)}
                    className="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 text-xs font-semibold text-[var(--text-primary)]"
                  >
                    {quizzes.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name} ({q.questionIds.length} Qs)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingName((prev) => !prev)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDuplicate}>
                    <CopyPlus className="h-3.5 w-3.5" />
                    Duplicate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>

              {editingName && (
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 space-y-2">
                  <Input
                    aria-label="Edit quiz title"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    placeholder="Quiz title"
                  />
                  <Input
                    aria-label="Edit quiz description"
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    placeholder="Optional course / assessment description..."
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingName(false)}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleSaveRename}>
                      Save Details
                    </Button>
                  </div>
                </div>
              )}

              {activeQuiz.remixedFrom && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
                  <GitBranch className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                  <span>
                    Remixed from Pre-Built:{' '}
                    <strong>{activeQuiz.remixedFrom.title}</strong>
                    {activeQuiz.remixedFrom.author
                      ? ` by ${activeQuiz.remixedFrom.author}`
                      : ''}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Active Quiz Tabs */}
        {!activeQuiz ? (
          <div className="rounded-xl border border-dashed border-[var(--border-color)] p-8 text-center text-sm text-[var(--text-secondary)]">
            Create your first quiz above to start adding questions, analyzing ASCP blueprint
            balance, and exporting to D2L, QTI, Aiken, or Word.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5 border-b border-[var(--border-color)] pb-2">
              {(
                [
                  ['questions', `Questions (${activeQuiz.questionIds.length})`],
                  ['blueprint', 'ASCP Blueprint'],
                  ['export', 'Export'],
                  ['share', 'Share as Pre-Built'],
                ] as const
              ).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setActiveTab(tabKey)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer',
                    activeTab === tabKey
                      ? 'bg-indigo-600 text-white'
                      : 'bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'questions' && (
              <div className="space-y-3">
                {/* Enemy Question Warnings */}
                {enemyPairs.length > 0 && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
                      <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                      <span>
                        Enemy Question Warning: {enemyPairs.length} near-duplicate pair
                        {enemyPairs.length === 1 ? '' : 's'} detected (cosine &gt; 0.90)
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {enemyPairs.map((pair) => (
                        <div
                          key={`${pair.a.id}-${pair.b.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-[var(--bg-surface)] px-3 py-2 text-xs"
                        >
                          <span className="text-[var(--text-primary)]">
                            <strong className="font-mono">{pair.a.displayId}</strong> and{' '}
                            <strong className="font-mono">{pair.b.displayId}</strong> test
                            nearly identical content.
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => openSwapPicker(pair.b)}
                            >
                              <RefreshCw className="h-3 w-3" />
                              Swap {pair.b.displayId}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px] text-rose-600"
                              onClick={async () => {
                                await removeQuestionFromQuiz(activeQuiz.id, pair.b.id);
                                await onWorkspaceChanged(activeQuiz.id);
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {questionsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : quizQuestions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-color)] p-8 text-center text-xs text-[var(--text-secondary)]">
                    This quiz has no questions yet. Click{' '}
                    <strong>+ Add to Quiz</strong> on any question card in the Explorer.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {quizQuestions.map((q, idx) => {
                      const bloom = BLOOM_META[q.bloomLevel];
                      const pts = activeQuiz.customPoints[q.id] ?? 1;
                      const isSwapOpen = swapTargetId === q.id;

                      return (
                        <div
                          key={q.id}
                          className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3.5 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-xs font-bold text-[var(--text-secondary)]">
                                  #{idx + 1}
                                </span>
                                <Badge
                                  className={cn(
                                    'text-[10px] font-bold',
                                    DISCIPLINE_COLORS[q.disciplineCode],
                                  )}
                                >
                                  {q.disciplineCode}
                                </Badge>
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {q.displayId}
                                </Badge>
                                {bloom && (
                                  <Badge className={cn('text-[10px]', bloom.className)}>
                                    {bloom.short}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-[10px]">
                                  Diff {q.difficulty}
                                </Badge>
                              </div>
                              <p className="text-xs font-medium text-[var(--text-primary)] line-clamp-2">
                                <FormattedText text={q.questionText} />
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-1 shrink-0">
                              <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] mr-1">
                                Pts
                                <input
                                  type="number"
                                  min={0.5}
                                  step={0.5}
                                  value={pts}
                                  aria-label={`Points for ${q.displayId}`}
                                  onChange={async (e) => {
                                    await setQuestionPoints(
                                      activeQuiz.id,
                                      q.id,
                                      Number(e.target.value),
                                    );
                                    await onWorkspaceChanged(activeQuiz.id);
                                  }}
                                  className="h-7 w-14 rounded border border-[var(--border-color)] px-1.5 text-xs text-[var(--text-primary)]"
                                />
                              </label>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={idx === 0}
                                aria-label={`Move ${q.displayId} up`}
                                onClick={async () => {
                                  await reorderQuizQuestion(activeQuiz.id, idx, idx - 1);
                                  await onWorkspaceChanged(activeQuiz.id);
                                }}
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={idx === quizQuestions.length - 1}
                                aria-label={`Move ${q.displayId} down`}
                                onClick={async () => {
                                  await reorderQuizQuestion(activeQuiz.id, idx, idx + 1);
                                  await onWorkspaceChanged(activeQuiz.id);
                                }}
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                              {q.similarIds.length > 0 && (
                                <Button
                                  variant={isSwapOpen ? 'primary' : 'outline'}
                                  size="sm"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => openSwapPicker(q)}
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Swap Variant
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${q.displayId}`}
                                onClick={async () => {
                                  await removeQuestionFromQuiz(activeQuiz.id, q.id);
                                  await onWorkspaceChanged(activeQuiz.id);
                                }}
                                className="text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          {isSwapOpen && (
                            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold text-indigo-950">
                                <span>Choose a similar variant to swap in-place:</span>
                                <button
                                  type="button"
                                  onClick={() => setSwapTargetId(null)}
                                  className="text-[11px] text-indigo-700 hover:underline cursor-pointer"
                                >
                                  Close
                                </button>
                              </div>
                              {swapLoading ? (
                                <Skeleton className="h-12 w-full" />
                              ) : swapCandidates.length === 0 ? (
                                <p className="text-xs text-[var(--text-secondary)]">
                                  No sibling variants found.
                                </p>
                              ) : (
                                <div className="space-y-1.5">
                                  {swapCandidates.map((cand) => {
                                    const alreadyInQuiz = activeQuestionIdSet.has(cand.id);
                                    return (
                                      <div
                                        key={cand.id}
                                        className="flex items-center justify-between gap-2 rounded border border-indigo-200 bg-[var(--bg-surface)] px-2.5 py-2 text-xs"
                                      >
                                        <div className="min-w-0">
                                          <span className="font-mono font-semibold text-[var(--text-primary)] mr-1.5">
                                            {cand.displayId}
                                          </span>
                                          <span className="text-[var(--text-primary)] line-clamp-1">
                                            <FormattedText text={cand.questionText} />
                                          </span>
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          disabled={alreadyInQuiz}
                                          onClick={() => handleSwap(q.id, cand.id)}
                                          className="h-6 px-2 text-[11px] shrink-0"
                                        >
                                          {alreadyInQuiz ? 'Already in quiz' : 'Use Variant'}
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'blueprint' && (
              <BlueprintBalanceMeter questions={quizQuestions} manifest={manifest} />
            )}

            {activeTab === 'export' && (
              <div className="space-y-4">
                <p className="text-xs text-[var(--text-secondary)]">
                  Export <strong>{activeQuiz.name}</strong> ({quizQuestions.length} questions)
                  under <strong>CC0 1.0 Public Domain</strong> into LMS packages, Word
                  documents, or printable formats:
                </p>
                <QuizExportButtons
                  title={activeQuiz.name}
                  description={activeQuiz.description}
                  questions={quizQuestions}
                  customPoints={activeQuiz.customPoints}
                />
              </div>
            )}

            {activeTab === 'share' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-indigo-950">
                    <Share2 className="h-4 w-4 text-indigo-600" />
                    Share &ldquo;{activeQuiz.name}&rdquo; as a Pre-Built Quiz
                  </div>
                  <p className="text-xs text-indigo-900/80">
                    Colleagues can open your Pre-Built link to export directly or{' '}
                    <strong>Clone &amp; Remix</strong> it, while students can use the{' '}
                    <strong>Student Self-Practice</strong> link with answers hidden until
                    submission.
                  </p>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={shareAuthor}
                      onChange={(e) => setShareAuthor(e.target.value)}
                      placeholder="Optional Author Name"
                      className="h-8 text-xs bg-[var(--bg-surface)]"
                    />
                    <Input
                      value={shareInstitution}
                      onChange={(e) => setShareInstitution(e.target.value)}
                      placeholder="Optional Institution (e.g., Augusta University)"
                      className="h-8 text-xs bg-[var(--bg-surface)]"
                    />
                  </div>
                  <Input
                    value={shareTags}
                    onChange={(e) => setShareTags(e.target.value)}
                    placeholder="Optional comma-separated tags (e.g., midterm, hematology, fall-2026)"
                    className="h-8 text-xs bg-[var(--bg-surface)]"
                  />

                  <Separator />

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!sharePayload}
                      onClick={() => copyShareUrl('educator')}
                    >
                      {copiedMode === 'educator' ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copied Educator Link
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy Educator Remix Link
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!sharePayload}
                      onClick={() => copyShareUrl('practice')}
                      className="bg-[var(--bg-surface)]"
                    >
                      {copiedMode === 'practice' ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copied Practice Link
                        </>
                      ) : (
                        <>
                          <GraduationCap className="h-3.5 w-3.5 text-indigo-600" />
                          Copy Student Practice Link
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={quizQuestions.length === 0}
                      onClick={() => {
                        onClose();
                        onLaunchPractice(
                          activeQuiz.name,
                          quizQuestions,
                          activeQuiz.description,
                        );
                      }}
                      className="bg-[var(--bg-surface)]"
                    >
                      <Play className="h-3.5 w-3.5 text-emerald-600" />
                      Preview Student Self-Practice
                    </Button>

                    {sharePayload && (
                      <a
                        href={buildPrebuiltCatalogIssueUrl(sharePayload)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Submit to Community Catalog
                      </a>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!sharePayload || !githubSession || publishingGist}
                      onClick={handlePublishPrebuiltGist}
                      className="bg-[var(--bg-surface)] sm:col-span-2"
                    >
                      <Cloud className="h-3.5 w-3.5 text-indigo-600" />
                      {publishingGist
                        ? 'Publishing Public Gist...'
                        : githubSession
                          ? 'Publish Permanent Public Pre-Built Gist'
                          : 'Connect GitHub Above to Publish Public Pre-Built Gist'}
                    </Button>
                  </div>

                  {publishedPrebuiltGist && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">Public Pre-Built Gist Published</span>
                        <a
                          href={publishedPrebuiltGist.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium underline"
                        >
                          View on GitHub
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-[var(--bg-surface)] h-7 text-xs"
                          onClick={async () => {
                            await navigator.clipboard.writeText(publishedPrebuiltGist.shareUrl);
                            onNotice('Copied short Gist Educator Remix URL.');
                          }}
                        >
                          <Copy className="h-3 w-3" />
                          Copy Short Educator URL (#prebuilt=gist:...)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-[var(--bg-surface)] h-7 text-xs"
                          onClick={async () => {
                            await navigator.clipboard.writeText(publishedPrebuiltGist.practiceShareUrl);
                            onNotice('Copied short Gist Student Practice URL.');
                          }}
                        >
                          <Copy className="h-3 w-3" />
                          Copy Short Student Practice URL
                        </Button>
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-[var(--text-secondary)]">
                    All shared Pre-Built quizzes are dedicated under CC0 1.0 Public Domain.
                    Backup filename suggestion:{' '}
                    <code className="font-mono">{sanitizeFilename(activeQuiz.name)}.json</code>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

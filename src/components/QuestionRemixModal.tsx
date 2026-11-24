import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  GitFork,
  Github,
  HardDrive,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import type { RemixedQuestionRecord } from '@/lib/db';
import {
  buildFallbackIssueUrl,
  buildVariantSubmissionMarkdown,
  createGitHubIssue,
} from '@/lib/githubApi';
import type { GitHubSession } from '@/lib/githubAuth';
import { saveRemixedQuestion } from '@/lib/remixStore';
import { formatAscpBreadcrumb } from '@/lib/utils';
import type { ManifestData, QuestionOption, QuestionRecord } from '@/types/question';
import { Badge, Button, Input } from './ui/primitives';

export interface QuestionRemixModalProps {
  open: boolean;
  sourceQuestion: QuestionRecord | null;
  parentQuestionId: string | null;
  editingRemix?: RemixedQuestionRecord | null;
  manifest?: ManifestData | null;
  githubSession: GitHubSession | null;
  onClose: () => void;
  onOpenFeedbackAuth?: () => void;
  onSavedLocal: (record: RemixedQuestionRecord) => void;
  onSubmittedCommunity?: (
    record: RemixedQuestionRecord,
    issueUrl: string,
    issueNumber: number,
  ) => void;
}

const OPTION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function relabelOptions(options: QuestionOption[]): QuestionOption[] {
  return options.map((opt, idx) => ({
    ...opt,
    label: OPTION_LABELS[idx] ?? String(idx + 1),
  }));
}

function composeAscpPath(
  disciplineName: string,
  topicName: string,
  ascpSubtopic: string,
  leafTopic: string,
): string {
  return [disciplineName, topicName, ascpSubtopic, leafTopic]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' > ');
}

export function QuestionRemixModal({
  open,
  sourceQuestion,
  parentQuestionId,
  editingRemix = null,
  manifest = null,
  githubSession,
  onClose,
  onOpenFeedbackAuth,
  onSavedLocal,
  onSubmittedCommunity,
}: QuestionRemixModalProps): React.ReactElement | null {
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState<QuestionOption[]>([]);
  const [hint, setHint] = useState('');
  const [objective, setObjective] = useState('');
  const [difficulty, setDifficulty] = useState(2);
  const [difficultyRationale, setDifficultyRationale] = useState('');
  const [bloomLevel, setBloomLevel] = useState('RE');
  const [questionType, setQuestionType] = useState('MC');
  const [disciplineCode, setDisciplineCode] = useState('');
  const [disciplineName, setDisciplineName] = useState('');
  const [topicCode, setTopicCode] = useState('');
  const [topicName, setTopicName] = useState('');
  const [ascpSubtopic, setAscpSubtopic] = useState('');
  const [leafTopic, setLeafTopic] = useState('');
  const [ascpPath, setAscpPath] = useState('');
  const [ascpPathManual, setAscpPathManual] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [rationaleNote, setRationaleNote] = useState('');

  const [savingLocal, setSavingLocal] = useState(false);
  const [submittingCommunity, setSubmittingCommunity] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedLocalRecord, setSavedLocalRecord] = useState<RemixedQuestionRecord | null>(null);
  const [createdIssue, setCreatedIssue] = useState<{ number: number; url: string } | null>(null);
  const [copiedPayload, setCopiedPayload] = useState(false);

  useEffect(() => {
    if (!open || !sourceQuestion) return;
    const base = editingRemix?.question ?? sourceQuestion;
    setQuestionText(base.questionText);
    setOptions(base.options.map((opt) => ({ ...opt })));
    setHint(base.hint ?? '');
    setObjective(base.objective ?? '');
    setDifficulty(base.difficulty);
    setDifficultyRationale(base.difficultyRationale ?? '');
    setBloomLevel(base.bloomLevel || 'RE');
    setQuestionType(base.questionType || 'MC');
    setDisciplineCode(base.disciplineCode);
    setDisciplineName(base.disciplineName);
    setTopicCode(base.topicCode);
    setTopicName(base.topicName);
    setAscpSubtopic(base.ascpSubtopic);
    setLeafTopic(base.leafTopic);
    setAscpPath(base.ascpPath);
    setAscpPathManual(false);
    setMetadataOpen(false);
    setRationaleNote(editingRemix?.rationaleNote ?? '');
    setSavingLocal(false);
    setSubmittingCommunity(false);
    setErrorMsg(null);
    setSavedLocalRecord(null);
    setCreatedIssue(
      editingRemix?.submittedIssueUrl && editingRemix?.submittedIssueNumber
        ? { url: editingRemix.submittedIssueUrl, number: editingRemix.submittedIssueNumber }
        : null,
    );
    setCopiedPayload(false);
  }, [open, sourceQuestion, editingRemix]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (ascpPathManual) return;
    const nextPath = composeAscpPath(disciplineName, topicName, ascpSubtopic, leafTopic);
    if (nextPath) {
      setAscpPath(nextPath);
    }
  }, [disciplineName, topicName, ascpSubtopic, leafTopic, ascpPathManual]);

  const disciplineOptions = useMemo(() => {
    if (!manifest) return [];
    return Object.values(manifest.disciplines).map((d) => ({
      code: d.disciplineCode,
      name: d.disciplineName,
    }));
  }, [manifest]);

  const shardTopicOptions = useMemo(() => {
    if (!manifest) return [];
    return manifest.shards.map((s) => ({
      code: s.topicCode,
      name: s.topicName,
      disciplineCode: s.disciplineCode,
    }));
  }, [manifest]);

  const draftQuestion: QuestionRecord | null = useMemo(() => {
    if (!sourceQuestion) return null;
    const base = editingRemix?.question ?? sourceQuestion;
    return {
      ...base,
      disciplineCode: disciplineCode.trim() || base.disciplineCode,
      disciplineName: disciplineName.trim() || base.disciplineName,
      topicCode: topicCode.trim() || base.topicCode,
      topicName: topicName.trim() || base.topicName,
      ascpSubtopic: ascpSubtopic.trim(),
      leafTopic: leafTopic.trim(),
      ascpPath:
        ascpPath.trim() ||
        composeAscpPath(disciplineName, topicName, ascpSubtopic, leafTopic) ||
        base.ascpPath,
      bloomLevel: bloomLevel.trim() || base.bloomLevel,
      difficulty,
      difficultyRationale: difficultyRationale.trim(),
      questionType: questionType.trim() || base.questionType,
      objective: objective.trim(),
      questionText: questionText.trim(),
      options: relabelOptions(options),
      hint: hint.trim(),
      similarIds: [],
      sourceFiles: base.sourceFiles,
    };
  }, [
    sourceQuestion,
    editingRemix,
    disciplineCode,
    disciplineName,
    topicCode,
    topicName,
    ascpSubtopic,
    leafTopic,
    ascpPath,
    bloomLevel,
    difficulty,
    difficultyRationale,
    questionType,
    objective,
    questionText,
    options,
    hint,
  ]);

  const submissionSummary = useMemo(() => {
    if (!sourceQuestion || !parentQuestionId || !draftQuestion) return null;
    return buildVariantSubmissionMarkdown({
      sourceQuestion,
      parentQuestionId,
      remixedQuestion: draftQuestion,
      rationaleNote,
      contributorRole: githubSession
        ? `@${githubSession.username}`
        : 'MLS Educator / Community Contributor',
    });
  }, [sourceQuestion, parentQuestionId, draftQuestion, rationaleNote, githubSession]);

  if (!open || !sourceQuestion || !parentQuestionId || !draftQuestion || !submissionSummary) {
    return null;
  }

  const fallbackIssueUrl = buildFallbackIssueUrl({
    title: submissionSummary.suggestedTitle,
    body: submissionSummary.markdownBody,
    labels: ['question-variant', 'community-contribution'],
  });

  const validateDraft = (): string | null => {
    if (!questionText.trim()) {
      return 'Question stem cannot be empty.';
    }
    if (options.length < 2) {
      return 'At least 2 answer options are required.';
    }
    if (options.some((opt) => !opt.text.trim())) {
      return 'All answer options must have text.';
    }
    if (!options.some((opt) => opt.weight === 100)) {
      return 'Please mark one option as the correct answer.';
    }
    return null;
  };

  const handleSelectCorrectOption = (targetIndex: number) => {
    setOptions((prev) =>
      prev.map((opt, idx) => ({
        ...opt,
        weight: idx === targetIndex ? 100 : 0,
      })),
    );
  };

  const handleUpdateOptionField = (
    targetIndex: number,
    field: 'text' | 'feedback',
    value: string,
  ) => {
    setOptions((prev) =>
      prev.map((opt, idx) => (idx === targetIndex ? { ...opt, [field]: value } : opt)),
    );
  };

  const handleAddOption = () => {
    if (options.length >= 8) return;
    setOptions((prev) =>
      relabelOptions([
        ...prev,
        { label: '', text: '', weight: 0, feedback: '' },
      ]),
    );
  };

  const handleRemoveOption = (targetIndex: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => {
      const next = prev.filter((_, idx) => idx !== targetIndex);
      if (!next.some((opt) => opt.weight === 100) && next.length > 0) {
        next[0] = { ...next[0], weight: 100 };
      }
      return relabelOptions(next);
    });
  };

  const persistLocalRemix = async (extra?: {
    submittedIssueUrl?: string;
    submittedIssueNumber?: number;
  }): Promise<RemixedQuestionRecord> => {
    const saved = await saveRemixedQuestion({
      existingId: editingRemix?.id ?? savedLocalRecord?.id,
      parentQuestionId,
      remixedFromId: sourceQuestion.id,
      question: draftQuestion,
      rationaleNote,
      submittedIssueUrl: extra?.submittedIssueUrl,
      submittedIssueNumber: extra?.submittedIssueNumber,
    });
    setSavedLocalRecord(saved);
    onSavedLocal(saved);
    return saved;
  };

  const handleSaveLocally = async () => {
    const validationError = validateDraft();
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    setSavingLocal(true);
    setErrorMsg(null);
    try {
      await persistLocalRemix();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save remix locally.');
    } finally {
      setSavingLocal(false);
    }
  };

  const handleSubmitCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateDraft();
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    setSubmittingCommunity(true);
    setErrorMsg(null);
    try {
      await persistLocalRemix();
      if (!githubSession) {
        setSubmittingCommunity(false);
        return;
      }
      const res = await createGitHubIssue(githubSession.accessToken, {
        title: submissionSummary.suggestedTitle,
        body: submissionSummary.markdownBody,
        labels: ['question-variant', 'community-contribution'],
      });
      const updated = await persistLocalRemix({
        submittedIssueUrl: res.html_url,
        submittedIssueNumber: res.number,
      });
      setCreatedIssue({ number: res.number, url: res.html_url });
      onSubmittedCommunity?.(updated, res.html_url, res.number);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit variant to GitHub.');
    } finally {
      setSubmittingCommunity(false);
    }
  };

  const handleCopyPayload = async () => {
    try {
      await navigator.clipboard.writeText(submissionSummary.markdownBody);
      setCopiedPayload(true);
      window.setTimeout(() => setCopiedPayload(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remix-modal-title"
    >
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs" onClick={onClose} />

      <form
        onSubmit={handleSubmitCommunity}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitFork className="h-4 w-4 text-teal-600" />
              <h2 id="remix-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
                {editingRemix ? 'Edit Remixed Variant' : 'Remix Question / Create Variant'}
              </h2>
              <Badge className="border-[var(--border-color)] bg-[var(--bg-primary)] font-mono text-[11px] text-[var(--text-primary)]">
                {sourceQuestion.displayId}
              </Badge>
            </div>
            <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
              {formatAscpBreadcrumb(ascpPath || sourceQuestion.ascpPath)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close remix modal"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {createdIssue && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Saved locally &amp; submitted to OER Question Bank (#{createdIssue.number})
              </div>
              <p className="mt-1 text-xs text-emerald-800">
                Your variant is saved in this browser for immediate quiz/export use and queued for community review.
              </p>
              <a
                href={createdIssue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline"
              >
                View Issue #{createdIssue.number} on GitHub
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {savedLocalRecord && !createdIssue && (
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-3.5 text-xs text-teal-900">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
                Saved locally to this browser
              </div>
              <p className="mt-0.5 text-teal-800">
                You can now switch to this variant in the card&apos;s Variants/Remix bar, add it to quizzes, and export it.
              </p>
            </div>
          )}

          {/* Expandable Classification, Topic-Leaf & Metadata */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]">
            <button
              type="button"
              onClick={() => setMetadataOpen((prev) => !prev)}
              aria-expanded={metadataOpen}
              className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)]/70 rounded-xl"
            >
              <span className="flex items-center gap-2">
                {metadataOpen ? (
                  <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
                )}
                Classification, Topic-Leaf &amp; Metadata
              </span>
              <span className="font-mono text-[11px] font-normal text-[var(--text-secondary)]">
                {bloomLevel} • Diff {difficulty}/10 • {leafTopic || topicCode}
              </span>
            </button>

            {metadataOpen && (
              <div className="space-y-3 border-t border-[var(--border-color)] p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      Discipline Code
                    </label>
                    <Input
                      value={disciplineCode}
                      onChange={(e) => setDisciplineCode(e.target.value)}
                      list="remix-discipline-codes"
                      placeholder="e.g., BB"
                    />
                    {disciplineOptions.length > 0 && (
                      <datalist id="remix-discipline-codes">
                        {disciplineOptions.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.name}
                          </option>
                        ))}
                      </datalist>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      Discipline Name
                    </label>
                    <Input
                      value={disciplineName}
                      onChange={(e) => setDisciplineName(e.target.value)}
                      placeholder="e.g., Blood Banking"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      Topic Code
                    </label>
                    <Input
                      value={topicCode}
                      onChange={(e) => setTopicCode(e.target.value)}
                      list="remix-topic-codes"
                      placeholder="e.g., BB_01"
                    />
                    {shardTopicOptions.length > 0 && (
                      <datalist id="remix-topic-codes">
                        {shardTopicOptions.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.name}
                          </option>
                        ))}
                      </datalist>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      Topic Name
                    </label>
                    <Input
                      value={topicName}
                      onChange={(e) => setTopicName(e.target.value)}
                      placeholder="e.g., Blood Products"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      ASCP Subtopic
                    </label>
                    <Input
                      value={ascpSubtopic}
                      onChange={(e) => setAscpSubtopic(e.target.value)}
                      placeholder="e.g., Donors"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      Topic-Leaf
                    </label>
                    <Input
                      value={leafTopic}
                      onChange={(e) => setLeafTopic(e.target.value)}
                      placeholder="e.g., Qualification"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-[var(--text-primary)]">
                      Full ASCP Path (Topic-Leaf Breadcrumb)
                    </label>
                    {ascpPathManual && (
                      <button
                        type="button"
                        onClick={() => setAscpPathManual(false)}
                        className="text-[11px] font-medium text-teal-600 hover:underline"
                      >
                        Sync from fields above
                      </button>
                    )}
                  </div>
                  <Input
                    value={ascpPath}
                    onChange={(e) => {
                      setAscpPathManual(true);
                      setAscpPath(e.target.value);
                    }}
                    placeholder="Discipline > Topic > Subtopic > Leaf"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      Bloom Level
                    </label>
                    <select
                      value={bloomLevel}
                      onChange={(e) => setBloomLevel(e.target.value)}
                      className="h-9 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 text-sm text-[var(--text-primary)] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    >
                      <option value="RE">RE — Remember</option>
                      <option value="UN">UN — Understand</option>
                      <option value="AP">AP — Apply</option>
                      <option value="AN">AN — Analyze</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      Difficulty (1–10)
                    </label>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(Number(e.target.value))}
                      className="h-9 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 text-sm text-[var(--text-primary)] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    >
                      {Array.from({ length: 10 }, (_, idx) => idx + 1).map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl} / 10
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                      Question Type
                    </label>
                    <Input
                      value={questionType}
                      onChange={(e) => setQuestionType(e.target.value)}
                      placeholder="MC"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                    Learning Objective
                  </label>
                  <Input
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="Learning objective assessed by this variant"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                    Difficulty Rationale
                  </label>
                  <Input
                    value={difficultyRationale}
                    onChange={(e) => setDifficultyRationale(e.target.value)}
                    placeholder="Why is this variant at this difficulty level?"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Stem */}
          <div>
            <label
              htmlFor="remix-stem"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            >
              Question Stem
            </label>
            <textarea
              id="remix-stem"
              rows={3}
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          {/* Options */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Answer Options &amp; Feedback
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-secondary)]">Select the correct answer</span>
                {options.length < 8 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddOption}
                    className="h-7 px-2 text-xs"
                  >
                    <Plus className="h-3 w-3" />
                    Add Option
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {options.map((opt, idx) => {
                const isCorrect = opt.weight === 100;
                const label = OPTION_LABELS[idx] ?? String(idx + 1);
                return (
                  <div
                    key={`remix-opt-${idx}`}
                    className={`rounded-xl border p-3 transition ${
                      isCorrect
                        ? 'border-emerald-300 bg-emerald-50/40'
                        : 'border-[var(--border-color)] bg-[var(--bg-primary)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="remix-correct-option"
                        checked={isCorrect}
                        onChange={() => handleSelectCorrectOption(idx)}
                        aria-label={`Mark option ${label} as correct`}
                        className="h-4 w-4 cursor-pointer accent-emerald-600"
                      />
                      <span className="w-5 text-xs font-bold text-[var(--text-primary)]">{label}.</span>
                      <Input
                        value={opt.text}
                        onChange={(e) => handleUpdateOptionField(idx, 'text', e.target.value)}
                        aria-label={`Option ${label} text`}
                      />
                      {options.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveOption(idx)}
                          aria-label={`Remove option ${label}`}
                          className="h-8 px-2 text-[var(--text-secondary)] hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="mt-2 pl-7">
                      <Input
                        value={opt.feedback}
                        onChange={(e) => handleUpdateOptionField(idx, 'feedback', e.target.value)}
                        placeholder="Option feedback / rationale..."
                        aria-label={`Option ${label} feedback`}
                        className="h-8 text-xs text-[var(--text-secondary)]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hint */}
          <div>
            <label
              htmlFor="remix-hint"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            >
              Hint
            </label>
            <Input
              id="remix-hint"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Optional student hint"
            />
          </div>

          {/* Rationale / Note */}
          <div>
            <label
              htmlFor="remix-rationale"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            >
              Remix / Contribution Note
            </label>
            <textarea
              id="remix-rationale"
              rows={2}
              value={rationaleNote}
              onChange={(e) => setRationaleNote(e.target.value)}
              placeholder="Optional note describing what changed or why this variant is useful..."
              className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] bg-[var(--bg-primary)] px-6 py-3.5">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleCopyPayload}>
              <Copy className="h-3.5 w-3.5" />
              {copiedPayload ? 'Copied!' : 'Copy JSON/Markdown'}
            </Button>
            {!githubSession && (
              <a
                href={fallbackIssueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
              >
                Open Pre-filled GitHub Issue
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={savingLocal || submittingCommunity}
              onClick={handleSaveLocally}
            >
              <HardDrive className="h-3.5 w-3.5" />
              {savingLocal ? 'Saving…' : 'Save Locally'}
            </Button>
            {githubSession ? (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={savingLocal || submittingCommunity}
              >
                <Send className="h-3.5 w-3.5" />
                {submittingCommunity ? 'Submitting…' : 'Submit to OER Question Bank'}
              </Button>
            ) : (
              onOpenFeedbackAuth && (
                <Button type="button" variant="primary" size="sm" onClick={onOpenFeedbackAuth}>
                  <Github className="h-3.5 w-3.5" />
                  Sign in to Submit to OER Bank
                </Button>
              )
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

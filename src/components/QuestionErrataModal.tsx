import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileWarning,
  Github,
  Send,
  X,
} from 'lucide-react';
import {
  buildErrataDiffMarkdown,
  buildFallbackIssueUrl,
  createGitHubIssue,
} from '@/lib/githubApi';
import type { GitHubSession } from '@/lib/githubAuth';
import type { QuestionOption, QuestionRecord } from '@/types/question';
import { Badge, Button, Input } from './ui/primitives';

export interface QuestionErrataModalProps {
  open: boolean;
  question: QuestionRecord | null;
  githubSession: GitHubSession | null;
  onClose: () => void;
  onOpenFeedbackAuth?: () => void;
  onSubmitted?: (issueUrl: string, issueNumber: number) => void;
}

export function QuestionErrataModal({
  open,
  question,
  githubSession,
  onClose,
  onOpenFeedbackAuth,
  onSubmitted,
}: QuestionErrataModalProps): React.ReactElement | null {
  const [proposedStem, setProposedStem] = useState('');
  const [proposedOptions, setProposedOptions] = useState<QuestionOption[]>([]);
  const [proposedHint, setProposedHint] = useState('');
  const [proposedDifficulty, setProposedDifficulty] = useState(2);
  const [rationaleNote, setRationaleNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdIssue, setCreatedIssue] = useState<{ number: number; url: string } | null>(null);
  const [copiedDiff, setCopiedDiff] = useState(false);

  useEffect(() => {
    if (!open || !question) return;
    setProposedStem(question.questionText);
    setProposedOptions(question.options.map((opt) => ({ ...opt })));
    setProposedHint(question.hint ?? '');
    setProposedDifficulty(question.difficulty);
    setRationaleNote('');
    setSubmitting(false);
    setSubmitError(null);
    setCreatedIssue(null);
    setCopiedDiff(false);
  }, [open, question]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const diff = useMemo(() => {
    if (!question) return null;
    return buildErrataDiffMarkdown({
      question,
      proposedStem,
      proposedOptions,
      proposedHint,
      proposedDifficulty,
      rationaleNote,
      reporterRole: githubSession ? `@${githubSession.username}` : 'MLS Educator / Community Reviewer',
    });
  }, [
    question,
    proposedStem,
    proposedOptions,
    proposedHint,
    proposedDifficulty,
    rationaleNote,
    githubSession,
  ]);

  if (!open || !question || !diff) return null;

  const fallbackIssueUrl = buildFallbackIssueUrl({
    title: diff.suggestedTitle,
    body: diff.markdownBody,
    labels: ['question-errata'],
  });

  const handleSelectCorrectOption = (targetIndex: number) => {
    setProposedOptions((prev) =>
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
    setProposedOptions((prev) =>
      prev.map((opt, idx) => (idx === targetIndex ? { ...opt, [field]: value } : opt)),
    );
  };

  const handleSubmitGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubSession) return;
    if (diff.changedFields.length === 0 && !rationaleNote.trim()) {
      setSubmitError('Please modify at least one field or enter a rationale note before submitting.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createGitHubIssue(githubSession.accessToken, {
        title: diff.suggestedTitle,
        body: diff.markdownBody,
        labels: ['question-errata'],
      });
      setCreatedIssue({ number: created.number, url: created.html_url });
      onSubmitted?.(created.html_url, created.number);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyDiff = async () => {
    try {
      await navigator.clipboard.writeText(diff.markdownBody);
      setCopiedDiff(true);
      setTimeout(() => setCopiedDiff(false), 2000);
    } catch {
      setSubmitError('Clipboard copy was blocked by the browser. Expand the Markdown diff to copy manually.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Suggest Question Correction"
    >
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <form
        onSubmit={handleSubmitGitHub}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FileWarning className="h-4 w-4 text-amber-600 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900">
                Suggest Question Correction / Errata
              </h2>
              <Badge variant="outline" className="font-mono text-[11px]">
                {question.id}
              </Badge>
              <Badge variant="default" className="font-mono text-[11px]">
                {question.displayId}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500 truncate">{question.ascpPath}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close errata modal">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {createdIssue && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  Errata proposal submitted as GitHub Issue <strong>#{createdIssue.number}</strong>.
                </span>
              </div>
              <a
                href={createdIssue.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-emerald-800 underline hover:text-emerald-950"
              >
                View Issue
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {submitError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Question Stem */}
          <div>
            <label
              htmlFor="errata-stem"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-700 mb-1.5"
            >
              Proposed Question Stem
            </label>
            <textarea
              id="errata-stem"
              rows={3}
              value={proposedStem}
              onChange={(e) => setProposedStem(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Options & Correct Key */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Options &amp; Answer Key (select radio for 100% correct key)
              </span>
              <span className="text-[11px] text-slate-500">
                Edit option text or distractor rationale below
              </span>
            </div>

            {proposedOptions.map((opt, idx) => {
              const isCorrect = opt.weight > 0;
              return (
                <div
                  key={opt.label}
                  className={`rounded-lg border p-3 space-y-2 ${
                    isCorrect
                      ? 'border-emerald-300 bg-emerald-50/40'
                      : 'border-slate-200 bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="errata-correct-option"
                      checked={isCorrect}
                      onChange={() => handleSelectCorrectOption(idx)}
                      aria-label={`Mark option ${opt.label} as correct`}
                      className="h-4 w-4 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-700 w-5">{opt.label})</span>
                    <Input
                      value={opt.text}
                      onChange={(e) => handleUpdateOptionField(idx, 'text', e.target.value)}
                      aria-label={`Option ${opt.label} text`}
                      className="h-8 text-xs"
                    />
                    {isCorrect && (
                      <Badge variant="default" className="bg-emerald-100 text-emerald-800 border-emerald-200 shrink-0">
                        Key (100%)
                      </Badge>
                    )}
                  </div>
                  <Input
                    value={opt.feedback}
                    onChange={(e) => handleUpdateOptionField(idx, 'feedback', e.target.value)}
                    placeholder={`Feedback / explanation for option ${opt.label} (optional)`}
                    aria-label={`Option ${opt.label} feedback`}
                    className="h-8 text-xs bg-white/90"
                  />
                </div>
              );
            })}
          </div>

          {/* Hint & Difficulty */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="errata-hint"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-700 mb-1.5"
              >
                Study Hint
              </label>
              <Input
                id="errata-hint"
                value={proposedHint}
                onChange={(e) => setProposedHint(e.target.value)}
                placeholder="Optional study hint"
              />
            </div>
            <div>
              <label
                htmlFor="errata-difficulty"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-700 mb-1.5"
              >
                Difficulty (1–10)
              </label>
              <select
                id="errata-difficulty"
                value={proposedDifficulty}
                onChange={(e) => setProposedDifficulty(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value={1}>1 — Very Easy</option>
                <option value={2}>2 — Foundational Recall</option>
                <option value={3}>3 — Basic Concept</option>
                <option value={4}>4 — Standard Knowledge</option>
                <option value={5}>5 — Intermediate</option>
                <option value={6}>6 — Applied Clinical</option>
                <option value={7}>7 — Challenging Analysis</option>
                <option value={8}>8 — Complex Case</option>
                <option value={9}>9 — Advanced Edge Case</option>
                <option value={10}>10 — Expert Synthesis</option>
              </select>
            </div>
          </div>

          {/* Rationale Note */}
          <div>
            <label
              htmlFor="errata-rationale"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-700 mb-1.5"
            >
              Clinical / Pedagogical Rationale
            </label>
            <textarea
              id="errata-rationale"
              rows={2}
              value={rationaleNote}
              onChange={(e) => setRationaleNote(e.target.value)}
              placeholder="Cite textbook reference, ASCP guideline, CLSI standard, or ambiguity detail..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Diff Summary */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-700">Detected Changes:</span>
                {diff.changedFields.length > 0 ? (
                  diff.changedFields.map((field) => (
                    <Badge key={field} variant="accent" className="font-mono text-[11px]">
                      {field}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">None yet — edit fields above or write a rationale note</span>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyDiff}
                className="h-7 text-xs"
              >
                <Copy className="h-3 w-3" />
                {copiedDiff ? 'Copied Diff' : 'Copy Structured Diff'}
              </Button>
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer font-medium text-indigo-700 hover:text-indigo-800">
                Preview Structured GitHub Issue Markdown &amp; JSON Patch
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[11px] font-mono text-slate-700 whitespace-pre-wrap">
                {diff.markdownBody}
              </pre>
            </details>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            {githubSession ? (
              <span>
                Submitting as <strong>@{githubSession.username}</strong> (<code className="font-mono">question-errata</code>)
              </span>
            ) : (
              <span>
                Not signed in — use pre-filled GitHub Issue link or{' '}
                {onOpenFeedbackAuth ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenFeedbackAuth();
                    }}
                    className="font-semibold text-indigo-600 underline hover:text-indigo-700 cursor-pointer"
                  >
                    Sign in with GitHub
                  </button>
                ) : (
                  'connect GitHub'
                )}
                .
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={fallbackIssueUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Github className="h-3.5 w-3.5" />
              Open Pre-Filled GitHub Issue
              <ExternalLink className="h-3 w-3" />
            </a>

            {githubSession && (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={submitting}
              >
                <Send className="h-3.5 w-3.5" />
                {submitting ? 'Submitting...' : 'Submit Correction to GitHub'}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FileWarning,
  GitBranch,
  GitFork,
  Lightbulb,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button, Card } from '@/components/ui/primitives';
import type { QuizWorkspaceRecord, RemixedQuestionRecord } from '@/lib/db';
import { fetchQuestionsByIds } from '@/lib/duckdb';
import { BLOOM_META, cn } from '@/lib/utils';
import type { ManifestData, QuestionRecord } from '@/types/question';

export interface QuestionCardProps {
  question: QuestionRecord;
  manifest?: ManifestData | null;
  globalReveal: boolean;
  onToggleGlobalReveal?: () => void;
  semanticMatch?: {
    semanticScore: number | null;
    keywordMatched: boolean;
  };
  quizzes?: QuizWorkspaceRecord[];
  activeQuizId?: string | null;
  isBookmarked?: boolean;
  onLoadVariants?: (question: QuestionRecord) => Promise<QuestionRecord[]>;
  onAddToQuiz?: (quizId: string, questionId: string) => void;
  onRemoveFromQuiz?: (quizId: string, questionId: string) => void;
  onQuickCreateAndAdd?: (questionId: string) => void;
  onToggleBookmark?: (questionId: string) => void;
  onSuggestCorrection?: (question: QuestionRecord) => void;
  localRemixes?: RemixedQuestionRecord[];
  onOpenRemix?: (
    sourceQuestion: QuestionRecord,
    parentQuestionId: string,
    editingRemix?: RemixedQuestionRecord,
  ) => void;
  onDeleteRemix?: (remixId: string) => void;
  onDeferredAction?: (message: string) => void;
  /** Whether this card is the most visible item in its scroll viewport. */
  isFocused?: boolean;
}

const SLIDE_DURATION_MS = 450;

export function QuestionCard({
  question,
  manifest = null,
  globalReveal,
  onToggleGlobalReveal,
  quizzes = [],
  activeQuizId = null,
  isBookmarked = false,
  onLoadVariants,
  onAddToQuiz,
  onRemoveFromQuiz,
  onQuickCreateAndAdd,
  onToggleBookmark,
  onSuggestCorrection,
  localRemixes = [],
  onOpenRemix,
  onDeleteRemix,
  onDeferredAction,
  isFocused,
}: QuestionCardProps): React.ReactElement {
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [localReveal, setLocalReveal] = useState<boolean>(globalReveal);
  const [variants, setVariants] = useState<QuestionRecord[]>([question]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);
  const [exitingQuestion, setExitingQuestion] = useState<QuestionRecord | null>(null);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  const clearExitTimer = () => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  };

  useEffect(() => {
    setLocalReveal(globalReveal);
  }, [globalReveal]);

  useEffect(() => {
    clearExitTimer();
    setVariants([question]);
    setVariantsLoaded(false);
    setVariantsLoading(false);
    setActiveVariantIndex(0);
    setExitingQuestion(null);
    setSlideDirection(null);
    setVariantsOpen(false);
    return clearExitTimer;
  }, [question]);

  const totalVariants = 1 + question.similarIds.length;
  const totalCount = totalVariants + localRemixes.length;
  const remixStartIndex = totalVariants;

  const getQuestionAtSlot = (idx: number): QuestionRecord | undefined => {
    if (idx < totalVariants) {
      return variants[idx];
    }
    return localRemixes[idx - remixStartIndex]?.question;
  };

  const activeQuestion = getQuestionAtSlot(activeVariantIndex) ?? question;
  const activeRemix =
    activeVariantIndex >= remixStartIndex
      ? localRemixes[activeVariantIndex - remixStartIndex] ?? null
      : null;

  useEffect(() => {
    if (activeVariantIndex >= totalCount) {
      setActiveVariantIndex(0);
    }
  }, [activeVariantIndex, totalCount]);

  const activeQuiz = quizzes.find((qz) => qz.id === activeQuizId) ?? quizzes[0] ?? null;
  const inActiveQuiz = Boolean(activeQuiz?.questionIds.includes(activeQuestion.id));

  const handlePrimaryAdd = () => {
    if (activeQuiz && onAddToQuiz) {
      onAddToQuiz(activeQuiz.id, activeQuestion.id);
    } else if (onQuickCreateAndAdd) {
      onQuickCreateAndAdd(activeQuestion.id);
    } else {
      onDeferredAction?.('Open My Quizzes to create a quiz first.');
    }
  };

  const loadSiblingVariants = async () => {
    if (variantsLoaded || variantsLoading || question.similarIds.length === 0) return;
    setVariantsLoading(true);
    try {
      let siblings: QuestionRecord[] = [];
      if (onLoadVariants) {
        siblings = await onLoadVariants(question);
      } else if (manifest) {
        const sameTopicShards = manifest.shards.filter(
          (s) => s.topicCode === question.topicCode,
        );
        siblings = await fetchQuestionsByIds(manifest, question.similarIds, sameTopicShards);
      }
      const byId = new Map(siblings.map((s) => [s.id, s]));
      const orderedSiblings = question.similarIds
        .map((id) => byId.get(id))
        .filter((item): item is QuestionRecord => Boolean(item));
      setVariants([question, ...orderedSiblings]);
      setVariantsLoaded(true);
    } catch {
      setVariantsLoaded(true);
    } finally {
      setVariantsLoading(false);
    }
  };

  const transitionToVariant = (nextIndex: number) => {
    if (nextIndex === activeVariantIndex || !getQuestionAtSlot(nextIndex)) return;
    clearExitTimer();
    setExitingQuestion(activeQuestion);
    setSlideDirection(nextIndex > activeVariantIndex ? 'right' : 'left');
    setActiveVariantIndex(nextIndex);
    exitTimerRef.current = window.setTimeout(() => {
      setExitingQuestion(null);
      exitTimerRef.current = null;
    }, SLIDE_DURATION_MS);
  };

  const handleToggleVariants = () => {
    const nextOpen = !variantsOpen;
    setVariantsOpen(nextOpen);
    if (nextOpen) {
      void loadSiblingVariants();
    } else if (activeVariantIndex !== 0) {
      transitionToVariant(0);
    }
  };

  const renderQuestionContent = (q: QuestionRecord) => {
    const qBloom = BLOOM_META[q.bloomLevel] ?? {
      label: q.bloomLevel,
      short: q.bloomLevel,
      className: 'bg-[var(--bg-primary)] text-[var(--text-primary)] border-[var(--border-color)]',
    };
    const showInfoBox =
      localReveal && Boolean(q.objective || q.hint || q.difficultyRationale);

    return (
      <>
        {/* Top Row: ASCP Path (left) & Bloom / Difficulty (right) */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
          <span className="min-w-0 truncate font-medium text-[var(--text-secondary)]">{q.ascpPath}</span>
          <span className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            BLOOM: {qBloom.label} | DIFFICULTY: {q.difficulty} / 10
          </span>
        </div>

        {/* Question Text */}
        <p className="mt-2.5 text-[15px] font-medium leading-relaxed text-[var(--text-primary)]">
          {q.questionText}
        </p>

        {/* Options */}
        <div className="mt-3 w-fit max-w-full space-y-2">
          {q.options.map((opt) => {
            const isCorrect = opt.weight === 100;
            const highlightCorrect = isCorrect;
            return (
              <div
                key={opt.label}
                className={cn(
                  'flex items-stretch overflow-hidden rounded-lg border text-sm transition-colors',
                  highlightCorrect
                    ? 'border-emerald-300 dark:border-emerald-700/80 bg-[var(--bg-surface)] text-[var(--text-primary)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)]',
                )}
              >
                <div
                  className={cn(
                    'flex w-10 shrink-0 items-center justify-center border-r',
                    highlightCorrect
                      ? 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-100/80 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                      : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)]',
                  )}
                >
                  {highlightCorrect ? (
                    <CheckCircle2
                      className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                      aria-label="Correct answer"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 rounded-full border-2 border-[var(--border-color)] bg-[var(--bg-surface)]"
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1 px-3 py-2">
                  <div className="leading-snug">{opt.text}</div>
                  {localReveal && opt.feedback && (
                    <p
                      className={cn(
                        'mt-1.5 text-xs leading-relaxed',
                        isCorrect
                          ? 'text-emerald-800 dark:text-emerald-300'
                          : 'text-[var(--text-secondary)]',
                      )}
                    >
                      {opt.feedback}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Objective, Hint & Difficulty Rationale */}
        {showInfoBox && (
          <div className="mt-3 flex w-fit max-w-full items-stretch overflow-hidden rounded-lg border border-amber-200/80 dark:border-amber-800/60 bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)]">
            <div className="flex w-10 shrink-0 items-center justify-center border-r border-amber-200/80 dark:border-amber-800/60 bg-amber-100/75 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
              <Lightbulb className="h-4 w-4 shrink-0" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 p-3">
              {q.objective && (
                <p className="text-[var(--text-primary)]">
                  <strong className="font-semibold text-[var(--text-primary)]">Objective:</strong>{' '}
                  {q.objective}
                </p>
              )}
              {localReveal && q.hint && (
                <p>
                  <strong className="font-semibold text-[var(--text-primary)]">Hint:</strong> {q.hint}
                </p>
              )}
              {localReveal && q.difficultyRationale && (
                <p className="text-[var(--text-secondary)]">
                  <strong className="font-semibold text-[var(--text-primary)]">Difficulty Rationale:</strong>{' '}
                  {q.difficultyRationale}
                </p>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  const slideInClass =
    slideDirection === 'right'
      ? 'animate-slide-in-right'
      : slideDirection === 'left'
        ? 'animate-slide-in-left'
        : '';

  const slideOutClass =
    slideDirection === 'right' ? 'animate-slide-out-left' : 'animate-slide-out-right';

  return (
    <Card
      data-focused={isFocused === undefined ? undefined : String(isFocused)}
      className={cn(
        'p-5 transition-[opacity,box-shadow,border-color] duration-200',
        isFocused === true && 'border-indigo-300 dark:border-indigo-500/70 opacity-100 shadow-md ring-2 ring-indigo-500/15',
        isFocused === false && 'opacity-65 hover:border-[var(--cream-border)] hover:opacity-100 focus-within:opacity-100',
        isFocused === undefined && 'hover:border-[var(--cream-border)]',
      )}
    >
      <div className="overflow-hidden">
        <div className="relative overflow-hidden">
          {exitingQuestion && (
            <div
              key={`exit-${exitingQuestion.id}`}
              aria-hidden="true"
              className={cn('pointer-events-none absolute inset-x-0 top-0', slideOutClass)}
            >
              {renderQuestionContent(exitingQuestion)}
            </div>
          )}
          <div key={activeQuestion.id} className={slideInClass}>
            {renderQuestionContent(activeQuestion)}
          </div>
        </div>

        {/* Action Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-1.5 border-t border-[var(--border-color)] pt-3">
          <div className="mr-auto flex items-center gap-1.5">
            <Button
              variant={localReveal ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={localReveal}
              aria-label={localReveal ? 'Hide feedback' : 'Show feedback'}
              onClick={() => setLocalReveal((prev) => !prev)}
            >
              {localReveal ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              Feedback
            </Button>

            {localReveal && onToggleGlobalReveal && (
              <Button
                variant={globalReveal ? 'primary' : 'outline'}
                size="sm"
                aria-pressed={globalReveal}
                aria-label={
                  globalReveal
                    ? 'Hide feedback for all questions'
                    : 'Reveal feedback for all questions'
                }
                onClick={onToggleGlobalReveal}
              >
                {globalReveal ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    Hide All
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    Reveal All
                  </>
                )}
              </Button>
            )}
          </div>

          {onToggleBookmark && (
            <Button
              variant={isBookmarked ? 'secondary' : 'outline'}
              size="sm"
              aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark question'}
              onClick={() => onToggleBookmark(activeQuestion.id)}
              className={cn(isBookmarked && 'border-amber-200 bg-amber-50 text-amber-700')}
            >
              <Bookmark className={cn('h-3.5 w-3.5', isBookmarked && 'fill-current')} />
              {isBookmarked ? 'Bookmarked' : 'Bookmark'}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (onSuggestCorrection) {
                onSuggestCorrection(activeQuestion);
              } else {
                onDeferredAction?.('Connect question errata handler to submit corrections.');
              }
            }}
          >
            <FileWarning className="h-3.5 w-3.5" />
            Suggest/Discuss
          </Button>

          <div className="inline-flex items-center">
            <Button
              variant={inActiveQuiz ? 'secondary' : 'outline'}
              size="sm"
              disabled={inActiveQuiz && !onRemoveFromQuiz}
              onClick={
                inActiveQuiz
                  ? () => activeQuiz && onRemoveFromQuiz?.(activeQuiz.id, activeQuestion.id)
                  : handlePrimaryAdd
              }
              aria-label={
                inActiveQuiz && onRemoveFromQuiz
                  ? `Remove ${activeQuestion.displayId} from ${activeQuiz?.name ?? 'quiz'}`
                  : undefined
              }
              title={
                inActiveQuiz && onRemoveFromQuiz
                  ? `Remove from ${activeQuiz?.name ?? 'quiz'}`
                  : undefined
              }
              className={cn(
                inActiveQuiz &&
                  'group border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100',
                quizzes.length > 1 && onAddToQuiz && 'rounded-r-none border-r-0',
              )}
            >
              {inActiveQuiz ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>In Use</span>
                  {onRemoveFromQuiz && (
                    <span
                      aria-hidden="true"
                      className="ml-0.5 inline-flex items-center justify-center rounded border border-emerald-200 bg-white/80 p-0.5 text-slate-500 shadow-2xs transition-colors group-hover:border-rose-200 group-hover:bg-rose-50 group-hover:text-rose-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add to Quiz
                </>
              )}
            </Button>

            {quizzes.length > 1 && onAddToQuiz && (
              <select
                aria-label={`Add ${activeQuestion.displayId} to another quiz`}
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    onAddToQuiz(e.target.value, activeQuestion.id);
                  }
                }}
                className="h-8 rounded-r-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-1.5 text-xs text-[var(--text-primary)] cursor-pointer"
              >
                <option value="">▾</option>
                {quizzes.map((qz) => (
                  <option key={qz.id} value={qz.id}>
                    {qz.questionIds.includes(activeQuestion.id) ? '✓ ' : '+ '}
                    {qz.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Button
            variant={variantsOpen ? 'secondary' : 'outline'}
            size="sm"
            aria-expanded={variantsOpen}
            onClick={handleToggleVariants}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Variants/Remix ({totalCount})
          </Button>
        </div>

        {inActiveQuiz && activeQuiz && (
          <div className="mt-2 flex justify-center">
            <p className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/40 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              <span>
                Added to <strong>{activeQuiz.name}</strong>
              </span>
            </p>
          </div>
        )}

        {/* Variant Switcher Bar */}
        {variantsOpen && (
          <div className="mt-3 flex flex-col items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {Array.from({ length: totalVariants }).map((_, idx) => {
                const isLoaded = idx < variants.length;
                const isActive = idx === activeVariantIndex;
                return (
                  <Button
                    key={`variant-${idx + 1}`}
                    variant={isActive ? 'primary' : 'outline'}
                    size="sm"
                    disabled={!isLoaded}
                    onClick={() => transitionToVariant(idx)}
                    className="h-8 min-w-16 px-4 text-xs font-mono"
                  >
                    V{idx + 1}
                  </Button>
                );
              })}

              {localRemixes.map((remix, rIdx) => {
                const slotIdx = remixStartIndex + rIdx;
                const isActive = slotIdx === activeVariantIndex;
                return (
                  <Button
                    key={remix.id}
                    variant={isActive ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => transitionToVariant(slotIdx)}
                    title={`Local remix (${remix.question.displayId})`}
                    className={cn(
                      'h-8 min-w-16 px-3 text-xs font-mono',
                      !isActive && 'border-teal-300 bg-teal-50/70 text-teal-800 hover:bg-teal-100/70',
                    )}
                  >
                    R{rIdx + 1}
                  </Button>
                );
              })}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (onOpenRemix) {
                    onOpenRemix(activeQuestion, question.id);
                  } else {
                    onDeferredAction?.('Connect remix handler to create question variants.');
                  }
                }}
                className="h-8 border-dashed border-teal-400 dark:border-teal-600 bg-[var(--bg-surface)] px-3 text-xs font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40"
              >
                <GitFork className="h-3.5 w-3.5" />
                + Remix
              </Button>
            </div>

            {activeRemix && (onOpenRemix || onDeleteRemix) && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 text-[11px] text-[var(--text-secondary)]">
                <span>Local remix</span>
                {activeRemix.submittedIssueNumber && activeRemix.submittedIssueUrl && (
                  <a
                    href={activeRemix.submittedIssueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-teal-700 dark:text-teal-300 underline"
                  >
                    Issue #{activeRemix.submittedIssueNumber}
                  </a>
                )}
                {onOpenRemix && (
                  <button
                    type="button"
                    onClick={() => onOpenRemix(activeRemix.question, question.id, activeRemix)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)]"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                )}
                {onDeleteRemix && (
                  <button
                    type="button"
                    onClick={() => {
                      transitionToVariant(0);
                      onDeleteRemix(activeRemix.id);
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-100/70 dark:hover:bg-rose-950/50"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                )}
              </div>
            )}

            {variantsLoading && (
              <span className="text-[11px] text-[var(--text-secondary)]">Loading variants…</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

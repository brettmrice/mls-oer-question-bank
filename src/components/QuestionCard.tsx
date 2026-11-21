import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FileWarning,
  GitBranch,
  Info,
  Lightbulb,
  Plus,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui/primitives';
import type { QuizWorkspaceRecord } from '@/lib/db';
import { BLOOM_META, cn, DISCIPLINE_COLORS } from '@/lib/utils';
import type { QuestionRecord } from '@/types/question';

export interface QuestionCardProps {
  question: QuestionRecord;
  globalReveal: boolean;
  semanticMatch?: {
    semanticScore: number | null;
    keywordMatched: boolean;
  };
  quizzes?: QuizWorkspaceRecord[];
  activeQuizId?: string | null;
  isBookmarked?: boolean;
  onInspect: (question: QuestionRecord) => void;
  onAddToQuiz?: (quizId: string, questionId: string) => void;
  onQuickCreateAndAdd?: (questionId: string) => void;
  onToggleBookmark?: (questionId: string) => void;
  onSuggestCorrection?: (question: QuestionRecord) => void;
  onDeferredAction?: (message: string) => void;
}

export function QuestionCard({
  question,
  globalReveal,
  semanticMatch,
  quizzes = [],
  activeQuizId = null,
  isBookmarked = false,
  onInspect,
  onAddToQuiz,
  onQuickCreateAndAdd,
  onToggleBookmark,
  onSuggestCorrection,
  onDeferredAction,
}: QuestionCardProps): React.ReactElement {
  const [localReveal, setLocalReveal] = useState(globalReveal);

  useEffect(() => {
    setLocalReveal(globalReveal);
  }, [globalReveal]);

  const bloom = BLOOM_META[question.bloomLevel] ?? {
    label: question.bloomLevel,
    short: question.bloomLevel,
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  const activeQuiz = quizzes.find((qz) => qz.id === activeQuizId) ?? quizzes[0] ?? null;
  const inActiveQuiz = Boolean(activeQuiz?.questionIds.includes(question.id));

  const handlePrimaryAdd = () => {
    if (activeQuiz && onAddToQuiz) {
      onAddToQuiz(activeQuiz.id, question.id);
    } else if (onQuickCreateAndAdd) {
      onQuickCreateAndAdd(question.id);
    } else {
      onDeferredAction?.('Open My Quizzes to create a quiz first.');
    }
  };

  return (
    <Card className="p-5 transition hover:border-slate-300">
      {/* Header Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            className={cn(
              'font-bold',
              DISCIPLINE_COLORS[question.disciplineCode] ?? 'bg-slate-100 text-slate-800',
            )}
          >
            {question.disciplineCode}
          </Badge>
          <Badge variant="outline" className="font-mono text-[11px]">
            {question.topicCode}
          </Badge>
          <Badge className={bloom.className}>
            {bloom.label} ({bloom.short})
          </Badge>
          <Badge variant="outline">Diff {question.difficulty}/10</Badge>
          <Badge variant="outline" className="font-mono text-[11px]">
            {question.questionType}
          </Badge>
          {question.similarIds.length > 0 && (
            <Badge variant="accent" title="Precomputed sibling variants (cosine > 0.90)">
              <GitBranch className="h-3 w-3" />
              {question.similarIds.length} similar
            </Badge>
          )}
          {semanticMatch?.semanticScore !== null &&
            semanticMatch?.semanticScore !== undefined && (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
                {Math.round(Math.max(0, semanticMatch.semanticScore) * 100)}% semantic
              </Badge>
            )}
          {semanticMatch?.keywordMatched && (
            <Badge className="bg-amber-50 text-amber-800 border-amber-200">
              Exact clinical match
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
          <span>{question.displayId}</span>
          <span aria-hidden="true">•</span>
          <span title="Immutable Content-Addressed Question UID">{question.id}</span>
        </div>
      </div>

      {/* 4-level ASCP path & subsets */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate font-medium text-slate-600">{question.ascpPath}</span>
        <div className="flex flex-wrap gap-1">
          {question.subsetTags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
            >
              {tag}
            </span>
          ))}
          {question.subsetTags.length > 4 && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              +{question.subsetTags.length - 4}
            </span>
          )}
        </div>
      </div>

      {/* Assessment Objective */}
      {question.objective && (
        <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200/70 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Objective: </span>
          {question.objective}
        </div>
      )}

      {/* Question Text */}
      <p className="mt-3 text-[15px] font-medium leading-relaxed text-slate-900">
        {question.questionText}
      </p>

      {/* Options */}
      <div className="mt-3 space-y-2">
        {question.options.map((opt) => {
          const isCorrect = opt.weight === 100;
          const highlightCorrect = localReveal && isCorrect;
          return (
            <div
              key={opt.label}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm transition-colors',
                highlightCorrect
                  ? 'border-emerald-300 bg-emerald-50/70 text-emerald-950'
                  : 'border-slate-200 bg-white text-slate-800',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      highlightCorrect
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-700',
                    )}
                  >
                    {opt.label}
                  </span>
                  <span>{opt.text}</span>
                </div>
                {highlightCorrect && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                )}
              </div>

              {localReveal && opt.feedback && (
                <p
                  className={cn(
                    'mt-1.5 pl-7 text-xs leading-relaxed',
                    isCorrect ? 'text-emerald-800' : 'text-slate-600',
                  )}
                >
                  {opt.feedback}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Revealed Hint & Difficulty Rationale */}
      {localReveal && (question.hint || question.difficultyRationale) && (
        <div className="mt-3 space-y-1.5 rounded-lg border border-amber-200/80 bg-amber-50/50 p-3 text-xs text-slate-700">
          {question.hint && (
            <p className="flex items-start gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
              <span>
                <strong className="font-semibold">Hint:</strong> {question.hint}
              </span>
            </p>
          )}
          {question.difficultyRationale && (
            <p className="text-slate-600">
              <strong className="font-semibold text-slate-700">Difficulty Rationale:</strong>{' '}
              {question.difficultyRationale}
            </p>
          )}
        </div>
      )}

      {/* Action Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={localReveal ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setLocalReveal((prev) => !prev)}
          >
            {localReveal ? (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                Hide Answer
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" />
                Reveal Answer &amp; Rationales
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onInspect(question)}>
            <Info className="h-3.5 w-3.5" />
            Inspect Details
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onToggleBookmark && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark question'}
              onClick={() => onToggleBookmark(question.id)}
              className={isBookmarked ? 'text-amber-600 bg-amber-50' : ''}
            >
              <Bookmark className={cn('h-3.5 w-3.5', isBookmarked && 'fill-current')} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (onSuggestCorrection) {
                onSuggestCorrection(question);
              } else {
                onDeferredAction?.('Connect question errata handler to submit corrections.');
              }
            }}
          >
            <FileWarning className="h-3.5 w-3.5" />
            Suggest Correction
          </Button>

          <div className="inline-flex items-center">
            <Button
              variant={inActiveQuiz ? 'secondary' : 'outline'}
              size="sm"
              disabled={inActiveQuiz}
              onClick={handlePrimaryAdd}
              className={cn(
                inActiveQuiz && 'border-emerald-200 bg-emerald-50 text-emerald-800',
                quizzes.length > 1 && onAddToQuiz && 'rounded-r-none border-r-0',
              )}
            >
              {inActiveQuiz ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  In {activeQuiz?.name}
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  {activeQuiz ? `Add to ${activeQuiz.name}` : 'Add to Quiz'}
                </>
              )}
            </Button>

            {quizzes.length > 1 && onAddToQuiz && (
              <select
                aria-label={`Add ${question.displayId} to another quiz`}
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    onAddToQuiz(e.target.value, question.id);
                  }
                }}
                className="h-8 rounded-r-md border border-slate-300 bg-white px-1.5 text-xs text-slate-700 cursor-pointer"
              >
                <option value="">▾</option>
                {quizzes.map((qz) => (
                  <option key={qz.id} value={qz.id}>
                    {qz.questionIds.includes(question.id) ? '✓ ' : '+ '}
                    {qz.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

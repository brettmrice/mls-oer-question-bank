import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  GitBranch,
  Lightbulb,
  Plus,
} from 'lucide-react';
import { QuestionComments } from '@/components/QuestionComments';
import { Badge, Button, Drawer, Separator, Skeleton } from '@/components/ui/primitives';
import { fetchQuestionsByIds } from '@/lib/duckdb';
import { BLOOM_META, cn, DISCIPLINE_COLORS } from '@/lib/utils';
import type { ManifestData, QuestionRecord } from '@/types/question';

export interface QuestionDetailDrawerProps {
  manifest: ManifestData;
  question: QuestionRecord | null;
  activeQuizName?: string | null;
  inActiveQuiz?: boolean;
  onAddToActiveQuiz?: (questionId: string) => void;
  onSuggestCorrection?: (question: QuestionRecord) => void;
  onClose: () => void;
  onSelectQuestion: (question: QuestionRecord) => void;
}

export function QuestionDetailDrawer({
  manifest,
  question,
  activeQuizName = null,
  inActiveQuiz = false,
  onAddToActiveQuiz,
  onSuggestCorrection,
  onClose,
  onSelectQuestion,
}: QuestionDetailDrawerProps): React.ReactElement {
  const [siblings, setSiblings] = useState<QuestionRecord[]>([]);
  const [siblingsLoading, setSiblingsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!question || question.similarIds.length === 0) {
      setSiblings([]);
      setSiblingsLoading(false);
      return;
    }

    setSiblingsLoading(true);
    const sameTopicShards = manifest.shards.filter((s) => s.topicCode === question.topicCode);
    fetchQuestionsByIds(manifest, question.similarIds, sameTopicShards)
      .then((res) => {
        if (!cancelled) {
          setSiblings(res);
          setSiblingsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSiblings([]);
          setSiblingsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manifest, question]);

  const bloom = question
    ? (BLOOM_META[question.bloomLevel] ?? {
        label: question.bloomLevel,
        short: question.bloomLevel,
        className: 'bg-slate-100 text-slate-700',
      })
    : null;

  return (
    <Drawer
      open={question !== null}
      onClose={onClose}
      title={question ? `${question.displayId} (${question.id})` : 'Question Details'}
      subtitle={question?.ascpPath}
    >
      {question && (
        <div className="space-y-6">
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={cn('font-bold', DISCIPLINE_COLORS[question.disciplineCode])}>
              {question.disciplineCode} — {question.disciplineName}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {question.taxonomicCode || question.topicCode}
            </Badge>
            {bloom && (
              <Badge className={bloom.className}>
                {bloom.label} ({bloom.short})
              </Badge>
            )}
            <Badge variant="outline">Difficulty {question.difficulty}/10</Badge>
            <Badge variant="outline">{question.questionType}</Badge>
            {onAddToActiveQuiz && (
              <Button
                variant={inActiveQuiz ? 'secondary' : 'primary'}
                size="sm"
                disabled={inActiveQuiz}
                onClick={() => onAddToActiveQuiz(question.id)}
                className="ml-auto h-7 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                {inActiveQuiz
                  ? `In ${activeQuizName ?? 'Active Quiz'}`
                  : activeQuizName
                    ? `Add to ${activeQuizName}`
                    : 'Add to Quiz'}
              </Button>
            )}
          </div>

          {/* Objective & Question */}
          <div className="space-y-3">
            {question.objective && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <strong className="font-semibold text-slate-900">Assessment Objective: </strong>
                {question.objective}
              </div>
            )}
            <p className="text-base font-semibold leading-relaxed text-slate-900">
              {question.questionText}
            </p>
          </div>

          {/* Full Options + Rationales */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Options &amp; Educator Rationales
            </h3>
            {question.options.map((opt) => {
              const isCorrect = opt.weight === 100;
              return (
                <div
                  key={opt.label}
                  className={cn(
                    'rounded-lg border p-3 text-sm',
                    isCorrect
                      ? 'border-emerald-300 bg-emerald-50/70'
                      : 'border-slate-200 bg-white',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 font-medium">
                    <span>
                      <span className="mr-1.5 font-mono font-bold">{opt.label})</span>
                      {opt.text}
                    </span>
                    {isCorrect && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                    )}
                  </div>
                  {opt.feedback && (
                    <p
                      className={cn(
                        'mt-1.5 text-xs leading-relaxed',
                        isCorrect ? 'text-emerald-900' : 'text-slate-600',
                      )}
                    >
                      {opt.feedback}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Hint & Difficulty Rationale */}
          {(question.hint || question.difficultyRationale) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 text-xs space-y-2">
              {question.hint && (
                <p className="flex items-start gap-1.5 text-slate-800">
                  <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    <strong>Hint:</strong> {question.hint}
                  </span>
                </p>
              )}
              {question.difficultyRationale && (
                <p className="text-slate-700">
                  <strong>Difficulty Rationale:</strong> {question.difficultyRationale}
                </p>
              )}
            </div>
          )}

          <Separator />

          {/* Sibling / Similar Questions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <GitBranch className="h-3.5 w-3.5 text-indigo-600" />
                Similar / Sibling Variants (Cosine &gt; 0.90)
              </h3>
              <Badge variant="outline">{question.similarIds.length}</Badge>
            </div>

            {question.similarIds.length === 0 ? (
              <p className="text-xs text-slate-500">
                No near-duplicate siblings detected above the 0.90 cosine threshold.
              </p>
            ) : siblingsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <div className="space-y-2">
                {siblings.map((sib) => (
                  <div
                    key={sib.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs hover:border-indigo-300 transition"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono font-semibold text-slate-700">
                        {sib.displayId} • {sib.id}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => onSelectQuestion(sib)}
                      >
                        View Variant
                      </Button>
                    </div>
                    <p className="text-slate-800 line-clamp-2">{sib.questionText}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Source Files & Subset Provenance */}
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <FileText className="h-3.5 w-3.5" />
              Provenance &amp; Subset Membership
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {question.subsetTags.map((tag) => (
                <Badge key={tag} className="font-mono text-[11px]">
                  {tag}
                </Badge>
              ))}
            </div>
            <ul className="space-y-1 text-[11px] font-mono text-slate-500 break-all">
              {question.sourceFiles.map((src) => (
                <li key={src}>{src}</li>
              ))}
            </ul>
          </div>

          <Separator />

          <QuestionComments
            questionId={question.id}
            onOpenErrata={onSuggestCorrection ? () => onSuggestCorrection(question) : undefined}
          />
        </div>
      )}
    </Drawer>
  );
}

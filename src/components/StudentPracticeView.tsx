import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  GraduationCap,
  Lightbulb,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { FormattedText } from '@/components/FormattedText';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { BLOOM_META, cn, DISCIPLINE_COLORS, formatAscpBreadcrumb } from '@/lib/utils';
import type { QuestionRecord } from '@/types/question';

export interface StudentPracticeViewProps {
  title: string;
  subtitle?: string;
  questions: QuestionRecord[];
  onExit: () => void;
}

export function StudentPracticeView({
  title,
  subtitle,
  questions,
  onExit,
}: StudentPracticeViewProps): React.ReactElement {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealedHints, setRevealedHints] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  const answeredCount = Object.keys(answers).length;

  const scoreSummary = useMemo(() => {
    if (!submitted) return null;
    let correct = 0;
    const byDisc = new Map<string, { correct: number; total: number }>();

    for (const q of questions) {
      const selected = answers[q.id];
      const correctOpt = q.options.find((o) => o.weight === 100);
      const isRight = Boolean(selected && correctOpt && selected === correctOpt.label);
      if (isRight) correct += 1;

      const entry = byDisc.get(q.disciplineCode) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (isRight) entry.correct += 1;
      byDisc.set(q.disciplineCode, entry);
    }

    const pct = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    return {
      correct,
      total: questions.length,
      pct,
      byDisc: Array.from(byDisc.entries()).sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [submitted, questions, answers]);

  const handleRetake = () => {
    setAnswers({});
    setRevealedHints({});
    setSubmitted(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 space-y-5">
      {/* Header Bar */}
      <Card className="p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">
              <GraduationCap className="h-3.5 w-3.5" />
              Student Self-Practice Mode
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              CC0-1.0
            </Badge>
          </div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-600">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600">
            Answered: <strong>{answeredCount}</strong> / {questions.length}
          </span>
          <Button variant="outline" size="sm" onClick={onExit}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Exit Practice Mode
          </Button>
        </div>
      </Card>

      {/* Post-Submission Score Card */}
      {submitted && scoreSummary && (
        <Card className="border-indigo-200 bg-indigo-50/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-indigo-950">
                Attempt Score: {scoreSummary.correct} / {scoreSummary.total} ({scoreSummary.pct}
                %)
              </h3>
              <p className="text-xs text-indigo-800">
                Review each question below for full per-option rationales and ASCP topic
                mappings.
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={handleRetake}>
              <RotateCcw className="h-3.5 w-3.5" />
              Retake Practice Quiz
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {scoreSummary.byDisc.map(([code, stat]) => (
              <Badge key={code} className={cn('text-xs', DISCIPLINE_COLORS[code])}>
                {code}: {stat.correct}/{stat.total}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Question Runner */}
      <div className="space-y-4">
        {questions.map((q, idx) => {
          const chosen = answers[q.id];
          const correctOpt = q.options.find((o) => o.weight === 100);
          const isCorrect = Boolean(chosen && correctOpt && chosen === correctOpt.label);
          const hintVisible = Boolean(revealedHints[q.id]);

          return (
            <Card key={q.id} className="p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-slate-500">
                    Question {idx + 1}
                  </span>
                  <Badge className={cn('text-[10px]', DISCIPLINE_COLORS[q.disciplineCode])}>
                    {q.disciplineCode}
                  </Badge>
                  <Badge className={cn('text-[10px]', BLOOM_META[q.bloomLevel]?.className)}>
                    {q.bloomLevel}
                  </Badge>
                </div>

                {submitted ? (
                  isCorrect ? (
                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Correct
                    </Badge>
                  ) : (
                    <Badge className="bg-rose-50 text-rose-700 border-rose-200">
                      <XCircle className="h-3 w-3" />
                      {chosen ? `Selected ${chosen} • Answer ${correctOpt?.label}` : `Unanswered • Answer ${correctOpt?.label}`}
                    </Badge>
                  )
                ) : (
                  q.hint && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-amber-700 hover:bg-amber-50"
                      onClick={() =>
                        setRevealedHints((prev) => ({
                          ...prev,
                          [q.id]: !prev[q.id],
                        }))
                      }
                    >
                      <Lightbulb className="h-3.5 w-3.5" />
                      {hintVisible ? 'Hide Hint' : 'Show Hint'}
                    </Button>
                  )
                )}
              </div>

              <p className="text-[15px] font-medium leading-relaxed text-[var(--text-primary)]">
                <FormattedText text={q.questionText} />
              </p>

              {!submitted && hintVisible && q.hint && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-950 dark:text-amber-200">
                  <strong>Hint:</strong> <FormattedText text={q.hint} />
                </div>
              )}

              <div className="w-fit max-w-full space-y-2">
                {q.options.map((opt) => {
                  const selected = chosen === opt.label;
                  const optionIsCorrect = opt.weight === 100;

                  let styleClass =
                    'border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)]';
                  if (!submitted && selected) {
                    styleClass =
                      'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200 ring-1 ring-indigo-500';
                  } else if (submitted && optionIsCorrect) {
                    styleClass =
                      'border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200';
                  } else if (submitted && selected && !optionIsCorrect) {
                    styleClass =
                      'border-rose-300 dark:border-rose-700 bg-rose-50/70 dark:bg-rose-950/40 text-rose-950 dark:text-rose-200';
                  }

                  return (
                    <label
                      key={opt.label}
                      className={cn(
                        'block rounded-lg border px-3.5 py-2.5 text-sm transition',
                        !submitted && 'cursor-pointer',
                        styleClass,
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <input
                          type="radio"
                          name={`practice_${q.id}`}
                          value={opt.label}
                          disabled={submitted}
                          checked={selected}
                          onChange={() =>
                            setAnswers((prev) => ({ ...prev, [q.id]: opt.label }))
                          }
                          className="mt-1 h-4 w-4 text-indigo-600"
                        />
                        <span className="flex-1">
                          <span className="font-mono font-bold mr-1.5">{opt.label})</span>
                          <FormattedText text={opt.text} />
                        </span>
                      </div>

                      {submitted && opt.feedback && (
                        <p className="mt-1.5 pl-6 text-xs leading-relaxed opacity-90">
                          <FormattedText text={opt.feedback} />
                        </p>
                      )}
                    </label>
                  );
                })}
              </div>

              {submitted && (
                <div className="pt-1 text-[11px] text-[var(--text-secondary)]">
                  <strong>ASCP Path:</strong> {formatAscpBreadcrumb(q.ascpPath)}
                  {q.hint ? (
                    <>
                      {' '}• Hint: <FormattedText text={q.hint} />
                    </>
                  ) : (
                    ''
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {!submitted && questions.length > 0 && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-[var(--text-secondary)]">
            {answeredCount === questions.length
              ? 'All questions answered — ready to submit.'
              : `${questions.length - answeredCount} question(s) still unanswered.`}
          </span>
          <Button variant="primary" onClick={() => setSubmitted(true)}>
            Submit Attempt &amp; Review Rationales
          </Button>
        </Card>
      )}
    </div>
  );
}

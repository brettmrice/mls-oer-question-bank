import React, { useMemo, useState } from 'react';
import { Clock, Gauge, Target } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { computeQuizBlueprint, type BlueprintTrack } from '@/lib/quizAnalytics';
import { BLOOM_META, cn, DISCIPLINE_COLORS } from '@/lib/utils';
import type { ManifestData, QuestionRecord } from '@/types/question';

export interface BlueprintBalanceMeterProps {
  questions: QuestionRecord[];
  manifest: ManifestData;
}

export function BlueprintBalanceMeter({
  questions,
  manifest,
}: BlueprintBalanceMeterProps): React.ReactElement {
  const [track, setTrack] = useState<BlueprintTrack>('MLS');

  const summary = useMemo(
    () => computeQuizBlueprint(questions, manifest, track),
    [questions, manifest, track],
  );

  const statusBadge = (status: 'in_range' | 'under' | 'over' | 'unweighted') => {
    switch (status) {
      case 'in_range':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'under':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'over':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-indigo-600" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            ASCP Blueprint Balance Meter
          </h4>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['MLS', 'MLT', 'Specialist'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTrack(t)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer',
                track === t
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="block text-[10px] uppercase tracking-wider text-slate-400">
            Questions
          </span>
          <span className="text-sm font-bold text-slate-900">
            {summary.totalQuestions}
          </span>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <Gauge className="h-3 w-3" />
            Avg Diff
          </span>
          <span className="text-sm font-bold text-slate-900">
            {summary.avgDifficulty} / 10
          </span>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <Clock className="h-3 w-3" />
            Est. Time
          </span>
          <span className="text-sm font-bold text-slate-900">
            ~{summary.estimatedMinutes} min
          </span>
        </div>
      </div>

      {/* Bloom's Taxonomy Distribution */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="font-semibold text-slate-700">Bloom&apos;s Mix</span>
          <div className="flex flex-wrap gap-1.5">
            {(['RE', 'UN', 'AP', 'AN'] as const).map((b) => (
              <span key={b} className="font-mono text-slate-600">
                {b}: <strong>{summary.bloomCounts[b]}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
          {summary.totalQuestions > 0 &&
            (['RE', 'UN', 'AP', 'AN'] as const).map((b) => {
              const pct = (summary.bloomCounts[b] / summary.totalQuestions) * 100;
              if (pct === 0) return null;
              const barColor: Record<string, string> = {
                RE: 'bg-slate-500',
                UN: 'bg-sky-500',
                AP: 'bg-indigo-500',
                AN: 'bg-violet-600',
              };
              return (
                <div
                  key={b}
                  title={`${BLOOM_META[b]?.label ?? b}: ${summary.bloomCounts[b]} (${pct.toFixed(0)}%)`}
                  className={barColor[b]}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
        </div>
      </div>

      {/* Per-Discipline Rows */}
      <div className="space-y-2">
        {summary.disciplineRows.map((row) => (
          <div key={row.disciplineCode} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] font-bold',
                    DISCIPLINE_COLORS[row.disciplineCode],
                  )}
                >
                  {row.disciplineCode}
                </span>
                <span className="truncate text-slate-700">{row.disciplineName}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="font-mono text-[11px] text-slate-700">
                  {row.count} ({row.actualPct}%)
                </span>
                {row.targetLabel && (
                  <Badge className={cn('text-[10px] px-1.5 py-0', statusBadge(row.status))}>
                    Target {row.targetLabel}
                  </Badge>
                )}
              </div>
            </div>
            <div className="relative h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              {row.targetMinPct !== null && row.targetMaxPct !== null && (
                <div
                  className="absolute top-0 bottom-0 bg-emerald-200/70"
                  style={{
                    left: `${Math.min(100, row.targetMinPct)}%`,
                    width: `${Math.max(2, Math.min(100, row.targetMaxPct) - Math.min(100, row.targetMinPct))}%`,
                  }}
                />
              )}
              <div
                className={cn(
                  'relative h-full rounded-full transition-all',
                  row.status === 'in_range'
                    ? 'bg-emerald-600'
                    : row.status === 'over'
                      ? 'bg-rose-500'
                      : row.status === 'under'
                        ? 'bg-amber-500'
                        : 'bg-indigo-500',
                )}
                style={{ width: `${Math.min(100, row.actualPct)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

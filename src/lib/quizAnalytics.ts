import type { ManifestData, QuestionRecord } from '@/types/question';

export type BlueprintTrack = 'MLS' | 'MLT' | 'Specialist';

export interface DisciplineCoverageRow {
  disciplineCode: string;
  disciplineName: string;
  count: number;
  actualPct: number;
  targetMinPct: number | null;
  targetMaxPct: number | null;
  targetLabel: string | null;
  status: 'in_range' | 'under' | 'over' | 'unweighted';
}

export interface QuizBlueprintSummary {
  track: BlueprintTrack;
  totalQuestions: number;
  disciplineRows: DisciplineCoverageRow[];
  bloomCounts: Record<'RE' | 'UN' | 'AP' | 'AN', number>;
  avgDifficulty: number;
  estimatedMinutes: number;
}

export interface EnemyPair {
  a: QuestionRecord;
  b: QuestionRecord;
}

export function computeQuizBlueprint(
  questions: QuestionRecord[],
  manifest: ManifestData,
  track: BlueprintTrack = 'MLS',
): QuizBlueprintSummary {
  const total = questions.length;
  const discCounts = new Map<string, number>();
  const bloomCounts: Record<'RE' | 'UN' | 'AP' | 'AN', number> = {
    RE: 0,
    UN: 0,
    AP: 0,
    AN: 0,
  };

  let diffSum = 0;
  let minutesSum = 0;

  for (const q of questions) {
    discCounts.set(q.disciplineCode, (discCounts.get(q.disciplineCode) ?? 0) + 1);
    if (q.bloomLevel === 'RE' || q.bloomLevel === 'UN' || q.bloomLevel === 'AP' || q.bloomLevel === 'AN') {
      bloomCounts[q.bloomLevel] += 1;
    }
    diffSum += q.difficulty;
    minutesSum += q.bloomLevel === 'AP' || q.bloomLevel === 'AN' ? 1.5 : 1.0;
  }

  const disciplineCodes = Object.keys(manifest.disciplines).sort();
  const disciplineRows: DisciplineCoverageRow[] = disciplineCodes.map((code) => {
    const disc = manifest.disciplines[code];
    const count = discCounts.get(code) ?? 0;
    const actualPct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    const weight = disc.blueprintWeights?.[track];
    const targetMinPct = weight?.minPct ?? null;
    const targetMaxPct = weight?.maxPct ?? null;
    const targetLabel = weight?.rawValue ?? null;

    let status: DisciplineCoverageRow['status'] = 'unweighted';
    if (total > 0 && targetMinPct !== null && targetMaxPct !== null) {
      if (actualPct < targetMinPct) status = 'under';
      else if (actualPct > targetMaxPct) status = 'over';
      else status = 'in_range';
    }

    return {
      disciplineCode: code,
      disciplineName: disc.disciplineName,
      count,
      actualPct,
      targetMinPct,
      targetMaxPct,
      targetLabel,
      status,
    };
  });

  return {
    track,
    totalQuestions: total,
    disciplineRows,
    bloomCounts,
    avgDifficulty: total > 0 ? Math.round((diffSum / total) * 10) / 10 : 0,
    estimatedMinutes: total > 0 ? Math.max(1, Math.round(minutesSum)) : 0,
  };
}

export function detectEnemyPairs(questions: QuestionRecord[]): EnemyPair[] {
  const pairs: EnemyPair[] = [];
  for (let i = 0; i < questions.length; i++) {
    const a = questions[i];
    const aSims = new Set(a.similarIds);
    for (let j = i + 1; j < questions.length; j++) {
      const b = questions[j];
      if (aSims.has(b.id) || b.similarIds.includes(a.id)) {
        pairs.push({ a, b });
      }
    }
  }
  return pairs;
}

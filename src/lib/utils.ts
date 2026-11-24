import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Strip leading "Clinical " prefix from discipline names in ASCP breadcrumb paths. */
export function formatAscpBreadcrumb(ascpPath: string): string {
  return ascpPath.replace(/^Clinical\s+/i, '');
}

export interface CompactHeaderStep {
  breadcrumb: string;
  meta: string;
}

/**
 * Build ordered responsive header steps from most verbose to most compact.
 * Keeps the leaf visible as long as possible by ellipsing parent -> ancestors,
 * compacting the Bloom/Difficulty label, and acronyming the top discipline.
 */
export function buildCompactHeaderSteps(
  ascpPath: string,
  disciplineCode: string,
  bloomLabel: string,
  bloomShort: string,
  difficulty: number,
): CompactHeaderStep[] {
  const clean = formatAscpBreadcrumb(ascpPath);
  const segs = clean
    .split(' > ')
    .map((s) => s.trim())
    .filter(Boolean);

  const metaFull = `BLOOM: ${bloomLabel} | DIFFICULTY: ${difficulty} / 10`;
  const metaMid = `BL: ${bloomShort} | DIFF: ${difficulty} / 10`;
  const metaMin = `${bloomShort} | ${difficulty} / 10`;

  if (segs.length <= 1) {
    const only = segs[0] ?? clean;
    return [
      { breadcrumb: only, meta: metaFull },
      { breadcrumb: only, meta: metaMid },
      { breadcrumb: only, meta: metaMin },
    ];
  }

  const top = segs[0];
  const leaf = segs[segs.length - 1];
  const middle = segs.slice(1, -1);
  const topAcronym =
    disciplineCode.trim().toUpperCase() ||
    top
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');

  const steps: CompactHeaderStep[] = [{ breadcrumb: segs.join(' > '), meta: metaFull }];

  // Ellipse parent first, then ancestor, and so on up toward top
  for (let hiddenCount = 1; hiddenCount <= middle.length; hiddenCount++) {
    const keptMiddle = middle.slice(0, middle.length - hiddenCount);
    steps.push({
      breadcrumb: [top, ...keptMiddle, '...', leaf].join(' > '),
      meta: metaFull,
    });
  }

  const collapsedWithTop =
    middle.length > 0 ? [top, '...', leaf].join(' > ') : [top, leaf].join(' > ');
  const collapsedWithAcronym =
    middle.length > 0 ? [topAcronym, '...', leaf].join(' > ') : [topAcronym, leaf].join(' > ');

  steps.push({ breadcrumb: collapsedWithTop, meta: metaMid });
  if (topAcronym !== top) {
    steps.push({ breadcrumb: collapsedWithAcronym, meta: metaMid });
  }
  steps.push({ breadcrumb: collapsedWithAcronym, meta: metaMin });

  return steps;
}

let cachedMeasureCtx: CanvasRenderingContext2D | null | undefined;

export function measureTextWidth(text: string, font: string): number {
  if (typeof document !== 'undefined') {
    if (cachedMeasureCtx === undefined) {
      try {
        cachedMeasureCtx = document.createElement('canvas').getContext('2d');
      } catch {
        cachedMeasureCtx = null;
      }
    }
    if (cachedMeasureCtx) {
      cachedMeasureCtx.font = font;
      return cachedMeasureCtx.measureText(text).width;
    }
  }
  return text.length * 7;
}

export function selectCompactHeaderStep(
  steps: CompactHeaderStep[],
  availableWidth: number,
  breadcrumbFont: string,
  metaFont: string,
  metaTrackingPx = 0.275,
): { stepIndex: number; wraps: boolean } {
  const gapAndBufferPx = 12;
  for (let i = 0; i < steps.length; i++) {
    const bw = measureTextWidth(steps[i].breadcrumb, breadcrumbFont);
    const mw = measureTextWidth(steps[i].meta, metaFont) + steps[i].meta.length * metaTrackingPx;
    if (bw + mw + gapAndBufferPx <= availableWidth) {
      return { stepIndex: i, wraps: false };
    }
  }
  return { stepIndex: steps.length - 1, wraps: true };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** idx;
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export const BLOOM_META: Record<
  string,
  { label: string; short: string; className: string; order: number }
> = {
  RE: {
    label: 'Remember',
    short: 'RE',
    className: 'bg-slate-100 text-slate-700 border-slate-300',
    order: 1,
  },
  UN: {
    label: 'Understand',
    short: 'UN',
    className: 'bg-sky-50 text-sky-700 border-sky-200',
    order: 2,
  },
  AP: {
    label: 'Apply',
    short: 'AP',
    className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    order: 3,
  },
  AN: {
    label: 'Analyze',
    short: 'AN',
    className: 'bg-violet-50 text-violet-700 border-violet-200',
    order: 4,
  },
};

export const DISCIPLINE_COLORS: Record<string, string> = {
  BB: 'bg-rose-50 text-rose-800 border-rose-200',
  CH: 'bg-amber-50 text-amber-800 border-amber-200',
  HE: 'bg-red-50 text-red-800 border-red-200',
  IM: 'bg-teal-50 text-teal-800 border-teal-200',
  LO: 'bg-slate-100 text-slate-800 border-slate-300',
  MB: 'bg-purple-50 text-purple-800 border-purple-200',
  MI: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  UA: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  BF: 'bg-sky-50 text-sky-800 border-sky-200',
  UABF: 'bg-cyan-50 text-cyan-800 border-cyan-200',
};

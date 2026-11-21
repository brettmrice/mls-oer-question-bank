import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
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

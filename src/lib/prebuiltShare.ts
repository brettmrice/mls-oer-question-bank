import LZString from 'lz-string';
import type { QuizWorkspaceRecord } from '@/lib/db';
import { createQuiz } from '@/lib/quizStore';

export type PrebuiltShareMode = 'educator' | 'practice';

export interface PrebuiltSharePayload {
  title: string;
  description: string;
  author?: string;
  institution?: string;
  tags: string[];
  questionIds: string[];
  customPoints?: Record<string, number>;
  license: 'CC0-1.0';
}

export interface ParsedPrebuiltHash {
  kind: 'lz' | 'catalog' | 'gist';
  mode: PrebuiltShareMode;
  payload?: PrebuiltSharePayload;
  refId?: string;
  rawHash: string;
}

export function encodePrebuiltHashUrl(
  payload: PrebuiltSharePayload,
  mode: PrebuiltShareMode = 'educator',
  baseHref?: string,
): string {
  const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
  const hash = `#prebuilt=lz:${compressed}&mode=${mode}`;
  if (baseHref) {
    return `${baseHref.split('#')[0]}${hash}`;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.href.split('#')[0]}${hash}`;
  }
  return hash;
}

export function encodeCatalogHashUrl(
  catalogId: string,
  mode: PrebuiltShareMode = 'educator',
  baseHref?: string,
): string {
  const hash = `#prebuilt=catalog:${encodeURIComponent(catalogId)}&mode=${mode}`;
  if (baseHref) {
    return `${baseHref.split('#')[0]}${hash}`;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.href.split('#')[0]}${hash}`;
  }
  return hash;
}

export function parsePrebuiltLocationHash(hashInput: string): ParsedPrebuiltHash | null {
  const cleanHash = hashInput.includes('#')
    ? hashInput.slice(hashInput.indexOf('#') + 1)
    : hashInput;
  if (!cleanHash || !cleanHash.includes('prebuilt=')) return null;

  const params = new URLSearchParams(cleanHash);
  const prebuiltParam = params.get('prebuilt');
  if (!prebuiltParam) return null;

  const rawMode = params.get('mode');
  const mode: PrebuiltShareMode = rawMode === 'practice' ? 'practice' : 'educator';

  if (prebuiltParam.startsWith('lz:')) {
    const encoded = prebuiltParam.slice(3);
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as Partial<PrebuiltSharePayload>;
      if (!parsed.title || !Array.isArray(parsed.questionIds)) return null;
      return {
        kind: 'lz',
        mode,
        rawHash: `#${cleanHash}`,
        payload: {
          title: parsed.title,
          description: parsed.description ?? '',
          author: parsed.author,
          institution: parsed.institution,
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
          questionIds: parsed.questionIds,
          customPoints: parsed.customPoints,
          license: 'CC0-1.0',
        },
      };
    } catch {
      return null;
    }
  }

  if (prebuiltParam.startsWith('catalog:')) {
    return {
      kind: 'catalog',
      mode,
      refId: prebuiltParam.slice('catalog:'.length),
      rawHash: `#${cleanHash}`,
    };
  }

  if (prebuiltParam.startsWith('gist:')) {
    return {
      kind: 'gist',
      mode,
      refId: prebuiltParam.slice('gist:'.length),
      rawHash: `#${cleanHash}`,
    };
  }

  return null;
}

export async function clonePrebuiltToWorkspace(
  payload: PrebuiltSharePayload,
  sourcePrebuiltId?: string,
  shareUrl?: string,
): Promise<QuizWorkspaceRecord> {
  return createQuiz(`${payload.title} (Remix)`, payload.description, {
    questionIds: payload.questionIds,
    customPoints: payload.customPoints,
    tags: payload.tags,
    sourcePrebuiltId,
    remixedFrom: {
      title: payload.title,
      author: payload.author,
      shareUrl,
      remixedAt: new Date().toISOString(),
    },
    activate: true,
  });
}

export function buildPrebuiltCatalogIssueUrl(
  payload: PrebuiltSharePayload,
  repoSlug = 'mls-oer-question-bank/mls-oer-question-bank',
): string {
  const issueTitle = encodeURIComponent(`[Pre-Built Quiz] ${payload.title}`);
  const bodyContent = [
    '### Community Pre-Built Quiz Submission (CC0 1.0)',
    '',
    `- **Title:** ${payload.title}`,
    `- **Author / Institution:** ${payload.author || 'Anonymous'}${payload.institution ? ` (${payload.institution})` : ''}`,
    `- **Question Count:** ${payload.questionIds.length}`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n');
  const body = encodeURIComponent(bodyContent);
  return `https://github.com/${repoSlug}/issues/new?labels=prebuilt-quiz&title=${issueTitle}&body=${body}`;
}

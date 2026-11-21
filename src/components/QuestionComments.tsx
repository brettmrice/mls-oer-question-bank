import React from 'react';
import Giscus from '@giscus/react';
import { ExternalLink, FileWarning, MessageSquare } from 'lucide-react';
import { getGitHubConfig } from '@/config/github';
import { Badge, Button } from './ui/primitives';

export interface QuestionCommentsProps {
  questionId: string;
  onOpenErrata?: () => void;
}

export function QuestionComments({
  questionId,
  onOpenErrata,
}: QuestionCommentsProps): React.ReactElement {
  const cfg = getGitHubConfig();
  const discussionsSearchUrl = `https://github.com/${cfg.repo}/discussions?discussions_q=${encodeURIComponent(questionId)}`;

  return (
    <section
      aria-label="Community Comments and Errata Thread"
      className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-4 w-4 text-indigo-600 shrink-0" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-800">
            Community Comments &amp; Errata Thread
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            UID: {questionId}
          </Badge>
          {onOpenErrata && (
            <Button variant="outline" size="sm" onClick={onOpenErrata} className="h-7 text-xs">
              <FileWarning className="h-3.5 w-3.5 text-amber-600" />
              Suggest Correction
            </Button>
          )}
        </div>
      </div>

      {cfg.isGiscusConfigured && cfg.giscusRepoId && cfg.giscusCategoryId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <Giscus
            id={`giscus-${questionId}`}
            repo={cfg.repo}
            repoId={cfg.giscusRepoId}
            category={cfg.giscusCategory}
            categoryId={cfg.giscusCategoryId}
            mapping="specific"
            term={questionId}
            strict="1"
            reactionsEnabled="1"
            emitMetadata="0"
            inputPosition="top"
            theme="light"
            lang="en"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3.5 text-xs text-slate-600 space-y-2">
          <p>
            Discussions bind immutably via Giscus (<code className="font-mono">mapping=&quot;specific&quot;</code>,{' '}
            <code className="font-mono">term=&quot;{questionId}&quot;</code>) so comments never break when taxonomy
            codes evolve.
          </p>
          <p className="text-slate-500">
            Giscus environment variables (<code className="font-mono">VITE_GISCUS_REPO_ID</code> and{' '}
            <code className="font-mono">VITE_GISCUS_CATEGORY_ID</code>) are not configured in this local build.
          </p>
          <div className="pt-1 flex flex-wrap items-center gap-3">
            <a
              href={discussionsSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-700"
            >
              Search GitHub Discussions for {questionId}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </section>
  );
}

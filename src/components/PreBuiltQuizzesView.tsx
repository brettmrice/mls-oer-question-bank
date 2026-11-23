import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  GitBranch,
  GraduationCap,
  Layers,
  Play,
  Search,
} from 'lucide-react';
import { BlueprintBalanceMeter } from '@/components/BlueprintBalanceMeter';
import { QuizExportButtons } from '@/components/QuizExportButtons';
import { Badge, Button, Card, Input, Skeleton } from '@/components/ui/primitives';
import { fetchQuestionsByIds } from '@/lib/duckdb';
import { fetchPrebuiltCatalog } from '@/lib/manifest';
import {
  clonePrebuiltToWorkspace,
  encodeCatalogHashUrl,
  encodePrebuiltHashUrl,
  type PrebuiltSharePayload,
} from '@/lib/prebuiltShare';
import { BLOOM_META, cn, DISCIPLINE_COLORS } from '@/lib/utils';
import type {
  ManifestData,
  PreBuiltQuizSummary,
  QuestionRecord,
} from '@/types/question';

export interface PreBuiltQuizzesViewProps {
  manifest: ManifestData;
  sharedPayload?: PrebuiltSharePayload | null;
  sharedSourceUrl?: string;
  initialSelectedId?: string | null;
  onClonedToWorkspace: (newQuizId: string) => Promise<void>;
  onLaunchPractice: (
    title: string,
    questions: QuestionRecord[],
    subtitle?: string,
  ) => void;
  onNotice: (msg: string) => void;
}

export function PreBuiltQuizzesView({
  manifest,
  sharedPayload = null,
  sharedSourceUrl,
  initialSelectedId = null,
  onClonedToWorkspace,
  onLaunchPractice,
  onNotice,
}: PreBuiltQuizzesViewProps): React.ReactElement {
  const [catalog, setCatalog] = useState<PreBuiltQuizSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(
    sharedPayload ? '__shared_link__' : initialSelectedId,
  );

  const [loadedQuestions, setLoadedQuestions] = useState<QuestionRecord[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPrebuiltCatalog(manifest)
      .then((items) => {
        if (cancelled) return;
        setCatalog(items);
        setCatalogLoading(false);
        if (!sharedPayload && !selectedId && items.length > 0) {
          setSelectedId(initialSelectedId ?? items[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  useEffect(() => {
    if (sharedPayload) {
      setSelectedId('__shared_link__');
    } else if (initialSelectedId) {
      setSelectedId(initialSelectedId);
    }
  }, [sharedPayload, initialSelectedId]);

  const activeEntry: PrebuiltSharePayload | null = useMemo(() => {
    if (selectedId === '__shared_link__' && sharedPayload) {
      return sharedPayload;
    }
    const found = catalog.find((c) => c.id === selectedId);
    if (!found) return null;
    return {
      title: found.title,
      description: found.description,
      author: found.author,
      institution: found.institution,
      tags: found.tags,
      questionIds: found.questionIds,
      license: 'CC0-1.0',
    };
  }, [selectedId, sharedPayload, catalog]);

  useEffect(() => {
    let cancelled = false;
    if (!activeEntry || activeEntry.questionIds.length === 0) {
      setLoadedQuestions([]);
      setQuestionsLoading(false);
      return;
    }

    setQuestionsLoading(true);
    fetchQuestionsByIds(manifest, activeEntry.questionIds)
      .then((res) => {
        if (!cancelled) {
          setLoadedQuestions(res);
          setQuestionsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedQuestions([]);
          setQuestionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manifest, activeEntry]);

  const filteredCatalog = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (c) =>
        c.title.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle) ||
        c.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [catalog, searchTerm]);

  const handleCloneAndRemix = async () => {
    if (!activeEntry) return;
    const created = await clonePrebuiltToWorkspace(
      activeEntry,
      selectedId === '__shared_link__' ? undefined : (selectedId ?? undefined),
      sharedSourceUrl,
    );
    await onClonedToWorkspace(created.id);
    onNotice(`Cloned "${activeEntry.title}" into My Quizzes for remixing.`);
  };

  const handleCopyShareLink = async (mode: 'educator' | 'practice') => {
    if (!activeEntry) return;
    const url =
      selectedId && selectedId !== '__shared_link__'
        ? encodeCatalogHashUrl(selectedId, mode)
        : encodePrebuiltHashUrl(activeEntry, mode);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedType(mode);
      window.setTimeout(() => setCopiedType(null), 2000);
    } catch {
      onNotice(`Share link: ${url}`);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
      {/* Left Catalog List */}
      <div className="w-full shrink-0 space-y-3 lg:w-96">
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
              <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Pre-Built Quizzes Catalog
            </h2>
            <Badge variant="accent">{catalog.length}</Badge>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search Pre-Built exams & reviews..."
              className="pl-8"
            />
          </div>
        </Card>

        {sharedPayload && (
          <button
            type="button"
            onClick={() => setSelectedId('__shared_link__')}
            className={cn(
              'w-full rounded-xl border p-3.5 text-left transition cursor-pointer',
              selectedId === '__shared_link__'
                ? 'border-[var(--cream-border)] bg-[var(--cream-surface)] ring-1 ring-[var(--cream-border)]'
                : 'border-indigo-200 dark:border-indigo-800 bg-[var(--bg-surface)] hover:border-indigo-400',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <Badge variant="accent" className="text-[10px]">
                Shared Link
              </Badge>
              <span className="text-xs font-mono text-[var(--text-secondary)]">
                {sharedPayload.questionIds.length} Qs
              </span>
            </div>
            <h3 className="mt-1.5 text-sm font-bold text-[var(--text-primary)]">
              {sharedPayload.title}
            </h3>
            {sharedPayload.author && (
              <p className="text-xs text-[var(--text-secondary)]">By {sharedPayload.author}</p>
            )}
          </button>
        )}

        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {catalogLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : (
            filteredCatalog.map((item) => {
              const active = selectedId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'w-full rounded-xl border p-3.5 text-left transition cursor-pointer',
                    active
                      ? 'border-[var(--cream-border)] bg-[var(--cream-surface)] ring-1 ring-[var(--cream-border)]'
                      : 'border-[var(--border-color)] bg-[var(--bg-surface)] hover:bg-[var(--cream-surface-soft)]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
                      {item.subsetKey || item.id}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {item.questionCount} Qs • Diff {item.avgDifficulty}
                    </Badge>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {item.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)] line-clamp-2">
                    {item.description}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Preview, Use As-Is Export & Clone/Remix */}
      <div className="min-w-0 flex-1 space-y-4">
        {!activeEntry ? (
          <Card className="p-10 text-center text-sm text-[var(--text-secondary)]">
            Select a Pre-Built quiz from the catalog to preview, export directly, practice,
            or clone &amp; remix.
          </Card>
        ) : (
          <>
            <Card className="p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">
                      {activeEntry.title}
                    </h2>
                    <Badge variant="accent" className="font-mono text-[11px]">
                      {activeEntry.license}
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {activeEntry.author || 'MLS OER Contributor'}
                    {activeEntry.institution ? ` • ${activeEntry.institution}` : ''}
                  </p>
                  {activeEntry.description && (
                    <p className="text-sm text-[var(--text-primary)] pt-1">{activeEntry.description}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={questionsLoading || loadedQuestions.length === 0}
                    onClick={handleCloneAndRemix}
                  >
                    <GitBranch className="h-4 w-4" />
                    Clone &amp; Remix into My Quizzes
                  </Button>
                  <Button
                    variant="outline"
                    disabled={questionsLoading || loadedQuestions.length === 0}
                    onClick={() =>
                      onLaunchPractice(
                        activeEntry.title,
                        loadedQuestions,
                        activeEntry.description,
                      )
                    }
                  >
                    <Play className="h-4 w-4 text-emerald-600" />
                    Student Self-Practice
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border-color)]">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyShareLink('educator')}
                >
                  {copiedType === 'educator' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  Copy Educator Remix Link
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyShareLink('practice')}
                >
                  {copiedType === 'practice' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <GraduationCap className="h-3.5 w-3.5" />
                  )}
                  Copy Student Practice Link
                </Button>
              </div>
            </Card>

            {questionsLoading ? (
              <Card className="p-5 space-y-3">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-48 w-full" />
              </Card>
            ) : (
              <>
                <div className="grid gap-4 xl:grid-cols-2">
                  <BlueprintBalanceMeter questions={loadedQuestions} manifest={manifest} />
                  <Card className="p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Use As-Is — Export Pre-Built Quiz ({loadedQuestions.length} Qs)
                    </h3>
                    <QuizExportButtons
                      title={activeEntry.title}
                      description={activeEntry.description}
                      questions={loadedQuestions}
                      customPoints={activeEntry.customPoints}
                    />
                  </Card>
                </div>

                <Card className="p-4 space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Question Preview (Showing {Math.min(25, loadedQuestions.length)} of{' '}
                    {loadedQuestions.length})
                  </h3>
                  <div className="divide-y divide-[var(--border-color)]">
                    {loadedQuestions.slice(0, 25).map((q, idx) => (
                      <div key={q.id} className="py-3 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-[var(--text-secondary)]">
                            {idx + 1}.
                          </span>
                          <Badge
                            className={cn(
                              'text-[10px] font-bold',
                              DISCIPLINE_COLORS[q.disciplineCode],
                            )}
                          >
                            {q.disciplineCode}
                          </Badge>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {q.displayId}
                          </Badge>
                          <Badge
                            className={cn(
                              'text-[10px]',
                              BLOOM_META[q.bloomLevel]?.className,
                            )}
                          >
                            {q.bloomLevel}
                          </Badge>
                          <span className="text-[11px] text-[var(--text-secondary)] truncate">
                            {q.ascpPath}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--text-primary)]">{q.questionText}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

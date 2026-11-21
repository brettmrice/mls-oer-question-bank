import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Plus,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { FeedbackDrawer } from '@/components/FeedbackDrawer';
import { FilterSidebar } from '@/components/FilterSidebar';
import { Navbar } from '@/components/Navbar';
import { PreBuiltQuizzesView } from '@/components/PreBuiltQuizzesView';
import { QuestionCard } from '@/components/QuestionCard';
import { QuestionDetailDrawer } from '@/components/QuestionDetailDrawer';
import { QuestionErrataModal } from '@/components/QuestionErrataModal';
import { QuizManagerDrawer } from '@/components/QuizManagerDrawer';
import { SemanticSearchModal } from '@/components/SemanticSearchModal';
import { StudentPracticeView } from '@/components/StudentPracticeView';
import { Badge, Button, Card, Skeleton } from '@/components/ui/primitives';
import { getDataBaseUrl } from '@/config/dataSource';
import type { QuizWorkspaceRecord } from '@/lib/db';
import {
  fetchQuestionsByIds,
  queryQuestions,
  querySubtopicFacets,
} from '@/lib/duckdb';
import { fetchPrebuiltFromGist } from '@/lib/githubApi';
import {
  completeGitHubOAuthCallback,
  getGitHubSession,
  type GitHubSession,
} from '@/lib/githubAuth';
import type { CentroidSuggestion, HybridRankedItem } from '@/lib/hybridRanker';
import { fetchManifest, fetchPrebuiltCatalog } from '@/lib/manifest';
import {
  parsePrebuiltLocationHash,
  type PrebuiltSharePayload,
} from '@/lib/prebuiltShare';
import { selectTargetShards } from '@/lib/queryBuilder';
import {
  addQuestionsToQuiz,
  createQuiz,
  getActiveQuizId,
  getBackupStatus,
  listQuizzes,
  listSavedQuestions,
  setActiveQuizId as persistActiveQuizId,
  toggleSavedQuestion,
  type BackupStatus,
} from '@/lib/quizStore';
import { runHybridSemanticSearch } from '@/lib/semanticClient';
import { formatBytes } from '@/lib/utils';
import {
  DEFAULT_FILTERS,
  type FilterState,
  type ManifestData,
  type QuestionRecord,
  type SortOption,
  type SubtopicFacet,
} from '@/types/question';

export function App(): React.ReactElement {
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<'explore' | 'prebuilt' | 'practice'>(
    'explore',
  );
  const [quizManagerOpen, setQuizManagerOpen] = useState<boolean>(false);

  // Phase 4: Multi-Quiz & Bookmark State (IndexedDB)
  const [quizzes, setQuizzes] = useState<QuizWorkspaceRecord[]>([]);
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);

  // Pre-Built & Practice Routing State
  const [sharedPrebuiltPayload, setSharedPrebuiltPayload] =
    useState<PrebuiltSharePayload | null>(null);
  const [sharedSourceUrl, setSharedSourceUrl] = useState<string | undefined>(undefined);
  const [prebuiltCatalogId, setPrebuiltCatalogId] = useState<string | null>(null);
  const [practiceSession, setPracticeSession] = useState<{
    title: string;
    subtitle?: string;
    questions: QuestionRecord[];
  } | null>(null);

  // Phase 5: GitHub Auth, Feedback Drawer & Errata Modal State
  const [githubSession, setGithubSession] = useState<GitHubSession | null>(null);
  const [feedbackDrawerOpen, setFeedbackDrawerOpen] = useState<boolean>(false);
  const [errataQuestion, setErrataQuestion] = useState<QuestionRecord | null>(null);

  // Explorer Query State
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [shardsQueried, setShardsQueried] = useState<number>(0);
  const [queryElapsedMs, setQueryElapsedMs] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [subtopicFacets, setSubtopicFacets] = useState<SubtopicFacet[]>([]);
  const [facetsLoading, setFacetsLoading] = useState<boolean>(false);

  // Phase 3: Consent-gated multi-shard hybrid semantic search state
  const [semanticModalOpen, setSemanticModalOpen] = useState<boolean>(false);
  const [modalPreselectShards, setModalPreselectShards] = useState<string[] | null>(null);
  const [modalInitialPrompt, setModalInitialPrompt] = useState<string>('');
  const [activeSemanticShards, setActiveSemanticShards] = useState<string[]>([]);
  const [semanticPrompt, setSemanticPrompt] = useState<string>('');
  const [semanticResults, setSemanticResults] = useState<HybridRankedItem[]>([]);
  const [semanticMeta, setSemanticMeta] = useState<{
    embedMs: number;
    searchMs: number;
    totalMs: number;
    centroidSuggestions: CentroidSuggestion[];
  } | null>(null);
  const [semanticLoading, setSemanticLoading] = useState<boolean>(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);

  const [globalReveal, setGlobalReveal] = useState<boolean>(false);
  const [inspectedQuestion, setInspectedQuestion] = useState<QuestionRecord | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const querySeqRef = useRef(0);
  const facetSeqRef = useRef(0);
  const semanticSeqRef = useRef(0);

  const isSemanticActive =
    semanticPrompt.trim().length > 0 && activeSemanticShards.length > 0;

  const refreshWorkspace = useCallback(async (preferredActiveId?: string | null) => {
    const [quizList, storedActive, savedList, status] = await Promise.all([
      listQuizzes(),
      getActiveQuizId(),
      listSavedQuestions(),
      getBackupStatus(),
    ]);
    setQuizzes(quizList);
    const resolvedActive =
      preferredActiveId !== undefined
        ? preferredActiveId
        : quizList.some((q) => q.id === storedActive)
          ? storedActive
          : (quizList[0]?.id ?? null);
    setActiveQuizId(resolvedActive);
    setBookmarkedIds(new Set(savedList.map((s) => s.questionId)));
    setBackupStatus(status);
  }, []);

  useEffect(() => {
    refreshWorkspace().catch(() => {});
  }, [refreshWorkspace]);

  useEffect(() => {
    let active = true;
    fetchManifest()
      .then((data) => {
        if (active) {
          setManifest(data);
          setManifestError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setManifestError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const oauthRes = await completeGitHubOAuthCallback();
      if (!active) return;
      if (oauthRes.handled) {
        if (oauthRes.session) {
          setGithubSession(oauthRes.session);
          showNotice(`Signed in with GitHub as @${oauthRes.session.username}.`);
        } else if (oauthRes.error) {
          showNotice(oauthRes.error);
        }
        return;
      }
      const existing = await getGitHubSession();
      if (active && existing) {
        setGithubSession(existing);
      }
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [showNotice]);

  // Resolve #prebuilt=... deep links on mount and hashchange
  useEffect(() => {
    if (!manifest) return;
    const handleHash = async () => {
      const parsed = parsePrebuiltLocationHash(window.location.hash);
      if (!parsed) return;

      if (parsed.kind === 'lz' && parsed.payload) {
        if (parsed.mode === 'practice') {
          const qs = await fetchQuestionsByIds(manifest, parsed.payload.questionIds);
          setPracticeSession({
            title: parsed.payload.title,
            subtitle: parsed.payload.description,
            questions: qs,
          });
          setActiveView('practice');
        } else {
          setSharedPrebuiltPayload(parsed.payload);
          setSharedSourceUrl(window.location.href);
          setActiveView('prebuilt');
        }
      } else if (parsed.kind === 'catalog' && parsed.refId) {
        const catalog = await fetchPrebuiltCatalog(manifest);
        const found = catalog.find((c) => c.id === parsed.refId);
        if (found) {
          if (parsed.mode === 'practice') {
            const qs = await fetchQuestionsByIds(manifest, found.questionIds);
            setPracticeSession({
              title: found.title,
              subtitle: found.description,
              questions: qs,
            });
            setActiveView('practice');
          } else {
            setPrebuiltCatalogId(found.id);
            setActiveView('prebuilt');
          }
        }
      } else if (parsed.kind === 'gist' && parsed.refId) {
        try {
          const gistPayload = await fetchPrebuiltFromGist(parsed.refId);
          if (parsed.mode === 'practice') {
            const qs = await fetchQuestionsByIds(manifest, gistPayload.questionIds);
            setPracticeSession({
              title: gistPayload.title,
              subtitle: gistPayload.description,
              questions: qs,
            });
            setActiveView('practice');
          } else {
            setSharedPrebuiltPayload(gistPayload);
            setSharedSourceUrl(window.location.href);
            setActiveView('prebuilt');
          }
        } catch (err) {
          showNotice(
            err instanceof Error
              ? `Failed to load Pre-Built Gist: ${err.message}`
              : 'Failed to load Pre-Built Gist.',
          );
        }
      }
    };

    handleHash().catch(() => {});
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [manifest, showNotice]);

  useEffect(() => {
    if (!manifest || isSemanticActive || activeView !== 'explore') return;
    const seq = ++querySeqRef.current;
    setLoading(true);
    setQueryError(null);

    queryQuestions(manifest, filters)
      .then((res) => {
        if (seq !== querySeqRef.current) return;
        setQuestions(res.items);
        setTotalCount(res.total);
        setShardsQueried(res.shardsQueried);
        setQueryElapsedMs(res.elapsedMs);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (seq !== querySeqRef.current) return;
        setQueryError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [manifest, filters, isSemanticActive, activeView]);

  const semanticFilterKey = useMemo(
    () =>
      JSON.stringify({
        subtopics: filters.subtopics,
        leafTopics: filters.leafTopics,
        bloomLevels: filters.bloomLevels,
        difficultyMin: filters.difficultyMin,
        difficultyMax: filters.difficultyMax,
        subsetTags: filters.subsetTags,
        questionTypes: filters.questionTypes,
      }),
    [filters],
  );

  useEffect(() => {
    if (!manifest || !isSemanticActive) return;
    const seq = ++semanticSeqRef.current;
    setSemanticLoading(true);
    setSemanticError(null);

    runHybridSemanticSearch(manifest, semanticPrompt, activeSemanticShards, filters)
      .then((out) => {
        if (seq !== semanticSeqRef.current) return;
        setSemanticResults(out.items);
        setSemanticMeta({
          embedMs: out.embedMs,
          searchMs: out.searchMs,
          totalMs: out.totalMs,
          centroidSuggestions: out.centroidSuggestions,
        });
        setSemanticLoading(false);
      })
      .catch((err: unknown) => {
        if (seq !== semanticSeqRef.current) return;
        setSemanticError(err instanceof Error ? err.message : String(err));
        setSemanticLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, semanticPrompt, activeSemanticShards, semanticFilterKey]);

  const facetKey = useMemo(
    () =>
      JSON.stringify({
        disciplines: filters.disciplines,
        topicCodes: filters.topicCodes,
        bloomLevels: filters.bloomLevels,
        difficultyMin: filters.difficultyMin,
        difficultyMax: filters.difficultyMax,
        subsetTags: filters.subsetTags,
        questionTypes: filters.questionTypes,
        keyword: filters.keyword,
      }),
    [filters],
  );

  useEffect(() => {
    if (!manifest) return;
    if (filters.disciplines.length === 0 && filters.topicCodes.length === 0) {
      setSubtopicFacets([]);
      setFacetsLoading(false);
      return;
    }
    const seq = ++facetSeqRef.current;
    setFacetsLoading(true);
    querySubtopicFacets(manifest, filters)
      .then((facets) => {
        if (seq !== facetSeqRef.current) return;
        setSubtopicFacets(facets);
        setFacetsLoading(false);
      })
      .catch(() => {
        if (seq !== facetSeqRef.current) return;
        setSubtopicFacets([]);
        setFacetsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, facetKey]);

  const updateFilters = useCallback((patch: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSemanticPrompt('');
    setSemanticResults([]);
    setSemanticMeta(null);
  }, []);

  const openSemanticModal = useCallback(
    (preselect?: string[], promptHint?: string) => {
      setModalPreselectShards(preselect ?? null);
      setModalInitialPrompt(promptHint ?? semanticPrompt);
      setSemanticModalOpen(true);
    },
    [semanticPrompt],
  );

  const activeQuiz = useMemo(
    () => quizzes.find((q) => q.id === activeQuizId) ?? quizzes[0] ?? null,
    [quizzes, activeQuizId],
  );

  const handleSelectActiveQuiz = useCallback(
    async (quizId: string) => {
      await persistActiveQuizId(quizId);
      setActiveQuizId(quizId);
    },
    [],
  );

  const handleAddToQuiz = useCallback(
    async (quizId: string, questionId: string) => {
      const target = quizzes.find((q) => q.id === quizId);
      const res = await addQuestionsToQuiz(quizId, [questionId]);
      await refreshWorkspace(quizId);
      if (res.addedCount > 0) {
        showNotice(`Added question to "${target?.name ?? 'Quiz'}".`);
      } else {
        showNotice(`Question is already in "${target?.name ?? 'Quiz'}".`);
      }
    },
    [quizzes, refreshWorkspace, showNotice],
  );

  const handleQuickCreateAndAdd = useCallback(
    async (questionId: string) => {
      const created = await createQuiz('My Quiz 1', '', {
        questionIds: [questionId],
        activate: true,
      });
      await refreshWorkspace(created.id);
      showNotice(
        `Created "${created.name}" and added question. Open My Quizzes to rename, export, or create more.`,
      );
    },
    [refreshWorkspace, showNotice],
  );

  const handleToggleBookmark = useCallback(
    async (questionId: string) => {
      const nowSaved = await toggleSavedQuestion(questionId);
      await refreshWorkspace();
      showNotice(nowSaved ? 'Bookmarked question locally.' : 'Removed bookmark.');
    },
    [refreshWorkspace, showNotice],
  );

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    for (const d of filters.disciplines) {
      chips.push({
        key: `disc:${d}`,
        label: `Discipline: ${d}`,
        onRemove: () =>
          updateFilters({
            disciplines: filters.disciplines.filter((x) => x !== d),
            subtopics: [],
            leafTopics: [],
            page: 1,
          }),
      });
    }
    for (const t of filters.topicCodes) {
      chips.push({
        key: `topic:${t}`,
        label: `Topic: ${t}`,
        onRemove: () =>
          updateFilters({
            topicCodes: filters.topicCodes.filter((x) => x !== t),
            subtopics: [],
            leafTopics: [],
            page: 1,
          }),
      });
    }
    for (const s of filters.subtopics) {
      chips.push({
        key: `sub:${s}`,
        label: `Subtopic: ${s}`,
        onRemove: () =>
          updateFilters({
            subtopics: filters.subtopics.filter((x) => x !== s),
            page: 1,
          }),
      });
    }
    for (const l of filters.leafTopics) {
      chips.push({
        key: `leaf:${l}`,
        label: `Leaf: ${l}`,
        onRemove: () =>
          updateFilters({
            leafTopics: filters.leafTopics.filter((x) => x !== l),
            page: 1,
          }),
      });
    }
    for (const b of filters.bloomLevels) {
      chips.push({
        key: `bloom:${b}`,
        label: `Bloom: ${b}`,
        onRemove: () =>
          updateFilters({
            bloomLevels: filters.bloomLevels.filter((x) => x !== b),
            page: 1,
          }),
      });
    }
    if (filters.difficultyMin > 1 || filters.difficultyMax < 10) {
      chips.push({
        key: 'diff',
        label: `Difficulty: ${filters.difficultyMin}–${filters.difficultyMax}`,
        onRemove: () => updateFilters({ difficultyMin: 1, difficultyMax: 10, page: 1 }),
      });
    }
    for (const st of filters.subsetTags) {
      chips.push({
        key: `subset:${st}`,
        label: `Subset: ${st}`,
        onRemove: () =>
          updateFilters({
            subsetTags: filters.subsetTags.filter((x) => x !== st),
            page: 1,
          }),
      });
    }
    if (!isSemanticActive && filters.keyword.trim()) {
      chips.push({
        key: 'kw',
        label: `Keyword: "${filters.keyword.trim()}"`,
        onRemove: () => updateFilters({ keyword: '', page: 1 }),
      });
    }
    return chips;
  }, [filters, isSemanticActive, updateFilters]);

  const displayedTotal = isSemanticActive ? semanticResults.length : totalCount;
  const displayedItems = useMemo(() => {
    if (isSemanticActive) {
      const start = (filters.page - 1) * filters.pageSize;
      return semanticResults.slice(start, start + filters.pageSize).map((item) => ({
        question: item.question,
        semanticMatch: {
          semanticScore: item.semanticScore,
          keywordMatched: item.keywordMatched,
        },
      }));
    }
    return questions.map((question) => ({
      question,
      semanticMatch: undefined,
    }));
  }, [isSemanticActive, semanticResults, questions, filters.page, filters.pageSize]);

  const handleAddPageToQuiz = async () => {
    const pageIds = displayedItems.map((item) => item.question.id);
    if (pageIds.length === 0) return;
    if (activeQuiz) {
      const res = await addQuestionsToQuiz(activeQuiz.id, pageIds);
      await refreshWorkspace(activeQuiz.id);
      showNotice(`Added ${res.addedCount} new question(s) to "${activeQuiz.name}".`);
    } else {
      const created = await createQuiz('My Quiz 1', '', {
        questionIds: pageIds,
        activate: true,
      });
      await refreshWorkspace(created.id);
      showNotice(`Created "${created.name}" with ${pageIds.length} questions.`);
    }
  };

  const isBusy = isSemanticActive ? semanticLoading : loading;
  const totalPages = Math.max(1, Math.ceil(displayedTotal / filters.pageSize));
  const targetShardCount = manifest ? selectTargetShards(manifest, filters).length : 0;

  if (manifestError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Navbar
          manifest={null}
          activeView="explore"
          activeSemanticShardCount={0}
          quizCount={quizzes.length}
          activeQuizQuestionCount={activeQuiz?.questionIds.length ?? 0}
          backupStatus={backupStatus}
          githubUsername={githubSession?.username ?? null}
          onSelectView={() => {}}
          onOpenSemanticModal={() => {}}
          onOpenQuizManager={() => setQuizManagerOpen(true)}
          onOpenFeedback={() => setFeedbackDrawerOpen(true)}
          onNotice={showNotice}
        />
        <main className="mx-auto max-w-2xl px-4 py-16">
          <Card className="p-6 border-rose-200 bg-rose-50/60">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm text-rose-950">
                <h2 className="font-semibold">Unable to connect to Question Bank Data Source</h2>
                <p className="text-rose-800">{manifestError}</p>
                <p className="text-xs text-rose-800">
                  Data Base URL: <code className="font-mono">{getDataBaseUrl()}</code>
                </p>
                <p className="text-xs text-rose-800">
                  For local testing, run{' '}
                  <code className="rounded bg-rose-100 px-1.5 py-0.5 font-mono">
                    python local.py --skip-etl
                  </code>{' '}
                  to serve <code className="font-mono">./local_data</code> with HTTP 206 Range + CORS.
                </p>
              </div>
            </div>
          </Card>
        </main>
        <FeedbackDrawer
          open={feedbackDrawerOpen}
          onClose={() => setFeedbackDrawerOpen(false)}
          githubSession={githubSession}
          onSessionChange={setGithubSession}
          onNotice={showNotice}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar
        manifest={manifest}
        activeView={activeView}
        activeSemanticShardCount={activeSemanticShards.length}
        quizCount={quizzes.length}
        activeQuizQuestionCount={activeQuiz?.questionIds.length ?? 0}
        backupStatus={backupStatus}
        githubUsername={githubSession?.username ?? null}
        onSelectView={(v) => setActiveView(v)}
        onOpenSemanticModal={() => openSemanticModal()}
        onOpenQuizManager={() => setQuizManagerOpen(true)}
        onOpenFeedback={() => setFeedbackDrawerOpen(true)}
        onNotice={showNotice}
      />

      {notice && (
        <div className="border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-900">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 sm:px-2">
            <span>{notice}</span>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setNotice(null)}
              className="rounded p-0.5 hover:bg-indigo-100 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {activeView === 'practice' && practiceSession ? (
        <StudentPracticeView
          title={practiceSession.title}
          subtitle={practiceSession.subtitle}
          questions={practiceSession.questions}
          onExit={() => {
            setPracticeSession(null);
            setActiveView('prebuilt');
          }}
        />
      ) : activeView === 'prebuilt' && manifest ? (
        <PreBuiltQuizzesView
          manifest={manifest}
          sharedPayload={sharedPrebuiltPayload}
          sharedSourceUrl={sharedSourceUrl}
          initialSelectedId={prebuiltCatalogId}
          onClonedToWorkspace={async (newQuizId) => {
            await refreshWorkspace(newQuizId);
            setQuizManagerOpen(true);
          }}
          onLaunchPractice={(title, qs, subtitle) => {
            setPracticeSession({ title, questions: qs, subtitle });
            setActiveView('practice');
          }}
          onNotice={showNotice}
        />
      ) : (
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-6 px-4 py-6 sm:px-6">
          {/* Desktop Sidebar */}
          <div className="hidden w-80 shrink-0 lg:block">
            {manifest ? (
              <FilterSidebar
                manifest={manifest}
                filters={filters}
                subtopicFacets={subtopicFacets}
                facetsLoading={facetsLoading}
                activeSemanticShards={activeSemanticShards}
                semanticPrompt={semanticPrompt}
                semanticLoading={semanticLoading}
                onUpdateFilters={updateFilters}
                onResetFilters={resetFilters}
                onOpenSemanticModal={() => openSemanticModal()}
                onSubmitSemanticPrompt={(prompt) => {
                  setSemanticPrompt(prompt);
                  updateFilters({ page: 1 });
                }}
                onClearSemanticPrompt={() => {
                  setSemanticPrompt('');
                  setSemanticResults([]);
                  setSemanticMeta(null);
                }}
              />
            ) : (
              <div className="space-y-4">
                <Skeleton className="h-44 w-full" />
                <Skeleton className="h-96 w-full" />
              </div>
            )}
          </div>

          {/* Mobile Filter Drawer */}
          {mobileFiltersOpen && manifest && (
            <div className="fixed inset-0 z-40 flex lg:hidden">
              <div
                className="fixed inset-0 bg-slate-900/40"
                onClick={() => setMobileFiltersOpen(false)}
              />
              <div className="relative z-10 h-full w-80 max-w-[85vw] overflow-y-auto bg-slate-50 p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">Filters</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileFiltersOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <FilterSidebar
                  manifest={manifest}
                  filters={filters}
                  subtopicFacets={subtopicFacets}
                  facetsLoading={facetsLoading}
                  activeSemanticShards={activeSemanticShards}
                  semanticPrompt={semanticPrompt}
                  semanticLoading={semanticLoading}
                  onUpdateFilters={updateFilters}
                  onResetFilters={resetFilters}
                  onOpenSemanticModal={() => {
                    setMobileFiltersOpen(false);
                    openSemanticModal();
                  }}
                  onSubmitSemanticPrompt={(prompt) => {
                    setSemanticPrompt(prompt);
                    updateFilters({ page: 1 });
                  }}
                  onClearSemanticPrompt={() => {
                    setSemanticPrompt('');
                    setSemanticResults([]);
                    setSemanticMeta(null);
                  }}
                />
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <main className="min-w-0 flex-1 space-y-4">
            {/* Toolbar */}
            <Card className="p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="lg:hidden"
                    onClick={() => setMobileFiltersOpen(true)}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filters
                  </Button>
                  <p className="text-sm text-slate-700">
                    {isBusy ? (
                      <span>
                        {isSemanticActive
                          ? `Running hybrid semantic + BM25 search across ${activeSemanticShards.length} shard(s)...`
                          : `Querying ${targetShardCount} Parquet shards via DuckDB-WASM...`}
                      </span>
                    ) : isSemanticActive ? (
                      <span>
                        Ranked{' '}
                        <strong className="font-semibold text-slate-950">
                          {displayedTotal.toLocaleString()}
                        </strong>{' '}
                        hybrid semantic matches{' '}
                        <span className="text-xs text-slate-500">
                          ({activeSemanticShards.length} active shard
                          {activeSemanticShards.length === 1 ? '' : 's'}
                          {semanticMeta
                            ? ` • ${semanticMeta.embedMs} ms embed • ${semanticMeta.totalMs} ms total`
                            : ''}
                          )
                        </span>
                      </span>
                    ) : (
                      <span>
                        Showing{' '}
                        <strong className="font-semibold text-slate-950">
                          {displayedTotal.toLocaleString()}
                        </strong>{' '}
                        matching questions{' '}
                        <span className="text-xs text-slate-500">
                          ({shardsQueried} {shardsQueried === 1 ? 'shard' : 'shards'} •{' '}
                          {queryElapsedMs} ms)
                        </span>
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isBusy || displayedItems.length === 0}
                    onClick={handleAddPageToQuiz}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Page ({displayedItems.length})
                  </Button>

                  <Button
                    variant={globalReveal ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setGlobalReveal((prev) => !prev)}
                  >
                    {globalReveal ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" />
                        Hide All Answers
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" />
                        Reveal All Answers
                      </>
                    )}
                  </Button>

                  {!isSemanticActive && (
                    <select
                      aria-label="Sort questions"
                      value={filters.sortBy}
                      onChange={(e) =>
                        updateFilters({ sortBy: e.target.value as SortOption, page: 1 })
                      }
                      className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700"
                    >
                      <option value="topic_asc">Sort: ASCP Topic &amp; Bloom&apos;s</option>
                      <option value="difficulty_asc">Sort: Difficulty (Low → High)</option>
                      <option value="difficulty_desc">Sort: Difficulty (High → Low)</option>
                      <option value="bloom_desc">Sort: Cognitive Tier (AN → RE)</option>
                      <option value="display_id_asc">Sort: Display ID (A → Z)</option>
                    </select>
                  )}

                  <select
                    aria-label="Questions per page"
                    value={filters.pageSize}
                    onChange={(e) =>
                      updateFilters({ pageSize: Number(e.target.value), page: 1 })
                    }
                    className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700"
                  >
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                    <option value={100}>100 / page</option>
                  </select>
                </div>
              </div>

              {activeFilterChips.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-100">
                  {activeFilterChips.map((chip) => (
                    <Badge key={chip.key} variant="accent" className="gap-1 pr-1">
                      <span>{chip.label}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${chip.label}`}
                        onClick={chip.onRemove}
                        className="rounded p-0.5 hover:bg-indigo-200/60 cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 ml-1 cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </Card>

            {/* Active Semantic Search + Stage 2 Centroid Suggestions */}
            {isSemanticActive && (
              <Card className="border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-indigo-950">
                    <Sparkles className="h-4 w-4 text-indigo-600" />
                    <span>
                      Hybrid RRF ranking for{' '}
                      <strong className="font-semibold">&ldquo;{semanticPrompt}&rdquo;</strong> across{' '}
                      <span className="font-mono">{activeSemanticShards.join(', ')}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openSemanticModal()}
                    >
                      Add / Manage Shards
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSemanticPrompt('');
                        setSemanticResults([]);
                        setSemanticMeta(null);
                      }}
                    >
                      Exit Semantic Search
                    </Button>
                  </div>
                </div>

                {manifest &&
                  semanticMeta &&
                  semanticMeta.centroidSuggestions.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 space-y-2">
                      <p className="text-xs font-semibold text-amber-950">
                        Related non-active topics detected via centroid routing:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {semanticMeta.centroidSuggestions.map((sugg) => {
                          const shard = manifest.shards.find(
                            (s) => s.shardId === sugg.shardId,
                          );
                          if (!shard) return null;
                          const sz = shard.vectors.bytes + shard.ids.bytes;
                          return (
                            <Button
                              key={sugg.shardId}
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                openSemanticModal(
                                  Array.from(
                                    new Set([...activeSemanticShards, shard.shardId]),
                                  ),
                                  semanticPrompt,
                                )
                              }
                              className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100/70"
                            >
                              <Download className="h-3.5 w-3.5 text-amber-700" />
                              Include {shard.topicCode}: {shard.topicName} ({formatBytes(sz)})
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </Card>
            )}

            {(queryError || semanticError) && (
              <Card className="border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-900">
                <strong className="font-semibold">Query Error: </strong>
                {semanticError || queryError}
              </Card>
            )}

            {/* Question List */}
            {isBusy ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="p-5 space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </Card>
                ))}
              </div>
            ) : displayedItems.length === 0 ? (
              <Card className="p-10 text-center space-y-3">
                <p className="text-sm font-medium text-slate-700">
                  No questions matched the active filter criteria.
                </p>
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Reset All Filters
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {displayedItems.map(({ question, semanticMatch }) => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    globalReveal={globalReveal}
                    semanticMatch={semanticMatch}
                    quizzes={quizzes}
                    activeQuizId={activeQuiz?.id ?? null}
                    isBookmarked={bookmarkedIds.has(question.id)}
                    onInspect={setInspectedQuestion}
                    onAddToQuiz={handleAddToQuiz}
                    onQuickCreateAndAdd={handleQuickCreateAndAdd}
                    onToggleBookmark={handleToggleBookmark}
                    onSuggestCorrection={setErrataQuestion}
                    onDeferredAction={showNotice}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {displayedTotal > 0 && (
              <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs text-slate-600">
                  Page <strong className="text-slate-900">{filters.page}</strong> of{' '}
                  <strong className="text-slate-900">{totalPages.toLocaleString()}</strong>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.page <= 1 || isBusy}
                    onClick={() => {
                      updateFilters({ page: Math.max(1, filters.page - 1) });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.page >= totalPages || isBusy}
                    onClick={() => {
                      updateFilters({ page: Math.min(totalPages, filters.page + 1) });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}
          </main>
        </div>
      )}

      {manifest && (
        <>
          <QuestionDetailDrawer
            manifest={manifest}
            question={inspectedQuestion}
            activeQuizName={activeQuiz?.name ?? null}
            inActiveQuiz={Boolean(
              inspectedQuestion && activeQuiz?.questionIds.includes(inspectedQuestion.id),
            )}
            onAddToActiveQuiz={(qid) =>
              activeQuiz ? handleAddToQuiz(activeQuiz.id, qid) : handleQuickCreateAndAdd(qid)
            }
            onSuggestCorrection={setErrataQuestion}
            onClose={() => setInspectedQuestion(null)}
            onSelectQuestion={setInspectedQuestion}
          />
          <SemanticSearchModal
            open={semanticModalOpen}
            manifest={manifest}
            activeShardIds={modalPreselectShards ?? activeSemanticShards}
            initialPrompt={modalInitialPrompt}
            onClose={() => {
              setSemanticModalOpen(false);
              setModalPreselectShards(null);
            }}
            onActivate={(shardIds, promptHint) => {
              setActiveSemanticShards(shardIds);
              if (shardIds.length === 0) {
                setSemanticPrompt('');
                setSemanticResults([]);
                setSemanticMeta(null);
              } else if (promptHint) {
                setActiveView('explore');
                setSemanticPrompt(promptHint);
                updateFilters({ page: 1 });
              }
            }}
          />
          <QuizManagerDrawer
            open={quizManagerOpen}
            manifest={manifest}
            quizzes={quizzes}
            activeQuizId={activeQuiz?.id ?? null}
            backupStatus={backupStatus}
            githubSession={githubSession}
            onGitHubSessionChange={setGithubSession}
            onOpenFeedbackDrawer={() => setFeedbackDrawerOpen(true)}
            onClose={() => setQuizManagerOpen(false)}
            onWorkspaceChanged={refreshWorkspace}
            onSelectActiveQuiz={handleSelectActiveQuiz}
            onLaunchPractice={(title, qs, subtitle) => {
              setPracticeSession({ title, questions: qs, subtitle });
              setActiveView('practice');
            }}
            onNotice={showNotice}
          />
        </>
      )}

      <FeedbackDrawer
        open={feedbackDrawerOpen}
        onClose={() => setFeedbackDrawerOpen(false)}
        githubSession={githubSession}
        onSessionChange={setGithubSession}
        onNotice={showNotice}
      />

      <QuestionErrataModal
        open={errataQuestion !== null}
        question={errataQuestion}
        githubSession={githubSession}
        onClose={() => setErrataQuestion(null)}
        onOpenFeedbackAuth={() => setFeedbackDrawerOpen(true)}
        onSubmitted={(issueUrl, issueNumber) =>
          showNotice(`Submitted Errata GitHub Issue #${issueNumber} (${issueUrl}).`)
        }
      />
    </div>
  );
}

export default App;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  ListFilter,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { FeedbackDrawer } from '@/components/FeedbackDrawer';
import { FilterSidebar, TopicsFilterSummaryCard } from '@/components/FilterSidebar';
import { Navbar } from '@/components/Navbar';
import { PreBuiltQuizzesView } from '@/components/PreBuiltQuizzesView';
import { QuestionCard } from '@/components/QuestionCard';
import { QuestionErrataModal } from '@/components/QuestionErrataModal';
import { QuestionRemixModal } from '@/components/QuestionRemixModal';
import { QuizBuilderSidebar } from '@/components/QuizBuilderSidebar';
import { QuizManagerDrawer } from '@/components/QuizManagerDrawer';
import { SemanticSearchModal } from '@/components/SemanticSearchModal';
import { StudentPracticeView } from '@/components/StudentPracticeView';
import { OverflowBlurScrollArea } from '@/components/ui/OverflowBlurScrollArea';
import { TruncatedTextTooltip } from '@/components/ui/TruncatedTextTooltip';
import { Button, Card, Skeleton } from '@/components/ui/primitives';
import { getDataBaseUrl } from '@/config/dataSource';
import { getGitHubConfig } from '@/config/github';
import type {
  QuestionRating,
  QuizWorkspaceRecord,
  RemixedQuestionRecord,
  SavedQuestionRecord,
} from '@/lib/db';
import {
  fetchQuestionsByIds,
  queryAscpPathFacets,
  queryAvailableBloomLevels,
  queryQuestions,
} from '@/lib/duckdb';
import { fetchPrebuiltFromGist } from '@/lib/githubApi';
import {
  completeGitHubOAuthCallback,
  getGitHubSession,
  signOutGitHub,
  startGitHubOAuthFlow,
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
  buildMarkQueryConstraint,
  createQuiz,
  getActiveQuizId,
  getBackupStatus,
  listQuizzes,
  listSavedQuestions,
  removeQuestionFromQuiz,
  setActiveQuizId as persistActiveQuizId,
  updateQuestionMark,
  type BackupStatus,
} from '@/lib/quizStore';
import { deleteRemixedQuestion, listAllRemixes } from '@/lib/remixStore';
import { runHybridSemanticSearch } from '@/lib/semanticClient';
import { formatBytes } from '@/lib/utils';
import type { QuestionRange } from '@/lib/variantGrouping';
import {
  DEFAULT_FILTERS,
  type AscpPathFacet,
  type FilterState,
  type ManifestData,
  type QuestionRecord,
  type SortOption,
} from '@/types/question';

export function App(): React.ReactElement {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }
    return 'light';
  });

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('oer_theme', next);
      } catch {
        // Ignore storage errors in restricted contexts
      }
      return next;
    });
  }, []);

  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<'explore' | 'prebuilt' | 'practice'>(
    'explore',
  );
  const [quizManagerOpen, setQuizManagerOpen] = useState<boolean>(false);

  // Phase 4: Multi-Quiz & Marks State (IndexedDB)
  const [quizzes, setQuizzes] = useState<QuizWorkspaceRecord[]>([]);
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const [savedMarksById, setSavedMarksById] = useState<Map<string, SavedQuestionRecord>>(
    () => new Map(),
  );
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
  const [githubAuthBusy, setGithubAuthBusy] = useState<boolean>(false);
  const [feedbackDrawerOpen, setFeedbackDrawerOpen] = useState<boolean>(false);
  const [errataQuestion, setErrataQuestion] = useState<QuestionRecord | null>(null);
  const [notice, setNotice] = useState<{ id: number; message: string; isError: boolean } | null>(
    null,
  );
  const noticeTimerRef = useRef<number | null>(null);

  // Explorer Query State
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [questionRanges, setQuestionRanges] = useState<Record<string, QuestionRange>>({});
  const [totalCount, setTotalCount] = useState<number>(0);
  const [rawTotalCount, setRawTotalCount] = useState<number>(0);
  const [avgLoadTimeMs, setAvgLoadTimeMs] = useState<number>(0);
  const loadTimeHistoryRef = useRef<Array<{ ts: number; ms: number }>>([]);
  const loadTimeTimerRef = useRef<number | null>(null);

  const refreshLoadTimeAvg = useCallback(() => {
    const cutoff = performance.now() - 2000;
    const recent = loadTimeHistoryRef.current.filter((entry) => entry.ts >= cutoff);
    loadTimeHistoryRef.current = recent;
    if (recent.length === 0) {
      setAvgLoadTimeMs(0);
      if (loadTimeTimerRef.current !== null) {
        window.clearInterval(loadTimeTimerRef.current);
        loadTimeTimerRef.current = null;
      }
      return;
    }
    const sorted = recent.map((entry) => entry.ms).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    setAvgLoadTimeMs(Math.round(median));
  }, []);

  const recordLoadTime = useCallback(
    (ms: number) => {
      loadTimeHistoryRef.current.push({ ts: performance.now(), ms });
      refreshLoadTimeAvg();
      if (loadTimeTimerRef.current === null) {
        loadTimeTimerRef.current = window.setInterval(refreshLoadTimeAvg, 100);
      }
    },
    [refreshLoadTimeAvg],
  );

  useEffect(() => {
    return () => {
      if (loadTimeTimerRef.current !== null) {
        window.clearInterval(loadTimeTimerRef.current);
        loadTimeTimerRef.current = null;
      }
    };
  }, []);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [semanticVisibleCount, setSemanticVisibleCount] = useState<number>(
    DEFAULT_FILTERS.pageSize,
  );

  const [ascpPathFacets, setAscpPathFacets] = useState<AscpPathFacet[]>([]);
  const [availableBloomLevels, setAvailableBloomLevels] = useState<string[] | null>(null);
  const [requestedTopicCodes, setRequestedTopicCodes] = useState<string[]>([]);
  const [facetsLoading, setFacetsLoading] = useState<boolean>(false);

  // Phase 3: Consent-gated multi-shard hybrid semantic search state
  const [semanticModalOpen, setSemanticModalOpen] = useState<boolean>(false);
  const [modalPreselectShards, setModalPreselectShards] = useState<string[] | null>(null);
  const [modalInitialPrompt, setModalInitialPrompt] = useState<string>('');
  const [activeSemanticShards, setActiveSemanticShards] = useState<string[]>([]);
  const [semanticPrompt, setSemanticPrompt] = useState<string>('');
  const [semanticResults, setSemanticResults] = useState<HybridRankedItem[]>([]);
  const [semanticRawTotal, setSemanticRawTotal] = useState<number>(0);
  const [semanticQuestionRanges, setSemanticQuestionRanges] = useState<
    Record<string, QuestionRange>
  >({});
  const [semanticMeta, setSemanticMeta] = useState<{
    embedMs: number;
    searchMs: number;
    totalMs: number;
    centroidSuggestions: CentroidSuggestion[];
  } | null>(null);
  const [semanticLoading, setSemanticLoading] = useState<boolean>(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);

  const [globalReveal, setGlobalReveal] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [quizSidebarCollapsed, setQuizSidebarCollapsed] = useState<boolean>(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);
  const [mobileQuizBuilderOpen, setMobileQuizBuilderOpen] = useState<boolean>(false);
  const [focusNewQuizCounter, setFocusNewQuizCounter] = useState<number>(0);
  const [remixesByParent, setRemixesByParent] = useState<Record<string, RemixedQuestionRecord[]>>({});
  const [remixModalState, setRemixModalState] = useState<{
    sourceQuestion: QuestionRecord;
    parentQuestionId: string;
    editingRemix?: RemixedQuestionRecord;
  } | null>(null);

  const querySeqRef = useRef(0);
  const facetSeqRef = useRef(0);
  const bloomSeqRef = useRef(0);
  const semanticSeqRef = useRef(0);
  const questionListRef = useRef<HTMLDivElement>(null);
  const questionCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [focusedQuestionId, setFocusedQuestionId] = useState<string | null>(null);

  const isSemanticActive =
    semanticPrompt.trim().length > 0 && activeSemanticShards.length > 0;

  const hasSelectedTopics =
    filters.disciplines.length > 0 ||
    filters.topicCodes.length > 0 ||
    filters.subtopics.length > 0 ||
    filters.leafTopics.length > 0 ||
    filters.ascpPaths.length > 0;
  const showTopicSelectionPrompt = !hasSelectedTopics && !isSemanticActive;

  const refreshWorkspace = useCallback(async (preferredActiveId?: string | null) => {
    const [quizList, storedActive, savedList, status, allRemixes] = await Promise.all([
      listQuizzes(),
      getActiveQuizId(),
      listSavedQuestions(),
      getBackupStatus(),
      listAllRemixes(),
    ]);
    setQuizzes(quizList);
    const resolvedActive =
      preferredActiveId !== undefined
        ? preferredActiveId
        : quizList.some((q) => q.id === storedActive)
          ? storedActive
          : (quizList[0]?.id ?? null);
    setActiveQuizId(resolvedActive);
    setSavedMarksById(new Map(savedList.map((s) => [s.questionId, s])));
    setBackupStatus(status);

    const grouped: Record<string, RemixedQuestionRecord[]> = {};
    for (const rec of allRemixes) {
      if (!grouped[rec.parentQuestionId]) {
        grouped[rec.parentQuestionId] = [];
      }
      grouped[rec.parentQuestionId].push(rec);
    }
    setRemixesByParent(grouped);
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
    const trimmed = msg.trim();
    if (!trimmed) return;
    const isError =
      /\b(error|failed|unable|mismatch|invalid|not configured|denied|expired)\b/i.test(trimmed);
    setNotice({ id: Date.now(), message: trimmed, isError });
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hasOAuthParams = Boolean(search && (search.includes('code=') || search.includes('error=')));
    if (hasOAuthParams) {
      setGithubAuthBusy(true);
    }
    (async () => {
      try {
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
      } finally {
        if (active && hasOAuthParams) {
          setGithubAuthBusy(false);
        }
      }
    })().catch(() => {
      if (active) setGithubAuthBusy(false);
    });
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

  const markCounts = useMemo(() => {
    let good = 0;
    let bad = 0;
    let notes = 0;
    for (const rec of savedMarksById.values()) {
      if (rec.rating === 'good') good += 1;
      if (rec.rating === 'bad') bad += 1;
      if (rec.personalNote.trim().length > 0) notes += 1;
    }
    return { good, bad, notes };
  }, [savedMarksById]);

  const markConstraint = useMemo(
    () => buildMarkQueryConstraint(filters.marks, savedMarksById),
    [filters.marks, savedMarksById],
  );

  const effectiveFilters = useMemo(
    () => ({ ...filters, markConstraint }),
    [filters, markConstraint],
  );

  useEffect(() => {
    if (!manifest || isSemanticActive || activeView !== 'explore') return;
    if (showTopicSelectionPrompt) {
      querySeqRef.current += 1;
      setQuestions([]);
      setQuestionRanges({});
      setTotalCount(0);
      setRawTotalCount(0);
      setLoading(false);
      setLoadingMore(false);
      setQueryError(null);
      return;
    }
    const isInitialPage = effectiveFilters.page <= 1;
    const seq = ++querySeqRef.current;
    if (isInitialPage) {
      setLoading(true);
      setLoadingMore(false);
      questionListRef.current?.scrollTo({ top: 0 });
    } else {
      setLoadingMore(true);
    }
    setQueryError(null);

    queryQuestions(manifest, effectiveFilters)
      .then((res) => {
        if (seq !== querySeqRef.current) return;
        if (isInitialPage) {
          setQuestions(res.items);
          setQuestionRanges(res.questionRanges);
        } else {
          setQuestions((prev) => {
            const seen = new Set(prev.map((q) => q.id));
            const next = [...prev];
            for (const item of res.items) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                next.push(item);
              }
            }
            return next;
          });
          setQuestionRanges((prev) => ({ ...prev, ...res.questionRanges }));
        }
        setTotalCount(res.total);
        setRawTotalCount(res.rawTotal);
        recordLoadTime(res.elapsedMs);
        setLoading(false);
        setLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (seq !== querySeqRef.current) return;
        setQueryError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        setLoadingMore(false);
      });
  }, [manifest, effectiveFilters, isSemanticActive, activeView, showTopicSelectionPrompt]);

  const semanticFilterKey = useMemo(
    () =>
      JSON.stringify({
        subtopics: filters.subtopics,
        leafTopics: filters.leafTopics,
        ascpPaths: filters.ascpPaths,
        bloomLevels: filters.bloomLevels,
        difficultyMin: filters.difficultyMin,
        difficultyMax: filters.difficultyMax,
        subsetTags: filters.subsetTags,
        questionTypes: filters.questionTypes,
        marks: filters.marks,
        markConstraint,
      }),
    [filters, markConstraint],
  );

  useEffect(() => {
    if (!manifest || !isSemanticActive) return;
    const seq = ++semanticSeqRef.current;
    setSemanticLoading(true);
    setSemanticError(null);

    runHybridSemanticSearch(manifest, semanticPrompt, activeSemanticShards, effectiveFilters)
      .then((out) => {
        if (seq !== semanticSeqRef.current) return;
        setSemanticResults(out.items);
        setSemanticVisibleCount(DEFAULT_FILTERS.pageSize);
        questionListRef.current?.scrollTo({ top: 0 });
        setSemanticRawTotal(out.rawTotal);
        setSemanticQuestionRanges(out.questionRanges);
        setSemanticMeta({
          embedMs: out.embedMs,
          searchMs: out.searchMs,
          totalMs: out.totalMs,
          centroidSuggestions: out.centroidSuggestions,
        });
        recordLoadTime(out.totalMs);
        setSemanticLoading(false);
      })
      .catch((err: unknown) => {
        if (seq !== semanticSeqRef.current) return;
        setSemanticError(err instanceof Error ? err.message : String(err));
        setSemanticLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, semanticPrompt, activeSemanticShards, semanticFilterKey]);

  const ensureTopicFacets = useCallback((codes: string[]) => {
    setRequestedTopicCodes((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const c of codes) {
        if (c && !next.has(c)) {
          next.add(c);
          changed = true;
        }
      }
      return changed ? Array.from(next) : prev;
    });
  }, []);

  const facetKey = useMemo(
    () =>
      JSON.stringify({
        requestedTopicCodes,
        disciplines: filters.disciplines,
        topicCodes: filters.topicCodes,
        ascpPaths: filters.ascpPaths,
        bloomLevels: filters.bloomLevels,
        difficultyMin: filters.difficultyMin,
        difficultyMax: filters.difficultyMax,
        subsetTags: filters.subsetTags,
        questionTypes: filters.questionTypes,
        keyword: filters.keyword,
      }),
    [filters, requestedTopicCodes],
  );

  useEffect(() => {
    if (!manifest) return;
    const requestedSet = new Set(requestedTopicCodes);
    const activeShards =
      filters.disciplines.length > 0 ||
      filters.topicCodes.length > 0 ||
      filters.ascpPaths.length > 0
        ? selectTargetShards(manifest, filters)
        : [];
    for (const s of activeShards) {
      requestedSet.add(s.topicCode);
    }
    const targetShards = manifest.shards.filter((s) => requestedSet.has(s.topicCode));
    if (targetShards.length === 0) {
      setAscpPathFacets([]);
      setFacetsLoading(false);
      return;
    }
    const seq = ++facetSeqRef.current;
    setFacetsLoading(true);
    queryAscpPathFacets(targetShards, filters)
      .then((facets) => {
        if (seq !== facetSeqRef.current) return;
        setAscpPathFacets(facets);
        setFacetsLoading(false);
      })
      .catch(() => {
        if (seq !== facetSeqRef.current) return;
        setAscpPathFacets([]);
        setFacetsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, facetKey]);

  const bloomScopeKey = useMemo(
    () =>
      JSON.stringify({
        disciplines: filters.disciplines,
        topicCodes: filters.topicCodes,
        ascpPaths: filters.ascpPaths,
        subtopics: filters.subtopics,
        leafTopics: filters.leafTopics,
      }),
    [
      filters.disciplines,
      filters.topicCodes,
      filters.ascpPaths,
      filters.subtopics,
      filters.leafTopics,
    ],
  );

  useEffect(() => {
    if (!manifest) return;
    const hasTopicScope =
      filters.disciplines.length > 0 ||
      filters.topicCodes.length > 0 ||
      filters.ascpPaths.length > 0;
    if (!hasTopicScope) {
      bloomSeqRef.current += 1;
      setAvailableBloomLevels(null);
      setFilters((prev) =>
        prev.bloomLevels.length === 0 ? prev : { ...prev, bloomLevels: [], page: 1 },
      );
      return;
    }

    const targetShards = selectTargetShards(manifest, filters);
    if (targetShards.length === 0) {
      bloomSeqRef.current += 1;
      setAvailableBloomLevels([]);
      setFilters((prev) =>
        prev.bloomLevels.length === 0 ? prev : { ...prev, bloomLevels: [], page: 1 },
      );
      return;
    }

    const seq = ++bloomSeqRef.current;
    queryAvailableBloomLevels(targetShards, filters)
      .then((presentLevels) => {
        if (seq !== bloomSeqRef.current) return;
        setAvailableBloomLevels(presentLevels);
        setFilters((prev) => ({
          ...prev,
          bloomLevels: presentLevels,
          page: 1,
        }));
      })
      .catch(() => {
        if (seq !== bloomSeqRef.current) return;
        setAvailableBloomLevels(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, bloomScopeKey]);

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

  const handleRemoveFromQuiz = useCallback(
    async (quizId: string, questionId: string) => {
      const target = quizzes.find((q) => q.id === quizId);
      await removeQuestionFromQuiz(quizId, questionId);
      await refreshWorkspace(quizId);
      showNotice(`Removed question from "${target?.name ?? 'Quiz'}".`);
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

  const handleUpdateMark = useCallback(
    async (
      questionId: string,
      patch: { rating?: QuestionRating | null; personalNote?: string },
    ) => {
      const updated = await updateQuestionMark(questionId, patch);
      setSavedMarksById((prev) => {
        const next = new Map(prev);
        if (updated) {
          next.set(questionId, updated);
        } else {
          next.delete(questionId);
        }
        return next;
      });
      await refreshWorkspace();
    },
    [refreshWorkspace],
  );

  const displayedTotal = isSemanticActive ? semanticResults.length : totalCount;
  const displayedSelectedCount = isSemanticActive
    ? Math.max(semanticRawTotal, semanticResults.length)
    : rawTotalCount;
  const loadedQuestionCount = useMemo(() => {
    if (!manifest || showTopicSelectionPrompt) return 0;
    if (isSemanticActive) {
      const activeSet = new Set(activeSemanticShards);
      return manifest.shards
        .filter((s) => activeSet.has(s.shardId))
        .reduce((sum, s) => sum + s.questionCount, 0);
    }
    return selectTargetShards(manifest, filters).reduce(
      (sum, s) => sum + s.questionCount,
      0,
    );
  }, [manifest, showTopicSelectionPrompt, isSemanticActive, activeSemanticShards, filters]);
  const displayedItems = useMemo(() => {
    if (isSemanticActive) {
      return semanticResults.slice(0, semanticVisibleCount).map((item) => ({
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
  }, [isSemanticActive, semanticResults, semanticVisibleCount, questions]);

  useEffect(() => {
    if (showTopicSelectionPrompt || displayedItems.length === 0) {
      setFocusedQuestionId(null);
      return;
    }
    if (displayedItems.length === 1) {
      setFocusedQuestionId(displayedItems[0].question.id);
      return;
    }

    const container = questionListRef.current;
    if (!container) {
      setFocusedQuestionId(displayedItems[0].question.id);
      return;
    }

    const computeFocusedQuestion = () => {
      const { scrollTop, clientHeight, scrollHeight } = container;
      if (scrollHeight > clientHeight) {
        if (scrollTop <= 2) {
          setFocusedQuestionId((prev) =>
            prev === displayedItems[0].question.id ? prev : displayedItems[0].question.id,
          );
          return;
        }
        if (scrollTop + clientHeight >= scrollHeight - 2) {
          const lastId = displayedItems[displayedItems.length - 1].question.id;
          setFocusedQuestionId((prev) => (prev === lastId ? prev : lastId));
          return;
        }
      }

      const containerRect = container.getBoundingClientRect();
      const containerCenter = (containerRect.top + containerRect.bottom) / 2;

      let bestId = displayedItems[0].question.id;
      let bestVisible = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const { question } of displayedItems) {
        const el = questionCardRefs.current.get(question.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const visibleHeight = Math.max(
          0,
          Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top),
        );
        const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - containerCenter);

        if (
          visibleHeight > bestVisible + 1 ||
          (Math.abs(visibleHeight - bestVisible) <= 1 && centerDistance < bestDistance)
        ) {
          bestId = question.id;
          bestVisible = visibleHeight;
          bestDistance = centerDistance;
        }
      }

      setFocusedQuestionId((prev) => (prev === bestId ? prev : bestId));
    };

    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        computeFocusedQuestion();
      });
    };

    computeFocusedQuestion();
    container.addEventListener('scroll', scheduleUpdate, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', scheduleUpdate);
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      container.removeEventListener('scroll', scheduleUpdate);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', scheduleUpdate);
      }
    };
  }, [displayedItems]);

  const isBusy = isSemanticActive ? semanticLoading : loading;
  const hasMore = isSemanticActive
    ? semanticVisibleCount < semanticResults.length
    : questions.length < totalCount;

  const rowVirtualizer = useVirtualizer({
    count: displayedItems.length,
    getScrollElement: () => questionListRef.current,
    estimateSize: () => 340,
    overscan: 4,
    gap: 16,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastVirtualIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  useEffect(() => {
    if (showTopicSelectionPrompt || activeView !== 'explore') return;
    if (!hasMore || isBusy || loadingMore) return;
    if (lastVirtualIndex < 0 || lastVirtualIndex < displayedItems.length - 5) return;

    if (isSemanticActive) {
      setSemanticVisibleCount((prev) =>
        Math.min(semanticResults.length, prev + DEFAULT_FILTERS.pageSize),
      );
      return;
    }

    setFilters((prev) => ({ ...prev, page: prev.page + 1 }));
  }, [
    showTopicSelectionPrompt,
    activeView,
    hasMore,
    isBusy,
    loadingMore,
    lastVirtualIndex,
    displayedItems.length,
    isSemanticActive,
    semanticResults.length,
  ]);

  if (manifestError) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col">
        <Navbar
          manifest={null}
          activeView="explore"
          activeSemanticShardCount={0}
          quizCount={quizzes.length}
          activeQuizQuestionCount={activeQuiz?.questionIds.length ?? 0}
          backupStatus={backupStatus}
          githubSession={githubSession}
          githubAuthBusy={githubAuthBusy}
          githubUsername={githubSession?.username ?? null}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSelectView={() => {}}
          onOpenSemanticModal={() => {}}
          onOpenQuizManager={() => setQuizManagerOpen(true)}
          onOpenFeedback={() => setFeedbackDrawerOpen(true)}
          onGitHubLogin={() => {
            if (githubSession) {
              setFeedbackDrawerOpen(true);
              return;
            }
            if (getGitHubConfig().isOAuthConfigured) {
              try {
                startGitHubOAuthFlow();
              } catch (err: unknown) {
                showNotice(
                  err instanceof Error ? err.message : 'Unable to start GitHub OAuth flow.',
                );
                setFeedbackDrawerOpen(true);
              }
            } else {
              setFeedbackDrawerOpen(true);
            }
          }}
          onGitHubLogout={() => {
            void signOutGitHub();
            setGithubSession(null);
            showNotice('Signed out of GitHub.');
          }}
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

  const isExploreView =
    !(activeView === 'practice' && practiceSession) &&
    !(activeView === 'prebuilt' && manifest);

  return (
    <div
      className={
        isExploreView
          ? 'flex h-screen flex-col overflow-hidden bg-[var(--bg-primary)]'
          : 'min-h-screen bg-[var(--bg-primary)] flex flex-col'
      }
    >
      <Navbar
        manifest={manifest}
        activeView={activeView}
        activeSemanticShardCount={activeSemanticShards.length}
        quizCount={quizzes.length}
        activeQuizQuestionCount={activeQuiz?.questionIds.length ?? 0}
        backupStatus={backupStatus}
        githubSession={githubSession}
        githubAuthBusy={githubAuthBusy}
        githubUsername={githubSession?.username ?? null}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSelectView={(v) => setActiveView(v)}
        onOpenSemanticModal={() => openSemanticModal()}
        onOpenQuizManager={() => setQuizManagerOpen(true)}
        onOpenFeedback={() => setFeedbackDrawerOpen(true)}
        onGitHubLogin={() => {
          if (githubSession) {
            setQuizManagerOpen(true);
            return;
          }
          if (getGitHubConfig().isOAuthConfigured) {
            try {
              startGitHubOAuthFlow();
            } catch (err: unknown) {
              showNotice(
                err instanceof Error ? err.message : 'Unable to start GitHub OAuth flow.',
              );
              setFeedbackDrawerOpen(true);
            }
          } else {
            setFeedbackDrawerOpen(true);
          }
        }}
        onGitHubLogout={() => {
          void signOutGitHub();
          setGithubSession(null);
          showNotice('Signed out of GitHub.');
        }}
        onOpenMobileQuizBuilder={() => setMobileQuizBuilderOpen(true)}
        onNotice={showNotice}
      />

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
        <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 gap-6 px-4 py-6 sm:px-6">
          {/* Desktop Sidebar */}
          <div
            className={`hidden shrink-0 lg:relative lg:flex lg:h-full lg:flex-col lg:overflow-hidden transition-[width] duration-300 ease-in-out ${
              sidebarCollapsed ? 'lg:w-12' : 'lg:w-80'
            }`}
          >
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand filters sidebar"
              title={
                manifest
                  ? `Expand filters (${manifest.totalQuestions.toLocaleString()} questions)`
                  : 'Expand filters'
              }
              tabIndex={sidebarCollapsed ? 0 : -1}
              aria-hidden={!sidebarCollapsed}
              className={`absolute top-0 left-0 z-10 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-2xs transition-all duration-300 ease-in-out hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] cursor-pointer ${
                sidebarCollapsed
                  ? 'scale-100 opacity-100 pointer-events-auto'
                  : 'scale-95 opacity-0 pointer-events-none'
              }`}
            >
              <Database className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
            </button>

            <div
              aria-hidden={sidebarCollapsed}
              className={`flex h-full w-80 flex-col gap-4 transition-all duration-300 ease-in-out ${
                sidebarCollapsed
                  ? '-translate-x-full opacity-0 pointer-events-none'
                  : 'translate-x-0 opacity-100'
              }`}
            >
              {manifest ? (
                <TopicsFilterSummaryCard
                  totalQuestions={manifest.totalQuestions}
                  loadedCount={loadedQuestionCount}
                  selectedCount={showTopicSelectionPrompt ? 0 : displayedSelectedCount}
                  loadTimeMs={avgLoadTimeMs}
                  onCollapse={() => setSidebarCollapsed(true)}
                />
              ) : (
                <Skeleton className="h-24 w-full shrink-0" />
              )}
              <OverflowBlurScrollArea
                className="min-h-0 flex-1"
                scrollClassName="lg:pr-1"
              >
                {manifest ? (
                  <FilterSidebar
                    manifest={manifest}
                    filters={filters}
                    ascpPathFacets={ascpPathFacets}
                    availableBloomLevels={availableBloomLevels}
                    markCounts={markCounts}
                    facetsLoading={facetsLoading}
                    onEnsureTopicFacets={ensureTopicFacets}
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
              </OverflowBlurScrollArea>
            </div>
          </div>

          {/* Mobile Filter Drawer */}
          {mobileFiltersOpen && manifest && (
            <div className="fixed inset-0 z-40 flex lg:hidden">
              <div
                className="fixed inset-0 bg-slate-900/40"
                onClick={() => setMobileFiltersOpen(false)}
              />
              <div className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col bg-[var(--bg-primary)] shadow-xl">
                <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-3">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Filters</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileFiltersOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  <div className="shrink-0 px-4">
                    <TopicsFilterSummaryCard
                      totalQuestions={manifest.totalQuestions}
                      loadedCount={loadedQuestionCount}
                      selectedCount={showTopicSelectionPrompt ? 0 : displayedSelectedCount}
                      loadTimeMs={avgLoadTimeMs}
                    />
                  </div>
                  <OverflowBlurScrollArea className="flex-1 min-h-0" contentClassName="px-4 pb-4">
                    <FilterSidebar
                      manifest={manifest}
                      filters={filters}
                      ascpPathFacets={ascpPathFacets}
                      availableBloomLevels={availableBloomLevels}
                      markCounts={markCounts}
                      facetsLoading={facetsLoading}
                      onEnsureTopicFacets={ensureTopicFacets}
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
                  </OverflowBlurScrollArea>
                </div>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            {/* Active Semantic Search + Stage 2 Centroid Suggestions */}
            {isSemanticActive && (
              <Card className="shrink-0 border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
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
              <Card className="shrink-0 border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-900">
                <strong className="font-semibold">Query Error: </strong>
                {semanticError || queryError}
              </Card>
            )}

            {/* Question List */}
            {showTopicSelectionPrompt ? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                <Card className="max-w-md p-8 text-center space-y-3">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-subtle,rgba(148,163,184,0.12))] text-[var(--text-secondary)]">
                    <ListFilter className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      Select one or more topics
                    </h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Choose a discipline or topic from the Topics filter to view matching questions.
                    </p>
                  </div>
                  <div className="pt-1 lg:hidden">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMobileFiltersOpen(true)}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Select Topics
                    </Button>
                  </div>
                </Card>
              </div>
            ) : isBusy && displayedItems.length === 0 ? (
              <OverflowBlurScrollArea
                className="min-h-0 flex-1"
                scrollClassName="pr-1"
                contentClassName="space-y-4"
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="p-5 space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </Card>
                ))}
              </OverflowBlurScrollArea>
            ) : displayedItems.length === 0 ? (
              <Card className="shrink-0 p-10 text-center space-y-3">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  No questions matched the active filter criteria.
                </p>
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Reset All Filters
                </Button>
              </Card>
            ) : (
              <OverflowBlurScrollArea
                scrollRef={questionListRef}
                aria-busy={isBusy}
                className={`min-h-0 flex-1 transition-opacity duration-200 ${
                  isBusy ? 'opacity-55 pointer-events-none' : 'opacity-100'
                }`}
                scrollClassName="pr-1"
                fadeClassName="h-16"
              >
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {virtualItems.map((virtualRow) => {
                    const { question, semanticMatch } = displayedItems[virtualRow.index];
                    return (
                      <div
                        key={question.id}
                        data-index={virtualRow.index}
                        ref={(el) => {
                          rowVirtualizer.measureElement(el);
                          if (el) {
                            questionCardRefs.current.set(question.id, el);
                          } else {
                            questionCardRefs.current.delete(question.id);
                          }
                        }}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <QuestionCard
                          question={question}
                          manifest={manifest}
                          globalReveal={globalReveal}
                          onToggleGlobalReveal={() => setGlobalReveal((prev) => !prev)}
                          semanticMatch={semanticMatch}
                          quizzes={quizzes}
                          activeQuizId={activeQuiz?.id ?? null}
                          mark={savedMarksById.get(question.id) ?? null}
                          getMark={(id) => savedMarksById.get(id) ?? null}
                          isFocused={
                            focusedQuestionId ? focusedQuestionId === question.id : undefined
                          }
                          onAddToQuiz={handleAddToQuiz}
                          onRemoveFromQuiz={handleRemoveFromQuiz}
                          onQuickCreateAndAdd={handleQuickCreateAndAdd}
                          onUpdateMark={handleUpdateMark}
                          onSuggestCorrection={setErrataQuestion}
                          localRemixes={remixesByParent[question.id] ?? []}
                          onOpenRemix={(sourceQuestion, parentQuestionId, editingRemix) =>
                            setRemixModalState({ sourceQuestion, parentQuestionId, editingRemix })
                          }
                          onDeleteRemix={async (remixId) => {
                            await deleteRemixedQuestion(remixId);
                            await refreshWorkspace();
                            showNotice('Removed local question remix.');
                          }}
                          onDeferredAction={showNotice}
                        />
                      </div>
                    );
                  })}
                </div>
              </OverflowBlurScrollArea>
            )}

            {/* Question Position Status */}
            {!showTopicSelectionPrompt && displayedTotal > 0 && (() => {
              const activeQuestionRanges = isSemanticActive
                ? semanticQuestionRanges
                : questionRanges;
              const focusedItemId =
                (focusedQuestionId &&
                displayedItems.some((item) => item.question.id === focusedQuestionId)
                  ? focusedQuestionId
                  : displayedItems[0]?.question.id) ?? null;
              const focusedQuestionRange = focusedItemId
                ? activeQuestionRanges[focusedItemId]
                : undefined;
              const displayedQuestionTotal = isSemanticActive
                ? Math.max(semanticRawTotal, semanticResults.length)
                : Math.max(rawTotalCount, totalCount);
              const questionPositionLabel = focusedQuestionRange
                ? focusedQuestionRange.end > focusedQuestionRange.start
                  ? `${focusedQuestionRange.start.toLocaleString()}–${focusedQuestionRange.end.toLocaleString()}`
                  : focusedQuestionRange.start.toLocaleString()
                : '1';

              return (
              <Card className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs text-[var(--text-secondary)]">
                  Question{' '}
                  <strong className="text-[var(--text-primary)]">{questionPositionLabel}</strong> of{' '}
                  <strong className="text-[var(--text-primary)]">
                    {displayedQuestionTotal.toLocaleString()}
                  </strong>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {loadingMore && (
                    <span className="text-xs text-[var(--text-secondary)]">
                      Loading more…
                    </span>
                  )}
                  {!isSemanticActive && (
                    <select
                      aria-label="Sort questions"
                      value={filters.sortBy}
                      onChange={(e) =>
                        updateFilters({ sortBy: e.target.value as SortOption, page: 1 })
                      }
                      className="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)]"
                    >
                      <option value="difficulty_asc">Sort: Difficulty (1 → 10)</option>
                      <option value="difficulty_desc">Sort: Difficulty (10 → 1)</option>
                      <option value="bloom_asc">Sort: Bloom (RE → AN)</option>
                      <option value="bloom_desc">Sort: Bloom (AN → RE)</option>
                      <option value="topic_asc">Sort: ASCP Topic (A → Z)</option>
                      <option value="topic_desc">Sort: ASCP Topic (Z → A)</option>
                    </select>
                  )}
                </div>
              </Card>
              );
            })()}
          </main>

          {/* Desktop Right Aside: Quiz Builder */}
          <aside
            className={`hidden shrink-0 lg:relative lg:flex lg:h-full lg:flex-col lg:overflow-hidden transition-[width] duration-300 ease-in-out ${
              quizSidebarCollapsed ? 'lg:w-12' : 'lg:w-80'
            }`}
            aria-label="Quiz Builder"
          >
            <button
              type="button"
              onClick={() => setQuizSidebarCollapsed(false)}
              aria-label="Expand Quiz Builder sidebar"
              title="Expand Quiz Builder"
              tabIndex={quizSidebarCollapsed ? 0 : -1}
              aria-hidden={!quizSidebarCollapsed}
              className={`absolute top-0 right-0 z-10 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-2xs transition-all duration-300 ease-in-out hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] cursor-pointer ${
                quizSidebarCollapsed
                  ? 'scale-100 opacity-100 pointer-events-auto'
                  : 'scale-95 opacity-0 pointer-events-none'
              }`}
            >
              <ClipboardList className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
            </button>

            <div
              aria-hidden={quizSidebarCollapsed}
              className={`flex h-full w-80 flex-col gap-4 transition-all duration-300 ease-in-out ${
                quizSidebarCollapsed
                  ? 'translate-x-full opacity-0 pointer-events-none'
                  : 'translate-x-0 opacity-100'
              }`}
            >
              <QuizBuilderSidebar
                manifest={manifest}
                activeView={activeView}
                quizCount={quizzes.length}
                activeQuizQuestionCount={activeQuiz?.questionIds.length ?? 0}
                backupStatus={backupStatus}
                onSelectPrebuilt={() => setActiveView('prebuilt')}
                onOpenMyQuizzes={() => setQuizManagerOpen(true)}
                onCreateNewQuiz={() => {
                  setQuizManagerOpen(true);
                  setFocusNewQuizCounter((c) => c + 1);
                }}
                onCollapse={() => setQuizSidebarCollapsed(true)}
              />
            </div>
          </aside>
        </div>
      )}

      {/* Mobile Quiz Builder Drawer */}
      {mobileQuizBuilderOpen && (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileQuizBuilderOpen(false)}
          />
          <div className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col bg-[var(--bg-primary)] shadow-xl">
            <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-3">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                Quiz Builder
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileQuizBuilderOpen(false)}
                aria-label="Close Quiz Builder"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
              <QuizBuilderSidebar
                manifest={manifest}
                activeView={activeView}
                quizCount={quizzes.length}
                activeQuizQuestionCount={activeQuiz?.questionIds.length ?? 0}
                backupStatus={backupStatus}
                onSelectPrebuilt={() => {
                  setMobileQuizBuilderOpen(false);
                  setActiveView('prebuilt');
                }}
                onOpenMyQuizzes={() => {
                  setMobileQuizBuilderOpen(false);
                  setQuizManagerOpen(true);
                }}
                onCreateNewQuiz={() => {
                  setMobileQuizBuilderOpen(false);
                  setQuizManagerOpen(true);
                  setFocusNewQuizCounter((c) => c + 1);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {manifest && (
        <>
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
            focusNewQuizRequest={focusNewQuizCounter}
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

      <QuestionRemixModal
        open={remixModalState !== null}
        sourceQuestion={remixModalState?.sourceQuestion ?? null}
        parentQuestionId={remixModalState?.parentQuestionId ?? null}
        editingRemix={remixModalState?.editingRemix ?? null}
        manifest={manifest}
        githubSession={githubSession}
        onClose={() => setRemixModalState(null)}
        onOpenFeedbackAuth={() => setFeedbackDrawerOpen(true)}
        onSavedLocal={() => {
          void refreshWorkspace();
          showNotice('Saved remixed variant locally.');
        }}
        onSubmittedCommunity={(_record, issueUrl, issueNumber) => {
          void refreshWorkspace();
          showNotice(`Saved locally & submitted Variant Issue #${issueNumber} (${issueUrl}).`);
        }}
      />

      <TruncatedTextTooltip />

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 flex max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm ${
            notice.isError
              ? 'border-rose-300 bg-rose-50/95 text-rose-950 dark:border-rose-800 dark:bg-rose-950/95 dark:text-rose-100'
              : 'border-emerald-300 bg-emerald-50/95 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/95 dark:text-emerald-100'
          }`}
        >
          {notice.isError ? (
            <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
          )}
          <span className="flex-1 leading-snug">{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
            className="rounded p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;

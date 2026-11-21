import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Lock,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, Card, Input, Separator } from '@/components/ui/primitives';
import { BLOOM_META, cn, DISCIPLINE_COLORS } from '@/lib/utils';
import type { FilterState, ManifestData, ShardManifest, SubtopicFacet } from '@/types/question';

export interface FilterSidebarProps {
  manifest: ManifestData;
  filters: FilterState;
  subtopicFacets: SubtopicFacet[];
  facetsLoading: boolean;
  activeSemanticShards: string[];
  semanticPrompt: string;
  semanticLoading: boolean;
  onUpdateFilters: (patch: Partial<FilterState>) => void;
  onResetFilters: () => void;
  onOpenSemanticModal: () => void;
  onSubmitSemanticPrompt: (prompt: string) => void;
  onClearSemanticPrompt: () => void;
}

function toggleArrayItem(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterSidebar({
  manifest,
  filters,
  subtopicFacets,
  facetsLoading,
  activeSemanticShards,
  semanticPrompt,
  semanticLoading,
  onUpdateFilters,
  onResetFilters,
  onOpenSemanticModal,
  onSubmitSemanticPrompt,
  onClearSemanticPrompt,
}: FilterSidebarProps): React.ReactElement {
  const [keywordDraft, setKeywordDraft] = useState(filters.keyword);
  const [semanticDraft, setSemanticDraft] = useState(semanticPrompt);
  const [hierarchySearch, setHierarchySearch] = useState('');
  const [expandedDiscs, setExpandedDiscs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setKeywordDraft(filters.keyword);
  }, [filters.keyword]);

  useEffect(() => {
    setSemanticDraft(semanticPrompt);
  }, [semanticPrompt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keywordDraft !== filters.keyword) {
        onUpdateFilters({ keyword: keywordDraft, page: 1 });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keywordDraft, filters.keyword, onUpdateFilters]);

  const disciplineGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        count: number;
        mlsWeight?: string;
        shards: ShardManifest[];
      }
    >();

    for (const shard of manifest.shards) {
      const existing = map.get(shard.disciplineCode);
      if (existing) {
        existing.count += shard.questionCount;
        existing.shards.push(shard);
      } else {
        const mls = manifest.disciplines[shard.disciplineCode]?.blueprintWeights?.MLS?.rawValue;
        map.set(shard.disciplineCode, {
          code: shard.disciplineCode,
          name: shard.disciplineName,
          count: shard.questionCount,
          mlsWeight: mls,
          shards: [shard],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [manifest]);

  const availableQuestionTypes = useMemo(() => {
    const set = new Set<string>();
    for (const s of manifest.shards) {
      for (const qt of Object.keys(s.questionTypeHistogram)) {
        set.add(qt);
      }
    }
    return Array.from(set).sort();
  }, [manifest]);

  const visibleSubtopicGroups = useMemo(() => {
    const needle = hierarchySearch.trim().toLowerCase();
    const bySub = new Map<string, { subtopic: string; count: number; leaves: SubtopicFacet[] }>();

    for (const f of subtopicFacets) {
      const matchesNeedle =
        !needle ||
        f.ascpSubtopic.toLowerCase().includes(needle) ||
        f.leafTopic.toLowerCase().includes(needle);
      if (!matchesNeedle) continue;

      const grp = bySub.get(f.ascpSubtopic);
      if (grp) {
        grp.count += f.count;
        grp.leaves.push(f);
      } else {
        bySub.set(f.ascpSubtopic, { subtopic: f.ascpSubtopic, count: f.count, leaves: [f] });
      }
    }
    return Array.from(bySub.values());
  }, [subtopicFacets, hierarchySearch]);

  const primarySubsets = useMemo(
    () => manifest.subsetTags.filter((t) => !t.startsWith('old/')),
    [manifest.subsetTags],
  );
  const archivedSubsets = useMemo(
    () => manifest.subsetTags.filter((t) => t.startsWith('old/')),
    [manifest.subsetTags],
  );

  return (
    <aside className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="keyword-search" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Keyword Search
          </label>
          <Button variant="ghost" size="sm" onClick={onResetFilters} className="h-6 px-2 text-xs">
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            id="keyword-search"
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            placeholder="Search stem, objective, option, ID..."
            className="pl-8"
          />
        </div>

        <div
          className={cn(
            'mt-3 rounded-lg border p-3',
            activeSemanticShards.length > 0
              ? 'border-emerald-200 bg-emerald-50/50'
              : 'border-indigo-200/80 bg-indigo-50/70',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <Sparkles
                className={cn(
                  'h-3.5 w-3.5',
                  activeSemanticShards.length > 0 ? 'text-emerald-600' : 'text-indigo-600',
                )}
              />
              Semantic Prompt Search
            </span>
            {activeSemanticShards.length > 0 ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                {activeSemanticShards.length} shard{activeSemanticShards.length === 1 ? '' : 's'}
              </Badge>
            ) : (
              <Lock className="h-3.5 w-3.5 text-indigo-500" />
            )}
          </div>

          {activeSemanticShards.length === 0 ? (
            <>
              <p className="mt-1 text-[11px] leading-relaxed text-indigo-900/80">
                Requires explicit consent to download the AI embedding model (~33 MB) and
                chosen topic vector shard(s).
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenSemanticModal}
                className="mt-2 w-full border-indigo-300 text-indigo-700 hover:bg-indigo-100/70"
              >
                Select Shards &amp; Unlock
              </Button>
            </>
          ) : (
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (semanticDraft.trim()) {
                  onSubmitSemanticPrompt(semanticDraft.trim());
                }
              }}
            >
              <div className="flex flex-wrap gap-1">
                {activeSemanticShards.map((sid) => (
                  <span
                    key={sid}
                    className="rounded bg-white border border-emerald-200 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800"
                  >
                    {sid}
                  </span>
                ))}
              </div>
              <Input
                aria-label="Semantic prompt query"
                value={semanticDraft}
                onChange={(e) => setSemanticDraft(e.target.value)}
                placeholder="Ask a clinical concept or rule..."
                className="h-8 text-xs bg-white"
              />
              <div className="flex items-center gap-1.5">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!semanticDraft.trim() || semanticLoading}
                  className="flex-1 h-7 text-xs"
                >
                  {semanticLoading ? 'Searching...' : 'Semantic Search'}
                </Button>
                {semanticPrompt && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSemanticDraft('');
                      onClearSemanticPrompt();
                    }}
                    className="h-7 px-2 text-xs"
                  >
                    Clear
                  </Button>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onOpenSemanticModal}
                className="w-full h-7 text-[11px] text-emerald-800 hover:bg-emerald-100/60"
              >
                Manage / Add Shards
              </Button>
            </form>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
          ASCP BOC Hierarchy (Levels 1–4)
        </h2>

        <div className="space-y-2">
          {disciplineGroups.map((disc) => {
            const discChecked = filters.disciplines.includes(disc.code);
            const hasSelectedTopics = disc.shards.some((s) =>
              filters.topicCodes.includes(s.topicCode),
            );
            const isExpanded =
              expandedDiscs[disc.code] ?? (discChecked || hasSelectedTopics);

            return (
              <div key={disc.code} className="rounded-lg border border-slate-200/80 bg-slate-50/50">
                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={discChecked}
                      onChange={() =>
                        onUpdateFilters({
                          disciplines: toggleArrayItem(filters.disciplines, disc.code),
                          subtopics: [],
                          leafTopics: [],
                          page: 1,
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[10px] font-bold',
                        DISCIPLINE_COLORS[disc.code] ?? 'bg-slate-100 text-slate-700',
                      )}
                    >
                      {disc.code}
                    </span>
                    <span className="truncate text-xs font-medium text-slate-800">
                      {disc.name}
                    </span>
                  </label>
                  <div className="flex items-center gap-1 shrink-0">
                    {disc.mlsWeight && (
                      <span
                        title="Official ASCP MLS Exam Blueprint Weight"
                        className="text-[10px] text-slate-500 hidden sm:inline"
                      >
                        {disc.mlsWeight}
                      </span>
                    )}
                    <Badge className="text-[10px] px-1.5 py-0">
                      {disc.count.toLocaleString()}
                    </Badge>
                    <button
                      type="button"
                      aria-label={`Toggle ${disc.name} Level-2 topics`}
                      onClick={() =>
                        setExpandedDiscs((prev) => ({
                          ...prev,
                          [disc.code]: !isExpanded,
                        }))
                      }
                      className="rounded p-0.5 text-slate-500 hover:bg-slate-200/60 cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200/70 bg-white px-3 py-2 space-y-1.5 rounded-b-lg">
                    {disc.shards.map((shard) => {
                      const topicChecked = filters.topicCodes.includes(shard.topicCode);
                      return (
                        <label
                          key={shard.shardId}
                          className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer hover:text-slate-950"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={topicChecked}
                              onChange={() =>
                                onUpdateFilters({
                                  topicCodes: toggleArrayItem(
                                    filters.topicCodes,
                                    shard.topicCode,
                                  ),
                                  subtopics: [],
                                  leafTopics: [],
                                  page: 1,
                                })
                              }
                              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="truncate">
                              <span className="font-mono text-[11px] text-slate-500 mr-1">
                                {shard.topicCode}
                              </span>
                              {shard.topicName}
                            </span>
                          </span>
                          <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                            {shard.questionCount.toLocaleString()}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {(filters.disciplines.length > 0 || filters.topicCodes.length > 0) && (
          <div className="mt-4 pt-3 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700">
                Levels 3–4: Subtopics &amp; Leaves
              </span>
              {facetsLoading && (
                <span className="text-[11px] text-indigo-600">Loading...</span>
              )}
            </div>
            <Input
              value={hierarchySearch}
              onChange={(e) => setHierarchySearch(e.target.value)}
              placeholder="Filter subtopics or leaves..."
              className="h-8 text-xs mb-2"
            />
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {visibleSubtopicGroups.length === 0 && !facetsLoading && (
                <p className="text-xs text-slate-400 py-1">No matching subtopics.</p>
              )}
              {visibleSubtopicGroups.map((grp) => {
                const subChecked = filters.subtopics.includes(grp.subtopic);
                return (
                  <div key={grp.subtopic} className="space-y-1">
                    <label className="flex items-center justify-between gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={subChecked}
                          onChange={() =>
                            onUpdateFilters({
                              subtopics: toggleArrayItem(filters.subtopics, grp.subtopic),
                              page: 1,
                            })
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                        />
                        <span className="truncate">{grp.subtopic}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {grp.count.toLocaleString()}
                      </span>
                    </label>
                    <div className="pl-5 space-y-1">
                      {grp.leaves.map((leaf) => {
                        const leafChecked = filters.leafTopics.includes(leaf.leafTopic);
                        return (
                          <label
                            key={`${grp.subtopic}::${leaf.leafTopic}`}
                            className="flex items-center justify-between gap-2 text-[11px] text-slate-600 cursor-pointer hover:text-slate-900"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={leafChecked}
                                onChange={() =>
                                  onUpdateFilters({
                                    leafTopics: toggleArrayItem(
                                      filters.leafTopics,
                                      leaf.leafTopic,
                                    ),
                                    page: 1,
                                  })
                                }
                                className="h-3 w-3 rounded border-slate-300 text-indigo-600"
                              />
                              <span className="truncate">{leaf.leafTopic}</span>
                            </span>
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              {leaf.count}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Bloom&apos;s Taxonomy Level
          </h2>
          <div className="grid grid-cols-2 gap-1.5">
            {(['RE', 'UN', 'AP', 'AN'] as const).map((code) => {
              const meta = BLOOM_META[code];
              const active = filters.bloomLevels.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    onUpdateFilters({
                      bloomLevels: toggleArrayItem(filters.bloomLevels, code),
                      page: 1,
                    })
                  }
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer',
                    active
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <span>{meta.label}</span>
                  <span className="font-mono text-[10px] opacity-80">{code}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Difficulty (1–10)
            </h2>
            <span className="text-xs font-medium text-slate-700">
              {filters.difficultyMin} – {filters.difficultyMax}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Minimum difficulty"
              value={filters.difficultyMin}
              onChange={(e) => {
                const nextMin = Number(e.target.value);
                onUpdateFilters({
                  difficultyMin: nextMin,
                  difficultyMax: Math.max(nextMin, filters.difficultyMax),
                  page: 1,
                });
              }}
              className="h-8 flex-1 rounded-md border border-slate-300 bg-white px-2 text-xs"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Min {n}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400">to</span>
            <select
              aria-label="Maximum difficulty"
              value={filters.difficultyMax}
              onChange={(e) => {
                const nextMax = Number(e.target.value);
                onUpdateFilters({
                  difficultyMax: nextMax,
                  difficultyMin: Math.min(filters.difficultyMin, nextMax),
                  page: 1,
                });
              }}
              className="h-8 flex-1 rounded-md border border-slate-300 bg-white px-2 text-xs"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Max {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Separator />

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Question Type
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {availableQuestionTypes.map((qt) => {
              const active = filters.questionTypes.includes(qt);
              return (
                <button
                  key={qt}
                  type="button"
                  onClick={() =>
                    onUpdateFilters({
                      questionTypes: toggleArrayItem(filters.questionTypes, qt),
                      page: 1,
                    })
                  }
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium cursor-pointer',
                    active
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {qt}
                </button>
              );
            })}
          </div>
        </div>

        <Separator />

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Assessment Subsets
          </h2>
          <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
            {primarySubsets.map((tag) => {
              const checked = filters.subsetTags.includes(tag);
              return (
                <label
                  key={tag}
                  className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:text-slate-950"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      onUpdateFilters({
                        subsetTags: toggleArrayItem(filters.subsetTags, tag),
                        page: 1,
                      })
                    }
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                  />
                  <span className="font-mono text-[11px]">{tag}</span>
                </label>
              );
            })}
            {archivedSubsets.length > 0 && (
              <details className="pt-1">
                <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700">
                  Archived subsets ({archivedSubsets.length})
                </summary>
                <div className="mt-1 pl-2 space-y-1">
                  {archivedSubsets.map((tag) => {
                    const checked = filters.subsetTags.includes(tag);
                    return (
                      <label
                        key={tag}
                        className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            onUpdateFilters({
                              subsetTags: toggleArrayItem(filters.subsetTags, tag),
                              page: 1,
                            })
                          }
                          className="h-3 w-3 rounded border-slate-300 text-indigo-600"
                        />
                        <span className="font-mono">{tag}</span>
                      </label>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        </div>
      </Card>
    </aside>
  );
}

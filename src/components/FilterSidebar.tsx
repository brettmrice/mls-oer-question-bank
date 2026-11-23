import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, Card, Checkbox as TreeCheckbox, Input } from '@/components/ui/primitives';
import { BLOOM_META, cn } from '@/lib/utils';
import type {
  AscpPathFacet,
  FilterState,
  ManifestData,
  ShardManifest,
} from '@/types/question';

export interface FilterSidebarProps {
  manifest: ManifestData;
  filters: FilterState;
  ascpPathFacets: AscpPathFacet[];
  facetsLoading: boolean;
  onEnsureTopicFacets: (topicCodes: string[]) => void;
  activeSemanticShards: string[];
  semanticPrompt: string;
  semanticLoading: boolean;
  selectedCount: number;
  loadTimeMs: number;
  onUpdateFilters: (patch: Partial<FilterState>) => void;
  onResetFilters: () => void;
  onOpenSemanticModal: () => void;
  onSubmitSemanticPrompt: (prompt: string) => void;
  onClearSemanticPrompt: () => void;
}

interface PathTreeNode {
  label: string;
  fullPath: string;
  count: number;
  children: PathTreeNode[];
}

const MLS_DISCIPLINE_ORDER = ['BB', 'UA', 'BF', 'CH', 'HE', 'IM', 'MI', 'LO', 'MB'];

function buildPathTree(
  facets: AscpPathFacet[],
  shard: ShardManifest,
  isSingleShardDisc: boolean,
): PathTreeNode[] {
  const roots: PathTreeNode[] = [];

  for (const facet of facets) {
    const rawSegs = facet.ascpPath
      .split(' > ')
      .map((s) => s.trim())
      .filter(Boolean);
    if (rawSegs.length === 0) continue;

    let startIdx = 0;
    if (rawSegs[0]?.toLowerCase() === shard.disciplineName.toLowerCase()) {
      startIdx = 1;
    }
    if (!isSingleShardDisc && rawSegs.length > startIdx + 1) {
      startIdx += 1;
    }

    const displaySegs = rawSegs.slice(startIdx);
    if (displaySegs.length === 0) continue;

    let currentLevel = roots;
    for (let i = 0; i < displaySegs.length; i++) {
      const label = displaySegs[i];
      const fullPath = rawSegs.slice(0, startIdx + i + 1).join(' > ');
      let node = currentLevel.find((n) => n.fullPath === fullPath);
      if (!node) {
        node = { label, fullPath, count: 0, children: [] };
        currentLevel.push(node);
      }
      node.count += facet.count;
      currentLevel = node.children;
    }
  }

  return roots;
}

function toggleArrayItem(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

type SidebarSectionId = 'topics' | 'bloom' | 'difficulty' | 'questionType' | 'keyword';

interface CollapsibleFilterCardProps {
  title: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Sidebar card whose body collapses down to its h2 header row.
 */
function CollapsibleFilterCard({
  title,
  collapsed,
  onToggle,
  headerAction,
  footer,
  children,
}: CollapsibleFilterCardProps): React.ReactElement {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" />
          )}
          <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
            {title}
          </h2>
        </button>
        {headerAction}
      </div>
      {!collapsed && <div className="mt-3">{children}</div>}
      {footer}
    </Card>
  );
}

export function FilterSidebar({
  manifest,
  filters,
  ascpPathFacets,
  facetsLoading,
  onEnsureTopicFacets,
  activeSemanticShards,
  semanticPrompt,
  semanticLoading,
  selectedCount,
  loadTimeMs,
  onUpdateFilters,
  onResetFilters,
  onOpenSemanticModal,
  onSubmitSemanticPrompt,
  onClearSemanticPrompt,
}: FilterSidebarProps): React.ReactElement {
  const [keywordDraft, setKeywordDraft] = useState(filters.keyword);
  const [semanticDraft, setSemanticDraft] = useState(semanticPrompt);
  const [expandedDiscs, setExpandedDiscs] = useState<Record<string, boolean>>({});
  const [expandedTopics, setExpandedTopics] = useState<Record<string, boolean>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [pendingExpandAllTopics, setPendingExpandAllTopics] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<SidebarSectionId, boolean>>({
    topics: false,
    bloom: false,
    difficulty: false,
    questionType: false,
    keyword: false,
  });

  const toggleSection = (id: SidebarSectionId) => {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

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
    return Array.from(map.values()).sort((a, b) => {
      const idxA = MLS_DISCIPLINE_ORDER.indexOf(a.code);
      const idxB = MLS_DISCIPLINE_ORDER.indexOf(b.code);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.code.localeCompare(b.code);
    });
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

  const treeByTopicCode = useMemo(() => {
    const facetsByTopic = new Map<string, AscpPathFacet[]>();
    for (const f of ascpPathFacets) {
      const list = facetsByTopic.get(f.topicCode);
      if (list) {
        list.push(f);
      } else {
        facetsByTopic.set(f.topicCode, [f]);
      }
    }

    const result = new Map<string, PathTreeNode[]>();
    for (const disc of disciplineGroups) {
      const isSingleShardDisc = disc.shards.length === 1;
      for (const shard of disc.shards) {
        const facets = facetsByTopic.get(shard.topicCode) ?? [];
        if (facets.length > 0) {
          result.set(shard.topicCode, buildPathTree(facets, shard, isSingleShardDisc));
        }
      }
    }
    return result;
  }, [ascpPathFacets, disciplineGroups]);

  const handleToggleDiscipline = (
    disc: (typeof disciplineGroups)[number],
    isCurrentlyChecked: boolean,
  ) => {
    const discTopicCodes = new Set(disc.shards.map((s) => s.topicCode));
    const isDiscPath = (p: string) => p === disc.name || p.startsWith(`${disc.name} > `);

    if (isCurrentlyChecked) {
      onUpdateFilters({
        disciplines: filters.disciplines.filter((c) => c !== disc.code),
        topicCodes: filters.topicCodes.filter((t) => !discTopicCodes.has(t)),
        ascpPaths: filters.ascpPaths.filter((p) => !isDiscPath(p)),
        subtopics: [],
        leafTopics: [],
        page: 1,
      });
    } else {
      onEnsureTopicFacets(disc.shards.map((s) => s.topicCode));
      onUpdateFilters({
        disciplines: Array.from(new Set([...filters.disciplines, disc.code])),
        topicCodes: filters.topicCodes.filter((t) => !discTopicCodes.has(t)),
        ascpPaths: filters.ascpPaths.filter((p) => !isDiscPath(p)),
        subtopics: [],
        leafTopics: [],
        page: 1,
      });
    }
  };

  const handleToggleShard = (
    disc: (typeof disciplineGroups)[number],
    shard: ShardManifest,
    isCurrentlyChecked: boolean,
  ) => {
    const discChecked = filters.disciplines.includes(disc.code);
    const shardPrefix = `${shard.disciplineName} > ${shard.topicName}`;
    const isShardPath = (p: string) => p === shardPrefix || p.startsWith(`${shardPrefix} > `);

    if (isCurrentlyChecked) {
      let nextDisciplines = filters.disciplines;
      let nextTopicCodes = filters.topicCodes;
      if (discChecked) {
        nextDisciplines = filters.disciplines.filter((c) => c !== disc.code);
        const siblingTopics = disc.shards
          .filter((s) => s.topicCode !== shard.topicCode)
          .map((s) => s.topicCode);
        nextTopicCodes = Array.from(new Set([...filters.topicCodes, ...siblingTopics]));
      } else {
        nextTopicCodes = filters.topicCodes.filter((t) => t !== shard.topicCode);
      }
      onUpdateFilters({
        disciplines: nextDisciplines,
        topicCodes: nextTopicCodes,
        ascpPaths: filters.ascpPaths.filter((p) => !isShardPath(p)),
        subtopics: [],
        leafTopics: [],
        page: 1,
      });
    } else {
      onEnsureTopicFacets([shard.topicCode]);
      onUpdateFilters({
        topicCodes: Array.from(new Set([...filters.topicCodes, shard.topicCode])),
        ascpPaths: filters.ascpPaths.filter((p) => !isShardPath(p)),
        subtopics: [],
        leafTopics: [],
        page: 1,
      });
    }
  };

  const handleTogglePathNode = (
    targetNode: PathTreeNode,
    disc: (typeof disciplineGroups)[number],
    shard: ShardManifest,
    rootNodes: PathTreeNode[],
    isEffectivelyChecked: boolean,
  ) => {
    if (!isEffectivelyChecked) {
      const nextPaths = filters.ascpPaths.filter(
        (p) => !p.startsWith(`${targetNode.fullPath} > `),
      );
      nextPaths.push(targetNode.fullPath);
      onUpdateFilters({
        ascpPaths: Array.from(new Set(nextPaths)),
        page: 1,
      });
      return;
    }

    const discChecked = filters.disciplines.includes(disc.code);
    const topicChecked = filters.topicCodes.includes(shard.topicCode);
    let nextDisciplines = [...filters.disciplines];
    let nextTopicCodes = [...filters.topicCodes];
    let nextAscpPaths = [...filters.ascpPaths];

    if (discChecked) {
      nextDisciplines = nextDisciplines.filter((c) => c !== disc.code);
      if (disc.shards.length > 1) {
        const siblingTopics = disc.shards
          .filter((s) => s.topicCode !== shard.topicCode)
          .map((s) => s.topicCode);
        nextTopicCodes = Array.from(new Set([...nextTopicCodes, ...siblingTopics]));
      }
      nextAscpPaths = Array.from(
        new Set([...nextAscpPaths, ...rootNodes.map((n) => n.fullPath)]),
      );
    } else if (topicChecked) {
      nextTopicCodes = nextTopicCodes.filter((t) => t !== shard.topicCode);
      nextAscpPaths = Array.from(
        new Set([...nextAscpPaths, ...rootNodes.map((n) => n.fullPath)]),
      );
    }

    let currentNodes = rootNodes;
    while (currentNodes.length > 0) {
      const branch = currentNodes.find(
        (n) =>
          n.fullPath === targetNode.fullPath ||
          targetNode.fullPath.startsWith(`${n.fullPath} > `),
      );
      if (!branch) break;
      if (branch.fullPath === targetNode.fullPath) {
        nextAscpPaths = nextAscpPaths.filter(
          (p) =>
            p !== targetNode.fullPath && !p.startsWith(`${targetNode.fullPath} > `),
        );
        break;
      }
      if (nextAscpPaths.includes(branch.fullPath)) {
        nextAscpPaths = nextAscpPaths.filter((p) => p !== branch.fullPath);
        nextAscpPaths.push(...branch.children.map((c) => c.fullPath));
      }
      currentNodes = branch.children;
    }

    onUpdateFilters({
      disciplines: nextDisciplines,
      topicCodes: nextTopicCodes,
      ascpPaths: Array.from(new Set(nextAscpPaths)),
      page: 1,
    });
  };

  const isNodeFullySelected = (node: PathTreeNode, parentChecked: boolean): boolean => {
    if (parentChecked || filters.ascpPaths.includes(node.fullPath)) return true;
    return (
      node.children.length > 0 &&
      node.children.every((child) => isNodeFullySelected(child, false))
    );
  };

  const collectExpandablePaths = (nodes: PathTreeNode[]): string[] => {
    const paths: string[] = [];
    for (const node of nodes) {
      if (node.children.length > 0) {
        paths.push(node.fullPath, ...collectExpandablePaths(node.children));
      }
    }
    return paths;
  };

  useEffect(() => {
    const pendingCodes = Object.keys(pendingExpandAllTopics).filter(
      (code) => pendingExpandAllTopics[code],
    );
    if (pendingCodes.length === 0) return;
    const loadedCodes = pendingCodes.filter((code) => (treeByTopicCode.get(code)?.length ?? 0) > 0);
    if (loadedCodes.length === 0) return;

    setExpandedPaths((prev) => {
      const next = { ...prev };
      for (const code of loadedCodes) {
        for (const p of collectExpandablePaths(treeByTopicCode.get(code) ?? [])) {
          next[p] = true;
        }
      }
      return next;
    });
    setPendingExpandAllTopics((prev) => {
      const next = { ...prev };
      for (const code of loadedCodes) {
        delete next[code];
      }
      return next;
    });
  }, [treeByTopicCode, pendingExpandAllTopics]);

  const handleDoubleClickDiscipline = (
    disc: (typeof disciplineGroups)[number],
    currentlyExpanded: boolean,
  ) => {
    const nextExpanded = !currentlyExpanded;
    const codes = disc.shards.map((s) => s.topicCode);
    setExpandedDiscs((prev) => ({ ...prev, [disc.code]: nextExpanded }));
    setExpandedTopics((prev) => {
      const next = { ...prev };
      for (const c of codes) next[c] = nextExpanded;
      return next;
    });
    setExpandedPaths((prev) => {
      const next = { ...prev };
      for (const c of codes) {
        for (const p of collectExpandablePaths(treeByTopicCode.get(c) ?? [])) {
          next[p] = nextExpanded;
        }
      }
      return next;
    });
    if (nextExpanded) {
      const unloaded = codes.filter((c) => (treeByTopicCode.get(c)?.length ?? 0) === 0);
      if (unloaded.length > 0) {
        setPendingExpandAllTopics((prev) => {
          const next = { ...prev };
          for (const c of unloaded) next[c] = true;
          return next;
        });
      }
      onEnsureTopicFacets(codes);
    } else {
      setPendingExpandAllTopics((prev) => {
        const next = { ...prev };
        for (const c of codes) delete next[c];
        return next;
      });
    }
  };

  const handleDoubleClickShard = (shard: ShardManifest, currentlyExpanded: boolean) => {
    const nextExpanded = !currentlyExpanded;
    const nodes = treeByTopicCode.get(shard.topicCode) ?? [];
    setExpandedTopics((prev) => ({ ...prev, [shard.topicCode]: nextExpanded }));
    setExpandedPaths((prev) => {
      const next = { ...prev };
      for (const p of collectExpandablePaths(nodes)) {
        next[p] = nextExpanded;
      }
      return next;
    });
    if (nextExpanded) {
      if (nodes.length === 0) {
        setPendingExpandAllTopics((prev) => ({ ...prev, [shard.topicCode]: true }));
      }
      onEnsureTopicFacets([shard.topicCode]);
    } else {
      setPendingExpandAllTopics((prev) => {
        const next = { ...prev };
        delete next[shard.topicCode];
        return next;
      });
    }
  };

  const handleDoubleClickPathNode = (node: PathTreeNode, currentlyExpanded: boolean) => {
    const nextExpanded = !currentlyExpanded;
    setExpandedPaths((prev) => {
      const next = { ...prev, [node.fullPath]: nextExpanded };
      for (const p of collectExpandablePaths(node.children)) {
        next[p] = nextExpanded;
      }
      return next;
    });
  };

  const renderPathNodes = (
    nodes: PathTreeNode[],
    disc: (typeof disciplineGroups)[number],
    shard: ShardManifest,
    rootNodes: PathTreeNode[],
    parentChecked: boolean,
    depth = 0,
  ): React.ReactNode => {
    if (nodes.length === 0) return null;
    return (
      <div className={cn('space-y-1', depth > 0 && 'pl-4 border-l border-[var(--border-color)] ml-1.5')}>
        {nodes.map((node) => {
          const hasChildren = node.children.length > 0;
          const isChecked = isNodeFullySelected(node, parentChecked);
          const hasCheckedDescendant = filters.ascpPaths.some((p) =>
            p.startsWith(`${node.fullPath} > `),
          );
          const isPartial = !isChecked && hasCheckedDescendant;
          const isExpanded = expandedPaths[node.fullPath] ?? false;
          const toggleNodeExpand = () =>
            setExpandedPaths((prev) => ({
              ...prev,
              [node.fullPath]: !isExpanded,
            }));

          return (
            <div key={node.fullPath} className="space-y-1">
              <div className="flex items-center justify-between gap-1.5 text-xs text-[var(--text-primary)]">
                {hasChildren ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <TreeCheckbox
                      checked={isChecked}
                      partial={isPartial}
                      onChange={() =>
                        handleTogglePathNode(node, disc, shard, rootNodes, isChecked)
                      }
                      ariaLabel={`Select ${node.label}`}
                    />
                    <button
                      type="button"
                      onClick={toggleNodeExpand}
                      onDoubleClick={() => handleDoubleClickPathNode(node, isExpanded)}
                      className={cn(
                        'min-w-0 flex-1 truncate text-left cursor-pointer',
                        depth === 0 ? 'font-medium text-[var(--text-primary)]' : 'text-[11px] text-[var(--text-secondary)]',
                      )}
                    >
                      {node.label}
                    </button>
                  </div>
                ) : (
                  <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                    <TreeCheckbox
                      checked={isChecked}
                      onChange={() =>
                        handleTogglePathNode(node, disc, shard, rootNodes, isChecked)
                      }
                    />
                    <span className={cn('truncate', depth === 0 ? 'font-medium text-[var(--text-primary)]' : 'text-[11px] text-[var(--text-secondary)]')}>
                      {node.label}
                    </span>
                  </label>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                    {node.count.toLocaleString()}
                  </span>
                  {hasChildren ? (
                    <button
                      type="button"
                      aria-label={`Toggle ${node.label}`}
                      onClick={toggleNodeExpand}
                      onDoubleClick={() => handleDoubleClickPathNode(node, isExpanded)}
                      className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--cream-surface-soft)] cursor-pointer"
                    >
                      {isExpanded ? (
                        <Minus className="h-3 w-3" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" aria-hidden="true" />
                  )}
                </div>
              </div>
              {hasChildren &&
                isExpanded &&
                renderPathNodes(node.children, disc, shard, rootNodes, isChecked, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  const selectedPct =
    manifest.totalQuestions > 0
      ? Math.round((selectedCount / manifest.totalQuestions) * 100)
      : 0;

  return (
    <aside className="flex flex-col gap-4">
      <CollapsibleFilterCard
        title={
          <>
            Question Bank | {manifest.totalQuestions.toLocaleString()}{' '}
            <span className="normal-case font-normal" title="Running average load time">
              (avg {loadTimeMs} ms)
            </span>
          </>
        }
        collapsed={collapsedSections.topics}
        onToggle={() => toggleSection('topics')}
        footer={
          <div className="mt-3 border-t border-[var(--border-color)] pt-2.5 text-center text-xs font-medium text-[var(--text-secondary)]">
            Selected |{' '}
            <span className="font-semibold text-[var(--text-primary)]">
              {selectedCount.toLocaleString()}
            </span>{' '}
            |{' '}
            <span className="font-semibold text-[var(--text-primary)]">
              {selectedPct}%
            </span>
          </div>
        }
      >
        <div className="space-y-2">
          {disciplineGroups.map((disc) => {
            const isSingleShardDisc = disc.shards.length === 1;
            const discChecked = filters.disciplines.includes(disc.code);
            const hasSelectedTopics = disc.shards.some((s) =>
              filters.topicCodes.includes(s.topicCode),
            );
            const hasSelectedPaths = filters.ascpPaths.some(
              (p) => p === disc.name || p.startsWith(`${disc.name} > `),
            );
            const allShardsSelected =
              disc.shards.length > 0 &&
              disc.shards.every((s) => {
                if (filters.topicCodes.includes(s.topicCode)) return true;
                const sNodes = treeByTopicCode.get(s.topicCode) ?? [];
                return sNodes.length > 0 && sNodes.every((n) => isNodeFullySelected(n, false));
              });
            const isDiscChecked = discChecked || allShardsSelected;
            const isDiscPartial = !isDiscChecked && (hasSelectedTopics || hasSelectedPaths);
            const isExpanded = expandedDiscs[disc.code] ?? false;
            const toggleDiscExpand = () => {
              const nextExpanded = !isExpanded;
              setExpandedDiscs((prev) => ({
                ...prev,
                [disc.code]: nextExpanded,
              }));
              if (nextExpanded && isSingleShardDisc) {
                onEnsureTopicFacets([disc.shards[0].topicCode]);
              }
            };

            return (
              <div key={disc.code} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <TreeCheckbox
                      checked={isDiscChecked}
                      partial={isDiscPartial}
                      sizeClass="h-4 w-4"
                      onChange={() => handleToggleDiscipline(disc, isDiscChecked)}
                      ariaLabel={`Select ${disc.name.replace(/^Clinical\s+/, '')}`}
                    />
                    <button
                      type="button"
                      onClick={toggleDiscExpand}
                      onDoubleClick={() => handleDoubleClickDiscipline(disc, isExpanded)}
                      className="min-w-0 flex-1 truncate text-left text-xs font-medium text-[var(--text-primary)] cursor-pointer"
                    >
                      {disc.name.replace(/^Clinical\s+/, '')}
                    </button>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge className="text-[10px] px-1.5 py-0">
                      {disc.count.toLocaleString()}
                    </Badge>
                    <button
                      type="button"
                      aria-label={`Toggle ${disc.name} subtopics`}
                      onClick={toggleDiscExpand}
                      onDoubleClick={() => handleDoubleClickDiscipline(disc, isExpanded)}
                      className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--cream-surface-soft)] cursor-pointer"
                    >
                      {isExpanded ? (
                        <Minus className="h-3.5 w-3.5" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 space-y-1.5 rounded-b-lg">
                    {isSingleShardDisc ? (
                      (() => {
                        const soleShard = disc.shards[0];
                        const nodes = treeByTopicCode.get(soleShard.topicCode) ?? [];
                        if (nodes.length === 0) {
                          return (
                            <p className="text-[11px] text-[var(--text-secondary)] py-0.5">
                              {facetsLoading ? 'Loading subtopics...' : 'No subtopics loaded.'}
                            </p>
                          );
                        }
                        return renderPathNodes(nodes, disc, soleShard, nodes, discChecked);
                      })()
                    ) : (
                      disc.shards.map((shard) => {
                        const directTopicChecked =
                          discChecked || filters.topicCodes.includes(shard.topicCode);
                        const hasPathInTopic = filters.ascpPaths.some((p) =>
                          p.startsWith(`${shard.disciplineName} > ${shard.topicName}`),
                        );
                        const topicNodes = treeByTopicCode.get(shard.topicCode) ?? [];
                        const allTopicNodesSelected =
                          topicNodes.length > 0 &&
                          topicNodes.every((n) => isNodeFullySelected(n, directTopicChecked));
                        const topicChecked = directTopicChecked || allTopicNodesSelected;
                        const isTopicPartial = !topicChecked && hasPathInTopic;
                        const topicExpanded = expandedTopics[shard.topicCode] ?? false;
                        const toggleTopicExpand = () => {
                          const nextExpanded = !topicExpanded;
                          setExpandedTopics((prev) => ({
                            ...prev,
                            [shard.topicCode]: nextExpanded,
                          }));
                          if (nextExpanded) {
                            onEnsureTopicFacets([shard.topicCode]);
                          }
                        };

                        return (
                          <div key={shard.shardId} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-primary)]">
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <TreeCheckbox
                                  checked={topicChecked}
                                  partial={isTopicPartial}
                                  onChange={() => handleToggleShard(disc, shard, topicChecked)}
                                  ariaLabel={`Select ${shard.topicName}`}
                                />
                                <button
                                  type="button"
                                  onClick={toggleTopicExpand}
                                  onDoubleClick={() => handleDoubleClickShard(shard, topicExpanded)}
                                  className="min-w-0 flex-1 truncate text-left cursor-pointer"
                                >
                                  {shard.topicName}
                                </button>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                                  {shard.questionCount.toLocaleString()}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Toggle ${shard.topicName} subtopics`}
                                  onClick={toggleTopicExpand}
                                  onDoubleClick={() => handleDoubleClickShard(shard, topicExpanded)}
                                  className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--cream-surface-soft)] cursor-pointer"
                                >
                                  {topicExpanded ? (
                                    <Minus className="h-3 w-3" />
                                  ) : (
                                    <Plus className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            </div>
                            {topicExpanded && (
                              <div className="pl-4 border-l border-[var(--border-color)] ml-1.5 py-0.5">
                                {topicNodes.length === 0 ? (
                                  <p className="text-[11px] text-[var(--text-secondary)]">
                                    {facetsLoading ? 'Loading subtopics...' : 'No subtopics loaded.'}
                                  </p>
                                ) : (
                                  renderPathNodes(topicNodes, disc, shard, topicNodes, topicChecked)
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleFilterCard>

      <CollapsibleFilterCard
        title="Bloom's Taxonomy Level"
        collapsed={collapsedSections.bloom}
        onToggle={() => toggleSection('bloom')}
      >
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
                  'flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-center text-xs font-medium transition cursor-pointer',
                  active
                    ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                    : 'border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)]',
                )}
              >
                <span>{meta.label}</span>
              </button>
            );
          })}
        </div>
      </CollapsibleFilterCard>

      <CollapsibleFilterCard
        title="Difficulty (1–10)"
        collapsed={collapsedSections.difficulty}
        onToggle={() => toggleSection('difficulty')}
        headerAction={
          <span className="shrink-0 text-xs font-medium text-[var(--text-primary)]">
            {filters.difficultyMin} – {filters.difficultyMax}
          </span>
        }
      >
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
            className="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                Min {n}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--text-secondary)]">to</span>
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
            className="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                Max {n}
              </option>
            ))}
          </select>
        </div>
      </CollapsibleFilterCard>

      <CollapsibleFilterCard
        title="Question Type"
        collapsed={collapsedSections.questionType}
        onToggle={() => toggleSection('questionType')}
      >
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
                    ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                    : 'border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)]',
                )}
              >
                {qt}
              </button>
            );
          })}
        </div>
      </CollapsibleFilterCard>

      <CollapsibleFilterCard
        title="Keyword Search"
        collapsed={collapsedSections.keyword}
        onToggle={() => toggleSection('keyword')}
        headerAction={
          <Button variant="ghost" size="sm" onClick={onResetFilters} className="h-6 px-2 text-xs shrink-0">
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        }
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            id="keyword-search"
            aria-label="Keyword Search"
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
              ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/70 dark:bg-emerald-950/30'
              : 'border-indigo-200/80 bg-indigo-50/70 dark:border-indigo-800/70 dark:bg-indigo-950/30',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <Sparkles
                className={cn(
                  'h-3.5 w-3.5',
                  activeSemanticShards.length > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-indigo-600 dark:text-indigo-400',
                )}
              />
              Semantic Prompt Search
            </span>
            {activeSemanticShards.length > 0 ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 text-[10px]">
                {activeSemanticShards.length} shard{activeSemanticShards.length === 1 ? '' : 's'}
              </Badge>
            ) : (
              <Lock className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
            )}
          </div>

          {activeSemanticShards.length === 0 ? (
            <>
              <p className="mt-1 text-[11px] leading-relaxed text-indigo-900/80 dark:text-indigo-200/80">
                Requires explicit consent to download the AI embedding model (~33 MB) and
                chosen topic vector shard(s).
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenSemanticModal}
                className="mt-2 w-full border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100/70 dark:hover:bg-indigo-950/50"
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
                    className="rounded bg-[var(--bg-surface)] border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800 dark:text-emerald-300"
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
                className="h-8 text-xs"
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
      </CollapsibleFilterCard>
    </aside>
  );
}

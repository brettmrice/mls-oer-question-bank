import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Checkbox, Input, Separator } from '@/components/ui/primitives';
import type { DownloadedShardRecord } from '@/lib/db';
import { recommendShardsByKeywords } from '@/lib/hybridRanker';
import {
  cancelActiveDownloads,
  clearSemanticCache,
  downloadAndActivateShards,
  type SemanticDownloadSnapshot,
} from '@/lib/semanticClient';
import {
  getDownloadedShardsMap,
  getShardCacheStatus,
  isSemanticModelPreviouslyCached,
} from '@/lib/shardCache';
import { cn, DISCIPLINE_COLORS, formatBytes } from '@/lib/utils';
import type { ManifestData, ShardManifest } from '@/types/question';

const APPROX_MODEL_BYTES = 33 * 1024 * 1024;

export interface SemanticSearchModalProps {
  open: boolean;
  manifest: ManifestData;
  activeShardIds: string[];
  initialPrompt?: string;
  onClose: () => void;
  onActivate: (shardIds: string[], promptHint?: string) => void;
}

export function SemanticSearchModal({
  open,
  manifest,
  activeShardIds,
  initialPrompt = '',
  onClose,
  onActivate,
}: SemanticSearchModalProps): React.ReactElement | null {
  const [selectedIds, setSelectedIds] = useState<string[]>(activeShardIds);
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [recommenderQuery, setRecommenderQuery] = useState<string>(initialPrompt);
  const [cachedRecords, setCachedRecords] = useState<Map<string, DownloadedShardRecord>>(
    new Map(),
  );
  const [modelCached, setModelCached] = useState<boolean>(false);
  const [downloadSnapshot, setDownloadSnapshot] = useState<SemanticDownloadSnapshot | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshCacheState = async () => {
    const [shardsMap, modelOk] = await Promise.all([
      getDownloadedShardsMap(),
      isSemanticModelPreviouslyCached(),
    ]);
    setCachedRecords(shardsMap);
    setModelCached(modelOk);
  };

  useEffect(() => {
    if (!open) return;
    setSelectedIds(activeShardIds);
    setConsentChecked(false);
    setErrorMessage(null);
    if (initialPrompt) {
      setRecommenderQuery(initialPrompt);
    }
    refreshCacheState().catch(() => {});
  }, [open, activeShardIds, initialPrompt]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !downloadSnapshot?.isDownloading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, downloadSnapshot?.isDownloading, onClose]);

  const disciplineGroups = useMemo(() => {
    const map = new Map<
      string,
      { code: string; name: string; shards: ShardManifest[] }
    >();
    for (const s of manifest.shards) {
      const grp = map.get(s.disciplineCode);
      if (grp) {
        grp.shards.push(s);
      } else {
        map.set(s.disciplineCode, {
          code: s.disciplineCode,
          name: s.disciplineName,
          shards: [s],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [manifest.shards]);

  const recommendations = useMemo(
    () => recommendShardsByKeywords(manifest, recommenderQuery, 4),
    [manifest, recommenderQuery],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const { shardBytesToDownload, needsModelDownload, totalDownloadBytes } = useMemo(() => {
    let sBytes = 0;
    for (const shard of manifest.shards) {
      if (!selectedSet.has(shard.shardId)) continue;
      const status = getShardCacheStatus(shard, cachedRecords.get(shard.shardId));
      if (status !== 'cached') {
        sBytes += shard.vectors.bytes + shard.ids.bytes;
      }
    }
    const modelReadyNow = modelCached || downloadSnapshot?.model.status === 'cached';
    const mBytes = modelReadyNow ? 0 : APPROX_MODEL_BYTES;
    return {
      shardBytesToDownload: sBytes,
      needsModelDownload: !modelReadyNow,
      totalDownloadBytes: sBytes + mBytes,
    };
  }, [manifest.shards, selectedSet, cachedRecords, modelCached, downloadSnapshot?.model.status]);

  if (!open) return null;

  const isDownloading = Boolean(downloadSnapshot?.isDownloading);
  const canStart =
    !isDownloading &&
    selectedIds.length > 0 &&
    (totalDownloadBytes === 0 || consentChecked);

  const toggleShard = (shardId: string) => {
    setSelectedIds((prev) =>
      prev.includes(shardId) ? prev.filter((id) => id !== shardId) : [...prev, shardId],
    );
  };

  const toggleDiscipline = (shards: ShardManifest[]) => {
    const ids = shards.map((s) => s.shardId);
    const allChecked = ids.every((id) => selectedSet.has(id));
    if (allChecked) {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  const selectRecommended = () => {
    const recIds = recommendations.map((r) => r.shard.shardId);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...recIds])));
  };

  const handleAgreeAndDownload = async () => {
    setErrorMessage(null);
    try {
      const activated = await downloadAndActivateShards(
        manifest,
        selectedIds,
        (snap) => setDownloadSnapshot(snap),
      );
      await refreshCacheState();
      if (activated.length > 0 && activated.length === selectedIds.length) {
        onActivate(activated, recommenderQuery.trim() || undefined);
        onClose();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearCache = async () => {
    await clearSemanticCache();
    setDownloadSnapshot(null);
    setModelCached(false);
    setCachedRecords(new Map());
    setConsentChecked(false);
    onActivate([]);
  };

  const hasAnyCachedData = modelCached || cachedRecords.size > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Consent-Gated Semantic Search Setup"
    >
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-[1px]"
        onClick={() => {
          if (!isDownloading) onClose();
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-color)] px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
              <Sparkles className="h-5 w-5 text-indigo-600" />
              Semantic Prompt Search — Select &amp; Download Shards
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              To keep this $0 OER fast at 1M+ scale, AI search runs locally in your browser
              and only downloads the topic shards you explicitly approve.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            disabled={isDownloading}
            onClick={onClose}
            aria-label="Close semantic setup modal"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Stage 1 Smart Shard Recommender */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="stage1-recommender"
                className="text-xs font-semibold uppercase tracking-wider text-indigo-900"
              >
                Smart Shard Recommender (Zero-Download Preview)
              </label>
              {recommendations.length > 0 && (
                <Button variant="outline" size="sm" onClick={selectRecommended}>
                  Select Recommended ({recommendations.length})
                </Button>
              )}
            </div>
            <Input
              id="stage1-recommender"
              value={recommenderQuery}
              onChange={(e) => setRecommenderQuery(e.target.value)}
              placeholder="Type a concept or prompt first (e.g., hemolytic anemia HbA1c, athlete bradycardia donor)..."
            />
            {recommendations.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {recommendations.map((rec) => {
                  const sz = rec.shard.vectors.bytes + rec.shard.ids.bytes;
                  const checked = selectedSet.has(rec.shard.shardId);
                  return (
                    <button
                      key={rec.shard.shardId}
                      type="button"
                      onClick={() => toggleShard(rec.shard.shardId)}
                      className={cn(
                        'flex items-start justify-between gap-2 rounded-lg border p-2.5 text-left text-xs transition cursor-pointer',
                        checked
                          ? 'border-indigo-500 bg-[var(--bg-surface)] ring-1 ring-indigo-500'
                          : 'border-indigo-200 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--text-primary)] truncate">
                          {rec.shard.topicCode} — {rec.shard.topicName}
                        </div>
                        <div className="text-[11px] text-indigo-700 truncate">
                          Matched: {rec.matchedTerms.join(', ')}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {formatBytes(sz)}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Model Card */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Cpu className="h-5 w-5 text-indigo-600" />
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    In-Browser Semantic Embedding Model
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    One-time ~33 MB download • Cached locally in browser
                  </div>
                </div>
              </div>

              {modelCached || downloadSnapshot?.model.status === 'cached' ? (
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  <CheckCircle2 className="h-3 w-3" />
                  Cached
                </Badge>
              ) : downloadSnapshot?.model.status === 'downloading' ? (
                <Badge variant="accent">
                  Downloading {downloadSnapshot.model.percent}%
                </Badge>
              ) : downloadSnapshot?.model.status === 'cancelled' ? (
                <Badge className="bg-amber-50 text-amber-800 border-amber-200">
                  Cancelled
                </Badge>
              ) : (
                <Badge variant="outline">~33 MB download</Badge>
              )}
            </div>

            {downloadSnapshot &&
              (downloadSnapshot.model.status === 'downloading' ||
                downloadSnapshot.model.status === 'queued') && (
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                    <span className="truncate">
                      {downloadSnapshot.model.file || 'Initializing ONNX pipeline...'}
                    </span>
                    <span className="font-mono shrink-0 ml-2">
                      {formatBytes(downloadSnapshot.model.loaded)} /{' '}
                      {formatBytes(downloadSnapshot.model.total)} (
                      {downloadSnapshot.model.percent}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full bg-indigo-600 transition-all duration-150"
                      style={{ width: `${downloadSnapshot.model.percent}%` }}
                    />
                  </div>
                </div>
              )}
          </div>

          {/* Multi-Shard Topic Selector */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Select 1 or More ASCP Topic Shards ({selectedIds.length} selected)
              </h3>
              {hasAnyCachedData && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isDownloading}
                  onClick={handleClearCache}
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear Cached Shards
                </Button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {disciplineGroups.map((disc) => {
                const allDiscSelected = disc.shards.every((s) =>
                  selectedSet.has(s.shardId),
                );
                const discBytes = disc.shards.reduce(
                  (sum, s) => sum + s.vectors.bytes + s.ids.bytes,
                  0,
                );

                return (
                  <div
                    key={disc.code}
                    className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 bg-[var(--bg-primary)] px-3.5 py-2.5 border-b border-[var(--border-color)]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-[10px] font-bold',
                            DISCIPLINE_COLORS[disc.code],
                          )}
                        >
                          {disc.code}
                        </span>
                        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          {disc.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                          {formatBytes(discBytes)}
                        </span>
                        <button
                          type="button"
                          disabled={isDownloading}
                          onClick={() => toggleDiscipline(disc.shards)}
                          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer disabled:opacity-50"
                        >
                          {allDiscSelected ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-[var(--border-color)]">
                      {disc.shards.map((shard) => {
                        const checked = selectedSet.has(shard.shardId);
                        const shardSize = shard.vectors.bytes + shard.ids.bytes;
                        const cacheStatus = getShardCacheStatus(
                          shard,
                          cachedRecords.get(shard.shardId),
                        );
                        const liveProg = downloadSnapshot?.shards[shard.shardId];

                        return (
                          <div key={shard.shardId} className="px-3.5 py-2.5 space-y-1.5">
                            <label className="flex items-center justify-between gap-2 cursor-pointer">
                              <span className="flex items-center gap-2 min-w-0">
                                <Checkbox
                                  disabled={isDownloading}
                                  checked={checked}
                                  sizeClass="h-4 w-4"
                                  onChange={() => toggleShard(shard.shardId)}
                                />
                                <span className="min-w-0">
                                  <span className="block text-xs font-medium text-[var(--text-primary)] truncate">
                                    {shard.topicName}
                                  </span>
                                  <span className="text-[11px] text-[var(--text-secondary)]">
                                    {shard.questionCount.toLocaleString()} questions •{' '}
                                    {formatBytes(shardSize)}
                                  </span>
                                </span>
                              </span>

                              <span className="shrink-0">
                                {liveProg && liveProg.status === 'downloading' ? (
                                  <Badge variant="accent" className="text-[10px]">
                                    {liveProg.percent}%
                                  </Badge>
                                ) : liveProg && liveProg.status === 'queued' ? (
                                  <Badge variant="outline" className="text-[10px]">
                                    Queued
                                  </Badge>
                                ) : liveProg && liveProg.status === 'cancelled' ? (
                                  <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-[10px]">
                                    Cancelled
                                  </Badge>
                                ) : cacheStatus === 'cached' ? (
                                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                                    <HardDrive className="h-3 w-3" />
                                    Cached
                                  </Badge>
                                ) : cacheStatus === 'update_available' ? (
                                  <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-[10px]">
                                    Update ({formatBytes(shardSize)})
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">
                                    {formatBytes(shardSize)}
                                  </Badge>
                                )}
                              </span>
                            </label>

                            {liveProg && liveProg.status === 'downloading' && (
                              <div className="pl-6 space-y-1">
                                <div className="flex justify-between text-[10px] font-mono text-[var(--text-secondary)]">
                                  <span>Downloading vector shard...</span>
                                  <span>
                                    {formatBytes(liveProg.loaded)} /{' '}
                                    {formatBytes(liveProg.total)} ({liveProg.percent}%)
                                  </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                  <div
                                    className="h-full bg-indigo-600 transition-all duration-150"
                                    style={{ width: `${liveProg.percent}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {errorMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        <Separator />

        {/* Footer / Explicit Consent Gate */}
        <div className="px-6 py-4 bg-[var(--bg-primary)] rounded-b-2xl space-y-3">
          {downloadSnapshot && isDownloading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-medium text-indigo-900">
                <span>Overall Semantic Setup Progress</span>
                <span className="font-mono">{downloadSnapshot.overallPercent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-100">
                <div
                  className="h-full bg-indigo-600 transition-all duration-150"
                  style={{ width: `${downloadSnapshot.overallPercent}%` }}
                />
              </div>
            </div>
          )}

          {totalDownloadBytes > 0 && (
            <label className="flex items-start gap-2.5 text-xs text-[var(--text-primary)] cursor-pointer">
              <Checkbox
                disabled={isDownloading}
                checked={consentChecked}
                sizeClass="h-4 w-4"
                className="mt-0.5"
                onChange={(e) => setConsentChecked(e.target.checked)}
              />
              <span>
                I agree to download{' '}
                <strong className="font-semibold text-[var(--text-primary)]">
                  ~{formatBytes(totalDownloadBytes)}
                </strong>{' '}
                (
                {selectedIds.length} shard{selectedIds.length === 1 ? '' : 's'} totaling{' '}
                {formatBytes(shardBytesToDownload)}
                {needsModelDownload ? ' + ~33 MB embedding model' : ''}) into my
                browser&apos;s local cache for offline-capable semantic search.
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[var(--text-secondary)]">
              {selectedIds.length === 0
                ? 'Select at least 1 topic shard to enable semantic search.'
                : totalDownloadBytes === 0
                  ? `${selectedIds.length} selected shard(s) and model are already cached locally (0 B download).`
                  : `New download required: ~${formatBytes(totalDownloadBytes)}`}
            </span>

            <div className="flex items-center gap-2">
              {isDownloading ? (
                <Button
                  variant="outline"
                  onClick={() => cancelActiveDownloads()}
                  className="border-rose-300 text-rose-700 hover:bg-rose-50"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel Downloads
                </Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!canStart}
                    onClick={handleAgreeAndDownload}
                  >
                    <Download className="h-4 w-4" />
                    {totalDownloadBytes === 0
                      ? 'Activate Cached Shards'
                      : 'Agree & Download Shards'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { querySemanticCandidates } from '@/lib/duckdb';
import { groupVariantItems } from '@/lib/variantGrouping';
import {
  computeHybridRrfRanking,
  extractClinicalQueryTokens,
  type CentroidSuggestion,
  type DenseShardHit,
  type HybridRankedItem,
} from '@/lib/hybridRanker';
import {
  clearAllCachedShards,
  downloadAndCacheShard,
  downloadOrLoadCentroids,
  loadCachedShard,
  markSemanticModelCached,
} from '@/lib/shardCache';
import type { FilterState, ManifestData } from '@/types/question';

export type DownloadStatus =
  | 'idle'
  | 'queued'
  | 'downloading'
  | 'cached'
  | 'error'
  | 'cancelled';

export interface AssetProgress {
  status: DownloadStatus;
  loaded: number;
  total: number;
  percent: number;
  file?: string;
  error?: string;
}

export interface SemanticDownloadSnapshot {
  isDownloading: boolean;
  model: AssetProgress;
  shards: Record<string, AssetProgress>;
  overallPercent: number;
}

export interface HybridSearchOutput {
  items: HybridRankedItem[];
  centroidSuggestions: CentroidSuggestion[];
  embedMs: number;
  searchMs: number;
  totalMs: number;
}

type WorkerOutMessage =
  | { type: 'MODEL_PROGRESS'; file: string; status: string; loaded: number; total: number; percent: number }
  | { type: 'MODEL_READY'; modelId: string }
  | { type: 'SHARD_LOADED'; shardId: string; count: number }
  | { type: 'CENTROIDS_LOADED' }
  | {
      type: 'SEARCH_RESULT';
      requestId: number;
      denseHits: DenseShardHit[];
      centroidSuggestions: CentroidSuggestion[];
      embedMs: number;
      searchMs: number;
    }
  | { type: 'SEARCH_ERROR'; requestId: number; error: string }
  | { type: 'WORKER_ERROR'; requestId?: number; error: string };

let workerInstance: Worker | null = null;
let workerModelReady = false;
let workerCentroidsLoaded = false;
const workerLoadedShards = new Set<string>();
let activeAbortController: AbortController | null = null;
let searchSeq = 0;

function getOrCreateWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('../workers/semantic.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return workerInstance;
}

function sendShardToWorker(
  shardId: string,
  ids: string[],
  vecBuffer: ArrayBuffer,
  dim: number,
): Promise<void> {
  const w = getOrCreateWorker();
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (msg.type === 'SHARD_LOADED' && msg.shardId === shardId) {
        w.removeEventListener('message', handler);
        workerLoadedShards.add(shardId);
        resolve();
      } else if (msg.type === 'WORKER_ERROR') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);
    // Pass a copy so Cache API and caller retain intact buffers if needed
    const copy = vecBuffer.slice(0);
    w.postMessage({ type: 'LOAD_SHARD', shardId, ids, vecBuffer: copy, dim }, [copy]);
  });
}

function sendCentroidsToWorker(
  buffer: ArrayBuffer,
  shardOrder: string[],
  dim: number,
): Promise<void> {
  const w = getOrCreateWorker();
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (msg.type === 'CENTROIDS_LOADED') {
        w.removeEventListener('message', handler);
        workerCentroidsLoaded = true;
        resolve();
      } else if (msg.type === 'WORKER_ERROR') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);
    const copy = buffer.slice(0);
    w.postMessage({ type: 'LOAD_CENTROIDS', buffer: copy, shardOrder, dim }, [copy]);
  });
}

function initWorkerModel(
  modelId: string,
  onProgress: (p: AssetProgress) => void,
): Promise<void> {
  if (workerModelReady) {
    onProgress({ status: 'cached', loaded: 1, total: 1, percent: 100 });
    return Promise.resolve();
  }
  const w = getOrCreateWorker();
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (msg.type === 'MODEL_PROGRESS') {
        onProgress({
          status: 'downloading',
          loaded: msg.loaded,
          total: msg.total,
          percent: msg.percent,
          file: msg.file,
        });
      } else if (msg.type === 'MODEL_READY') {
        w.removeEventListener('message', handler);
        workerModelReady = true;
        markSemanticModelCached(modelId).catch(() => {});
        onProgress({ status: 'cached', loaded: 1, total: 1, percent: 100 });
        resolve();
      } else if (msg.type === 'WORKER_ERROR') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ type: 'INIT_MODEL', modelId });
  });
}

export async function downloadAndActivateShards(
  manifest: ManifestData,
  shardIds: string[],
  onSnapshot: (snapshot: SemanticDownloadSnapshot) => void,
): Promise<string[]> {
  if (shardIds.length === 0) return [];
  activeAbortController?.abort();
  const controller = new AbortController();
  activeAbortController = controller;

  const targetShards = manifest.shards.filter((s) => shardIds.includes(s.shardId));
  const snapshot: SemanticDownloadSnapshot = {
    isDownloading: true,
    model: {
      status: workerModelReady ? 'cached' : 'queued',
      loaded: 0,
      total: 33 * 1024 * 1024,
      percent: workerModelReady ? 100 : 0,
    },
    shards: Object.fromEntries(
      targetShards.map((s) => [
        s.shardId,
        {
          status: 'queued',
          loaded: 0,
          total: s.vectors.bytes + s.ids.bytes,
          percent: 0,
        },
      ]),
    ),
    overallPercent: 0,
  };

  const emit = () => {
    const shardEntries = Object.values(snapshot.shards);
    const totalCount = shardEntries.length + 1;
    const sumPercent =
      snapshot.model.percent + shardEntries.reduce((acc, s) => acc + s.percent, 0);
    snapshot.overallPercent = Math.round(sumPercent / Math.max(1, totalCount));
    onSnapshot({
      ...snapshot,
      model: { ...snapshot.model },
      shards: { ...snapshot.shards },
    });
  };
  emit();

  const activated: string[] = [];

  try {
    // 1. Initialize Transformers.js model in worker
    await initWorkerModel(manifest.embeddingModel, (modelProg) => {
      snapshot.model = modelProg;
      emit();
    });

    if (controller.signal.aborted) {
      throw new DOMException('Download cancelled', 'AbortError');
    }

    // 2. Load centroids (<100 KB) for Stage 2 cross-topic suggestions
    if (!workerCentroidsLoaded) {
      const centroidBuf = await downloadOrLoadCentroids(manifest, undefined, controller.signal);
      await sendCentroidsToWorker(
        centroidBuf,
        manifest.centroids.shardOrder,
        manifest.centroids.dim,
      );
    }

    // 3. Download (or read from Cache API) each selected shard with progress
    for (const shard of targetShards) {
      if (controller.signal.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }

      const cached = await loadCachedShard(shard);
      if (cached) {
        await sendShardToWorker(
          shard.shardId,
          cached.ids,
          cached.vecBuffer,
          manifest.embeddingDim,
        );
        snapshot.shards[shard.shardId] = {
          status: 'cached',
          loaded: shard.vectors.bytes + shard.ids.bytes,
          total: shard.vectors.bytes + shard.ids.bytes,
          percent: 100,
        };
        activated.push(shard.shardId);
        emit();
        continue;
      }

      snapshot.shards[shard.shardId] = {
        status: 'downloading',
        loaded: 0,
        total: shard.vectors.bytes + shard.ids.bytes,
        percent: 0,
      };
      emit();

      const downloaded = await downloadAndCacheShard(
        shard,
        (loaded, total) => {
          snapshot.shards[shard.shardId] = {
            status: 'downloading',
            loaded,
            total,
            percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
          };
          emit();
        },
        controller.signal,
      );

      await sendShardToWorker(
        shard.shardId,
        downloaded.ids,
        downloaded.vecBuffer,
        manifest.embeddingDim,
      );

      snapshot.shards[shard.shardId] = {
        status: 'cached',
        loaded: shard.vectors.bytes + shard.ids.bytes,
        total: shard.vectors.bytes + shard.ids.bytes,
        percent: 100,
      };
      activated.push(shard.shardId);
      emit();
    }

    snapshot.isDownloading = false;
    emit();
    return activated;
  } catch (err: unknown) {
    const isAbort =
      controller.signal.aborted ||
      (err instanceof DOMException && err.name === 'AbortError');
    snapshot.isDownloading = false;
    if (isAbort) {
      if (snapshot.model.status === 'downloading' || snapshot.model.status === 'queued') {
        snapshot.model.status = 'cancelled';
      }
      for (const sid of Object.keys(snapshot.shards)) {
        const st = snapshot.shards[sid].status;
        if (st === 'downloading' || st === 'queued') {
          snapshot.shards[sid].status = 'cancelled';
        }
      }
      emit();
      return activated;
    }
    throw err;
  } finally {
    if (activeAbortController === controller) {
      activeAbortController = null;
    }
  }
}

export function cancelActiveDownloads(): void {
  activeAbortController?.abort();
}

export async function clearSemanticCache(): Promise<void> {
  cancelActiveDownloads();
  await clearAllCachedShards();
  workerLoadedShards.clear();
  if (workerInstance) {
    workerInstance.postMessage({ type: 'UNLOAD_SHARDS' });
  }
}

export async function ensureShardsLoadedInWorker(
  manifest: ManifestData,
  shardIds: string[],
): Promise<void> {
  if (!workerModelReady) {
    await initWorkerModel(manifest.embeddingModel, () => {});
  }
  if (!workerCentroidsLoaded) {
    const buf = await downloadOrLoadCentroids(manifest);
    await sendCentroidsToWorker(
      buf,
      manifest.centroids.shardOrder,
      manifest.centroids.dim,
    );
  }
  for (const sid of shardIds) {
    if (workerLoadedShards.has(sid)) continue;
    const shard = manifest.shards.find((s) => s.shardId === sid);
    if (!shard) continue;
    const cached = await loadCachedShard(shard);
    if (!cached) {
      throw new Error(`Shard ${sid} is not cached locally yet.`);
    }
    await sendShardToWorker(sid, cached.ids, cached.vecBuffer, manifest.embeddingDim);
  }
}

function queryWorkerDense(
  query: string,
  activeShardIds: string[],
  topK = 200,
): Promise<{
  denseHits: DenseShardHit[];
  centroidSuggestions: CentroidSuggestion[];
  embedMs: number;
  searchMs: number;
}> {
  const w = getOrCreateWorker();
  const requestId = ++searchSeq;
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (msg.type === 'SEARCH_RESULT' && msg.requestId === requestId) {
        w.removeEventListener('message', handler);
        resolve({
          denseHits: msg.denseHits,
          centroidSuggestions: msg.centroidSuggestions,
          embedMs: msg.embedMs,
          searchMs: msg.searchMs,
        });
      } else if (
        (msg.type === 'SEARCH_ERROR' || msg.type === 'WORKER_ERROR') &&
        msg.requestId === requestId
      ) {
        w.removeEventListener('message', handler);
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({
      type: 'SEARCH',
      requestId,
      query,
      activeShardIds,
      topK,
    });
  });
}

export async function runHybridSemanticSearch(
  manifest: ManifestData,
  query: string,
  activeShardIds: string[],
  filters: FilterState,
): Promise<HybridSearchOutput> {
  const start = performance.now();
  await ensureShardsLoadedInWorker(manifest, activeShardIds);

  const workerResult = await queryWorkerDense(query, activeShardIds, 200);
  const clinicalTokens = extractClinicalQueryTokens(query);
  const denseTopIds = workerResult.denseHits.map((h) => h.id);

  const candidates = await querySemanticCandidates(
    manifest,
    activeShardIds,
    filters,
    denseTopIds,
    clinicalTokens,
  );

  const rankedItems = computeHybridRrfRanking(candidates, query, workerResult.denseHits, 60);
  const items = groupVariantItems(
    rankedItems,
    (item) => item.question.id,
    (item) => item.question.similarIds,
  );
  return {
    items,
    centroidSuggestions: workerResult.centroidSuggestions,
    embedMs: workerResult.embedMs,
    searchMs: workerResult.searchMs,
    totalMs: Math.round(performance.now() - start),
  };
}

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import {
  recommendShardsByCentroids,
  scoreInt8MultiShard,
  type LoadedVectorShard,
} from '@/lib/hybridRanker';

env.allowLocalModels = false;
env.useBrowserCache = true;

const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

let extractor: FeatureExtractionPipeline | null = null;
let loadedModelId: string | null = null;
const loadedShards = new Map<string, LoadedVectorShard>();
let centroidsState: {
  centroids: Float32Array;
  shardOrder: string[];
  dim: number;
} | null = null;

type WorkerInMessage =
  | { type: 'INIT_MODEL'; modelId: string }
  | { type: 'LOAD_SHARD'; shardId: string; ids: string[]; vecBuffer: ArrayBuffer; dim: number }
  | { type: 'UNLOAD_SHARDS'; shardIds?: string[] }
  | { type: 'LOAD_CENTROIDS'; buffer: ArrayBuffer; shardOrder: string[]; dim: number }
  | {
      type: 'SEARCH';
      requestId: number;
      query: string;
      activeShardIds: string[];
      topK?: number;
    };

function normalizeL2(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm <= 1e-12) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  try {
    if (msg.type === 'INIT_MODEL') {
      if (extractor && loadedModelId === msg.modelId) {
        self.postMessage({ type: 'MODEL_READY', modelId: msg.modelId });
        return;
      }

      const fileBytes = new Map<string, { loaded: number; total: number }>();

      const pipe = await pipeline('feature-extraction', msg.modelId, {
        dtype: 'q8',
        progress_callback: (info: Record<string, unknown>) => {
          const status = String(info.status ?? '');
          const file = String(info.file ?? '');
          const loaded = Number(info.loaded ?? 0);
          const total = Number(info.total ?? 0);

          if (file && total > 0) {
            fileBytes.set(file, { loaded, total });
          }

          let aggLoaded = 0;
          let aggTotal = 0;
          for (const entry of fileBytes.values()) {
            aggLoaded += entry.loaded;
            aggTotal += entry.total;
          }

          const percent =
            aggTotal > 0
              ? Math.min(100, Math.round((aggLoaded / aggTotal) * 100))
              : Number(info.progress ?? 0);

          self.postMessage({
            type: 'MODEL_PROGRESS',
            file,
            status,
            loaded: aggLoaded || loaded,
            total: aggTotal || total || 33 * 1024 * 1024,
            percent,
          });
        },
      });

      extractor = pipe as unknown as FeatureExtractionPipeline;
      loadedModelId = msg.modelId;
      self.postMessage({ type: 'MODEL_READY', modelId: msg.modelId });
      return;
    }

    if (msg.type === 'LOAD_SHARD') {
      loadedShards.set(msg.shardId, {
        shardId: msg.shardId,
        ids: msg.ids,
        vectors: new Int8Array(msg.vecBuffer),
        dim: msg.dim,
      });
      self.postMessage({
        type: 'SHARD_LOADED',
        shardId: msg.shardId,
        count: msg.ids.length,
      });
      return;
    }

    if (msg.type === 'UNLOAD_SHARDS') {
      if (!msg.shardIds) {
        loadedShards.clear();
      } else {
        for (const id of msg.shardIds) {
          loadedShards.delete(id);
        }
      }
      self.postMessage({ type: 'SHARDS_UNLOADED' });
      return;
    }

    if (msg.type === 'LOAD_CENTROIDS') {
      centroidsState = {
        centroids: new Float32Array(msg.buffer),
        shardOrder: msg.shardOrder,
        dim: msg.dim,
      };
      self.postMessage({ type: 'CENTROIDS_LOADED' });
      return;
    }

    if (msg.type === 'SEARCH') {
      if (!extractor) {
        self.postMessage({
          type: 'SEARCH_ERROR',
          requestId: msg.requestId,
          error: 'Semantic model has not been initialized.',
        });
        return;
      }

      const embedStart = performance.now();
      const output = await extractor(BGE_QUERY_PREFIX + msg.query, {
        pooling: 'cls',
        normalize: true,
      });
      const embedMs = Math.round(performance.now() - embedStart);

      const rawData = output.data as Float32Array;
      const queryVec = normalizeL2(new Float32Array(rawData));

      const searchStart = performance.now();
      const activeSet = new Set(msg.activeShardIds);
      const targetShards = Array.from(loadedShards.values()).filter((s) =>
        activeSet.has(s.shardId),
      );

      const denseHits = scoreInt8MultiShard(
        queryVec,
        targetShards,
        msg.topK ?? 200,
      );

      const centroidSuggestions = centroidsState
        ? recommendShardsByCentroids(
            queryVec,
            centroidsState.centroids,
            centroidsState.shardOrder,
            centroidsState.dim,
            activeSet,
            0.40,
            3,
          )
        : [];
      const searchMs = Math.round(performance.now() - searchStart);

      self.postMessage({
        type: 'SEARCH_RESULT',
        requestId: msg.requestId,
        denseHits,
        centroidSuggestions,
        embedMs,
        searchMs,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const reqId = 'requestId' in msg ? msg.requestId : undefined;
    self.postMessage({
      type: 'WORKER_ERROR',
      requestId: reqId,
      error: message,
    });
  }
};

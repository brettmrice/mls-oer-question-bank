import { getAssetUrl } from '@/config/dataSource';
import { db, type DownloadedShardRecord } from '@/lib/db';
import type { ManifestData, ShardManifest } from '@/types/question';

export const SHARD_CACHE_NAME = 'mls-oer-semantic-shards-v1';
export const PARQUET_SHARD_CACHE_NAME = 'mls-oer-parquet-shards-v1';

export type ShardCacheStatus = 'cached' | 'update_available' | 'not_downloaded';

export function getShardCacheStatus(
  shard: ShardManifest,
  record?: DownloadedShardRecord | null,
): ShardCacheStatus {
  if (!record) return 'not_downloaded';
  if (
    record.vecSha256 === shard.vectors.sha256 &&
    record.idsSha256 === shard.ids.sha256
  ) {
    return 'cached';
  }
  return 'update_available';
}

function buildVersionedCacheKey(relPath: string, sha256: string): string {
  return `${getAssetUrl(relPath)}?sha256=${sha256}`;
}

export async function fetchWithProgress(
  url: string,
  expectedBytes: number,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw new DOMException('Download aborted', 'AbortError');
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  }

  const headerLength = Number(response.headers.get('content-length') || 0);
  const totalBytes = headerLength > 0 ? headerLength : expectedBytes;

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength, totalBytes || buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      onProgress(loadedBytes, totalBytes || loadedBytes);
    }
  }

  const merged = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress(loadedBytes, totalBytes || loadedBytes);
  return merged.buffer;
}

export async function loadCachedShard(
  shard: ShardManifest,
): Promise<{ vecBuffer: ArrayBuffer; ids: string[] } | null> {
  const record = await db.downloadedShards.get(shard.shardId);
  if (getShardCacheStatus(shard, record) !== 'cached') {
    return null;
  }
  if (!('caches' in globalThis)) {
    return null;
  }

  const cache = await caches.open(SHARD_CACHE_NAME);
  const vecKey = buildVersionedCacheKey(shard.vectors.path, shard.vectors.sha256);
  const idsKey = buildVersionedCacheKey(shard.ids.path, shard.ids.sha256);

  const [vecResp, idsResp] = await Promise.all([cache.match(vecKey), cache.match(idsKey)]);
  if (!vecResp || !idsResp) {
    return null;
  }

  const [vecBuffer, idsText] = await Promise.all([vecResp.arrayBuffer(), idsResp.text()]);
  const ids = JSON.parse(idsText) as string[];
  return { vecBuffer, ids };
}

export async function downloadAndCacheShard(
  shard: ShardManifest,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<{ vecBuffer: ArrayBuffer; ids: string[] }> {
  const totalBytes = shard.vectors.bytes + shard.ids.bytes;

  const vecBuffer = await fetchWithProgress(
    getAssetUrl(shard.vectors.path),
    shard.vectors.bytes,
    (loaded) => onProgress(Math.min(loaded, totalBytes), totalBytes),
    signal,
  );

  const idsBuffer = await fetchWithProgress(
    getAssetUrl(shard.ids.path),
    shard.ids.bytes,
    (loaded) =>
      onProgress(Math.min(shard.vectors.bytes + loaded, totalBytes), totalBytes),
    signal,
  );

  const idsText = new TextDecoder().decode(idsBuffer);
  const ids = JSON.parse(idsText) as string[];

  if ('caches' in globalThis) {
    const cache = await caches.open(SHARD_CACHE_NAME);
    const vecKey = buildVersionedCacheKey(shard.vectors.path, shard.vectors.sha256);
    const idsKey = buildVersionedCacheKey(shard.ids.path, shard.ids.sha256);
    await Promise.all([
      cache.put(
        vecKey,
        new Response(vecBuffer, {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
      ),
      cache.put(
        idsKey,
        new Response(idsText, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ]);
  }

  await db.downloadedShards.put({
    shardId: shard.shardId,
    topicCode: shard.topicCode,
    vecSha256: shard.vectors.sha256,
    idsSha256: shard.ids.sha256,
    totalBytes,
    cachedAt: new Date().toISOString(),
  });

  onProgress(totalBytes, totalBytes);
  return { vecBuffer, ids };
}

export async function downloadOrLoadCentroids(
  manifest: ManifestData,
  onProgress?: (loadedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const cacheKey = buildVersionedCacheKey(
    manifest.centroids.path,
    manifest.centroids.sha256,
  );
  if ('caches' in globalThis) {
    const cache = await caches.open(SHARD_CACHE_NAME);
    const hit = await cache.match(cacheKey);
    if (hit) {
      const buf = await hit.arrayBuffer();
      onProgress?.(buf.byteLength, manifest.centroids.bytes);
      return buf;
    }
  }

  const buf = await fetchWithProgress(
    getAssetUrl(manifest.centroids.path),
    manifest.centroids.bytes,
    (loaded, total) => onProgress?.(loaded, total),
    signal,
  );

  if ('caches' in globalThis) {
    const cache = await caches.open(SHARD_CACHE_NAME);
    await cache.put(
      cacheKey,
      new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
  }
  return buf;
}

export async function getDownloadedShardsMap(): Promise<Map<string, DownloadedShardRecord>> {
  const rows = await db.downloadedShards.toArray();
  return new Map(rows.map((r) => [r.shardId, r]));
}

export async function isSemanticModelPreviouslyCached(): Promise<boolean> {
  const state = await db.appState.get('semanticModelReady');
  if (!state) return false;
  if ('caches' in globalThis) {
    try {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      return keys.length > 0;
    } catch {
      return Boolean(state.value);
    }
  }
  return Boolean(state.value);
}

export async function markSemanticModelCached(modelId: string): Promise<void> {
  await db.appState.put({
    key: 'semanticModelReady',
    value: { modelId, cachedAt: new Date().toISOString() },
  });
}

export async function loadOrFetchParquetShard(shard: ShardManifest): Promise<Uint8Array> {
  const cacheKey = buildVersionedCacheKey(shard.parquet.path, shard.parquet.sha256);

  if ('caches' in globalThis) {
    try {
      const cache = await caches.open(PARQUET_SHARD_CACHE_NAME);
      const hit = await cache.match(cacheKey);
      if (hit) {
        return new Uint8Array(await hit.arrayBuffer());
      }
    } catch {
      // Ignore Cache API read errors in restricted contexts
    }
  }

  const response = await fetch(getAssetUrl(shard.parquet.path));
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} fetching ${shard.parquet.path}`,
    );
  }
  const buffer = await response.arrayBuffer();

  if ('caches' in globalThis) {
    try {
      const cache = await caches.open(PARQUET_SHARD_CACHE_NAME);
      await cache.put(
        cacheKey,
        new Response(buffer, {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
      );
    } catch {
      // Ignore Cache API write errors (e.g. quota exceeded)
    }
  }

  return new Uint8Array(buffer);
}

export async function clearAllCachedShards(): Promise<void> {
  if ('caches' in globalThis) {
    await caches.delete(SHARD_CACHE_NAME);
    await caches.delete(PARQUET_SHARD_CACHE_NAME);
    await caches.delete('transformers-cache');
  }
  await db.downloadedShards.clear();
  await db.appState.delete('semanticModelReady');
}

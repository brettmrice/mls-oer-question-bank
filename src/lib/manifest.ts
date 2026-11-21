import { getAssetUrl } from '@/config/dataSource';
import type { ManifestData, PreBuiltQuizSummary } from '@/types/question';

let cachedManifest: ManifestData | null = null;
let cachedPrebuilt: PreBuiltQuizSummary[] | null = null;

export async function fetchManifest(forceRefresh = false): Promise<ManifestData> {
  if (cachedManifest && !forceRefresh) {
    return cachedManifest;
  }
  const url = getAssetUrl('manifest.json');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest.json (${response.status} ${response.statusText}) from ${url}`);
  }
  const data = (await response.json()) as ManifestData;
  cachedManifest = data;
  return data;
}

export async function fetchPrebuiltCatalog(
  manifest: ManifestData,
  forceRefresh = false,
): Promise<PreBuiltQuizSummary[]> {
  if (cachedPrebuilt && !forceRefresh) {
    return cachedPrebuilt;
  }
  const relPath = manifest.prebuiltCatalog?.path || 'prebuilt_quizzes.json';
  const url = getAssetUrl(relPath);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${relPath} (${response.status}) from ${url}`);
  }
  const data = (await response.json()) as PreBuiltQuizSummary[];
  cachedPrebuilt = data;
  return data;
}

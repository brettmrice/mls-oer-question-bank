import type { ManifestData, QuestionRecord, ShardManifest } from '@/types/question';

export interface LoadedVectorShard {
  shardId: string;
  ids: string[];
  vectors: Int8Array;
  dim: number;
}

export interface DenseShardHit {
  id: string;
  shardId: string;
  cosine: number;
}

export interface ShardKeywordRecommendation {
  shard: ShardManifest;
  score: number;
  matchedTerms: string[];
}

export interface CentroidSuggestion {
  shardId: string;
  cosine: number;
}

export interface HybridRankedItem {
  question: QuestionRecord;
  rrfScore: number;
  semanticScore: number | null;
  bm25Score: number;
  keywordMatched: boolean;
}

const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'what', 'which', 'when', 'where', 'why', 'how', 'who', 'whom', 'into',
  'than', 'then', 'have', 'has', 'had', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'can', 'not', 'but', 'all', 'any', 'each', 'both',
  'does', 'did', 'about', 'between', 'during', 'after', 'before', 'under',
  'over', 'within', 'without', 'using', 'patient', 'question', 'questions',
  'find', 'search', 'show', 'about', 'related',
]);

function stripBoundaryPunctuation(tok: string): string {
  let s = tok.replace(/^[.,/]+|[.,/]+$/g, '');
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1);
  } else if (s.startsWith('(') && !s.includes(')')) {
    s = s.slice(1);
  } else if (s.endsWith(')') && !s.includes('(')) {
    s = s.slice(0, -1);
  }
  return s;
}

export function extractClinicalQueryTokens(query: string): string[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [];
  const rawTokens = lower.match(/[a-z0-9][a-z0-9\-()./]{1,}/g) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const tok of rawTokens) {
    const trimmed = stripBoundaryPunctuation(tok);
    if (trimmed.length < 2 || QUERY_STOPWORDS.has(trimmed)) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      tokens.push(trimmed);
    }
    // Also add alphanumeric split parts for hyphenated/parenthesized clinical terms
    if (/[-()/]/.test(trimmed)) {
      for (const sub of trimmed.split(/[-()/]+/)) {
        if (sub.length >= 2 && !QUERY_STOPWORDS.has(sub) && !seen.has(sub)) {
          seen.add(sub);
          tokens.push(sub);
        }
      }
    }
  }
  return tokens;
}

export function scoreInt8MultiShard(
  queryVec: Float32Array,
  loadedShards: LoadedVectorShard[],
  topK = 200,
): DenseShardHit[] {
  if (loadedShards.length === 0 || topK <= 0) return [];
  const hits: DenseShardHit[] = [];
  const inv127 = 1.0 / 127.0;

  for (const shard of loadedShards) {
    const { shardId, ids, vectors, dim } = shard;
    const count = ids.length;
    for (let i = 0; i < count; i++) {
      const base = i * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) {
        dot += queryVec[d] * vectors[base + d];
      }
      hits.push({
        id: ids[i],
        shardId,
        cosine: dot * inv127,
      });
    }
  }

  hits.sort((a, b) => b.cosine - a.cosine);
  return hits.slice(0, topK);
}

export function recommendShardsByKeywords(
  manifest: ManifestData,
  prompt: string,
  limit = 4,
): ShardKeywordRecommendation[] {
  const tokens = extractClinicalQueryTokens(prompt);
  if (tokens.length === 0) return [];

  const recommendations: ShardKeywordRecommendation[] = [];

  for (const shard of manifest.shards) {
    let score = 0;
    const matchedTerms: string[] = [];

    const topicText = `${shard.topicCode} ${shard.topicName} ${shard.disciplineCode} ${shard.disciplineName}`.toLowerCase();
    const keywords = shard.topKeywords.map((k) => k.toLowerCase());

    const discTree = manifest.disciplines[shard.disciplineCode]?.level2Topics ?? {};
    const subtopicEntries = discTree[shard.topicName] ?? {};
    const hierarchyBlob = Object.entries(subtopicEntries)
      .flatMap(([sub, leaves]) => [sub, ...leaves])
      .join(' ')
      .toLowerCase();

    for (const tok of tokens) {
      let matched = false;
      if (shard.topicCode.toLowerCase() === tok || shard.disciplineCode.toLowerCase() === tok) {
        score += 5;
        matched = true;
      }
      if (topicText.includes(tok)) {
        score += 3.5;
        matched = true;
      }
      if (keywords.includes(tok)) {
        score += 3.0;
        matched = true;
      } else if (keywords.some((k) => k.includes(tok) || (tok.length >= 4 && tok.includes(k)))) {
        score += 1.5;
        matched = true;
      }
      if (hierarchyBlob.includes(tok)) {
        score += 2.0;
        matched = true;
      }
      if (matched) {
        matchedTerms.push(tok);
      }
    }

    if (score > 0) {
      recommendations.push({ shard, score, matchedTerms });
    }
  }

  recommendations.sort((a, b) => b.score - a.score || a.shard.shardId.localeCompare(b.shard.shardId));
  return recommendations.slice(0, limit);
}

export function recommendShardsByCentroids(
  queryVec: Float32Array,
  centroids: Float32Array,
  shardOrder: string[],
  dim: number,
  activeShardIds: Set<string>,
  minCosine = 0.40,
  limit = 3,
): CentroidSuggestion[] {
  const suggestions: CentroidSuggestion[] = [];
  for (let i = 0; i < shardOrder.length; i++) {
    const shardId = shardOrder[i];
    if (activeShardIds.has(shardId)) continue;
    const base = i * dim;
    if (base + dim > centroids.length) break;

    let dot = 0;
    for (let d = 0; d < dim; d++) {
      dot += queryVec[d] * centroids[base + d];
    }
    if (dot >= minCosine) {
      suggestions.push({ shardId, cosine: dot });
    }
  }

  suggestions.sort((a, b) => b.cosine - a.cosine);
  return suggestions.slice(0, limit);
}

function tokenizeDocument(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9\-()./]{1,}/g) ?? [];
}

export function computeHybridRrfRanking(
  candidates: QuestionRecord[],
  query: string,
  denseHits: Array<{ id: string; cosine: number }>,
  rrfK = 60,
): HybridRankedItem[] {
  if (candidates.length === 0) return [];

  const denseRankMap = new Map<string, { rank: number; cosine: number }>();
  denseHits.forEach((hit, idx) => {
    if (!denseRankMap.has(hit.id)) {
      denseRankMap.set(hit.id, { rank: idx + 1, cosine: hit.cosine });
    }
  });

  const queryTokens = extractClinicalQueryTokens(query);
  const rawLower = query.trim().toLowerCase();

  // Build Okapi BM25 scores over candidate documents
  const docs = candidates.map((q) => {
    const fullText = [
      q.questionText,
      q.objective,
      q.ascpPath,
      q.leafTopic,
      q.options.map((o) => o.text).join(' '),
    ]
      .join(' ')
      .toLowerCase();
    const tokens = tokenizeDocument(fullText);
    const tf = new Map<string, number>();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
    }
    return { q, fullText, len: tokens.length, tf };
  });

  const avgDocLen =
    docs.reduce((sum, d) => sum + d.len, 0) / Math.max(1, docs.length);
  const nDocs = docs.length;

  const dfMap = new Map<string, number>();
  for (const tok of queryTokens) {
    let df = 0;
    for (const d of docs) {
      if ((d.tf.get(tok) ?? 0) > 0 || d.fullText.includes(tok)) {
        df += 1;
      }
    }
    dfMap.set(tok, df);
  }

  const k1 = 1.5;
  const b = 0.75;

  const bm25Scores = docs.map((doc) => {
    let score = 0;
    let matchedCount = 0;
    for (const tok of queryTokens) {
      const freq = doc.tf.get(tok) ?? (doc.fullText.includes(tok) ? 1 : 0);
      if (freq > 0) matchedCount += 1;
      if (freq === 0) continue;
      const df = dfMap.get(tok) ?? 0;
      const idf = Math.log((nDocs - df + 0.5) / (df + 0.5) + 1.0);
      const tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + (b * doc.len) / Math.max(1, avgDocLen)));
      score += idf * tfNorm;
    }
    const exactPhraseHit =
      rawLower.length >= 3 && queryTokens.length > 0 && doc.fullText.includes(rawLower);
    if (exactPhraseHit) {
      score += 2.0;
    }
    const keywordMatched =
      queryTokens.length > 0 &&
      (matchedCount === queryTokens.length || exactPhraseHit);
    return { id: doc.q.id, bm25Score: score, keywordMatched };
  });

  const bm25Sorted = [...bm25Scores]
    .filter((item) => item.bm25Score > 0)
    .sort((a, b) => b.bm25Score - a.bm25Score);
  const bm25RankMap = new Map<string, number>();
  bm25Sorted.forEach((item, idx) => bm25RankMap.set(item.id, idx + 1));

  const bm25MetaMap = new Map(bm25Scores.map((item) => [item.id, item]));

  const ranked: HybridRankedItem[] = candidates.map((question) => {
    const dense = denseRankMap.get(question.id);
    const bm25Rank = bm25RankMap.get(question.id);
    const bm25Meta = bm25MetaMap.get(question.id)!;

    const denseRrf = dense ? 1.0 / (rrfK + dense.rank) : 0;
    const bm25Rrf = bm25Rank ? 0.85 / (rrfK + bm25Rank) : 0;
    const exactBonus = bm25Meta.keywordMatched ? 0.004 : 0;

    return {
      question,
      rrfScore: denseRrf + bm25Rrf + exactBonus,
      semanticScore: dense ? dense.cosine : null,
      bm25Score: bm25Meta.bm25Score,
      keywordMatched: bm25Meta.keywordMatched,
    };
  });

  ranked.sort((a, b) => b.rrfScore - a.rrfScore);
  return ranked;
}

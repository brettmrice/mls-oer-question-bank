export interface AssetMeta {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BlueprintWeight {
  track: string;
  rawLabel: string;
  rawValue: string;
  minPct: number | null;
  maxPct: number | null;
}

export interface DisciplineManifest {
  disciplineCode: string;
  disciplineName: string;
  blueprintWeights: Record<string, BlueprintWeight>;
  totalMappedTopics: number;
  level2Topics: Record<string, Record<string, string[]>>;
}

export interface ShardManifest {
  shardId: string;
  topicCode: string;
  topicName: string;
  disciplineCode: string;
  disciplineName: string;
  questionCount: number;
  parquet: AssetMeta;
  vectors: AssetMeta;
  ids: AssetMeta;
  bloomHistogram: Record<string, number>;
  difficultyHistogram: Record<string, number>;
  questionTypeHistogram: Record<string, number>;
  topKeywords: string[];
}

export interface ManifestData {
  version: string;
  generatedAt: string;
  license: string;
  totalQuestions: number;
  questionsWithSiblings: number;
  similarityThreshold: number;
  embeddingModel: string;
  sourceEmbeddingModel: string;
  embeddingDim: number;
  vectorQuantization: string;
  centroids: AssetMeta & {
    dtype: string;
    dim: number;
    shardOrder: string[];
  };
  prebuiltCatalog: AssetMeta & {
    count: number;
  };
  disciplines: Record<string, DisciplineManifest>;
  shards: ShardManifest[];
  subsetTags: string[];
  parseSummary: Record<string, number>;
}

export interface PreBuiltQuizSummary {
  id: string;
  subsetKey?: string;
  title: string;
  description: string;
  author: string;
  institution?: string;
  license: string;
  tags: string[];
  questionIds: string[];
  questionCount: number;
  disciplineCounts: Record<string, number>;
  bloomCounts: Record<string, number>;
  avgDifficulty: number;
  estimatedMinutes: number;
}

export interface QuestionOption {
  label: string;
  text: string;
  weight: number;
  feedback: string;
}

export interface QuestionRecord {
  id: string;
  displayId: string;
  disciplineCode: string;
  disciplineName: string;
  topicCode: string;
  topicName: string;
  taxonomicCode: string;
  ascpSubtopic: string;
  leafTopic: string;
  ascpPath: string;
  subsetTags: string[];
  bloomLevel: 'RE' | 'UN' | 'AP' | 'AN' | string;
  difficulty: number;
  difficultyRationale: string;
  questionType: string;
  objective: string;
  questionText: string;
  options: QuestionOption[];
  hint: string;
  similarIds: string[];
  sourceFiles: string[];
}

export type SortOption =
  | 'topic_asc'
  | 'difficulty_asc'
  | 'difficulty_desc'
  | 'bloom_desc'
  | 'display_id_asc';

export interface FilterState {
  disciplines: string[];
  topicCodes: string[];
  subtopics: string[];
  leafTopics: string[];
  bloomLevels: string[];
  difficultyMin: number;
  difficultyMax: number;
  subsetTags: string[];
  questionTypes: string[];
  keyword: string;
  sortBy: SortOption;
  page: number;
  pageSize: number;
}

export interface SubtopicFacet {
  ascpSubtopic: string;
  leafTopic: string;
  count: number;
}

export const DEFAULT_FILTERS: FilterState = {
  disciplines: [],
  topicCodes: [],
  subtopics: [],
  leafTopics: [],
  bloomLevels: [],
  difficultyMin: 1,
  difficultyMax: 10,
  subsetTags: [],
  questionTypes: [],
  keyword: '',
  sortBy: 'topic_asc',
  page: 1,
  pageSize: 25,
};

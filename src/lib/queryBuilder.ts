import type { FilterState, ManifestData, ShardManifest, SortOption } from '@/types/question';

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function escapeSqlLike(value: string): string {
  return escapeSqlString(
    value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_'),
  );
}

export function selectTargetShards(
  manifest: ManifestData,
  filters: Pick<FilterState, 'disciplines' | 'topicCodes'>,
): ShardManifest[] {
  if (filters.topicCodes.length > 0) {
    const allowed = new Set(filters.topicCodes);
    return manifest.shards.filter((s) => allowed.has(s.topicCode));
  }
  if (filters.disciplines.length > 0) {
    const allowed = new Set(filters.disciplines);
    return manifest.shards.filter((s) => allowed.has(s.disciplineCode));
  }
  return manifest.shards;
}

export function formatParquetSource(parquetPaths: string[]): string {
  if (parquetPaths.length === 0) {
    throw new Error('At least one Parquet shard path is required');
  }
  if (parquetPaths.length === 1) {
    return `read_parquet('${escapeSqlString(parquetPaths[0])}')`;
  }
  const items = parquetPaths.map((p) => `'${escapeSqlString(p)}'`).join(', ');
  return `read_parquet([${items}])`;
}

function buildInClause(column: string, values: string[]): string | null {
  if (values.length === 0) return null;
  const quoted = values.map((v) => `'${escapeSqlString(v)}'`).join(', ');
  return `${column} IN (${quoted})`;
}

export function buildWhereClause(
  filters: FilterState,
  options: {
    excludeHierarchySubLevels?: boolean;
    excludeTopicScope?: boolean;
    excludeKeyword?: boolean;
  } = {},
): string {
  const clauses: string[] = [];

  if (!options.excludeTopicScope) {
    const discClause = buildInClause('discipline_code', filters.disciplines);
    if (discClause) clauses.push(discClause);

    const topicClause = buildInClause('topic_code', filters.topicCodes);
    if (topicClause) clauses.push(topicClause);
  }

  if (!options.excludeHierarchySubLevels) {
    const subClause = buildInClause('ascp_subtopic', filters.subtopics);
    if (subClause) clauses.push(subClause);

    const leafClause = buildInClause('leaf_topic', filters.leafTopics);
    if (leafClause) clauses.push(leafClause);
  }

  const bloomClause = buildInClause('bloom_level', filters.bloomLevels);
  if (bloomClause) clauses.push(bloomClause);

  const qTypeClause = buildInClause('question_type', filters.questionTypes);
  if (qTypeClause) clauses.push(qTypeClause);

  if (filters.difficultyMin > 1 || filters.difficultyMax < 10) {
    const minVal = Math.max(1, Math.min(10, Math.floor(filters.difficultyMin)));
    const maxVal = Math.max(minVal, Math.min(10, Math.floor(filters.difficultyMax)));
    clauses.push(`difficulty BETWEEN ${minVal} AND ${maxVal}`);
  }

  if (filters.subsetTags.length > 0) {
    const tagMatches = filters.subsetTags.map((tag) => {
      const escaped = escapeSqlLike(tag.replace(/"/g, '\\"'));
      return `subset_tags_json ILIKE '%"${escaped}"%' ESCAPE '\\'`;
    });
    clauses.push(`(${tagMatches.join(' OR ')})`);
  }

  const trimmedKeyword = options.excludeKeyword ? '' : filters.keyword.trim();
  if (trimmedKeyword.length > 0) {
    const tokens = trimmedKeyword.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const escaped = escapeSqlLike(token);
      clauses.push(
        `(` +
          `question_text ILIKE '%${escaped}%' ESCAPE '\\' OR ` +
          `objective ILIKE '%${escaped}%' ESCAPE '\\' OR ` +
          `ascp_path ILIKE '%${escaped}%' ESCAPE '\\' OR ` +
          `leaf_topic ILIKE '%${escaped}%' ESCAPE '\\' OR ` +
          `options_json ILIKE '%${escaped}%' ESCAPE '\\' OR ` +
          `display_id ILIKE '%${escaped}%' ESCAPE '\\' OR ` +
          `id ILIKE '%${escaped}%' ESCAPE '\\'` +
          `)`,
      );
    }
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

export function buildOrderByClause(sortBy: SortOption): string {
  switch (sortBy) {
    case 'difficulty_asc':
      return 'ORDER BY difficulty ASC, topic_code ASC, display_id ASC';
    case 'difficulty_desc':
      return 'ORDER BY difficulty DESC, topic_code ASC, display_id ASC';
    case 'bloom_desc':
      return (
        "ORDER BY CASE bloom_level WHEN 'AN' THEN 4 WHEN 'AP' THEN 3 WHEN 'UN' THEN 2 WHEN 'RE' THEN 1 ELSE 0 END DESC, " +
        'difficulty DESC, topic_code ASC, display_id ASC'
      );
    case 'display_id_asc':
      return 'ORDER BY display_id ASC, id ASC';
    case 'topic_asc':
    default:
      return 'ORDER BY topic_code ASC, bloom_level ASC, difficulty ASC, display_id ASC';
  }
}

export function buildQuestionQuery(
  parquetPaths: string[],
  filters: FilterState,
): { countSql: string; rowsSql: string } {
  const source = formatParquetSource(parquetPaths);
  const where = buildWhereClause(filters);
  const orderBy = buildOrderByClause(filters.sortBy);
  const pageSize = Math.max(1, Math.min(200, Math.floor(filters.pageSize)));
  const page = Math.max(1, Math.floor(filters.page));
  const offset = (page - 1) * pageSize;

  const countSql = `SELECT COUNT(*) AS total FROM ${source} ${where}`;
  const rowsSql = `
    SELECT
      id,
      display_id,
      discipline_code,
      discipline_name,
      topic_code,
      topic_name,
      taxonomic_code,
      ascp_subtopic,
      leaf_topic,
      ascp_path,
      subset_tags_json,
      bloom_level,
      difficulty,
      difficulty_rationale,
      question_type,
      objective,
      question_text,
      options_json,
      hint,
      similar_ids_json,
      source_files_json
    FROM ${source}
    ${where}
    ${orderBy}
    LIMIT ${pageSize} OFFSET ${offset}
  `.trim();

  return { countSql, rowsSql };
}

export function buildFacetQuery(parquetPaths: string[], filters: FilterState): string {
  const source = formatParquetSource(parquetPaths);
  const where = buildWhereClause(filters, { excludeHierarchySubLevels: true });
  return `
    SELECT
      ascp_subtopic,
      leaf_topic,
      COUNT(*) AS cnt
    FROM ${source}
    ${where}
    GROUP BY ascp_subtopic, leaf_topic
    ORDER BY ascp_subtopic ASC, cnt DESC, leaf_topic ASC
  `.trim();
}

const QUESTION_COLUMNS = `
  id,
  display_id,
  discipline_code,
  discipline_name,
  topic_code,
  topic_name,
  taxonomic_code,
  ascp_subtopic,
  leaf_topic,
  ascp_path,
  subset_tags_json,
  bloom_level,
  difficulty,
  difficulty_rationale,
  question_type,
  objective,
  question_text,
  options_json,
  hint,
  similar_ids_json,
  source_files_json
`.trim();

export function buildSemanticCandidateQueries(
  parquetPaths: string[],
  filters: FilterState,
  denseTopIds: string[],
  clinicalTokens: string[],
  maxKeywordCandidates = 150,
): { denseSql: string | null; keywordSql: string | null } {
  const source = formatParquetSource(parquetPaths);
  const baseWhere = buildWhereClause(filters, {
    excludeTopicScope: true,
    excludeKeyword: true,
  });

  let denseSql: string | null = null;
  if (denseTopIds.length > 0) {
    const inList = denseTopIds.map((id) => `'${escapeSqlString(id)}'`).join(', ');
    const denseWhere = baseWhere
      ? `${baseWhere} AND id IN (${inList})`
      : `WHERE id IN (${inList})`;
    denseSql = `SELECT ${QUESTION_COLUMNS} FROM ${source} ${denseWhere}`;
  }

  let keywordSql: string | null = null;
  const tokens = clinicalTokens.slice(0, 6);
  if (tokens.length > 0) {
    const tokenPredicates = tokens.map((tok) => {
      const esc = escapeSqlLike(tok);
      return (
        `(question_text ILIKE '%${esc}%' ESCAPE '\\' OR ` +
        `objective ILIKE '%${esc}%' ESCAPE '\\' OR ` +
        `options_json ILIKE '%${esc}%' ESCAPE '\\' OR ` +
        `leaf_topic ILIKE '%${esc}%' ESCAPE '\\')`
      );
    });
    const hitExpr = tokenPredicates
      .map((pred) => `CASE WHEN ${pred} THEN 1 ELSE 0 END`)
      .join(' + ');
    const anyMatch = `(${tokenPredicates.join(' OR ')})`;
    const kwWhere = baseWhere ? `${baseWhere} AND ${anyMatch}` : `WHERE ${anyMatch}`;
    keywordSql = `
      SELECT ${QUESTION_COLUMNS}, (${hitExpr}) AS kw_hits
      FROM ${source}
      ${kwWhere}
      ORDER BY kw_hits DESC, topic_code ASC
      LIMIT ${Math.max(1, maxKeywordCandidates)}
    `.trim();
  }

  return { denseSql, keywordSql };
}

export interface VariantGroupEntry<T> {
  item: T;
  /** Number of unique matching items from the input list represented by this entry (1 + collapsed variants). */
  count: number;
}

export interface QuestionRange {
  start: number;
  end: number;
}

/**
 * Builds 1-based inclusive display ranges for grouped items given each item's
 * group size and the 1-based starting position of the first item.
 */
export function buildQuestionRanges(
  ids: readonly string[],
  counts: readonly number[],
  startAt = 1,
): Record<string, QuestionRange> {
  const ranges: Record<string, QuestionRange> = {};
  let cursor = startAt;
  for (let i = 0; i < ids.length; i += 1) {
    const count = Math.max(1, counts[i] ?? 1);
    const start = cursor;
    const end = cursor + count - 1;
    ranges[ids[i]] = { start, end };
    cursor = end + 1;
  }
  return ranges;
}

/**
 * Groups items into single visible representatives when variants exist,
 * returning each representative alongside the number of matching items it represents.
 *
 * Items are processed in order; the first encountered item of a variant group
 * is kept, and any subsequent items whose IDs appear in an earlier kept item's
 * `similarIds` are excluded so variants are not shown again later in paging.
 */
export function groupVariantItemsWithCounts<T>(
  items: readonly T[],
  getId: (item: T) => string,
  getSimilarIds: (item: T) => readonly string[],
): VariantGroupEntry<T>[] {
  const presentIds = new Set(items.map(getId));
  const excluded = new Set<string>();
  const grouped: VariantGroupEntry<T>[] = [];

  for (const item of items) {
    const id = getId(item);
    if (excluded.has(id)) {
      continue;
    }
    excluded.add(id);
    let count = 1;
    for (const simId of getSimilarIds(item)) {
      if (presentIds.has(simId) && !excluded.has(simId)) {
        count += 1;
      }
      excluded.add(simId);
    }
    grouped.push({ item, count });
  }

  return grouped;
}

/**
 * Groups items into single visible representatives when variants exist.
 *
 * Items are processed in order; the first encountered item of a variant group
 * is kept, and any subsequent items whose IDs appear in an earlier kept item's
 * `similarIds` are excluded so variants are not shown again later in paging.
 */
export function groupVariantItems<T>(
  items: readonly T[],
  getId: (item: T) => string,
  getSimilarIds: (item: T) => readonly string[],
): T[] {
  return groupVariantItemsWithCounts(items, getId, getSimilarIds).map((entry) => entry.item);
}

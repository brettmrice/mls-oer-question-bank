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
  const excluded = new Set<string>();
  const grouped: T[] = [];

  for (const item of items) {
    const id = getId(item);
    if (excluded.has(id)) {
      continue;
    }
    grouped.push(item);
    excluded.add(id);
    for (const simId of getSimilarIds(item)) {
      excluded.add(simId);
    }
  }

  return grouped;
}

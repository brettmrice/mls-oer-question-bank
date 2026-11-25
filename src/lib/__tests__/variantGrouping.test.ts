import { describe, expect, it } from 'vitest';
import {
  buildQuestionRanges,
  groupVariantItems,
  groupVariantItemsWithCounts,
} from '@/lib/variantGrouping';

interface StubItem {
  id: string;
  similarIds: string[];
}

describe('groupVariantItems', () => {
  it('keeps the first visible question of a variant group and excludes its variants later in paging', () => {
    const items: StubItem[] = [
      { id: 'q1', similarIds: ['q2', 'q3'] },
      { id: 'q4', similarIds: [] },
      { id: 'q2', similarIds: ['q1', 'q3'] },
      { id: 'q3', similarIds: ['q1', 'q2'] },
      { id: 'q5', similarIds: ['q6'] },
      { id: 'q6', similarIds: ['q5'] },
    ];

    const grouped = groupVariantItems(
      items,
      (item) => item.id,
      (item) => item.similarIds,
    );

    expect(grouped.map((item) => item.id)).toEqual(['q1', 'q4', 'q5']);
  });

  it('keeps a variant if its earlier sibling was not in the filtered list', () => {
    // Suppose q1 was filtered out before grouping, so q2 is the first visible member
    const items: StubItem[] = [
      { id: 'q2', similarIds: ['q1', 'q3'] },
      { id: 'q3', similarIds: ['q1', 'q2'] },
    ];

    const grouped = groupVariantItems(
      items,
      (item) => item.id,
      (item) => item.similarIds,
    );

    expect(grouped.map((item) => item.id)).toEqual(['q2']);
  });

  it('does not exclude items that are not in any kept item similarIds', () => {
    // q1 only lists q2; q3 is only in q2's similarIds, so q3 is not accessible from q1's card
    const items: StubItem[] = [
      { id: 'q1', similarIds: ['q2'] },
      { id: 'q2', similarIds: ['q1', 'q3'] },
      { id: 'q3', similarIds: ['q2'] },
    ];

    const grouped = groupVariantItems(
      items,
      (item) => item.id,
      (item) => item.similarIds,
    );

    expect(grouped.map((item) => item.id)).toEqual(['q1', 'q3']);
  });

  it('deduplicates repeated IDs even when similarIds is empty', () => {
    const items: StubItem[] = [
      { id: 'q1', similarIds: [] },
      { id: 'q1', similarIds: [] },
      { id: 'q2', similarIds: [] },
    ];

    const grouped = groupVariantItems(
      items,
      (item) => item.id,
      (item) => item.similarIds,
    );

    expect(grouped.map((item) => item.id)).toEqual(['q1', 'q2']);
  });
});

describe('groupVariantItemsWithCounts & buildQuestionRanges', () => {
  it('tracks collapsed variant counts and builds contiguous 1-based ranges', () => {
    const items: StubItem[] = [
      { id: 'q1', similarIds: ['q2', 'q3', 'q_missing'] },
      { id: 'q4', similarIds: [] },
      { id: 'q2', similarIds: ['q1', 'q3'] },
      { id: 'q3', similarIds: ['q1', 'q2'] },
      { id: 'q5', similarIds: ['q6'] },
      { id: 'q6', similarIds: ['q5'] },
    ];

    const grouped = groupVariantItemsWithCounts(
      items,
      (item) => item.id,
      (item) => item.similarIds,
    );

    expect(grouped.map((g) => ({ id: g.item.id, count: g.count }))).toEqual([
      { id: 'q1', count: 3 },
      { id: 'q4', count: 1 },
      { id: 'q5', count: 2 },
    ]);

    const ranges = buildQuestionRanges(
      grouped.map((g) => g.item.id),
      grouped.map((g) => g.count),
    );
    expect(ranges).toEqual({
      q1: { start: 1, end: 3 },
      q4: { start: 4, end: 4 },
      q5: { start: 5, end: 6 },
    });
  });

  it('supports paged startAt offsets when building ranges', () => {
    const ranges = buildQuestionRanges(['q5', 'q7'], [2, 1], 5);
    expect(ranges).toEqual({
      q5: { start: 5, end: 6 },
      q7: { start: 7, end: 7 },
    });
  });
});

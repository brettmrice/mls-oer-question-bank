import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicsFilterSummaryCard } from '@/components/FilterSidebar';

describe('TopicsFilterSummaryCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fades out loadTimeMs after 3s at 0, fades back in when > 0, and repeats', () => {
    const { rerender } = render(
      <TopicsFilterSummaryCard
        totalQuestions={1000}
        loadedCount={500}
        selectedCount={250}
        loadTimeMs={0}
      />,
    );

    const msSpan = screen.getByText('0 ms');
    expect(msSpan).toHaveClass('opacity-100');

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(msSpan).toHaveClass('opacity-100');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(msSpan).toHaveClass('opacity-0', 'transition-opacity');

    rerender(
      <TopicsFilterSummaryCard
        totalQuestions={1000}
        loadedCount={500}
        selectedCount={250}
        loadTimeMs={42}
      />,
    );
    expect(screen.getByText('42 ms')).toHaveClass('opacity-100', 'transition-none');

    rerender(
      <TopicsFilterSummaryCard
        totalQuestions={1000}
        loadedCount={500}
        selectedCount={250}
        loadTimeMs={0}
      />,
    );
    expect(screen.getByText('0 ms')).toHaveClass('opacity-100');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('0 ms')).toHaveClass('opacity-0');
  });

  it('renders collapse button only when onCollapse is provided and calls it on click', () => {
    const onCollapse = vi.fn();
    const { rerender } = render(
      <TopicsFilterSummaryCard
        totalQuestions={1000}
        loadedCount={500}
        selectedCount={250}
        loadTimeMs={10}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /collapse filters sidebar/i }),
    ).not.toBeInTheDocument();

    rerender(
      <TopicsFilterSummaryCard
        totalQuestions={1000}
        loadedCount={500}
        selectedCount={250}
        loadTimeMs={10}
        onCollapse={onCollapse}
      />,
    );

    const collapseBtn = screen.getByRole('button', {
      name: /collapse filters sidebar/i,
    });
    fireEvent.click(collapseBtn);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});

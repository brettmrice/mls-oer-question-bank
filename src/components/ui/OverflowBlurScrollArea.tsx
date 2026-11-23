import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface OverflowBlurScrollAreaProps {
  children: React.ReactNode;
  className?: string;
  scrollClassName?: string;
  contentClassName?: string;
  fadeClassName?: string;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Scrollable container that renders blurred top/bottom edge indicators
 * whenever content overflows above or below the visible viewport.
 */
export function OverflowBlurScrollArea({
  children,
  className,
  scrollClassName,
  contentClassName,
  fadeClassName = 'h-8',
  scrollRef: externalScrollRef,
}: OverflowBlurScrollAreaProps) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef ?? internalScrollRef;
  const contentRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setCanScrollUp(scrollTop > 1);
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 1);
  }, []);

  useEffect(() => {
    updateOverflow();
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateOverflow);
      return () => window.removeEventListener('resize', updateOverflow);
    }

    const observer = new ResizeObserver(() => {
      updateOverflow();
    });
    if (scrollEl) observer.observe(scrollEl);
    if (contentEl) observer.observe(contentEl);

    return () => observer.disconnect();
  }, [updateOverflow]);

  return (
    <div className={cn('relative min-h-0', className)}>
      <div
        ref={scrollRef}
        onScroll={updateOverflow}
        className={cn('h-full w-full overflow-y-auto', scrollClassName)}
      >
        <div ref={contentRef} className={contentClassName}>
          {children}
        </div>
      </div>

      {canScrollUp && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-[var(--bg-primary)] via-[var(--bg-primary)]/70 to-transparent',
            fadeClassName,
          )}
        />
      )}
      {canScrollDown && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/70 to-transparent',
            fadeClassName,
          )}
        />
      )}
    </div>
  );
}

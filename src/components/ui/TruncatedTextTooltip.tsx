import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const HOVER_DELAY_MS = 180;
const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 6;
const OVERFLOW_TOLERANCE_PX = 1;

interface TooltipState {
  text: string;
  anchorRect: DOMRect;
}

/**
 * Returns true when an element's rendered text is visually truncated by CSS
 * (single-line ellipsis/nowrap overflow or multi-line `-webkit-line-clamp`).
 */
export function isElementTextTruncated(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);

  const isSingleLineClipped =
    style.textOverflow === 'ellipsis' ||
    ((style.overflowX === 'hidden' || style.overflowX === 'clip') &&
      style.whiteSpace === 'nowrap');

  if (isSingleLineClipped && el.scrollWidth > el.clientWidth + OVERFLOW_TOLERANCE_PX) {
    return true;
  }

  const lineClamp = style.getPropertyValue('-webkit-line-clamp');
  if (
    lineClamp &&
    lineClamp !== 'none' &&
    lineClamp !== '0' &&
    el.scrollHeight > el.clientHeight + OVERFLOW_TOLERANCE_PX
  ) {
    return true;
  }

  return false;
}

/**
 * Walks up from the hovered DOM node to find the nearest ancestor (or self)
 * whose text is truncated and does not already provide a native `title`.
 */
export function findTruncatedElement(startEl: Element | null): HTMLElement | null {
  let current: Element | null = startEl;
  while (current && current !== document.body && current !== document.documentElement) {
    if (current instanceof HTMLElement) {
      if (current.hasAttribute('data-truncated-tooltip')) {
        return null;
      }
      const text = (current.dataset.tooltipText ?? current.textContent)?.trim();
      if (text) {
        const hasNativeTitle = Boolean(current.getAttribute('title')?.trim());
        if (!hasNativeTitle && isElementTextTruncated(current)) {
          return current;
        }
      }
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Global hover listener that renders a styled tooltip with the full text
 * whenever the user hovers over any truncated text element in the app.
 */
export function TruncatedTextTooltip(): React.ReactElement | null {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hideTooltip = useCallback(() => {
    clearHoverTimer();
    activeTargetRef.current = null;
    setTooltip(null);
    setCoords(null);
  }, [clearHoverTimer]);

  useEffect(() => {
    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const truncatedEl = findTruncatedElement(target);

      if (truncatedEl === activeTargetRef.current) {
        return;
      }

      clearHoverTimer();

      if (!truncatedEl) {
        activeTargetRef.current = null;
        setTooltip(null);
        setCoords(null);
        return;
      }

      activeTargetRef.current = truncatedEl;
      const fullText = (truncatedEl.dataset.tooltipText ?? truncatedEl.textContent)?.trim() ?? '';
      if (!fullText) {
        activeTargetRef.current = null;
        return;
      }

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (!truncatedEl.isConnected || activeTargetRef.current !== truncatedEl) {
          return;
        }
        setTooltip({
          text: fullText,
          anchorRect: truncatedEl.getBoundingClientRect(),
        });
      }, HOVER_DELAY_MS);
    };

    const handleMouseOut = (event: MouseEvent) => {
      const currentTarget = activeTargetRef.current;
      if (!currentTarget) return;
      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!related || !currentTarget.contains(related)) {
        hideTooltip();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideTooltip();
      }
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    document.addEventListener('pointerdown', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearHoverTimer();
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      document.removeEventListener('pointerdown', hideTooltip);
      window.removeEventListener('scroll', hideTooltip, true);
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clearHoverTimer, hideTooltip]);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return;

    const tipRect = tooltipRef.current.getBoundingClientRect();
    const { anchorRect } = tooltip;

    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - tipRect.width - VIEWPORT_PADDING);
    const left = Math.max(VIEWPORT_PADDING, Math.min(anchorRect.left, maxLeft));

    const aboveTop = anchorRect.top - tipRect.height - ANCHOR_GAP;
    const belowTop = anchorRect.bottom + ANCHOR_GAP;
    let top: number;

    if (aboveTop >= VIEWPORT_PADDING) {
      top = aboveTop;
    } else if (belowTop + tipRect.height <= window.innerHeight - VIEWPORT_PADDING) {
      top = belowTop;
    } else {
      top = Math.max(
        VIEWPORT_PADDING,
        Math.min(aboveTop, window.innerHeight - tipRect.height - VIEWPORT_PADDING),
      );
    }

    setCoords({ left, top });
  }, [tooltip]);

  if (!tooltip || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      data-truncated-tooltip="true"
      style={{
        left: coords ? `${coords.left}px` : `${tooltip.anchorRect.left}px`,
        top: coords ? `${coords.top}px` : `${tooltip.anchorRect.top}px`,
        visibility: coords ? 'visible' : 'hidden',
      }}
      className="pointer-events-none fixed z-[100] max-w-sm break-words whitespace-normal rounded-lg border border-slate-700/80 bg-slate-900/95 px-2.5 py-1.5 text-xs font-normal leading-relaxed text-slate-50 shadow-lg backdrop-blur-xs dark:border-slate-600/80 dark:bg-slate-800/95"
    >
      {tooltip.text}
    </div>,
    document.body,
  );
}

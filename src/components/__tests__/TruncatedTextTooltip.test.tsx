import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TruncatedTextTooltip } from '@/components/ui/TruncatedTextTooltip';

function mockBox(
  el: HTMLElement,
  opts: {
    scrollWidth?: number;
    clientWidth?: number;
    scrollHeight?: number;
    clientHeight?: number;
    rect?: Partial<DOMRect>;
  },
) {
  if (opts.scrollWidth !== undefined) {
    Object.defineProperty(el, 'scrollWidth', { value: opts.scrollWidth, configurable: true });
  }
  if (opts.clientWidth !== undefined) {
    Object.defineProperty(el, 'clientWidth', { value: opts.clientWidth, configurable: true });
  }
  if (opts.scrollHeight !== undefined) {
    Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true });
  }
  if (opts.clientHeight !== undefined) {
    Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true });
  }
  if (opts.rect) {
    el.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 120,
        left: 40,
        right: 200,
        width: 160,
        height: 20,
        x: 40,
        y: 100,
        toJSON: () => ({}),
        ...opts.rect,
      }) as DOMRect;
  }
}

describe('TruncatedTextTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows full text tooltip when hovering a single-line truncated element', () => {
    const fullText = 'Nucleic Acid Structure and Function in Molecular Biology';
    render(
      <div>
        <TruncatedTextTooltip />
        <button
          type="button"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            width: '120px',
          }}
        >
          {fullText}
        </button>
      </div>,
    );

    const btn = screen.getByRole('button', { name: fullText });
    mockBox(btn, { scrollWidth: 320, clientWidth: 120, rect: { top: 100, bottom: 120, left: 20 } });

    fireEvent.mouseOver(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(fullText);

    fireEvent.mouseOut(btn, { relatedTarget: document.body });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not show tooltip when element text is not truncated', () => {
    render(
      <div>
        <TruncatedTextTooltip />
        <span
          data-testid="short-label"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Sugars
        </span>
      </div>,
    );

    const el = screen.getByTestId('short-label');
    mockBox(el, { scrollWidth: 48, clientWidth: 48 });

    fireEvent.mouseOver(el);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows full text when hovering an inner child of a line-clamped element', () => {
    const fullText = 'A long multi-line description that is clamped to two lines in the UI.';
    render(
      <div>
        <TruncatedTextTooltip />
        <p
          data-testid="clamped"
          style={{
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitLineClamp: 2,
          }}
        >
          <span>{fullText}</span>
        </p>
      </div>,
    );

    const p = screen.getByTestId('clamped');
    const innerSpan = p.querySelector('span')!;
    mockBox(p, { scrollHeight: 64, clientHeight: 32 });

    fireEvent.mouseOver(innerSpan);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('tooltip')).toHaveTextContent(fullText);
  });

  it('does not duplicate tooltip when element already has a native title attribute', () => {
    render(
      <div>
        <TruncatedTextTooltip />
        <span
          data-testid="native-titled"
          title="Full ASCP Path"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          ASCP &gt; ... &gt; Path
        </span>
      </div>,
    );

    const el = screen.getByTestId('native-titled');
    mockBox(el, { scrollWidth: 250, clientWidth: 100 });

    fireEvent.mouseOver(el);
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('dismisses tooltip on pointerdown, scroll, and Escape', () => {
    const fullText = 'DNA Replication, Transcription, and Translation';
    render(
      <div>
        <TruncatedTextTooltip />
        <span
          data-testid="trunc"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fullText}
        </span>
      </div>,
    );

    const el = screen.getByTestId('trunc');
    mockBox(el, { scrollWidth: 280, clientWidth: 110 });

    // Dismiss on Escape
    fireEvent.mouseOver(el);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Re-hover then dismiss on scroll
    fireEvent.mouseOut(el, { relatedTarget: document.body });
    fireEvent.mouseOver(el);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Re-hover then dismiss on pointerdown
    fireEvent.mouseOut(el, { relatedTarget: document.body });
    fireEvent.mouseOver(el);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerDown(document);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

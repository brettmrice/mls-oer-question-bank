import { Fragment, type ReactNode } from 'react';

const INLINE_MARKDOWN_RE =
  /\\([*`\\])|`([^`]+)`|\*\*\*([^\s*](?:[^*]*?[^\s*])?)\*\*\*|\*\*([^\s*](?:[^*]*?[^\s*])?)\*\*|\*([^\s*](?:[^*]*?[^\s*])?)\*/g;

/**
 * Parse lightweight inline markdown (`*italic*`, `**bold**`, `***bold italic***`,
 * `` `code` ``, and `\*` escapes) into React nodes without HTML injection.
 */
export function renderInlineMarkdown(text: string, keyPrefix = 'md'): ReactNode {
  if (!text || (!text.includes('*') && !text.includes('`') && !text.includes('\\'))) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let tokenIdx = 0;

  INLINE_MARKDOWN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_MARKDOWN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${tokenIdx++}`;
    if (match[1] !== undefined) {
      nodes.push(match[1]);
    } else if (match[2] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-[var(--bg-primary)] px-1 py-0.5 font-mono text-[0.9em]"
        >
          {match[2]}
        </code>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <strong key={key}>
          <em>{renderInlineMarkdown(match[3], key)}</em>
        </strong>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <strong key={key}>{renderInlineMarkdown(match[4], key)}</strong>,
      );
    } else if (match[5] !== undefined) {
      nodes.push(
        <em key={key}>{renderInlineMarkdown(match[5], key)}</em>,
      );
    }

    lastIndex = INLINE_MARKDOWN_RE.lastIndex;
  }

  if (lastIndex === 0) {
    return text;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.map((node, i) =>
    typeof node === 'string' ? <Fragment key={`${keyPrefix}-t-${i}`}>{node}</Fragment> : node,
  );
}

export function FormattedText({ text }: { text: string }) {
  return <>{renderInlineMarkdown(text)}</>;
}

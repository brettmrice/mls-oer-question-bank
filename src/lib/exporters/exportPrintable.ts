import type { QuestionRecord } from '@/types/question';

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPrintableMarkdown(
  title: string,
  questions: QuestionRecord[],
  customPoints: Record<string, number> = {},
  includeAnswerKey = true,
): string {
  const totalPts = questions.reduce((sum, q) => sum + (customPoints[q.id] ?? 1), 0);
  const lines: string[] = [
    `# ${title}`,
    '',
    `> **License:** CC0 1.0 Public Domain Dedication | **Questions:** ${questions.length} | **Total Points:** ${totalPts}`,
    '',
    '---',
    '',
  ];

  questions.forEach((q, idx) => {
    const pts = customPoints[q.id] ?? 1;
    lines.push(`**${idx + 1}.** *(${pts} pt${pts === 1 ? '' : 's'})* ${q.questionText}`);
    lines.push('');
    for (const opt of q.options) {
      lines.push(`- **${opt.label})** ${opt.text}`);
    }
    lines.push('');
  });

  if (includeAnswerKey) {
    lines.push('---', '', '## Answer Key & Educator Rationales', '');
    questions.forEach((q, idx) => {
      const correct = q.options.find((o) => o.weight === 100) ?? q.options[0];
      lines.push(
        `### ${idx + 1}. Answer: ${correct?.label ?? 'A'} (${q.displayId} • ${q.id})`,
      );
      lines.push(`- **ASCP Path:** ${q.ascpPath}`);
      lines.push(`- **Bloom's / Difficulty:** ${q.bloomLevel} / ${q.difficulty}/10`);
      if (q.objective) lines.push(`- **Objective:** ${q.objective}`);
      for (const opt of q.options) {
        if (opt.feedback) {
          lines.push(`  - **${opt.label})** ${opt.feedback}`);
        }
      }
      if (q.hint) lines.push(`- **Hint:** ${q.hint}`);
      lines.push('');
    });
  }

  return lines.join('\n');
}

export function buildPrintableHtml(
  title: string,
  questions: QuestionRecord[],
  customPoints: Record<string, number> = {},
  includeAnswerKey = true,
): string {
  const totalPts = questions.reduce((sum, q) => sum + (customPoints[q.id] ?? 1), 0);

  const questionsHtml = questions
    .map((q, idx) => {
      const pts = customPoints[q.id] ?? 1;
      const opts = q.options
        .map(
          (o) =>
            `<li><strong>${escapeHtml(o.label)})</strong> ${escapeHtml(o.text)}</li>`,
        )
        .join('');
      return `
        <article class="question">
          <p class="stem"><strong>${idx + 1}.</strong> <span class="pts">(${pts} pt${pts === 1 ? '' : 's'})</span> ${escapeHtml(q.questionText)}</p>
          <ul class="options">${opts}</ul>
        </article>`;
    })
    .join('\n');

  const keyHtml = includeAnswerKey
    ? `
      <section class="answer-key">
        <h2>Answer Key &amp; Educator Rationales</h2>
        ${questions
          .map((q, idx) => {
            const correct = q.options.find((o) => o.weight === 100) ?? q.options[0];
            const fbs = q.options
              .filter((o) => o.feedback)
              .map(
                (o) =>
                  `<li><strong>${escapeHtml(o.label)})</strong> ${escapeHtml(o.feedback)}</li>`,
              )
              .join('');
            return `
              <div class="key-item">
                <p><strong>${idx + 1}. Answer: ${escapeHtml(correct?.label ?? 'A')}</strong> — <code>${escapeHtml(q.displayId)}</code> (${escapeHtml(q.bloomLevel)}, Diff ${q.difficulty}/10)</p>
                <p class="meta">${escapeHtml(q.ascpPath)}</p>
                ${q.objective ? `<p class="meta"><strong>Objective:</strong> ${escapeHtml(q.objective)}</p>` : ''}
                <ul>${fbs}</ul>
                ${q.hint ? `<p class="meta"><strong>Hint:</strong> ${escapeHtml(q.hint)}</p>` : ''}
              </div>`;
          })
          .join('\n')}
      </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)} — MLS OER</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1.25rem; color: #0f172a; line-height: 1.5; }
    header { border-bottom: 2px solid #cbd5e1; padding-bottom: 0.75rem; margin-bottom: 1.5rem; }
    h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
    .subtitle { margin: 0; font-size: 0.85rem; color: #475569; }
    .question { margin-bottom: 1.25rem; break-inside: avoid; }
    .stem { margin: 0 0 0.4rem; }
    .pts { font-size: 0.85rem; color: #475569; }
    .options { list-style: none; padding-left: 1.25rem; margin: 0; }
    .options li { margin-bottom: 0.25rem; }
    .answer-key { page-break-before: always; border-top: 2px solid #cbd5e1; padding-top: 1.5rem; margin-top: 2rem; }
    .key-item { margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid #e2e8f0; break-inside: avoid; }
    .meta { font-size: 0.85rem; color: #475569; margin: 0.2rem 0; }
    @media print { body { margin: 0.5in; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">MLS OER Question Bank (CC0 1.0 Public Domain) • ${questions.length} Questions • ${totalPts} Total Points</p>
  </header>
  ${questionsHtml}
  ${keyHtml}
</body>
</html>
`;
}

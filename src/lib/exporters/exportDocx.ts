import {
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { QuestionRecord } from '@/types/question';

export async function buildDocxBlob(
  title: string,
  description: string,
  questions: QuestionRecord[],
  customPoints: Record<string, number> = {},
): Promise<Blob> {
  const totalPts = questions.reduce((sum, q) => sum + (customPoints[q.id] ?? 1), 0);
  const estMinutes = Math.max(
    questions.length > 0 ? 1 : 0,
    Math.round(
      questions.reduce(
        (sum, q) => sum + (q.bloomLevel === 'AP' || q.bloomLevel === 'AN' ? 1.5 : 1.0),
        0,
      ),
    ),
  );

  const discCounts = new Map<string, { name: string; count: number }>();
  for (const q of questions) {
    const existing = discCounts.get(q.disciplineCode);
    if (existing) {
      existing.count += 1;
    } else {
      discCounts.set(q.disciplineCode, { name: q.disciplineName, count: 1 });
    }
  }

  const summaryRows = [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 55, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: 'ASCP Discipline', bold: true })] })],
        }),
        new TableCell({
          width: { size: 22, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: 'Questions', bold: true })] })],
        }),
        new TableCell({
          width: { size: 23, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: 'Share (%)', bold: true })] })],
        }),
      ],
    }),
    ...Array.from(discCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, info]) => {
        const pct = questions.length > 0 ? ((info.count / questions.length) * 100).toFixed(1) : '0.0';
        return new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(`${code} — ${info.name}`)],
            }),
            new TableCell({
              children: [new Paragraph(String(info.count))],
            }),
            new TableCell({
              children: [new Paragraph(`${pct}%`)],
            }),
          ],
        });
      }),
  ];

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: title, bold: true })],
    }),
    ...(description
      ? [
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: description, italics: true })],
          }),
        ]
      : []),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `MLS OER Question Bank (CC0 1.0 Public Domain) • ${questions.length} Questions • ${totalPts} Total Points • Est. ${estMinutes} min`,
          size: 20,
          color: '475569',
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: summaryRows,
    }),
    new Paragraph({
      spacing: { before: 280, after: 120 },
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Student Assessment', bold: true })],
    }),
  ];

  questions.forEach((q, idx) => {
    const pts = customPoints[q.id] ?? 1;
    children.push(
      new Paragraph({
        spacing: { before: 180, after: 60 },
        children: [
          new TextRun({ text: `${idx + 1}. `, bold: true }),
          new TextRun({ text: `(${pts} pt${pts === 1 ? '' : 's'}) `, italics: true, color: '475569' }),
          new TextRun({ text: q.questionText }),
        ],
      }),
    );
    for (const opt of q.options) {
      children.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 40 },
          children: [
            new TextRun({ text: `${opt.label}) `, bold: true }),
            new TextRun({ text: opt.text }),
          ],
        }),
      );
    }
  });

  // Page break before Educator Answer Key & Rationales
  children.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 160 },
      children: [new TextRun({ text: 'Educator Answer Key & Rationales', bold: true })],
    }),
  );

  questions.forEach((q, idx) => {
    const correct = q.options.find((o) => o.weight === 100) ?? q.options[0];
    children.push(
      new Paragraph({
        spacing: { before: 160, after: 40 },
        children: [
          new TextRun({ text: `${idx + 1}. Answer: ${correct?.label ?? 'A'} `, bold: true }),
          new TextRun({
            text: `(${q.displayId} • ${q.id} • ${q.bloomLevel} • Diff ${q.difficulty}/10)`,
            size: 18,
            color: '475569',
          }),
        ],
      }),
      new Paragraph({
        indent: { left: 240 },
        spacing: { after: 40 },
        children: [
          new TextRun({ text: `ASCP Path: ${q.ascpPath}`, size: 18, color: '475569' }),
        ],
      }),
    );

    if (q.objective) {
      children.push(
        new Paragraph({
          indent: { left: 240 },
          spacing: { after: 40 },
          children: [
            new TextRun({ text: 'Objective: ', bold: true, size: 18 }),
            new TextRun({ text: q.objective, size: 18 }),
          ],
        }),
      );
    }

    for (const opt of q.options) {
      if (!opt.feedback) continue;
      children.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 30 },
          children: [
            new TextRun({ text: `${opt.label}) `, bold: opt.weight === 100, size: 18 }),
            new TextRun({ text: opt.feedback, size: 18 }),
          ],
        }),
      );
    }

    if (q.hint) {
      children.push(
        new Paragraph({
          indent: { left: 240 },
          spacing: { after: 60 },
          children: [
            new TextRun({ text: 'Hint: ', bold: true, size: 18 }),
            new TextRun({ text: q.hint, italics: true, size: 18 }),
          ],
        }),
      );
    }
  });

  const doc = new Document({
    title,
    description,
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

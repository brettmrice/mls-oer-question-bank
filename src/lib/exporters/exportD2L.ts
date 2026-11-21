import type { QuestionRecord } from '@/types/question';

function csvCell(value: string | number): string {
  const str = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow5(
  c1: string | number,
  c2: string | number = '',
  c3: string | number = '',
  c4: string | number = '',
  c5: string | number = '',
): string {
  return [csvCell(c1), csvCell(c2), csvCell(c3), csvCell(c4), csvCell(c5)].join(',');
}

export function buildD2LCsv(
  questions: QuestionRecord[],
  customPoints: Record<string, number> = {},
): string {
  const lines: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const pts = customPoints[q.id] ?? 1;
    const title = `${q.bloomLevel}-${q.leafTopic}-${String(i + 1).padStart(2, '0')}`;

    lines.push(csvRow5('NewQuestion', q.questionType || 'MC'));
    lines.push(csvRow5('ID', q.displayId || q.id));
    lines.push(csvRow5('Title', title));
    lines.push(csvRow5('QuestionText', q.questionText));
    lines.push(csvRow5('Points', pts));
    lines.push(csvRow5('Difficulty', q.difficulty));
    lines.push(csvRow5('Image'));

    for (const opt of q.options) {
      lines.push(csvRow5('Option', opt.weight, opt.text, '', opt.feedback));
    }

    lines.push(csvRow5('Hint', q.hint));
    lines.push(csvRow5('Feedback'));
  }

  return lines.join('\r\n') + (lines.length > 0 ? '\r\n' : '');
}

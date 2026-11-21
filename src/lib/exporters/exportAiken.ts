import type { QuestionRecord } from '@/types/question';

export function buildAikenText(questions: QuestionRecord[]): string {
  const blocks: string[] = [];

  for (const q of questions) {
    const stem = q.questionText.replace(/\r?\n/g, ' ').trim();
    const optLines = q.options.map(
      (opt) => `${opt.label}. ${opt.text.replace(/\r?\n/g, ' ').trim()}`,
    );
    const correct = q.options.find((o) => o.weight === 100) ?? q.options[0];
    const answerLetter = correct ? correct.label : 'A';
    blocks.push([stem, ...optLines, `ANSWER: ${answerLetter}`].join('\n'));
  }

  return blocks.join('\n\n') + (blocks.length > 0 ? '\n' : '');
}

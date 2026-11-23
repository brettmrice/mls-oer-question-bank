import type { QuestionRecord } from '@/types/question';
import { db, type RemixedQuestionRecord } from './db';

function generateRemixId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `remix_${crypto.randomUUID().slice(0, 12)}`;
  }
  return `remix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listAllRemixes(): Promise<RemixedQuestionRecord[]> {
  return db.remixedQuestions.orderBy('updatedAt').toArray();
}

export async function listRemixesForParent(
  parentQuestionId: string,
): Promise<RemixedQuestionRecord[]> {
  return db.remixedQuestions
    .where('parentQuestionId')
    .equals(parentQuestionId)
    .sortBy('createdAt');
}

export async function getRemixedQuestionsByIds(ids: string[]): Promise<QuestionRecord[]> {
  if (ids.length === 0) return [];
  const records = await db.remixedQuestions.bulkGet(ids);
  return records
    .filter((rec): rec is RemixedQuestionRecord => Boolean(rec))
    .map((rec) => rec.question);
}

export interface SaveRemixInput {
  existingId?: string;
  parentQuestionId: string;
  remixedFromId: string;
  question: Omit<QuestionRecord, 'id'> & { id?: string };
  rationaleNote?: string;
  submittedIssueUrl?: string;
  submittedIssueNumber?: number;
}

export async function saveRemixedQuestion(
  input: SaveRemixInput,
): Promise<RemixedQuestionRecord> {
  const now = new Date().toISOString();
  const existing = input.existingId
    ? await db.remixedQuestions.get(input.existingId)
    : undefined;

  const id = existing?.id ?? generateRemixId();
  const displayId = input.question.displayId.includes('REMIX')
    ? input.question.displayId
    : `${input.question.displayId}-REMIX`;

  const question: QuestionRecord = {
    ...input.question,
    id,
    displayId,
  };

  const record: RemixedQuestionRecord = {
    id,
    parentQuestionId: input.parentQuestionId,
    remixedFromId: input.remixedFromId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    rationaleNote: input.rationaleNote?.trim() || existing?.rationaleNote,
    submittedIssueUrl: input.submittedIssueUrl ?? existing?.submittedIssueUrl,
    submittedIssueNumber: input.submittedIssueNumber ?? existing?.submittedIssueNumber,
    question,
  };

  await db.remixedQuestions.put(record);
  return record;
}

export async function deleteRemixedQuestion(id: string): Promise<void> {
  await db.remixedQuestions.delete(id);
}

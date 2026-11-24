import {
  db,
  type QuestionRating,
  type QuizRemixProvenance,
  type QuizWorkspaceRecord,
  type SavedQuestionRecord,
} from '@/lib/db';
import type { MarkFilterTag, MarkQueryConstraint } from '@/types/question';

export const NOTE_MAX_LENGTH = 280;

export function isQuestionMarked(record?: SavedQuestionRecord | null): boolean {
  if (!record) return false;
  return Boolean(
    record.rating === 'good' ||
      record.rating === 'bad' ||
      record.personalNote.trim().length > 0,
  );
}

export function buildMarkQueryConstraint(
  selectedMarks: MarkFilterTag[],
  savedById: Map<string, SavedQuestionRecord>,
): MarkQueryConstraint | undefined {
  if (selectedMarks.length === 0) {
    return undefined;
  }

  const goodIds: string[] = [];
  const badIds: string[] = [];
  const noteIds: string[] = [];
  const allMarkedIds: string[] = [];

  for (const [id, rec] of savedById.entries()) {
    if (!isQuestionMarked(rec)) continue;
    allMarkedIds.push(id);
    if (rec.rating === 'good') goodIds.push(id);
    if (rec.rating === 'bad') badIds.push(id);
    if (rec.personalNote.trim().length > 0) noteIds.push(id);
  }

  const includeSet = new Set<string>();
  if (selectedMarks.includes('good')) goodIds.forEach((id) => includeSet.add(id));
  if (selectedMarks.includes('bad')) badIds.forEach((id) => includeSet.add(id));
  if (selectedMarks.includes('notes')) noteIds.forEach((id) => includeSet.add(id));

  const includeUnmarked = selectedMarks.includes('unmarked');
  return {
    includeIds: Array.from(includeSet),
    includeUnmarked,
    allMarkedIds: includeUnmarked ? allMarkedIds : undefined,
  };
}

export interface BackupStatus {
  unsyncedQuizCount: number;
  unsyncedBookmarkCount: number;
  totalQuizzes: number;
  totalBookmarks: number;
  lastBackupAt: string | null;
  lastGistSyncAt: string | null;
  syncMode: 'local_only' | 'gist_synced';
}

export interface WorkspaceBackupPayload {
  schemaVersion: 1;
  exportedAt: string;
  license: 'CC0-1.0';
  activeQuizId: string | null;
  quizzes: QuizWorkspaceRecord[];
  savedQuestions: SavedQuestionRecord[];
}

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `quiz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listQuizzes(): Promise<QuizWorkspaceRecord[]> {
  return db.quizzes.orderBy('updatedAt').reverse().toArray();
}

export async function getActiveQuizId(): Promise<string | null> {
  const row = await db.appState.get('activeQuizId');
  return typeof row?.value === 'string' ? row.value : null;
}

export async function setActiveQuizId(quizId: string | null): Promise<void> {
  if (quizId === null) {
    await db.appState.delete('activeQuizId');
  } else {
    await db.appState.put({ key: 'activeQuizId', value: quizId });
  }
}

export async function createQuiz(
  name: string,
  description = '',
  options: {
    questionIds?: string[];
    customPoints?: Record<string, number>;
    tags?: string[];
    sourcePrebuiltId?: string;
    remixedFrom?: QuizRemixProvenance;
    activate?: boolean;
  } = {},
): Promise<QuizWorkspaceRecord> {
  const now = new Date().toISOString();
  const dedupedIds = Array.from(new Set(options.questionIds ?? []));
  const record: QuizWorkspaceRecord = {
    id: createUuid(),
    name: name.trim() || 'Untitled Quiz',
    description: description.trim(),
    createdAt: now,
    updatedAt: now,
    questionIds: dedupedIds,
    customPoints: { ...(options.customPoints ?? {}) },
    tags: options.tags ? [...options.tags] : undefined,
    sourcePrebuiltId: options.sourcePrebuiltId,
    remixedFrom: options.remixedFrom,
  };
  await db.quizzes.put(record);
  if (options.activate !== false) {
    await setActiveQuizId(record.id);
  }
  return record;
}

export async function renameQuiz(
  quizId: string,
  name: string,
  description?: string,
): Promise<QuizWorkspaceRecord | null> {
  const existing = await db.quizzes.get(quizId);
  if (!existing) return null;
  const updated: QuizWorkspaceRecord = {
    ...existing,
    name: name.trim() || existing.name,
    description: description !== undefined ? description.trim() : existing.description,
    updatedAt: new Date().toISOString(),
  };
  await db.quizzes.put(updated);
  return updated;
}

export async function duplicateQuiz(
  quizId: string,
  newName?: string,
): Promise<QuizWorkspaceRecord | null> {
  const existing = await db.quizzes.get(quizId);
  if (!existing) return null;
  return createQuiz(newName ?? `${existing.name} (Copy)`, existing.description, {
    questionIds: existing.questionIds,
    customPoints: existing.customPoints,
    tags: existing.tags,
    sourcePrebuiltId: existing.sourcePrebuiltId,
    remixedFrom: existing.remixedFrom,
    activate: true,
  });
}

export async function deleteQuiz(quizId: string): Promise<void> {
  await db.quizzes.delete(quizId);
  const active = await getActiveQuizId();
  if (active === quizId) {
    const remaining = await listQuizzes();
    await setActiveQuizId(remaining[0]?.id ?? null);
  }
}

export async function addQuestionsToQuiz(
  quizId: string,
  questionIds: string[],
): Promise<{ addedCount: number; quiz: QuizWorkspaceRecord | null }> {
  const existing = await db.quizzes.get(quizId);
  if (!existing) return { addedCount: 0, quiz: null };

  const currentSet = new Set(existing.questionIds);
  const toAdd = Array.from(new Set(questionIds)).filter((id) => !currentSet.has(id));
  if (toAdd.length === 0) {
    return { addedCount: 0, quiz: existing };
  }

  const updated: QuizWorkspaceRecord = {
    ...existing,
    questionIds: [...existing.questionIds, ...toAdd],
    updatedAt: new Date().toISOString(),
  };
  await db.quizzes.put(updated);
  return { addedCount: toAdd.length, quiz: updated };
}

export async function removeQuestionFromQuiz(
  quizId: string,
  questionId: string,
): Promise<QuizWorkspaceRecord | null> {
  const existing = await db.quizzes.get(quizId);
  if (!existing) return null;

  const nextPoints = { ...existing.customPoints };
  delete nextPoints[questionId];
  const updated: QuizWorkspaceRecord = {
    ...existing,
    questionIds: existing.questionIds.filter((id) => id !== questionId),
    customPoints: nextPoints,
    updatedAt: new Date().toISOString(),
  };
  await db.quizzes.put(updated);
  return updated;
}

export async function reorderQuizQuestion(
  quizId: string,
  fromIndex: number,
  toIndex: number,
): Promise<QuizWorkspaceRecord | null> {
  const existing = await db.quizzes.get(quizId);
  if (!existing) return null;
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= existing.questionIds.length ||
    toIndex >= existing.questionIds.length ||
    fromIndex === toIndex
  ) {
    return existing;
  }

  const nextIds = [...existing.questionIds];
  const [moved] = nextIds.splice(fromIndex, 1);
  nextIds.splice(toIndex, 0, moved);

  const updated: QuizWorkspaceRecord = {
    ...existing,
    questionIds: nextIds,
    updatedAt: new Date().toISOString(),
  };
  await db.quizzes.put(updated);
  return updated;
}

export async function swapQuizQuestion(
  quizId: string,
  oldQuestionId: string,
  newQuestionId: string,
): Promise<QuizWorkspaceRecord | null> {
  const existing = await db.quizzes.get(quizId);
  if (!existing) return null;
  const idx = existing.questionIds.indexOf(oldQuestionId);
  if (idx === -1 || oldQuestionId === newQuestionId) return existing;

  const nextIds = existing.questionIds.filter(
    (id, i) => i === idx || id !== newQuestionId,
  );
  const replacedIdx = nextIds.indexOf(oldQuestionId);
  if (replacedIdx !== -1) {
    nextIds[replacedIdx] = newQuestionId;
  }

  const nextPoints = { ...existing.customPoints };
  if (nextPoints[oldQuestionId] !== undefined) {
    nextPoints[newQuestionId] = nextPoints[oldQuestionId];
    delete nextPoints[oldQuestionId];
  }

  const updated: QuizWorkspaceRecord = {
    ...existing,
    questionIds: nextIds,
    customPoints: nextPoints,
    updatedAt: new Date().toISOString(),
  };
  await db.quizzes.put(updated);
  return updated;
}

export async function setQuestionPoints(
  quizId: string,
  questionId: string,
  points: number,
): Promise<QuizWorkspaceRecord | null> {
  const existing = await db.quizzes.get(quizId);
  if (!existing) return null;
  const clamped = Number.isFinite(points) && points > 0 ? Math.round(points * 100) / 100 : 1;

  const updated: QuizWorkspaceRecord = {
    ...existing,
    customPoints: { ...existing.customPoints, [questionId]: clamped },
    updatedAt: new Date().toISOString(),
  };
  await db.quizzes.put(updated);
  return updated;
}

export async function listSavedQuestions(): Promise<SavedQuestionRecord[]> {
  return db.savedQuestions.orderBy('bookmarkedAt').reverse().toArray();
}

export async function toggleSavedQuestion(questionId: string): Promise<boolean> {
  const existing = await db.savedQuestions.get(questionId);
  if (existing) {
    await db.savedQuestions.delete(questionId);
    return false;
  }
  await db.savedQuestions.put({
    questionId,
    bookmarkedAt: new Date().toISOString(),
    personalNote: '',
  });
  return true;
}

export async function updateSavedNote(
  questionId: string,
  personalNote: string,
): Promise<void> {
  const existing = await db.savedQuestions.get(questionId);
  await db.savedQuestions.put({
    questionId,
    bookmarkedAt: existing?.bookmarkedAt ?? new Date().toISOString(),
    personalNote: personalNote.slice(0, NOTE_MAX_LENGTH),
    rating: existing?.rating ?? null,
  });
}

export async function updateQuestionMark(
  questionId: string,
  patch: {
    rating?: QuestionRating | null;
    personalNote?: string;
  },
): Promise<SavedQuestionRecord | null> {
  const existing = await db.savedQuestions.get(questionId);
  const next: SavedQuestionRecord = {
    questionId,
    bookmarkedAt: existing?.bookmarkedAt ?? new Date().toISOString(),
    personalNote: (patch.personalNote !== undefined
      ? patch.personalNote
      : existing?.personalNote ?? ''
    ).slice(0, NOTE_MAX_LENGTH),
    rating: patch.rating !== undefined ? patch.rating : existing?.rating ?? null,
  };

  if (!isQuestionMarked(next)) {
    await db.savedQuestions.delete(questionId);
    return null;
  }

  await db.savedQuestions.put(next);
  return next;
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const [quizzes, bookmarks, backupRow, gistRow] = await Promise.all([
    db.quizzes.toArray(),
    db.savedQuestions.toArray(),
    db.appState.get('lastBackupAt'),
    db.appState.get('lastGistSyncAt'),
  ]);

  const lastBackupAt = typeof backupRow?.value === 'string' ? backupRow.value : null;
  const lastGistSyncAt = typeof gistRow?.value === 'string' ? gistRow.value : null;

  const latestSafeMs = Math.max(
    lastBackupAt ? Date.parse(lastBackupAt) : 0,
    lastGistSyncAt ? Date.parse(lastGistSyncAt) : 0,
  );

  const unsyncedQuizCount = quizzes.filter(
    (q) => Date.parse(q.updatedAt) > latestSafeMs,
  ).length;
  const unsyncedBookmarkCount = bookmarks.filter(
    (b) => Date.parse(b.bookmarkedAt) > latestSafeMs,
  ).length;

  return {
    unsyncedQuizCount,
    unsyncedBookmarkCount,
    totalQuizzes: quizzes.length,
    totalBookmarks: bookmarks.length,
    lastBackupAt,
    lastGistSyncAt,
    syncMode: lastGistSyncAt ? 'gist_synced' : 'local_only',
  };
}

export async function exportWorkspaceBackupJson(): Promise<string> {
  const [quizzes, savedQuestions, activeQuizId] = await Promise.all([
    listQuizzes(),
    listSavedQuestions(),
    getActiveQuizId(),
  ]);
  const exportedAt = new Date().toISOString();
  await db.appState.put({ key: 'lastBackupAt', value: exportedAt });

  const payload: WorkspaceBackupPayload = {
    schemaVersion: 1,
    exportedAt,
    license: 'CC0-1.0',
    activeQuizId,
    quizzes,
    savedQuestions,
  };
  return JSON.stringify(payload, null, 2);
}

export async function importWorkspaceBackupJson(
  jsonText: string,
  mode: 'merge' | 'replace' = 'merge',
): Promise<{ importedQuizzes: number; importedBookmarks: number }> {
  const parsed = JSON.parse(jsonText) as Partial<WorkspaceBackupPayload>;
  if (!parsed || !Array.isArray(parsed.quizzes)) {
    throw new Error('Invalid MLS OER backup JSON: missing quizzes array.');
  }
  const bookmarks = Array.isArray(parsed.savedQuestions) ? parsed.savedQuestions : [];
  const now = new Date().toISOString();

  await db.transaction('rw', db.quizzes, db.savedQuestions, db.appState, async () => {
    if (mode === 'replace') {
      await db.quizzes.clear();
      await db.savedQuestions.clear();
    }
    for (const quiz of parsed.quizzes!) {
      if (!quiz?.id || !quiz?.name || !Array.isArray(quiz.questionIds)) continue;
      await db.quizzes.put({
        ...quiz,
        customPoints: quiz.customPoints ?? {},
      });
    }
    for (const bm of bookmarks) {
      if (!bm?.questionId) continue;
      await db.savedQuestions.put(bm);
    }
    if (parsed.activeQuizId) {
      await db.appState.put({ key: 'activeQuizId', value: parsed.activeQuizId });
    }
    await db.appState.put({ key: 'lastBackupAt', value: now });
  });

  return {
    importedQuizzes: parsed.quizzes.length,
    importedBookmarks: bookmarks.length,
  };
}

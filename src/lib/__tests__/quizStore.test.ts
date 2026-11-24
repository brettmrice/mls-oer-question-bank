import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { clonePrebuiltToWorkspace } from '@/lib/prebuiltShare';
import {
  addQuestionsToQuiz,
  buildMarkQueryConstraint,
  createQuiz,
  deleteQuiz,
  duplicateQuiz,
  exportWorkspaceBackupJson,
  getActiveQuizId,
  getBackupStatus,
  importWorkspaceBackupJson,
  isQuestionMarked,
  listQuizzes,
  NOTE_MAX_LENGTH,
  renameQuiz,
  reorderQuizQuestion,
  setQuestionPoints,
  swapQuizQuestion,
  toggleSavedQuestion,
  updateQuestionMark,
} from '@/lib/quizStore';

describe('quizStore', () => {
  beforeEach(async () => {
    await db.quizzes.clear();
    await db.savedQuestions.clear();
    await db.appState.clear();
  });

  it('supports multi-quiz CRUD, deduplication, reordering, swapping, and point customization', async () => {
    const qz1 = await createQuiz('Fall Hematology Midterm');
    const qz2 = await createQuiz('BB_01 Donor Review');

    expect(await getActiveQuizId()).toBe(qz2.id);
    expect((await listQuizzes()).map((q) => q.id)).toContain(qz1.id);

    // Add deduplicates identical IDs
    const addRes = await addQuestionsToQuiz(qz2.id, ['q_1', 'q_2', 'q_1', 'q_3']);
    expect(addRes.addedCount).toBe(3);
    expect(addRes.quiz?.questionIds).toEqual(['q_1', 'q_2', 'q_3']);

    // Reorder q_3 to index 0
    const reordered = await reorderQuizQuestion(qz2.id, 2, 0);
    expect(reordered?.questionIds).toEqual(['q_3', 'q_1', 'q_2']);

    // Set points and swap q_1 -> q_99 (preserves customPoints)
    await setQuestionPoints(qz2.id, 'q_1', 2.5);
    const swapped = await swapQuizQuestion(qz2.id, 'q_1', 'q_99');
    expect(swapped?.questionIds).toEqual(['q_3', 'q_99', 'q_2']);
    expect(swapped?.customPoints['q_99']).toBe(2.5);
    expect(swapped?.customPoints['q_1']).toBeUndefined();

    // Rename, duplicate, and delete
    const renamed = await renameQuiz(qz1.id, 'Heme Final');
    expect(renamed?.name).toBe('Heme Final');

    const copy = await duplicateQuiz(qz2.id, 'BB_01 Copy');
    expect(copy?.questionIds).toEqual(['q_3', 'q_99', 'q_2']);

    await deleteQuiz(copy!.id);
    expect((await listQuizzes()).length).toBe(2);
  });

  it('tracks unsynced changes and supports JSON backup/restore + Pre-Built clone attribution', async () => {
    await createQuiz('Quiz Alpha', 'Desc', { questionIds: ['q_a', 'q_b'] });
    await toggleSavedQuestion('q_a');

    const statusBefore = await getBackupStatus();
    expect(statusBefore.syncMode).toBe('local_only');
    expect(statusBefore.unsyncedQuizCount).toBe(1);
    expect(statusBefore.unsyncedBookmarkCount).toBe(1);

    const backupJson = await exportWorkspaceBackupJson();
    const statusAfter = await getBackupStatus();
    expect(statusAfter.unsyncedQuizCount).toBe(0);
    expect(statusAfter.unsyncedBookmarkCount).toBe(0);

    await db.quizzes.clear();
    await db.savedQuestions.clear();

    const imported = await importWorkspaceBackupJson(backupJson, 'replace');
    expect(imported.importedQuizzes).toBe(1);
    expect(imported.importedBookmarks).toBe(1);

    const remixed = await clonePrebuiltToWorkspace(
      {
        title: 'Exit Exam 1',
        description: 'Comprehensive MLS exam',
        author: 'Augusta University',
        tags: ['A1_EE-A1'],
        questionIds: ['q_x', 'q_y'],
        license: 'CC0-1.0',
      },
      'prebuilt_a1_ee-a1',
      'https://example.org/#prebuilt=catalog:prebuilt_a1_ee-a1',
    );

    expect(remixed.name).toBe('Exit Exam 1 (Remix)');
    expect(remixed.sourcePrebuiltId).toBe('prebuilt_a1_ee-a1');
    expect(remixed.remixedFrom?.title).toBe('Exit Exam 1');
    expect(remixed.remixedFrom?.author).toBe('Augusta University');
    expect(remixed.questionIds).toEqual(['q_x', 'q_y']);
  });

  it('manages question marks, note length limits, auto-cleanup, and filter constraints', async () => {
    const longNote = 'x'.repeat(NOTE_MAX_LENGTH + 25);
    const saved = await updateQuestionMark('q_1', {
      rating: 'good',
      personalNote: longNote,
    });
    expect(saved).not.toBeNull();
    expect(saved?.personalNote.length).toBe(NOTE_MAX_LENGTH);
    expect(isQuestionMarked(saved)).toBe(true);

    const badRec = await updateQuestionMark('q_2', { rating: 'bad' });
    expect(badRec?.rating).toBe('bad');

    const map = new Map<string, NonNullable<typeof saved>>();
    if (saved) map.set('q_1', saved);
    if (badRec) map.set('q_2', badRec);

    expect(buildMarkQueryConstraint([], map)).toBeUndefined();
    expect(buildMarkQueryConstraint(['good'], map)).toEqual({
      includeIds: ['q_1'],
      includeUnmarked: false,
      allMarkedIds: undefined,
    });
    expect(buildMarkQueryConstraint(['unmarked'], map)).toEqual({
      includeIds: [],
      includeUnmarked: true,
      allMarkedIds: ['q_1', 'q_2'],
    });

    // Clearing all marks removes the record from IndexedDB
    const cleared = await updateQuestionMark('q_1', { rating: null, personalNote: '' });
    expect(cleared).toBeNull();
    expect(await db.savedQuestions.get('q_1')).toBeUndefined();
  });
});

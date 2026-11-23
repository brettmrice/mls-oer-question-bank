import Dexie, { type Table } from 'dexie';
import type { QuestionRecord } from '@/types/question';

export interface DownloadedShardRecord {
  shardId: string;
  topicCode: string;
  vecSha256: string;
  idsSha256: string;
  totalBytes: number;
  cachedAt: string;
}

export interface QuizRemixProvenance {
  title: string;
  author?: string;
  shareUrl?: string;
  remixedAt: string;
}

export interface QuizWorkspaceRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  questionIds: string[];
  customPoints: Record<string, number>;
  tags?: string[];
  sourcePrebuiltId?: string;
  remixedFrom?: QuizRemixProvenance;
  lastSyncedAt?: string;
}

export interface SavedQuestionRecord {
  questionId: string;
  bookmarkedAt: string;
  personalNote: string;
}

export interface AppStateRecord {
  key: string;
  value: unknown;
}

export interface RemixedQuestionRecord {
  id: string;
  parentQuestionId: string;
  remixedFromId: string;
  createdAt: string;
  updatedAt: string;
  rationaleNote?: string;
  submittedIssueUrl?: string;
  submittedIssueNumber?: number;
  question: QuestionRecord;
}

export class MlsOerDb extends Dexie {
  downloadedShards!: Table<DownloadedShardRecord, string>;
  quizzes!: Table<QuizWorkspaceRecord, string>;
  savedQuestions!: Table<SavedQuestionRecord, string>;
  appState!: Table<AppStateRecord, string>;
  remixedQuestions!: Table<RemixedQuestionRecord, string>;

  constructor() {
    super('MlsOerQuestionBankDB');
    this.version(1).stores({
      downloadedShards: 'shardId, topicCode, vecSha256, cachedAt',
      quizzes: 'id, name, updatedAt',
      savedQuestions: 'questionId, bookmarkedAt',
      appState: 'key',
    });
    this.version(2).stores({
      downloadedShards: 'shardId, topicCode, vecSha256, cachedAt',
      quizzes: 'id, name, updatedAt',
      savedQuestions: 'questionId, bookmarkedAt',
      appState: 'key',
      remixedQuestions: 'id, parentQuestionId, updatedAt',
    });
  }
}

export const db = new MlsOerDb();

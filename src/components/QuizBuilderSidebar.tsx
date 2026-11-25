import React from 'react';
import {
  ChevronsRight,
  ClipboardList,
  Layers,
  Plus,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui/primitives';
import type { BackupStatus } from '@/lib/quizStore';
import type { ManifestData } from '@/types/question';

export interface QuizBuilderSidebarProps {
  manifest: ManifestData | null;
  activeView: 'explore' | 'prebuilt' | 'practice';
  quizCount: number;
  activeQuizQuestionCount: number;
  backupStatus: BackupStatus | null;
  onSelectPrebuilt: () => void;
  onOpenMyQuizzes: () => void;
  onCreateNewQuiz: () => void;
  onCollapse?: () => void;
}

export function QuizBuilderSidebar({
  manifest,
  activeView,
  quizCount,
  activeQuizQuestionCount,
  backupStatus,
  onSelectPrebuilt,
  onOpenMyQuizzes,
  onCreateNewQuiz,
  onCollapse,
}: QuizBuilderSidebarProps): React.ReactElement {
  const prebuiltCount = manifest?.prebuiltCatalog?.count ?? 0;
  const unsyncedCount =
    (backupStatus?.unsyncedQuizCount ?? 0) + (backupStatus?.unsyncedBookmarkCount ?? 0);

  return (
    <>
      {/* Top Section: Fixed Quiz Builder Title */}
      <Card className="relative shrink-0 p-4 flex items-center justify-center gap-2.5">
        <ClipboardList
          className="h-6 w-6 shrink-0 text-[var(--text-secondary)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">
          Quiz Builder
        </h2>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse Quiz Builder sidebar"
            title="Collapse Quiz Builder"
            className="absolute right-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </Card>

      {/* Middle Section: Primary Actions + Empty Space */}
      <div
        className="min-h-0 flex-1 flex flex-col gap-3"
        role="navigation"
        aria-label="Quiz Builder primary actions"
      >
        <Button
          variant="outline"
          disabled={!manifest}
          onClick={onSelectPrebuilt}
          className={
            activeView === 'prebuilt'
              ? 'h-12 w-full justify-between px-4 text-sm bg-[var(--cream-surface)] text-[var(--cream-text)] border-[var(--cream-border)] hover:bg-[var(--cream-surface-hover)] font-semibold'
              : 'h-12 w-full justify-between px-4 text-sm'
          }
        >
          <span className="flex items-center gap-2.5">
            <Layers className="h-4 w-4 text-[var(--text-secondary)]" />
            Pre-Built
          </span>
          {prebuiltCount > 0 && (
            <Badge variant="accent" className="text-[11px] px-2 py-0.5">
              {prebuiltCount}
            </Badge>
          )}
        </Button>

        <Button
          variant="outline"
          onClick={onOpenMyQuizzes}
          className="h-12 w-full justify-between px-4 text-sm"
        >
          <span className="flex items-center gap-2.5">
            <ClipboardList className="h-4 w-4 text-[var(--text-secondary)]" />
            My Quizzes
          </span>
          <span className="flex items-center gap-1.5">
            {quizCount > 0 && (
              <Badge variant="accent" className="text-[11px] px-2 py-0.5">
                {quizCount} ({activeQuizQuestionCount})
              </Badge>
            )}
            {unsyncedCount > 0 && (
              <span
                title={`${unsyncedCount} unsaved change(s) since last backup`}
                className="h-2 w-2 rounded-full bg-amber-500"
              />
            )}
          </span>
        </Button>

        <Button
          variant="outline"
          onClick={onCreateNewQuiz}
          className="h-12 w-full justify-start px-4 text-sm"
        >
          <Plus className="h-4 w-4 text-[var(--text-secondary)]" />
          New Quiz
        </Button>
      </div>
    </>
  );
}

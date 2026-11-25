import React from 'react';
import {
  ClipboardList,
  HardDrive,
  Layers,
  MessageSquarePlus,
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
  onOpenLocalStorage: () => void;
  onOpenFeedback: () => void;
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
  onOpenLocalStorage,
  onOpenFeedback,
}: QuizBuilderSidebarProps): React.ReactElement {
  const prebuiltCount = manifest?.prebuiltCatalog?.count ?? 0;
  const unsyncedCount =
    (backupStatus?.unsyncedQuizCount ?? 0) + (backupStatus?.unsyncedBookmarkCount ?? 0);

  return (
    <>
      {/* Top Section: Fixed Quiz Builder Title */}
      <Card className="shrink-0 p-4 flex items-center justify-center gap-4">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">
          Quiz Builder
        </h2>
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

      {/* Bottom Section: Local Only + Feedback */}
      <Card className="shrink-0 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenLocalStorage}
            title="No cloud user database — click to view IndexedDB storage notice and JSON backup options"
            className="w-full justify-start text-[var(--text-secondary)]"
          >
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
            <span className="truncate">
              {backupStatus?.syncMode === 'gist_synced' ? 'Gist Synced' : 'Local Only'}
            </span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenFeedback}
            className="w-full justify-start"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
            <span className="truncate">Feedback</span>
          </Button>
        </div>
      </Card>
    </>
  );
}

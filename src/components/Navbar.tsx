import React from 'react';
import {
  BookOpen,
  ClipboardList,
  Database,
  HardDrive,
  Layers,
  MessageSquarePlus,
  Sparkles,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui/primitives';
import type { BackupStatus } from '@/lib/quizStore';
import type { ManifestData } from '@/types/question';

export interface NavbarProps {
  manifest: ManifestData | null;
  activeView: 'explore' | 'prebuilt' | 'practice';
  activeSemanticShardCount: number;
  quizCount: number;
  activeQuizQuestionCount: number;
  backupStatus: BackupStatus | null;
  githubUsername?: string | null;
  onSelectView: (view: 'explore' | 'prebuilt') => void;
  onOpenSemanticModal: () => void;
  onOpenQuizManager: () => void;
  onOpenFeedback: () => void;
  onNotice?: (message: string) => void;
}

export function Navbar({
  manifest,
  activeView,
  activeSemanticShardCount,
  quizCount,
  activeQuizQuestionCount,
  backupStatus,
  githubUsername = null,
  onSelectView,
  onOpenSemanticModal,
  onOpenQuizManager,
  onOpenFeedback,
}: NavbarProps): React.ReactElement {
  const prebuiltCount = manifest?.prebuiltCatalog?.count ?? 0;
  const unsyncedCount =
    (backupStatus?.unsyncedQuizCount ?? 0) + (backupStatus?.unsyncedBookmarkCount ?? 0);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                MLS OER Question Bank
              </h1>
              <Badge variant="accent" className="font-mono text-[11px]">
                {manifest?.license ?? 'CC0-1.0'}
              </Badge>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Database className="h-3.5 w-3.5 text-slate-400" />
              {manifest ? (
                <span>
                  <strong className="font-semibold text-slate-700">
                    {manifest.totalQuestions.toLocaleString()}
                  </strong>{' '}
                  Questions across{' '}
                  <strong className="font-semibold text-slate-700">
                    {manifest.shards.length}
                  </strong>{' '}
                  ASCP Topics
                </span>
              ) : (
                <span>Loading ASCP Question Pool...</span>
              )}
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Primary navigation">
          <Button
            variant={activeView === 'explore' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => onSelectView('explore')}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Explore Bank
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!manifest}
            onClick={onOpenSemanticModal}
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            Semantic Search
            {activeSemanticShardCount > 0 ? (
              <Badge className="ml-0.5 bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">
                {activeSemanticShardCount} active
              </Badge>
            ) : (
              <Badge className="ml-0.5 text-[10px] px-1.5 py-0">Opt-In</Badge>
            )}
          </Button>
          <Button
            variant={activeView === 'prebuilt' ? 'primary' : 'outline'}
            size="sm"
            disabled={!manifest}
            onClick={() => onSelectView('prebuilt')}
          >
            <Layers className="h-3.5 w-3.5 text-emerald-600" />
            Pre-Built Quizzes
            {prebuiltCount > 0 && (
              <Badge variant="accent" className="ml-0.5 text-[10px] px-1.5 py-0">
                {prebuiltCount}
              </Badge>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenQuizManager}>
            <ClipboardList className="h-3.5 w-3.5 text-amber-600" />
            My Quizzes
            {quizCount > 0 && (
              <Badge variant="accent" className="ml-0.5 text-[10px] px-1.5 py-0">
                {quizCount} ({activeQuizQuestionCount})
              </Badge>
            )}
            {unsyncedCount > 0 && (
              <span
                title={`${unsyncedCount} unsaved change(s) since last backup`}
                className="ml-0.5 h-2 w-2 rounded-full bg-amber-500"
              />
            )}
          </Button>
          <button
            type="button"
            onClick={onOpenQuizManager}
            title="No cloud user database — click to view IndexedDB storage notice and JSON backup options"
            className="hidden xl:inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <HardDrive className="h-3 w-3 text-slate-500" />
            {backupStatus?.syncMode === 'gist_synced' ? 'Gist Synced' : 'Local Only'}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenFeedback}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            <span>Feedback</span>
            {githubUsername && (
              <Badge variant="accent" className="ml-0.5 text-[10px] px-1.5 py-0">
                @{githubUsername}
              </Badge>
            )}
          </Button>
        </nav>
      </div>
    </header>
  );
}

import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  ClipboardList,
  HardDrive,
  HelpCircle,
  Layers,
  MessageSquarePlus,
  Moon,
  Sun,
  X,
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
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onSelectView: (view: 'explore' | 'prebuilt') => void;
  onOpenSemanticModal: () => void;
  onOpenQuizManager: () => void;
  onOpenFeedback: () => void;
  onNotice?: (message: string) => void;
}

export function Navbar({
  manifest,
  activeView,
  quizCount,
  activeQuizQuestionCount,
  backupStatus,
  githubUsername = null,
  theme = 'light',
  onToggleTheme,
  onSelectView,
  onOpenQuizManager,
  onOpenFeedback,
}: NavbarProps): React.ReactElement {
  const [aboutOpen, setAboutOpen] = useState(false);
  const prebuiltCount = manifest?.prebuiltCatalog?.count ?? 0;
  const unsyncedCount =
    (backupStatus?.unsyncedQuizCount ?? 0) + (backupStatus?.unsyncedBookmarkCount ?? 0);

  useEffect(() => {
    if (!aboutOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAboutOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [aboutOpen]);

  return (
    <>
    <header className="sticky top-0 z-30 border-b border-[var(--border-color)] bg-[var(--bg-surface-blur)] backdrop-blur-sm transition-colors">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setAboutOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setAboutOpen(true);
            }
          }}
          aria-label="About OER Question Bank"
          title="About OER Question Bank"
          className="group flex cursor-pointer items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--cream-border)] bg-[var(--cream-surface)] text-[var(--cream-text)] shadow-xs transition-colors group-hover:bg-[var(--cream-surface-hover)]">
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-base font-bold tracking-tight text-[var(--text-primary)] sm:text-lg">
              OER Question Bank
            </h1>
            <HelpCircle
              className="h-4 w-4 text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]"
              aria-hidden="true"
            />
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Primary navigation">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelectView('explore')}
            className={
              activeView === 'explore'
                ? 'bg-[var(--cream-surface)] text-[var(--cream-text)] border-[var(--cream-border)] hover:bg-[var(--cream-surface-hover)] font-semibold'
                : ''
            }
          >
            <BookOpen className="h-3.5 w-3.5" />
            Explore Bank
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!manifest}
            onClick={() => onSelectView('prebuilt')}
            className={
              activeView === 'prebuilt'
                ? 'bg-[var(--cream-surface)] text-[var(--cream-text)] border-[var(--cream-border)] hover:bg-[var(--cream-surface-hover)] font-semibold'
                : ''
            }
          >
            <Layers className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Pre-Built Quizzes
            {prebuiltCount > 0 && (
              <Badge variant="accent" className="ml-0.5 text-[10px] px-1.5 py-0">
                {prebuiltCount}
              </Badge>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenQuizManager}>
            <ClipboardList className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
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
            className="hidden xl:inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--cream-surface-soft)] cursor-pointer transition-colors"
          >
            <HardDrive className="h-3 w-3 text-[var(--text-secondary)]" />
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
          {onToggleTheme && (
            <Button
              variant="outline"
              size="icon"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-[#EFE1CE]" />
              ) : (
                <Moon className="h-4 w-4 text-[#363945]" />
              )}
            </Button>
          )}
        </nav>
      </div>
    </header>

    {aboutOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="About OER Question Bank"
      >
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-[1px]"
          onClick={() => setAboutOpen(false)}
          aria-hidden="true"
        />
        <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--cream-border)] bg-[var(--cream-surface)] text-[var(--cream-text)]">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  About OER Question Bank
                </h2>
                <Badge
                  variant="outline"
                  className="font-mono text-[11px] border-[var(--cream-border)] bg-[var(--cream-surface)] text-[var(--cream-text)]"
                >
                  {manifest?.license ?? 'CC0-1.0'}
                </Badge>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAboutOpen(false)}
              aria-label="Close modal"
              className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--cream-surface-soft)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto px-6 py-4 text-sm text-[var(--text-secondary)]">
            <p className="text-[var(--text-primary)]">
              An Open Educational Resource (OER) question bank for Medical Laboratory Science (MLS)
              educators and students, aligned with ASCP Board of Certification (BOC) content
              guidelines.
            </p>
            {manifest && (
              <p className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs">
                Currently loaded:{' '}
                <strong className="font-semibold text-[var(--text-primary)]">
                  {manifest.totalQuestions.toLocaleString()}
                </strong>{' '}
                questions across{' '}
                <strong className="font-semibold text-[var(--text-primary)]">
                  {manifest.shards.length}
                </strong>{' '}
                ASCP topics.
              </p>
            )}
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-[var(--text-primary)]">Explore Bank:</strong> Browse and
                filter questions by ASCP topic, difficulty, and keywords.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Pre-Built Quizzes:</strong> Practice
                with curated topic and blueprint quizzes.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">My Quizzes:</strong> Build custom
                quizzes, remix questions, and export to Word (.docx), QTI, or JSON.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Local-First Privacy:</strong> Your
                quizzes and bookmarks stay in your browser&apos;s IndexedDB with optional JSON backup
                or GitHub Gist sync.
              </li>
            </ul>
          </div>

          <div className="flex justify-end border-t border-[var(--border-color)] px-6 py-3">
            <Button variant="outline" size="sm" onClick={() => setAboutOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Github,
  HelpCircle,
  Loader2,
  LogOut,
  MessageCircle,
  Moon,
  Sun,
  User,
  X,
} from 'lucide-react';
import { Badge, Button, Separator } from '@/components/ui/primitives';
import type { GitHubSession } from '@/lib/githubAuth';
import type { BackupStatus } from '@/lib/quizStore';
import type { ManifestData } from '@/types/question';

export interface NavbarProps {
  manifest: ManifestData | null;
  activeView: 'explore' | 'prebuilt' | 'practice';
  activeSemanticShardCount: number;
  quizCount: number;
  activeQuizQuestionCount: number;
  backupStatus: BackupStatus | null;
  githubSession?: GitHubSession | null;
  githubAuthBusy?: boolean;
  githubUsername?: string | null;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onSelectView: (view: 'explore' | 'prebuilt') => void;
  onOpenSemanticModal: () => void;
  onOpenQuizManager: () => void;
  onOpenFeedback: () => void;
  onGitHubLogin?: () => void;
  onGitHubLogout?: () => void;
  onOpenMobileQuizBuilder?: () => void;
  onNotice?: (message: string) => void;
}

export function Navbar({
  manifest,
  activeView,
  backupStatus,
  githubSession = null,
  githubAuthBusy = false,
  githubUsername = null,
  theme = 'light',
  onToggleTheme,
  onSelectView,
  onOpenQuizManager,
  onOpenFeedback,
  onGitHubLogin,
  onGitHubLogout,
  onOpenMobileQuizBuilder,
}: NavbarProps): React.ReactElement {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const effectiveUsername = githubSession?.username ?? githubUsername ?? null;
  const unsyncedCount =
    (backupStatus?.unsyncedQuizCount ?? 0) + (backupStatus?.unsyncedBookmarkCount ?? 0);

  useEffect(() => {
    if (!aboutOpen && !profileOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAboutOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [aboutOpen, profileOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileOpen]);

  useEffect(() => {
    if (!effectiveUsername) {
      setProfileOpen(false);
    }
  }, [effectiveUsername]);

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
          {onOpenMobileQuizBuilder && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenMobileQuizBuilder}
              className="lg:hidden"
            >
              <ClipboardList className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Quiz Builder
              {unsyncedCount > 0 && (
                <span
                  title={`${unsyncedCount} unsaved change(s) since last backup`}
                  className="ml-0.5 h-2 w-2 rounded-full bg-amber-500"
                />
              )}
            </Button>
          )}
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
          {onGitHubLogin && (
            <div className="relative flex items-center gap-1.5" ref={profileMenuRef}>
              {effectiveUsername ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setProfileOpen((prev) => !prev)}
                    aria-expanded={profileOpen}
                    aria-haspopup="menu"
                    title={`Signed in to GitHub as @${effectiveUsername}`}
                    className="border-emerald-300/80 bg-emerald-50/50 hover:bg-emerald-50 dark:border-emerald-800/80 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50"
                  >
                    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                      {githubSession?.avatarUrl ? (
                        <img
                          src={githubSession.avatarUrl}
                          alt={`@${effectiveUsername}`}
                          className="h-5 w-5 rounded-full object-cover border border-[var(--border-color)]"
                        />
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200">
                          <User className="h-3 w-3" />
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-[var(--bg-surface)]"
                      />
                    </span>
                    <span className="max-w-[140px] truncate font-medium">
                      @{effectiveUsername}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                  </Button>

                  {profileOpen && (
                    <div
                      role="menu"
                      aria-label="GitHub profile menu"
                      className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3.5 shadow-xl space-y-3"
                    >
                      <div className="flex items-start gap-3">
                        {githubSession?.avatarUrl ? (
                          <img
                            src={githubSession.avatarUrl}
                            alt={`@${effectiveUsername}`}
                            className="h-10 w-10 rounded-full object-cover border border-[var(--border-color)] shrink-0"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200 shrink-0">
                            <Github className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {githubSession?.name || `@${effectiveUsername}`}
                          </p>
                          <p className="text-xs text-[var(--text-secondary)] truncate">
                            @{effectiveUsername}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            >
                              Connected
                            </Badge>
                            {githubSession?.authMethod && (
                              <Badge variant="accent" className="text-[10px] uppercase">
                                {githubSession.authMethod}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {githubSession && (
                        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)] space-y-1">
                          <div>
                            <span className="font-medium text-[var(--text-primary)]">Scopes:</span>{' '}
                            {githubSession.scopes.length > 0
                              ? githubSession.scopes.join(', ')
                              : 'default'}
                          </div>
                          <div>
                            <span className="font-medium text-[var(--text-primary)]">
                              Signed in:
                            </span>{' '}
                            {new Date(githubSession.connectedAt).toLocaleString()}
                          </div>
                        </div>
                      )}

                      <Separator />

                      <div className="space-y-1">
                        <a
                          href={`https://github.com/${effectiveUsername}`}
                          target="_blank"
                          rel="noreferrer"
                          role="menuitem"
                          onClick={() => setProfileOpen(false)}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)] transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <Github className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                            View GitHub Profile
                          </span>
                          <ExternalLink className="h-3 w-3 text-[var(--text-secondary)]" />
                        </a>
                        {manifest && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setProfileOpen(false);
                              onOpenQuizManager();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)] transition-colors cursor-pointer"
                          >
                            <ClipboardList className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                            My Quizzes &amp; Gist Sync
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setProfileOpen(false);
                            onOpenFeedback();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)] transition-colors cursor-pointer"
                        >
                          <MessageCircle className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                          Feedback &amp; My Activity
                        </button>
                      </div>

                      {onGitHubLogout && (
                        <>
                          <Separator />
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setProfileOpen(false);
                              onGitHubLogout();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          >
                            <LogOut className="h-3.5 w-3.5" />
                            Sign Out
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onGitHubLogin}
                  disabled={githubAuthBusy}
                >
                  {githubAuthBusy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-secondary)]" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <Github className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                      <span>GitHub Login</span>
                    </>
                  )}
                </Button>
              )}
            </div>
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

import React, { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'icon';
}

export function Button({
  className,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps): React.ReactElement {
  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary:
      'bg-indigo-600 text-white hover:bg-indigo-700 border border-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-600 dark:border-indigo-500 shadow-xs disabled:opacity-50',
    secondary:
      'bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)] border border-[var(--border-color)] disabled:opacity-50',
    outline:
      'bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--cream-surface-soft)] border border-[var(--border-color)] shadow-2xs disabled:opacity-50',
    ghost:
      'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--cream-surface-soft)] hover:text-[var(--text-primary)] border border-transparent disabled:opacity-50',
  };
  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    sm: 'h-8 px-2.5 text-xs rounded-md',
    md: 'h-9 px-3.5 text-sm rounded-lg',
    icon: 'h-8 w-8 rounded-md p-0',
  };
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 cursor-pointer disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'outline' | 'accent';
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps): React.ReactElement {
  const variants: Record<NonNullable<BadgeProps['variant']>, string> = {
    default: 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)]',
    outline: 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-color)]',
    accent: 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium leading-tight',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xs',
        className,
      )}
      {...props}
    />
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref): React.ReactElement {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/70 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
        className,
      )}
      {...props}
    />
  );
});

export function Separator({ className }: { className?: string }): React.ReactElement {
  return <div className={cn('h-px w-full bg-[var(--border-color)]', className)} />;
}

export function Skeleton({ className }: { className?: string }): React.ReactElement {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-700/60', className)} />;
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-2xl',
  children,
}: DrawerProps): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl',
          maxWidthClass,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-color)] px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-[var(--text-secondary)] truncate">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close modal">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export interface CheckboxProps {
  checked: boolean;
  partial?: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  sizeClass?: string;
  className?: string;
  ariaLabel?: string;
}

export function Checkbox({
  checked,
  partial = false,
  onChange,
  disabled = false,
  sizeClass = 'h-3.5 w-3.5',
  className,
  ariaLabel,
}: CheckboxProps): React.ReactElement {
  const isPartial = partial && !checked;

  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', sizeClass, className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={ariaLabel}
        aria-checked={isPartial ? 'mixed' : checked}
        className={cn(
          sizeClass,
          'appearance-none rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#363945]/40 dark:focus-visible:ring-[#EFE1CE]/40',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          checked
            ? 'border-[#e5d3ba] bg-[#EFE1CE] dark:border-[var(--cream-border)] dark:bg-[#363945]'
            : isPartial
              ? 'border-slate-400 bg-transparent dark:border-slate-500 dark:bg-transparent'
              : 'border-slate-300 bg-transparent dark:border-slate-600 dark:bg-transparent',
        )}
      />
      {(checked || isPartial) && (
        <Check
          className="pointer-events-none absolute h-3 w-3 text-[#363945] dark:text-[#EFE1CE]"
          strokeWidth={3}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

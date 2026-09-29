'use client';

import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { createPortal } from 'react-dom';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { Tone } from '@/lib/format';

/** Class names joined with Tailwind conflicts resolved, so callers can override component defaults. */
export const cx = (...v: ClassValue[]) => twMerge(clsx(v));

/* ---------------------------------------------------------------- button */

type ButtonVariant = 'primary' | 'warn' | 'default' | 'ghost' | 'danger';
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; loading?: boolean }
>(function Button(
  { variant = 'default', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border font-medium transition duration-150 enabled:hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-10 px-4 text-[13.5px]' : 'h-8 px-3 text-[12.5px]',
        variant === 'primary' && 'border-transparent bg-accent text-accent-ink enabled:hover:brightness-110',
        variant === 'warn' && 'border-transparent bg-wait text-[#241703] enabled:hover:brightness-105',
        variant === 'danger' && 'border-bad/40 bg-bad/10 text-bad enabled:hover:bg-bad/20',
        variant === 'default' && 'border-line-2 bg-panel-2 text-text enabled:hover:border-white/25',
        variant === 'ghost' && 'border-line-2 bg-transparent text-text enabled:hover:border-white/25',
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'grid size-9 place-items-center rounded-[10px] border border-line-2 bg-panel text-text transition hover:border-accent/40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ pill */

const PILL: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok',
  run: 'bg-run/12 text-run',
  wait: 'bg-wait/12 text-wait',
  bad: 'bg-bad/12 text-bad',
  idle: 'bg-white/5 text-muted',
  accent: 'bg-accent/12 text-accent',
};

export function Pill({
  tone = 'idle',
  live,
  children,
  className,
}: {
  tone?: Tone;
  live?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-mono text-[11px] tracking-wide',
        PILL[tone],
        className,
      )}
    >
      <span className={cx('size-1.5 rounded-full bg-current', live && 'animate-breathe')} />
      {children}
    </span>
  );
}

export function Chip({
  children,
  className,
  onClick,
  active,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      onClick={onClick}
      className={cx(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] transition',
        active ? 'border-accent/45 bg-accent/12 text-text' : 'border-line-2 text-muted',
        onClick && 'hover:border-white/25 hover:text-text',
        className,
      )}
    >
      {children}
    </Comp>
  );
}

/* ------------------------------------------------------------------ card */

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-[18px] border border-line bg-panel', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  right,
  className,
}: {
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-3 border-b border-line px-5 py-4', className)}>
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- forms */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-[12px] text-faint">{hint}</p>}
      {error && <p className="text-[12px] text-bad">{error}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-[10px] border border-line-2 bg-panel-2 px-3 text-[13.5px] text-text placeholder:text-faint transition focus:border-accent/50 focus:outline-none';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(inputCls, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea ref={ref} className={cx(inputCls, 'min-h-24 py-2.5 leading-relaxed', className)} {...rest} />
    );
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'h-10 appearance-none pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition',
          checked ? 'border-accent bg-accent/70' : 'border-line-2 bg-panel-3',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-3.5 rounded-full bg-white transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13.5px]">{label}</span>
        {description && <span className="text-[12px] text-faint">{description}</span>}
      </span>
    </label>
  );
}

/* --------------------------------------------------------- misc display */

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('size-4 animate-spin text-muted', className)} />;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-[13px] text-muted">
      <Spinner /> {label}…
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/6 p-4 text-[13px]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
      <div className="flex-1">
        <div className="text-text">{message}</div>
        {onRetry && (
          <button onClick={onRetry} className="mt-2 text-accent hover:underline">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && (
        <div className="grid size-12 place-items-center rounded-2xl border border-line bg-panel-2 text-muted">
          {icon}
        </div>
      )}
      <div className="text-[15px] font-semibold">{title}</div>
      {body && <div className="max-w-md text-[13px] leading-relaxed text-muted">{body}</div>}
      {action}
    </div>
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="grid shrink-0 place-items-center rounded-full border border-line-2 bg-gradient-to-br from-[#2b2550] to-[#1b2338] font-semibold"
    >
      {initials}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
      {children}
    </span>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'relative -mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13.5px] transition',
            value === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- modal & sheet */

/** Renders overlays at the end of <body> so no page stacking context can cover them. */
function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 640,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEscape(open, onClose);
  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
              onClick={onClose}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              style={{ maxWidth: width }}
              className="relative flex max-h-[calc(100vh-48px)] w-full flex-col rounded-[22px] border border-line-2 bg-panel shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-start gap-3 border-b border-line px-6 py-5">
                <div className="flex-1 text-[18px] font-semibold tracking-tight">{title}</div>
                <IconButton label="Close" onClick={onClose} className="size-8">
                  <X className="size-4" />
                </IconButton>
              </div>
              <div className="overflow-y-auto px-6 py-5">{children}</div>
              {footer && (
                <div className="flex flex-wrap justify-end gap-2.5 border-t border-line px-6 py-4">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Portal>
  );
}

export function Sheet({
  open,
  onClose,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEscape(open, onClose);
  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-40">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              style={{ width: `min(${width}px, 100vw)` }}
              className="absolute inset-y-0 right-0 flex flex-col border-l border-line-2 bg-panel shadow-[-30px_0_80px_rgba(0,0,0,0.45)]"
            >
              <IconButton label="Close" onClick={onClose} className="absolute top-4 right-4 z-10 size-8">
                <X className="size-4" />
              </IconButton>
              {children}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </Portal>
  );
}

function useEscape(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, fn]);
}

/* ----------------------------------------------------------------- toast */

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'bad';
}
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className={cx(
                'flex max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-xl border bg-panel-3 px-4 py-3 text-[13.5px] shadow-[0_20px_60px_rgba(0,0,0,0.5)]',
                t.tone === 'bad' ? 'border-bad/40' : 'border-line-2',
              )}
            >
              <span className={cx('size-2 rounded-full', t.tone === 'bad' ? 'bg-bad' : 'bg-ok')} />
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

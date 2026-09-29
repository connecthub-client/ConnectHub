import {
  ButtonHTMLAttributes,
  forwardRef,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

type Intent = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const buttonIntent: Record<Intent, string> = {
  primary:
    "border border-teal-600 bg-teal-600 text-white shadow-sm hover:border-teal-700 hover:bg-teal-700 active:bg-teal-800 dark:border-teal-600 dark:bg-teal-600 dark:hover:bg-teal-700",
  secondary:
    "border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-800 dark:hover:bg-teal-950/50 dark:hover:text-teal-200",
  ghost:
    "border border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
  danger:
    "border border-red-600 bg-red-600 text-white shadow-sm hover:border-red-700 hover:bg-red-700 active:bg-red-800",
};

const buttonSize: Record<Size, string> = {
  sm: "min-h-8 rounded-lg px-2.5 py-1.5 text-xs",
  md: "min-h-9 rounded-lg px-3.5 py-2 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: Intent;
  size?: Size;
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      intent = "primary",
      size = "md",
      loading = false,
      leadingIcon,
      disabled,
      className = "",
      children,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`inline-flex items-center justify-center gap-2 font-semibold outline-none ring-offset-2 ring-offset-white focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-50 dark:ring-offset-slate-950 ${buttonIntent[intent]} ${buttonSize[size]} ${className}`}
        {...props}
      >
        {loading ? <LoadingSpinner className="h-3.5 w-3.5" /> : leadingIcon}
        {children}
      </button>
    );
  },
);

export function IconButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white ${className}`}
      {...props}
    />
  );
}

const fieldClass =
  "w-full min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:border-teal-500 dark:disabled:bg-slate-800";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return (
    <input ref={ref} className={`${fieldClass} ${className}`} {...props} />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = "", ...props }, ref) {
  return (
    <select
      ref={ref}
      className={`${fieldClass} themed-select ${className}`}
      {...props}
    />
  );
});

export function Surface({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
      {...props}
    />
  );
}

export function Badge({
  className = "",
  compact = false,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md bg-slate-100 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300 ${
        compact
          ? "h-4 min-h-4 px-1 text-[9px] leading-none"
          : "min-h-5 px-1.5 text-[10px]"
      } ${className}`}
      {...props}
    />
  );
}

export function StatusIndicator({
  state = "idle",
  label,
}: {
  state?: "idle" | "success" | "warning" | "error" | "busy";
  label: string;
}) {
  const colors = {
    idle: "bg-slate-400 dark:bg-slate-600",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    busy: "animate-pulse bg-teal-500",
  };
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`h-2 w-2 shrink-0 rounded-full ${colors[state]}`}
    />
  );
}

export function Notice({
  intent = "info",
  className = "",
  children,
}: {
  intent?: "info" | "success" | "warning" | "error";
  className?: string;
  children: ReactNode;
}) {
  const styles = {
    info: "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-100",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200",
  };
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm leading-5 ${styles[intent]} ${className}`}
    >
      {children}
    </div>
  );
}

export function LoadingSpinner({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return <span title={label}>{children}</span>;
}

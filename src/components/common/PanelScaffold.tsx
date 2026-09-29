import { ReactNode } from "react";

export function PanelScaffold({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl">
      <header className="mb-5 flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">
            {title}
          </h1>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">
            {description}
          </p>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-5 py-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300">
        {icon}
      </div>
      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const primaryActionClass =
  "inline-flex min-h-9 items-center justify-center rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 active:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryActionClass =
  "inline-flex min-h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-sm hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-teal-800 dark:hover:bg-teal-950/50 dark:hover:text-teal-300 disabled:cursor-not-allowed disabled:opacity-50";

export const listCardClass =
  "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";

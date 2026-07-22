import type { ReactNode } from "react";

// Icons for the VSCode-style Activity Bar (see ActivityBar.tsx) and the
// right-edge Snippets toggle - a distinct, small fixed set from
// hostIcons.tsx, which tags individual hosts rather than representing these
// app-level sections.

const ICON_PROPS = {
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const NAV_ICON_PATHS: Record<string, ReactNode> = {
  hosts: (
    <>
      <rect x="2" y="3" width="14" height="10" rx="1" />
      <path d="M5 6.5 7 8.5 5 10.5" />
      <path d="M9 10.5h2" />
      <path d="M6.5 16h5" />
    </>
  ),
  identities: (
    <>
      <circle cx="9" cy="6" r="3" />
      <path d="M3.5 16c0-3.5 2.5-6 5.5-6s5.5 2.5 5.5 6" />
    </>
  ),
  keys: (
    <>
      <circle cx="5.5" cy="12.5" r="3" />
      <path d="M7.8 10.2 15 3" />
      <path d="M12 6l2 2" />
      <path d="M14.5 3.5l2 2" />
    </>
  ),
  vpn: (
    <>
      <path d="M9 2l6 2.5v4c0 4-2.5 7-6 8-3.5-1-6-4-6-8v-4L9 2Z" />
      <path d="M6.3 9l1.9 1.9L12.2 6.5" />
    </>
  ),
  snippets: (
    <>
      <path d="M10 2 4 10h4l-1 6 7-9h-4l1-5Z" />
    </>
  ),
  google: (
    <>
      <circle cx="9" cy="9" r="7" />
      <circle cx="9" cy="7.2" r="2" />
      <path d="M4.5 14.3c1-2.2 2.8-3.4 4.5-3.4s3.5 1.2 4.5 3.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="9" cy="9" r="2.3" />
      <path d="M9 2.5v2.2M9 13.3v2.2M15.5 9h-2.2M4.7 9H2.5" />
      <path d="M13.7 4.3l-1.6 1.6M5.9 12.1l-1.6 1.6M13.7 13.7l-1.6-1.6M5.9 5.9 4.3 4.3" />
    </>
  ),
};

export type NavIconKey = keyof typeof NAV_ICON_PATHS;

export function NavIcon({ icon, className }: { icon: NavIconKey; className?: string }) {
  return (
    <svg {...ICON_PROPS} className={className} aria-hidden="true">
      {NAV_ICON_PATHS[icon]}
    </svg>
  );
}

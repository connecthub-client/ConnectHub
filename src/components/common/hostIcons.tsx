import type { CSSProperties, ReactNode } from "react";

// A host can be tagged with either a generic monoline icon (tinted via
// host.color, like the rest of this app's icons) or a fixed-color cloud
// provider mark / letter monogram (colored icons that carry their own
// color rather than being tinted, since a provider's brand color or a
// chosen monogram color IS the point of picking one). These are simplified,
// original interpretations of each provider's mark for identification
// purposes - not traced reproductions of the trademarked artwork - the same
// nominative-fair-use approach used by icon sets like simple-icons/devicon.

export interface HostIconDef {
  key: string;
  label: string;
  path: ReactNode;
}

const ICON_PROPS = {
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const HOST_ICONS: HostIconDef[] = [
  {
    key: "server",
    label: "Server",
    path: (
      <>
        <rect x="3" y="3" width="12" height="5" rx="1" />
        <rect x="3" y="10" width="12" height="5" rx="1" />
        <circle cx="6" cy="5.5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="6" cy="12.5" r="0.6" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    key: "database",
    label: "Database",
    path: (
      <>
        <ellipse cx="9" cy="4" rx="6" ry="2" />
        <path d="M3 4v10c0 1.1 2.7 2 6 2s6-.9 6-2V4" />
        <path d="M3 9c0 1.1 2.7 2 6 2s6-.9 6-2" />
      </>
    ),
  },
  {
    key: "cloud",
    label: "Cloud",
    path: <path d="M5.5 13h7a3 3 0 0 0 .3-6 4 4 0 0 0-7.6-1.2A3.5 3.5 0 0 0 5.5 13Z" />,
  },
  {
    key: "container",
    label: "Container",
    path: (
      <>
        <path d="M9 2 15 5v8l-6 3-6-3V5Z" />
        <path d="M3 5l6 3 6-3" />
        <path d="M9 8v8" />
      </>
    ),
  },
  {
    key: "network",
    label: "Network",
    path: (
      <>
        <circle cx="9" cy="3.5" r="1.8" />
        <circle cx="4" cy="14" r="1.8" />
        <circle cx="14" cy="14" r="1.8" />
        <path d="M9 5.3 5 12.4M9 5.3l4 7.1M5.8 14h6.4" />
      </>
    ),
  },
  {
    key: "lock",
    label: "Security",
    path: (
      <>
        <rect x="4" y="8" width="10" height="7" rx="1.5" />
        <path d="M6 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
  },
  {
    key: "globe",
    label: "Public",
    path: (
      <>
        <circle cx="9" cy="9" r="7" />
        <path d="M2 9h14M9 2c2.2 2 2.2 12 0 14M9 2c-2.2 2-2.2 12 0 14" />
      </>
    ),
  },
  {
    key: "home",
    label: "Local",
    path: (
      <>
        <path d="M3 9 9 3l6 6" />
        <path d="M4.5 7.5V15h9V7.5" />
      </>
    ),
  },
];

// Cloud provider marks - fixed brand-ish colors, not tinted by host.color.
export const CLOUD_ICONS: HostIconDef[] = [
  {
    key: "aws",
    label: "AWS",
    path: (
      <>
        <path d="M3 11c3 2.5 9 2.5 12 0" stroke="#FF9900" strokeWidth={1.8} fill="none" strokeLinecap="round" />
        <path
          d="M13 9.3l2 1.7-1.1 2.3"
          stroke="#FF9900"
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  {
    key: "azure",
    label: "Azure",
    path: <path d="M7.2 3h3.4L15 14h-4l-2-5-2 5H3Z" fill="#0078D4" stroke="none" />,
  },
  {
    key: "gcp",
    label: "Google Cloud",
    path: <path d="M5.5 13h7a3 3 0 0 0 .3-6 4 4 0 0 0-7.6-1.2A3.5 3.5 0 0 0 5.5 13Z" fill="#4285F4" stroke="none" />,
  },
  {
    key: "huawei",
    label: "Huawei Cloud",
    path: (
      <g fill="#CF0A2C" stroke="none">
        <circle cx="9" cy="5.2" r="2.1" />
        <circle cx="9" cy="12.8" r="2.1" />
        <circle cx="5.2" cy="9" r="2.1" />
        <circle cx="12.8" cy="9" r="2.1" />
      </g>
    ),
  },
  {
    key: "alibaba",
    label: "Alibaba Cloud",
    path: <path d="M9 3 4 14h3l2-4.6L11 14h3Z" fill="#FF6A00" stroke="none" />,
  },
  {
    key: "oracle",
    label: "Oracle Cloud",
    path: <ellipse cx="9" cy="9" rx="6.5" ry="4" fill="none" stroke="#F80000" strokeWidth={2} />,
  },
  {
    key: "ibm",
    label: "IBM Cloud",
    path: (
      <g fill="#0530AD" stroke="none">
        <rect x="3" y="4" width="12" height="1.6" />
        <rect x="3" y="7.2" width="12" height="1.6" />
        <rect x="3" y="10.4" width="12" height="1.6" />
        <rect x="3" y="13.6" width="12" height="1.6" />
      </g>
    ),
  },
  {
    key: "digitalocean",
    label: "DigitalOcean",
    path: <circle cx="9" cy="9" r="6.5" fill="#0080FF" stroke="none" />,
  },
];

// A-Z monogram icons, each with its own fixed color cycling through a small
// palette - revealed behind a "More" toggle in the picker (see HostForm.tsx)
// since 26 extra options would clutter the default grid.
const LETTER_PALETTE = [
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

export const LETTER_ICONS: HostIconDef[] = Array.from({ length: 26 }, (_, i) => {
  const letter = String.fromCharCode(65 + i);
  const color = LETTER_PALETTE[i % LETTER_PALETTE.length];
  return {
    key: `letter_${letter}`,
    label: letter,
    path: (
      <text
        x="9"
        y="13"
        textAnchor="middle"
        fontSize="12"
        fontWeight={700}
        fill={color}
        stroke="none"
        fontFamily="sans-serif"
      >
        {letter}
      </text>
    ),
  };
});

const HOST_ICON_MAP = new Map(
  [...HOST_ICONS, ...CLOUD_ICONS, ...LETTER_ICONS].map((i) => [i.key, i]),
);

export function HostIcon({
  icon,
  className,
  style,
}: {
  icon: string | null | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  const def = icon ? HOST_ICON_MAP.get(icon) : undefined;
  if (!def) return null;
  return (
    <svg {...ICON_PROPS} className={className} style={style} aria-hidden="true">
      {def.path}
    </svg>
  );
}

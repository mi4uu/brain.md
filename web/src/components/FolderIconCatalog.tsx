import type { ReactElement } from "react";

export interface IconDef {
  key: string;
  label: string;
  color: string;
  draw: ReactElement;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const ICONS: IconDef[] = [
  {
    key: "folder",
    label: "Folder",
    color: "#9b87f5",
    draw: <path {...stroke} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  },
  {
    key: "folder-open",
    label: "Folder open",
    color: "#9b87f5",
    draw: (
      <g {...stroke}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z" />
        <path d="M3 9h18l-2 9a2 2 0 0 1-2 1H5a2 2 0 0 1-2-1z" />
      </g>
    ),
  },
  {
    key: "star",
    label: "Star",
    color: "#fbbf24",
    draw: <polygon {...stroke} fill="currentColor" points="12 3 14.9 8.9 21 9.8 16.5 14.2 17.5 20.3 12 17.5 6.5 20.3 7.5 14.2 3 9.8 9.1 8.9" />,
  },
  {
    key: "book",
    label: "Book",
    color: "#60a5fa",
    draw: (
      <g {...stroke}>
        <path d="M4 4a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0-2 2z" />
        <path d="M4 18h14" />
      </g>
    ),
  },
  {
    key: "notebook",
    label: "Notebook",
    color: "#a78bfa",
    draw: (
      <g {...stroke}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <line x1="12" y1="8" x2="16" y2="8" />
        <line x1="12" y1="12" x2="16" y2="12" />
      </g>
    ),
  },
  {
    key: "calendar",
    label: "Calendar",
    color: "#f472b6",
    draw: (
      <g {...stroke}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="8" y1="3" x2="8" y2="7" />
        <line x1="16" y1="3" x2="16" y2="7" />
      </g>
    ),
  },
  {
    key: "inbox",
    label: "Inbox",
    color: "#22d3ee",
    draw: (
      <g {...stroke}>
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
      </g>
    ),
  },
  {
    key: "archive",
    label: "Archive",
    color: "#94a3b8",
    draw: (
      <g {...stroke}>
        <rect x="2" y="4" width="20" height="5" rx="1" />
        <path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
        <line x1="10" y1="13" x2="14" y2="13" />
      </g>
    ),
  },
  {
    key: "lightbulb",
    label: "Ideas",
    color: "#f59e0b",
    draw: (
      <g {...stroke}>
        <path d="M9 18h6" />
        <path d="M10 21h4" />
        <path d="M12 3a6 6 0 0 0-4 10.5c1 1 1.5 2 1.5 3.5h5c0-1.5.5-2.5 1.5-3.5A6 6 0 0 0 12 3z" />
      </g>
    ),
  },
  {
    key: "code",
    label: "Code",
    color: "#34d399",
    draw: <polyline {...stroke} points="16 18 22 12 16 6 8 6 2 12 8 18" />,
  },
  {
    key: "rocket",
    label: "Project",
    color: "#f87171",
    draw: (
      <g {...stroke}>
        <path d="M4 14l4-4 6 6 4-4-2-9-9 2-4 4z" />
        <circle cx="15" cy="9" r="1.5" />
        <path d="M4 20l3-3" />
      </g>
    ),
  },
  {
    key: "target",
    label: "Goals",
    color: "#ef4444",
    draw: (
      <g {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      </g>
    ),
  },
  {
    key: "heart",
    label: "Personal",
    color: "#ec4899",
    draw: <path {...stroke} fill="currentColor" d="M20.8 6.6a5 5 0 0 0-8.8-2 5 5 0 0 0-8.8 2c0 5.6 8.8 11.4 8.8 11.4s8.8-5.8 8.8-11.4z" />,
  },
  {
    key: "music",
    label: "Music",
    color: "#a855f7",
    draw: (
      <g {...stroke}>
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="17" cy="16" r="2.5" />
        <line x1="8.5" y1="18" x2="8.5" y2="6" />
        <line x1="19.5" y1="16" x2="19.5" y2="4" />
        <line x1="8.5" y1="6" x2="19.5" y2="4" />
      </g>
    ),
  },
  {
    key: "image",
    label: "Images",
    color: "#10b981",
    draw: (
      <g {...stroke}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="1.6" />
        <polyline points="21 15 16 10 5 21" />
      </g>
    ),
  },
  {
    key: "globe",
    label: "Web",
    color: "#0ea5e9",
    draw: (
      <g {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <path d="M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
      </g>
    ),
  },
  {
    key: "brain",
    label: "Brain",
    color: "#fb7185",
    draw: (
      <g {...stroke}>
        <path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8V14a3 3 0 0 0 3 3v1a3 3 0 0 0 3 3h0V4z" />
        <path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8V14a3 3 0 0 1-3 3v1a3 3 0 0 1-3 3h0V4z" />
      </g>
    ),
  },
  {
    key: "compass",
    label: "Explore",
    color: "#14b8a6",
    draw: (
      <g {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <polygon fill="currentColor" points="16 8 13 13 8 16 11 11" />
      </g>
    ),
  },
  {
    key: "graduation",
    label: "Learning",
    color: "#3b82f6",
    draw: (
      <g {...stroke}>
        <path d="M2 9l10-5 10 5-10 5z" />
        <path d="M6 11v5a4 4 0 0 0 12 0v-5" />
      </g>
    ),
  },
  {
    key: "briefcase",
    label: "Work",
    color: "#64748b",
    draw: (
      <g {...stroke}>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      </g>
    ),
  },
  {
    key: "tag",
    label: "Tagged",
    color: "#84cc16",
    draw: (
      <g {...stroke}>
        <path d="M3 12V3h9l9 9-9 9z" />
        <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      </g>
    ),
  },
  {
    key: "bookmark",
    label: "Bookmarks",
    color: "#f97316",
    draw: <path {...stroke} fill="currentColor" d="M6 3h12v18l-6-4-6 4z" />,
  },
  {
    key: "lock",
    label: "Private",
    color: "#71717a",
    draw: (
      <g {...stroke}>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </g>
    ),
  },
  {
    key: "flame",
    label: "Hot",
    color: "#dc2626",
    draw: <path {...stroke} fill="currentColor" d="M12 3c1 4-4 5-4 10a4 4 0 0 0 8 0c0-3-2-4-2-7 3 1 4 4 4 7a6 6 0 0 1-12 0c0-5 6-6 6-10z" />,
  },
  {
    key: "leaf",
    label: "Nature",
    color: "#16a34a",
    draw: <path {...stroke} fill="currentColor" fillOpacity="0.2" d="M21 3c-9 0-15 6-15 13 0 2 1 4 3 5C7 14 14 9 21 9z" />,
  },
  {
    key: "coffee",
    label: "Coffee",
    color: "#92400e",
    draw: (
      <g {...stroke}>
        <path d="M3 8h14v7a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
        <path d="M17 10h2a2 2 0 0 1 0 4h-2" />
        <line x1="7" y1="2" x2="7" y2="5" />
        <line x1="11" y1="2" x2="11" y2="5" />
      </g>
    ),
  },
  {
    key: "settings",
    label: "Settings",
    color: "#6b7280",
    draw: (
      <g {...stroke}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      </g>
    ),
  },
  {
    key: "users",
    label: "People",
    color: "#06b6d4",
    draw: (
      <g {...stroke}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M22 19c0-2-2-4-5-4" />
      </g>
    ),
  },
  {
    key: "map",
    label: "Map",
    color: "#0891b2",
    draw: (
      <g {...stroke}>
        <polygon points="2 5 9 3 15 5 22 3 22 19 15 21 9 19 2 21" />
        <line x1="9" y1="3" x2="9" y2="19" />
        <line x1="15" y1="5" x2="15" y2="21" />
      </g>
    ),
  },
  {
    key: "package",
    label: "Package",
    color: "#a16207",
    draw: (
      <g {...stroke}>
        <path d="M3 7l9-4 9 4-9 4z" />
        <path d="M3 7v10l9 4 9-4V7" />
        <line x1="12" y1="11" x2="12" y2="21" />
      </g>
    ),
  },
];

const BY_KEY = new Map(ICONS.map((i) => [i.key, i]));

export function findIcon(key: string | undefined | null): IconDef | undefined {
  if (!key) return undefined;
  return BY_KEY.get(key);
}

export interface RenderedIconProps {
  size?: number;
  color?: string;
}

export function IconBare({
  iconKey,
  size = 16,
  color,
}: {
  iconKey: string;
  size?: number;
  color?: string;
}) {
  if (iconKey.startsWith("emoji:")) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          fontSize: Math.round(size * 0.95),
          lineHeight: 1,
        }}
      >
        {iconKey.slice("emoji:".length)}
      </span>
    );
  }
  const def = findIcon(iconKey) ?? findIcon("folder")!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color: color ?? def.color, flexShrink: 0 }}
      aria-hidden="true"
    >
      {def.draw}
    </svg>
  );
}

export function FolderIconRender({
  iconKey,
  open,
  color,
  size = 16,
}: {
  iconKey?: string | null;
  open?: boolean;
  color?: string;
  size?: number;
}) {
  const base = open ? findIcon("folder-open")! : findIcon("folder")!;
  const badgeSize = Math.max(8, Math.round(size * 0.62));
  return (
    <span
      className="folder-icon-stack"
      style={{ width: size, height: size, position: "relative", display: "inline-flex", flexShrink: 0 }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{ color: color ?? base.color }}
        aria-hidden="true"
      >
        {base.draw}
      </svg>
      {iconKey ? (
        <span
          className="folder-icon-badge"
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: "50%",
            background: "var(--bg-surface)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 1px var(--border)",
          }}
        >
          <IconBare iconKey={iconKey} size={badgeSize - 2} />
        </span>
      ) : null}
    </span>
  );
}

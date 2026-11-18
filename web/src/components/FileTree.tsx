import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  ChevRightIcon,
  FileIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "./Icons";
import {
  ContextMenu as RadixContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";

interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { FolderIconRender, IconBare } from "./FolderIconCatalog";
import type { TreeData } from "../api/types";

export interface Node {
  name: string;
  path: string;
  type: "folder" | "note";
  children: Node[];
  // Shown only with "Show hidden", dimmed.
  hidden?: boolean;
  // Year/month group in the journal folder: a view, not a real folder.
  virtual?: boolean;
}

export type FolderSort = "name-asc" | "name-desc" | "modified-desc" | "modified-asc";
const SORT_LABELS: Array<[FolderSort, string]> = [
  ["name-asc", "Name A to Z"],
  ["name-desc", "Name Z to A"],
  ["modified-desc", "Recently changed first"],
  ["modified-asc", "Oldest change first"],
];

export interface TreeView {
  showHidden: boolean;
  sort: Record<string, string>;
  dailyDir: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAILY = /^(\d{4})-(\d{2})-\d{2}/;

// Daily notes straight under the journal folder are shown in year and
// month groups; the files stay where they are.
function groupJournal(journal: Node): void {
  const keep: Node[] = [];
  const years = new Map<string, Node>();
  for (const c of journal.children) {
    const m = c.type === "note" ? DAILY.exec(c.name) : null;
    if (!m) {
      keep.push(c);
      continue;
    }
    const [, y, mo] = m;
    let year = years.get(y!);
    if (!year) {
      year = { name: y!, path: `${journal.path}/${y}`, type: "folder", children: [], virtual: true };
      years.set(y!, year);
    }
    const monthPath = `${year.path}/${mo}`;
    let month = year.children.find((n) => n.path === monthPath);
    if (!month) {
      month = { name: `${mo} ${MONTHS[Number(mo) - 1] ?? ""}`.trim(), path: monthPath, type: "folder", children: [], virtual: true };
      year.children.push(month);
    }
    month.children.push(c);
  }
  journal.children = [...keep, ...years.values()];
}

export function buildTree(data: TreeData, view: TreeView): Node {
  const hiddenNotes = new Set(data.hiddenNotes ?? []);
  const hiddenFolders = new Set(data.hiddenFolders ?? []);
  const mtimes = data.mtimes ?? {};
  const root: Node = { name: "", path: "", type: "folder", children: [] };
  const dirIndex = new Map<string, Node>();
  dirIndex.set("", root);

  for (const folder of data.folders) {
    if (hiddenFolders.has(folder) && !view.showHidden) continue;
    const parts = folder.split("/");
    let cur = root;
    let accum = "";
    for (const part of parts) {
      accum = accum === "" ? part : `${accum}/${part}`;
      let next = dirIndex.get(accum);
      if (!next) {
        next = { name: part, path: accum, type: "folder", children: [], hidden: hiddenFolders.has(accum) };
        cur.children.push(next);
        dirIndex.set(accum, next);
      }
      cur = next;
    }
  }
  for (const note of data.notes) {
    if (hiddenNotes.has(note) && !view.showHidden) continue;
    const idx = note.lastIndexOf("/");
    const dir = idx >= 0 ? note.slice(0, idx) : "";
    const base = idx >= 0 ? note.slice(idx + 1) : note;
    const parent = dirIndex.get(dir) ?? root;
    if (idx > 0 && !dirIndex.has(dir)) {
      const parts = dir.split("/");
      let cur = root;
      let accum = "";
      for (const part of parts) {
        accum = accum === "" ? part : `${accum}/${part}`;
        let next = dirIndex.get(accum);
        if (!next) {
          next = { name: part, path: accum, type: "folder", children: [] };
          cur.children.push(next);
          dirIndex.set(accum, next);
        }
        cur = next;
      }
    }
    const owner = dirIndex.get(dir) ?? root;
    owner.children.push({ name: base, path: note, type: "note", children: [], hidden: hiddenNotes.has(note) });
  }
  const journal = view.dailyDir ? dirIndex.get(view.dailyDir) : undefined;
  if (journal) groupJournal(journal);

  // Journal/daily notes are named YYYY-MM-DD.md. Plain alpha sort buries the
  // newest entry at the bottom; sort dated notes descending so newest is on top.
  const datePrefix = /^\d{4}-\d{2}-\d{2}/;
  const byName = (a: Node, b: Node) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const sortRec = (n: Node) => {
    // Journal year/month groups: newest first, unless the folder has its own order.
    const mode = (view.sort[n.path] as FolderSort | undefined) ?? (n.virtual || n === journal ? "name-desc" : undefined);
    n.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      if (mode === "name-asc") return byName(a, b);
      if (mode === "name-desc") return byName(b, a);
      if (mode === "modified-desc" || mode === "modified-asc") {
        if (a.type === "folder") return byName(a, b);
        const d = (mtimes[a.path] ?? 0) - (mtimes[b.path] ?? 0);
        return (mode === "modified-desc" ? -d : d) || byName(a, b);
      }
      const aDated = a.type === "note" && datePrefix.test(a.name);
      const bDated = b.type === "note" && datePrefix.test(b.name);
      if (aDated && bDated) return b.name.localeCompare(a.name);
      return byName(a, b);
    });
    for (const c of n.children) sortRec(c);
  };
  sortRec(root);
  return root;
}

interface TreeProps {
  data: TreeData;
  activePath: string | null;
  folderIcons: Record<string, string>;
  basenameCounts: Record<string, number>;
  onOpen: (path: string) => void;
  onCreateNote: (parentDir: string) => void;
  onCreateFolder: (parentDir: string) => void;
  onRename: (path: string, isFolder: boolean) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  onSetIcon: (path: string) => void;
  onSetMcpPerms?: (path: string) => void;
  showHidden?: boolean;
  folderSort?: Record<string, string>;
  dailyDir?: string;
  homepage?: string;
  onSetHomepage?: (path: string) => void;
  onSetHidden?: (path: string, isFolder: boolean, hidden: boolean) => void;
  onSetSort?: (folder: string, sort: FolderSort | null) => void;
}

export function FileTree(props: TreeProps) {
  const { data, showHidden = false, folderSort, dailyDir = "" } = props;
  const root = useMemo(
    () => buildTree(data, { showHidden, sort: folderSort ?? {}, dailyDir }),
    [data, showHidden, folderSort, dailyDir],
  );

  if (root.children.length === 0) {
    return (
      <div className="tree-empty">
        <p>No notes yet.</p>
        <button className="btn primary" onClick={() => props.onCreateNote("")}>
          <PlusIcon /> New note
        </button>
      </div>
    );
  }

  const ctxItems = (node: Node): MenuItem[] => {
    const isFolder = node.type === "folder";
    if (node.virtual) return [];
    const hideItem: MenuItem[] = props.onSetHidden
      ? [
          {
            label: node.hidden ? "Show again" : isFolder ? "Hide folder" : "Hide note",
            icon: <IconBare iconKey={node.hidden ? "folder-open" : "lock"} />,
            onClick: () => props.onSetHidden!(node.path, isFolder, !node.hidden),
          },
        ]
      : [];
    const current = (folderSort?.[node.path] as FolderSort | undefined) ?? null;
    const sortItems: MenuItem[] = props.onSetSort
      ? SORT_LABELS.map(([mode, label]) => ({
          label: `Sort: ${label}${current === mode ? "  ✓" : ""}`,
          onClick: () => props.onSetSort!(node.path, current === mode ? null : mode),
        }))
      : [];
    return isFolder
      ? [
          { label: "New note here", icon: <PlusIcon />, onClick: () => props.onCreateNote(node.path) },
          { label: "New folder here", icon: <FolderIcon />, onClick: () => props.onCreateFolder(node.path) },
          { label: "Set icon…", icon: <IconBare iconKey="star" />, onClick: () => props.onSetIcon(node.path) },
          ...(props.onSetMcpPerms
            ? [
                {
                  label: "MCP permissions…",
                  icon: <IconBare iconKey="lock" />,
                  onClick: () => props.onSetMcpPerms!(node.path),
                } as MenuItem,
              ]
            : []),
          ...sortItems,
          ...hideItem,
          { label: "Rename folder", icon: <PencilIcon />, onClick: () => props.onRename(node.path, true) },
          { label: "Delete folder", icon: <TrashIcon />, destructive: true, onClick: () => props.onDelete(node.path, true) },
        ]
      : [
          { label: "Open", icon: <FileIcon />, onClick: () => props.onOpen(node.path) },
          ...(props.onSetHomepage
            ? [
                {
                  label: props.homepage === node.path ? "Homepage  ✓" : "Set as homepage",
                  icon: <IconBare iconKey="compass" />,
                  onClick: () => props.onSetHomepage!(node.path),
                  disabled: props.homepage === node.path,
                } as MenuItem,
              ]
            : []),
          ...hideItem,
          { label: "Rename note", icon: <PencilIcon />, onClick: () => props.onRename(node.path, false) },
          { label: "Delete note", icon: <TrashIcon />, destructive: true, onClick: () => props.onDelete(node.path, false) },
        ];
  };

  return (
    <div className="tree" role="tree">
      <TreeChildren
        node={root}
        depth={0}
        {...props}
        defaultExpanded
        getCtxItems={ctxItems}
      />
    </div>
  );
}

interface ChildrenProps extends TreeProps {
  node: Node;
  depth: number;
  defaultExpanded?: boolean;
  getCtxItems: (node: Node) => MenuItem[];
}

function RowDropdownMenu({ items }: { items: MenuItem[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button title="More" aria-label="Row actions">
          <DotsIcon />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {items.map((it, i) => (
          <DropdownMenuItem
            key={i}
            destructive={it.destructive}
            disabled={it.disabled}
            onSelect={(e) => {
              e.preventDefault();
              it.onClick();
            }}
          >
            {it.icon ? (
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-fg-3">
                {it.icon}
              </span>
            ) : null}
            <span>{it.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowContextMenu({
  items,
  children,
}: {
  items: MenuItem[];
  children: React.ReactNode;
}) {
  return (
    <RadixContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((it, i) => (
          <ContextMenuItem
            key={i}
            destructive={it.destructive}
            disabled={it.disabled}
            onSelect={(e) => {
              e.preventDefault();
              it.onClick();
            }}
          >
            {it.icon ? (
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-fg-3">
                {it.icon}
              </span>
            ) : null}
            <span>{it.label}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </RadixContextMenu>
  );
}

function TreeChildren({ node, depth, defaultExpanded, ...rest }: ChildrenProps) {
  return (
    <div className={depth === 0 ? "" : "tree-children"}>
      {node.children.map((child) =>
        child.type === "folder" ? (
          <FolderRow
            key={`f:${child.path}`}
            node={child}
            depth={depth}
            defaultExpanded={defaultExpanded ?? depth < 1}
            {...rest}
          />
        ) : (
          <NoteRow key={`n:${child.path}`} node={child} {...rest} />
        ),
      )}
    </div>
  );
}

function FolderRow({
  node,
  depth,
  defaultExpanded,
  getCtxItems,
  ...rest
}: ChildrenProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  return (
    <div>
      <RowContextMenu items={getCtxItems(node)}>
        <div
          className={clsx("tree-row", expanded && "expanded", node.hidden && "is-hidden")}
          role="treeitem"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          title={node.path}
        >
          <span className="chev">
            <ChevRightIcon />
          </span>
          <span className="icon">
            <FolderIconRender
              iconKey={rest.folderIcons[node.path] ?? null}
              open={expanded}
            />
          </span>
          <span className="label">{node.name}</span>
          {node.virtual ? null : (
            <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
              <RowDropdownMenu items={getCtxItems(node)} />
            </div>
          )}
        </div>
      </RowContextMenu>
      {expanded ? (
        <TreeChildren
          node={node}
          depth={depth + 1}
          getCtxItems={getCtxItems}
          {...rest}
        />
      ) : null}
    </div>
  );
}

function NoteRow({
  node,
  activePath,
  onOpen,
  onRename,
  onDelete,
  getCtxItems,
  basenameCounts,
}: {
  node: Node;
  getCtxItems: (n: Node) => MenuItem[];
} & Pick<
  TreeProps,
  "activePath" | "onOpen" | "onRename" | "onDelete" | "basenameCounts"
>) {
  const label = node.name.endsWith(".md") ? node.name.slice(0, -3) : node.name;
  const active = node.path === activePath;
  return (
    <RowContextMenu items={getCtxItems(node)}>
      <div
        className={clsx("tree-row", active && "active", node.hidden && "is-hidden")}
        role="treeitem"
        draggable
        onDragStart={(e) => {
          const ambiguous = (basenameCounts[label.toLowerCase()] ?? 0) > 1;
          const linkTarget = ambiguous
            ? node.path.replace(/\.md$/i, "")
            : label;
          const payload = JSON.stringify({ path: node.path, basename: label, linkTarget });
          e.dataTransfer.setData("application/x-brain-note", payload);
          e.dataTransfer.setData("text/plain", `[[${linkTarget}]]`);
          e.dataTransfer.effectAllowed = "copyLink";
        }}
        onClick={() => onOpen(node.path)}
        title={node.path}
      >
        <span className="chev" />
        <span className="icon">
          <FileIcon />
        </span>
        <span className="label">{label}</span>
        <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
          <RowDropdownMenu items={getCtxItems(node)} />
        </div>
      </div>
    </RowContextMenu>
  );
}

function DotsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  ChevRightIcon,
  FileIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "./Icons";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import {
  ContextMenu as RadixContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { FolderIconRender, IconBare } from "./FolderIconCatalog";
import type { TreeData } from "../api/types";

interface Node {
  name: string;
  path: string;
  type: "folder" | "note";
  children: Node[];
}

function buildTree(data: TreeData): Node {
  const root: Node = { name: "", path: "", type: "folder", children: [] };
  const dirIndex = new Map<string, Node>();
  dirIndex.set("", root);

  for (const folder of data.folders) {
    const parts = folder.split("/");
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
  for (const note of data.notes) {
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
    owner.children.push({ name: base, path: note, type: "note", children: [] });
  }

  const sortRec = (n: Node) => {
    n.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
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
}

type CtxState = { x: number; y: number; node: Node } | null;

export function FileTree(props: TreeProps) {
  const root = useMemo(() => buildTree(props.data), [props.data]);
  const [ctx, setCtx] = useState<CtxState>(null);

  const openCtx = (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, node });
  };

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
    return isFolder
      ? [
          { label: "New note here", icon: <PlusIcon />, onClick: () => props.onCreateNote(node.path) },
          { label: "New folder here", icon: <FolderIcon />, onClick: () => props.onCreateFolder(node.path) },
          { label: "Set icon…", icon: <IconBare iconKey="star" />, onClick: () => props.onSetIcon(node.path) },
          { label: "Rename folder", icon: <PencilIcon />, onClick: () => props.onRename(node.path, true) },
          { label: "Delete folder", icon: <TrashIcon />, destructive: true, onClick: () => props.onDelete(node.path, true) },
        ]
      : [
          { label: "Open", icon: <FileIcon />, onClick: () => props.onOpen(node.path) },
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
        openCtx={openCtx}
        getCtxItems={ctxItems}
      />
      {ctx ? (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctxItems(ctx.node)}
          onClose={() => setCtx(null)}
        />
      ) : null}
    </div>
  );
}

interface ChildrenProps extends TreeProps {
  node: Node;
  depth: number;
  defaultExpanded?: boolean;
  openCtx: (e: React.MouseEvent, node: Node) => void;
  getCtxItems: (node: Node) => MenuItem[];
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
  openCtx,
  getCtxItems,
  ...rest
}: ChildrenProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  return (
    <div>
      <RowContextMenu items={getCtxItems(node)}>
        <div
          className={clsx("tree-row", expanded && "expanded")}
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
          <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
            <button
              title="More"
              aria-label="Folder actions"
              onClick={(e) => openCtx(e, node)}
            >
              <DotsIcon />
            </button>
            <button
              title="New note"
              onClick={() => rest.onCreateNote(node.path)}
            >
              <PlusIcon />
            </button>
            <button
              title="Delete"
              onClick={() => rest.onDelete(node.path, true)}
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      </RowContextMenu>
      {expanded ? (
        <TreeChildren
          node={node}
          depth={depth + 1}
          openCtx={openCtx}
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
  openCtx,
  getCtxItems,
  basenameCounts,
}: {
  node: Node;
  openCtx: (e: React.MouseEvent, n: Node) => void;
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
        className={clsx("tree-row", active && "active")}
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
          <button title="More" aria-label="Note actions" onClick={(e) => openCtx(e, node)}>
            <DotsIcon />
          </button>
          <button title="Rename" onClick={() => onRename(node.path, false)}>
            <PencilIcon />
          </button>
          <button title="Delete" onClick={() => onDelete(node.path, false)}>
            <TrashIcon />
          </button>
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseBase, type ViewConfig } from "@brainmd/shared/base-parse";
import { MAX_QUERY_LIMIT, type BaseQueryResponse } from "@brainmd/shared/base-types";
import { PlusIcon } from "@radix-ui/react-icons";
import { BaseYamlError, addView } from "@brainmd/shared/base-yaml";
import { setProperties, type PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { ConflictError, api } from "../api/client";
import { BaseToolbar } from "./BaseToolbar";
import { CardsView } from "./CardsView";
import { KanbanView } from "./KanbanView";
import { ListView } from "./ListView";
import { TableView } from "./TableView";
import type { BaseHost } from "./host";
import { candidateKeys, optionType, partialHit, patchRowRevision, viewIndexFor } from "./model";
import { buildNoteContent, planNewNote, uniqueNotePath } from "./new-note";
import { FilterPopover, PropertiesPopover, SortPopover, type KeyOption } from "./ToolbarPopovers";
import { blockKey, emitBaseRefresh, getActiveView, getCached, getLast, getOpenTool, onBaseRefresh, setActiveView, setCached, setOpenTool } from "./store";
import type { LayoutProps, PropChange, Row } from "./types";

export interface BaseViewProps {
  source: string;
  startLine: number;
  ordinal: number;
  notePath: string | null;
  host: BaseHost;
}

let typesCache: { at: number; value: Promise<Map<string, PropertyType>> } | null = null;
function loadVaultTypes(): Promise<Map<string, PropertyType>> {
  if (!typesCache || Date.now() - typesCache.at > 30_000) {
    typesCache = {
      at: Date.now(),
      value: api
        .properties()
        .then((list) => new Map(list.map((p) => [p.name, p.type] as [string, PropertyType])))
        .catch(() => new Map<string, PropertyType>()),
    };
  }
  return typesCache.value;
}

const DEFAULT_VIEW: ViewConfig = { type: "table", name: "Table", order: [], sort: [], groupOrder: [], columnSize: {}, summaries: {} };
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function BaseView({ source, startLine, ordinal, notePath, host }: BaseViewProps) {
  const key = blockKey(notePath, ordinal);
  const parsed = useMemo(() => parseBase(source), [source]);
  const [activeName, setActiveName] = useState<string | undefined>(() => getActiveView(key));
  const fingerprint = `${source}\u0000${notePath ?? ""}\u0000${activeName ?? ""}`;
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const [result, setResult] = useState<BaseQueryResponse | null>(() => getCached(key, fingerprint) ?? getLast(key) ?? null);
  const [openTool, setOpenToolState] = useState<string | null>(() => getOpenTool(key));
  const toolOpen = (name: string) => ({
    open: openTool === name,
    onOpenChange: (o: boolean) => {
      const next = o ? name : null;
      setOpenToolState(next);
      setOpenTool(key, next);
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [vaultTypes, setVaultTypes] = useState<Map<string, PropertyType>>(new Map());

  useEffect(() => onBaseRefresh(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let live = true;
    void loadVaultTypes().then((m) => live && setVaultTypes(m));
    return () => {
      live = false;
    };
  }, []);

  // A mount paints the cached result at once but still fetches: Preview keeps
  // roots across keystrokes, so a fresh mount means the note was reopened or
  // the fence changed, and other notes may have changed meanwhile.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the refresh trigger
  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      api
        .baseQuery({ source, view: activeName, thisPath: notePath ?? undefined, limit: MAX_QUERY_LIMIT }, ctl.signal)
        .then((r) => {
          setCached(key, fingerprint, r);
          setResult(r);
          setError(null);
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
          setError(errText(e));
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [key, fingerprint, tick, source, activeName, notePath]);

  const views = parsed.config.views;
  const viewIndex = viewIndexFor(
    views.map((v) => v.name),
    activeName ?? result?.view,
  );
  const view = views[viewIndex] ?? DEFAULT_VIEW;

  const editView = useCallback(
    (fn: (src: string, idx: number) => string): boolean => {
      try {
        const ok = host.editFence(
          startLine,
          (src) => {
            const withView = parseBase(src).config.views.length > 0 ? src : addView(src, { type: "table", name: "Table" });
            return fn(withView, viewIndex);
          },
          source,
        );
        if (!ok) host.toast("Could not find this block in the note");
        return ok;
      } catch (e) {
        host.toast(e instanceof BaseYamlError ? `Edit the block in the source: ${e.message}` : `Edit failed: ${errText(e)}`);
        return false;
      }
    },
    [host, startLine, viewIndex, source],
  );

  const saveProps = useCallback(
    async (row: Row, change: PropChange, optimistic?: (r: BaseQueryResponse) => BaseQueryResponse): Promise<boolean> => {
      const cut = partialHit(row, change);
      if (cut !== null) {
        host.toast(`${cut} was shortened for display, so it cannot be edited here`);
        return false;
      }
      if (optimistic) setResult((r) => (r ? optimistic(r) : r));
      if (row.path === host.currentPath()) {
        try {
          host.edit((text) => setProperties(text, change.set ?? {}, change.unset));
          return true;
        } catch (e) {
          host.toast(`Property edit refused: ${errText(e)}`);
          setTick((t) => t + 1);
          return false;
        }
      }
      try {
        const res = await api.patchNoteProperties(row.path, { set: change.set, unset: change.unset, baseRevision: row.revision });
        const revision = res.revision;
        if (revision) {
          setResult((r) => {
            if (!r) return r;
            const next = patchRowRevision(r, row.path, revision);
            setCached(key, fingerprintRef.current, next);
            return next;
          });
        }
        emitBaseRefresh();
        return true;
      } catch (e) {
        host.toast(e instanceof ConflictError ? `${row.title} changed meanwhile, refreshed` : `Save failed: ${errText(e)}`);
        emitBaseRefresh();
        return false;
      }
    },
    [host, key],
  );

  const newNote = useCallback(
    async (preset?: Record<string, PropValue>): Promise<void> => {
      const plan = planNewNote([parsed.config.filters, view.filters], preset);
      const tried = new Set<string>();
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const path = uniqueNotePath(plan.folder, (p) => host.noteExists(p) || tried.has(p.toLowerCase()));
          const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
          if ((await host.createNote(path, buildNoteContent(title, plan.props))) !== "exists") return;
          tried.add(path.toLowerCase());
        }
      } catch (e) {
        host.toast(`Create failed: ${errText(e)}`);
        return;
      }
      host.toast("Could not find a free note name");
    },
    [host, parsed.config.filters, view.filters],
  );

  if (!result) {
    return (
      <div className="base-view" aria-busy={!error}>
        {error ? <p className="base-warn">Could not run this view: {error}</p> : <p className="base-empty">Loading view</p>}
      </div>
    );
  }

  const options: KeyOption[] = candidateKeys(
    [...vaultTypes.keys()],
    Object.keys(parsed.config.formulas),
    result.columns.map((c) => c.key),
  ).map((k) => ({
    key: k,
    label: result.columns.find((c) => c.key === k)?.label ?? k.replace(/^(file|note)\./, ""),
    type: optionType(k, result.columns, vaultTypes),
  }));
  const layout: LayoutProps = { result, config: parsed.config, view, vaultTypes, host, saveProps, editView, newNote };
  const type = result.views[viewIndex]?.type ?? "table";
  const warnings = result.warnings;

  return (
    <div className="base-view">
      <BaseToolbar
        result={result}
        viewIndex={viewIndex}
        onSwitch={(name) => {
          setActiveView(key, name);
          setActiveName(name);
        }}
        editView={editView}
        toast={host.toast}
        tools={
          <>
            <SortPopover view={view} options={options} editView={editView} {...toolOpen("sort")} />
            <FilterPopover view={view} options={options} editView={editView} {...toolOpen("filter")} />
            <PropertiesPopover view={view} options={options} editView={editView} {...toolOpen("properties")} />
            <button type="button" className="btn base-btn" aria-label="New note" onClick={() => void newNote()}>
              <PlusIcon aria-hidden />
              <span className="base-btn-text">New</span>
            </button>
          </>
        }
      />
      {error ? <p className="base-warn">Could not refresh: {error}</p> : null}
      {warnings.length > 0 ? (
        <p className="base-warn">
          {warnings.slice(0, 3).join(" · ")}
          {warnings.length > 3 ? ` · +${warnings.length - 3} more` : ""}
        </p>
      ) : null}
      {result.groups.every((g) => g.rows.length === 0) && type !== "kanban" ? (
        <p className="base-empty">No notes match this view.</p>
      ) : type === "table" ? (
        <TableView {...layout} />
      ) : type === "cards" ? (
        <CardsView {...layout} />
      ) : type === "list" ? (
        <ListView {...layout} />
      ) : type === "kanban" ? (
        <KanbanView {...layout} />
      ) : (
        <p className="base-empty">The {type} layout is not supported yet. The view keeps its settings.</p>
      )}
    </div>
  );
}

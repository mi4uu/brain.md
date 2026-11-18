import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { quadtree, type Quadtree } from "d3-quadtree";

export interface GraphNodeInput {
  id: string;
  title: string;
  folder: string;
  tags: string[];
}

export interface GraphInput {
  nodes: GraphNodeInput[];
  links: Array<{ source: string; target: string }>;
}

export interface GraphOptions {
  onOpen: (id: string) => void;
  focusId?: string | null;
  // Labels always on (small local graphs) instead of only when zoomed in.
  alwaysLabels?: boolean;
  // Every folder in the vault, so a filtered or local graph keeps the
  // colours of the full one.
  folders?: string[];
}

interface SimNode extends SimulationNodeDatum, GraphNodeInput {
  degree: number;
  r: number;
  color: string;
}

type SimLink = SimulationLinkDatum<SimNode>;

interface Theme {
  bg: string;
  edge: string;
  edgeHi: string;
  text: string;
  textDim: string;
  focus: string;
  palette: string[];
}

const PALETTE_VARS = Array.from({ length: 8 }, (_, i) => `--graph-${i + 1}`);

function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--graph-bg", "#ffffff"),
    edge: v("--graph-edge", "rgba(128,128,128,0.25)"),
    edgeHi: v("--graph-edge-hi", "rgba(110,86,207,0.8)"),
    text: v("--graph-text", "#1a1a1a"),
    textDim: v("--graph-text-dim", "rgba(128,128,128,0.6)"),
    focus: v("--graph-focus", "#6e56cf"),
    palette: PALETTE_VARS.map((n, i) => v(n, ["#6e56cf", "#0d9488", "#d97706", "#e11d48", "#0284c7", "#65a30d", "#9333ea", "#ea580c"][i]!)),
  };
}

// Framework-free force-directed graph on a 2D canvas: pan (drag empty
// space), zoom (wheel, pinch), drag nodes, hover highlights neighbours,
// click opens. The web app and the MCP Apps view both mount it.
export class GraphEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private theme: Theme;
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private neighbours = new Map<string, Set<string>>();
  private tree: Quadtree<SimNode> | null = null;
  private sim: Simulation<SimNode, SimLink> | null = null;
  private folderColors = new Map<string, string>();
  private t = { x: 0, y: 0, k: 1 };
  private width = 0;
  private height = 0;
  private hover: SimNode | null = null;
  private dragNode: SimNode | null = null;
  private panStart: { x: number; y: number; tx: number; ty: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; k: number; cx: number; cy: number } | null = null;
  private moved = 0;
  private fitted = false;
  private userMoved = false;
  private frame = 0;
  private readonly ro: ResizeObserver;
  private readonly mo: MutationObserver;
  private readonly mq: MediaQueryList;

  constructor(
    private readonly host: HTMLElement,
    private options: GraphOptions,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "graph-canvas";
    this.canvas.style.touchAction = "none";
    host.append(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not available");
    this.ctx = ctx;
    this.theme = readTheme(host);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.mo = new MutationObserver(() => this.refreshTheme());
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    this.mq = matchMedia("(prefers-color-scheme: dark)");
    this.mq.addEventListener("change", this.refreshTheme);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.resize();
  }

  setOptions(options: Partial<GraphOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.folders) {
      this.assignColors(this.nodes.map((n) => n.folder));
      for (const n of this.nodes) n.color = this.folderColors.get(n.folder) ?? this.theme.palette[0]!;
    }
    this.requestDraw();
  }

  setData(data: GraphInput): void {
    const old = new Map(this.nodes.map((n) => [n.id, n]));
    const degree = new Map<string, number>();
    for (const l of data.links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
    this.assignColors(data.nodes.map((n) => n.folder));
    this.nodes = data.nodes.map((n) => {
      const prev = old.get(n.id);
      const d = degree.get(n.id) ?? 0;
      return {
        ...n,
        degree: d,
        r: 3 + Math.sqrt(d) * 1.8,
        color: this.folderColors.get(n.folder) ?? this.theme.palette[0]!,
        x: prev?.x,
        y: prev?.y,
        vx: prev?.vx,
        vy: prev?.vy,
      };
    });
    const ids = new Set(this.nodes.map((n) => n.id));
    this.links = data.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));
    this.neighbours = new Map(this.nodes.map((n) => [n.id, new Set<string>()]));
    for (const l of data.links) {
      this.neighbours.get(l.source)?.add(l.target);
      this.neighbours.get(l.target)?.add(l.source);
    }
    this.hover = null;
    this.startSimulation(old.size === 0);
  }

  folderLegend(): Array<{ folder: string; color: string }> {
    const shown = new Set(this.nodes.map((n) => n.folder));
    return [...this.folderColors].filter(([f]) => shown.has(f)).map(([folder, color]) => ({ folder, color }));
  }

  private assignColors(present: string[]): void {
    const folders = [...new Set([...(this.options.folders ?? []), ...present])].sort();
    this.folderColors = new Map(folders.map((f, i) => [f, this.theme.palette[i % this.theme.palette.length]!]));
  }

  zoomToFit(padding = 40): void {
    if (this.nodes.length === 0 || this.width === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, (n.x ?? 0) - n.r);
      minY = Math.min(minY, (n.y ?? 0) - n.r);
      maxX = Math.max(maxX, (n.x ?? 0) + n.r);
      maxY = Math.max(maxY, (n.y ?? 0) + n.r);
    }
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const k = Math.min((this.width - padding * 2) / w, (this.height - padding * 2) / h, 2.5);
    this.t = { k, x: this.width / 2 - ((minX + maxX) / 2) * k, y: this.height / 2 - ((minY + maxY) / 2) * k };
    this.requestDraw();
  }

  destroy(): void {
    this.sim?.stop();
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.mo.disconnect();
    this.mq.removeEventListener("change", this.refreshTheme);
    this.canvas.remove();
  }

  private startSimulation(fresh: boolean): void {
    this.sim?.stop();
    const n = this.nodes.length;
    const sim = forceSimulation<SimNode, SimLink>(this.nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(this.links)
          .id((d) => d.id)
          .distance(40)
          .strength(0.4),
      )
      .force("charge", forceManyBody<SimNode>().strength(n > 1500 ? -40 : -90).distanceMax(400))
      .force("center", forceCenter(0, 0))
      // Gentle pull keeps unlinked notes in a ring around the clusters
      // instead of drifting off to infinity.
      .force("x", forceX<SimNode>(0).strength(0.04))
      .force("y", forceY<SimNode>(0).strength(0.04))
      .force("collide", forceCollide<SimNode>((d) => d.r + 2))
      .alphaDecay(n > 1500 ? 0.05 : 0.0228)
      .on("tick", () => {
        this.tree = null;
        if (!this.fitted && !this.userMoved && sim.alpha() < 0.3) {
          this.fitted = true;
          this.zoomToFit();
        }
        this.requestDraw();
      })
      .on("end", () => {
        if (!this.userMoved) this.zoomToFit();
        this.host.dispatchEvent(new CustomEvent("graphsettled", { detail: { nodes: this.nodes.length } }));
      });
    if (!fresh) sim.alpha(0.3);
    this.fitted = !fresh;
    this.sim = sim;
  }

  private readonly refreshTheme = (): void => {
    this.theme = readTheme(this.host);
    this.assignColors(this.nodes.map((n) => n.folder));
    for (const n of this.nodes) n.color = this.folderColors.get(n.folder) ?? this.theme.palette[0]!;
    this.requestDraw();
  };

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const first = this.width === 0;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    if (first) this.t = { x: rect.width / 2, y: rect.height / 2, k: 1 };
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private activeId(): string | null {
    return this.dragNode?.id ?? this.hover?.id ?? null;
  }

  private draw(): void {
    const { ctx, theme } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.setTransform(dpr * this.t.k, 0, 0, dpr * this.t.k, dpr * this.t.x, dpr * this.t.y);

    const active = this.activeId();
    const near = active ? (this.neighbours.get(active) ?? new Set<string>()) : null;
    const lit = (id: string) => !near || id === active || near.has(id);

    ctx.lineWidth = 1 / this.t.k;
    ctx.strokeStyle = theme.edge;
    ctx.beginPath();
    for (const l of this.links) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      if (near && (s.id === active || t.id === active)) continue;
      ctx.moveTo(s.x ?? 0, s.y ?? 0);
      ctx.lineTo(t.x ?? 0, t.y ?? 0);
    }
    ctx.globalAlpha = near ? 0.25 : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (near) {
      ctx.strokeStyle = theme.edgeHi;
      ctx.lineWidth = 1.6 / this.t.k;
      ctx.beginPath();
      for (const l of this.links) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (s.id !== active && t.id !== active) continue;
        ctx.moveTo(s.x ?? 0, s.y ?? 0);
        ctx.lineTo(t.x ?? 0, t.y ?? 0);
      }
      ctx.stroke();
    }

    const focus = this.options.focusId ?? null;
    for (const n of this.nodes) {
      ctx.globalAlpha = lit(n.id) ? 1 : 0.18;
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      if (n.id === focus || n.id === active) {
        ctx.lineWidth = 2.5 / this.t.k;
        ctx.strokeStyle = theme.focus;
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, n.r + 3 / this.t.k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const showAll = this.options.alwaysLabels || this.t.k >= 1.4;
    const fontPx = 11 / this.t.k;
    ctx.font = `${fontPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const n of this.nodes) {
      const important = n.id === focus || n.id === active || (near?.has(n.id) ?? false);
      if (!showAll && !important && !(this.t.k >= 0.9 && n.degree >= 6)) continue;
      ctx.fillStyle = lit(n.id) ? theme.text : theme.textDim;
      ctx.fillText(n.title, n.x ?? 0, (n.y ?? 0) + n.r + 2 / this.t.k);
    }
  }

  private toGraph(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.t.x) / this.t.k, y: (py - this.t.y) / this.t.k };
  }

  private nodeAt(px: number, py: number): SimNode | null {
    if (!this.tree) {
      this.tree = quadtree<SimNode>()
        .x((d) => d.x ?? 0)
        .y((d) => d.y ?? 0)
        .addAll(this.nodes);
    }
    const p = this.toGraph(px, py);
    const found = this.tree.find(p.x, p.y, 12 / this.t.k + 8);
    if (!found) return null;
    const dx = (found.x ?? 0) - p.x;
    const dy = (found.y ?? 0) - p.y;
    return Math.hypot(dx, dy) <= found.r + 6 / this.t.k ? found : null;
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture only keeps drags alive outside the canvas; losing it is harmless.
    }
    this.moved = 0;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: this.t.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.panStart = null;
      this.releaseDrag();
      return;
    }
    const node = this.nodeAt(p.x, p.y);
    if (node) {
      this.dragNode = node;
      node.fx = node.x;
      node.fy = node.y;
    } else {
      this.panStart = { x: p.x, y: p.y, tx: this.t.x, ty: this.t.y };
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (prev) {
      this.moved += Math.hypot(p.x - prev.x, p.y - prev.y);
      this.pointers.set(e.pointerId, p);
    }
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch.dist < 1) this.pinch.dist = Math.max(dist, 1);
      else this.zoomAt(this.pinch.cx, this.pinch.cy, (this.pinch.k * dist) / this.pinch.dist / this.t.k);
      return;
    }
    if (this.dragNode && prev) {
      const g = this.toGraph(p.x, p.y);
      this.dragNode.fx = g.x;
      this.dragNode.fy = g.y;
      if (this.moved > 3) {
        this.userMoved = true;
        this.sim?.alphaTarget(0.2).restart();
      }
      this.requestDraw();
      return;
    }
    if (this.panStart && prev) {
      this.userMoved = true;
      this.t.x = this.panStart.tx + (p.x - this.panStart.x);
      this.t.y = this.panStart.ty + (p.y - this.panStart.y);
      this.requestDraw();
      return;
    }
    const node = this.nodeAt(p.x, p.y);
    if (node !== this.hover) {
      this.hover = node;
      this.canvas.style.cursor = node ? "pointer" : "grab";
      this.requestDraw();
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const clicked = this.dragNode && this.moved < 5 ? this.dragNode : null;
    this.releaseDrag();
    this.panStart = null;
    if (clicked) this.options.onOpen(clicked.id);
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.releaseDrag();
    this.panStart = null;
  };

  private readonly onPointerLeave = (): void => {
    if (this.pointers.size > 0) return;
    if (this.hover) {
      this.hover = null;
      this.requestDraw();
    }
  };

  private releaseDrag(): void {
    if (!this.dragNode) return;
    this.dragNode.fx = null;
    this.dragNode.fy = null;
    this.dragNode = null;
    this.sim?.alphaTarget(0);
    this.requestDraw();
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  };

  private zoomAt(px: number, py: number, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const k = Math.min(8, Math.max(0.05, this.t.k * factor));
    const g = this.toGraph(px, py);
    this.userMoved = true;
    this.t = { k, x: px - g.x * k, y: py - g.y * k };
    this.requestDraw();
  }
}

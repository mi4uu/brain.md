export type SyncOrigin = "editor" | "preview";

interface SyncEvent {
  line: number;
  origin: SyncOrigin;
  cause: "cursor" | "scroll";
}

type Listener = (e: SyncEvent) => void;

export class SyncBus {
  private listeners = new Set<Listener>();
  private lockUntil = 0;
  private lastOrigin: SyncOrigin | null = null;

  emit(e: SyncEvent): void {
    const now = Date.now();
    if (now < this.lockUntil && this.lastOrigin !== null && this.lastOrigin !== e.origin) {
      return;
    }
    this.lockUntil = now + 120;
    this.lastOrigin = e.origin;
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // swallow
      }
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

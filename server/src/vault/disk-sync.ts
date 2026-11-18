import type { VaultIndex } from "../index/index";
import type { RagPipeline } from "../rag/pipeline";

export const DISK_SYNC_MS = 60_000;

// brain.md only hears about changes it makes itself (vault.onMutation).
// Files moved, deleted or edited behind its back (mv, git pull, a sync
// tool, another agent writing straight to disk) are picked up here: the
// note index and the vector store are compared with the disk, so a deleted
// note stops showing up in backlinks, Related and semantic search.
export async function syncWithDisk(
  index: VaultIndex,
  pipeline: RagPipeline | undefined,
): Promise<{ index: { removed: number; updated: number }; rag: { removed: string[]; updated: string[] } }> {
  const idx = await index.reconcile();
  const rag = pipeline ? await pipeline.syncWithDisk() : { removed: [], updated: [] };
  return { index: idx, rag };
}

export function startDiskSync(
  index: VaultIndex,
  pipeline: RagPipeline | undefined,
  intervalMs = DISK_SYNC_MS,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await syncWithDisk(index, pipeline);
      const n = r.index.removed + r.index.updated + r.rag.removed.length + r.rag.updated.length;
      if (n > 0) {
        console.log(
          `[sync] disk changes: index -${r.index.removed} ~${r.index.updated}, vectors -${r.rag.removed.length} ~${r.rag.updated.length}`,
        );
      }
    } catch (e) {
      console.warn("[sync] disk sync failed:", e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

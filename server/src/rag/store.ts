import type { EmbeddedChunk, SearchHit, ProviderId } from "./types";

// Stub — real impl lands in T102 using @lancedb/lancedb.
export class RagStore {
  constructor(
    public readonly dir: string,
    public readonly dim: number,
  ) {}

  async open(): Promise<void> {
    throw new Error("RagStore.open not implemented (T102)");
  }

  async upsert(_rows: EmbeddedChunk[]): Promise<void> {
    throw new Error("RagStore.upsert not implemented (T102)");
  }

  async deleteByPath(_path: string): Promise<void> {
    throw new Error("RagStore.deleteByPath not implemented (T102)");
  }

  async search(_vector: Float32Array, _k: number): Promise<SearchHit[]> {
    throw new Error("RagStore.search not implemented (T102)");
  }

  async countAll(): Promise<number> {
    throw new Error("RagStore.countAll not implemented (T102)");
  }

  async distinctProviderModel(): Promise<
    Array<{ providerId: ProviderId; modelId: string }>
  > {
    throw new Error("RagStore.distinctProviderModel not implemented (T102)");
  }
}

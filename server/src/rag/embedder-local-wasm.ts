// V63: WASM-backed local embedder. Replaces @xenova/transformers (which
// eagerly pulls in onnxruntime-node + sharp, both N-API natives that
// `bun --compile` can't bundle and can't dlopen from bunfs). Uses
// onnxruntime-web (pure WASM, platform-independent) so the prebuilt
// binary works on every target out of the box.
//
// Wire:
//   text → BertTokenizer → InferenceSession.run → mean-pool → L2 norm → Float32Array
//
// First call to ready():
//   1. Extracts ort-wasm-simd-threaded.{wasm,mjs} from bunfs (when
//      running compiled) or node_modules (when running from source) to
//      <cache>/brain.md/wasm/. Sets ort.env.wasm.wasmPaths.
//   2. Extracts vocab.txt to <cache>/brain.md/models/bge-small/.
//   3. Downloads model_quantized.onnx from HuggingFace if missing.
//   4. Constructs the InferenceSession.
//
// Subsequent calls reuse the cached files + session.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Embedder } from "./provider";
import type { LocalProviderConfig } from "./types";
import { BertTokenizer } from "./bert-tokenizer";

// Bundled assets. `with { type: "file" }` makes Bun embed the bytes into
// the compiled binary AND returns a path that fs APIs can read from
// (bunfs presents them as readable real-fs paths). Source builds get the
// same path pointing into node_modules.
// We keep our own copies in `./assets/` (~12MB) so the import path is
// stable across bun's module hoisting and so the embedded asset URLs
// are deterministic in the compiled binary.
import wasmPath from "./assets/ort-wasm-simd-threaded.wasm" with {
  type: "file",
};
import wasmMjsPath from "./assets/ort-wasm-simd-threaded.mjs" with {
  type: "file",
};
// vocab.txt for bge-small is the standard bert-base-uncased vocab. Drop
// it into the binary so the embedder works fully offline once the model
// .onnx is cached on disk.
import vocabPath from "./assets/bge-vocab.txt" with { type: "file" };

interface OrtTensorCtor {
  new (
    type: "int64" | "float32",
    data: BigInt64Array | Float32Array,
    dims: number[],
  ): unknown;
}
interface OrtInferenceSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: number[] }>>;
}
interface OrtModule {
  env: {
    wasm: {
      numThreads: number;
      simd: boolean;
      wasmPaths: string | Record<string, string>;
    };
  };
  Tensor: OrtTensorCtor;
  InferenceSession: {
    create(
      model: Uint8Array,
      opts?: { executionProviders?: string[] },
    ): Promise<OrtInferenceSession>;
  };
}

function cacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg ? join(xdg, "brain.md") : join(homedir(), ".cache", "brain.md");
}

const MODEL_URL =
  "https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main/onnx/model_quantized.onnx";

export class LocalEmbedderWasm implements Embedder {
  readonly providerId = "local" as const;
  readonly modelId: string;
  readonly dim: number;

  private session?: OrtInferenceSession;
  private tokenizer?: BertTokenizer;
  private ort?: OrtModule;
  private readyPromise?: Promise<void>;

  constructor(private readonly cfg: LocalProviderConfig) {
    this.modelId = cfg.model;
    this.dim = cfg.dim;
  }

  async ready(): Promise<void> {
    if (this.session && this.tokenizer) return;
    if (!this.readyPromise) {
      this.readyPromise = this.init();
    }
    await this.readyPromise;
  }

  private async init(): Promise<void> {
    const wasmDir = join(cacheRoot(), "wasm");
    const modelDir = join(cacheRoot(), "models", "bge-small");
    mkdirSync(wasmDir, { recursive: true });
    mkdirSync(modelDir, { recursive: true });

    // 1. Extract WASM runtime to real-fs (bunfs paths can't be passed
    //    to ORT's Worker-based loader on some platforms).
    const wasmReal = join(wasmDir, "ort-wasm-simd-threaded.wasm");
    const wasmMjsReal = join(wasmDir, "ort-wasm-simd-threaded.mjs");
    if (!existsSync(wasmReal)) {
      writeFileSync(wasmReal, readFileSync(wasmPath as unknown as string));
    }
    if (!existsSync(wasmMjsReal)) {
      writeFileSync(wasmMjsReal, readFileSync(wasmMjsPath as unknown as string));
    }

    // 2. Extract vocab + build tokenizer.
    const vocabReal = join(modelDir, "vocab.txt");
    if (!existsSync(vocabReal)) {
      writeFileSync(vocabReal, readFileSync(vocabPath as unknown as string));
    }
    this.tokenizer = new BertTokenizer(readFileSync(vocabReal, "utf8"), {
      lowercase: true,
      maxLen: 512,
    });

    // 3. Fetch model weights (one-time).
    const modelReal = join(modelDir, "model_quantized.onnx");
    if (!existsSync(modelReal)) {
      console.warn(
        `[rag] downloading bge-small model (≈34MB) → ${modelReal} — one-time`,
      );
      const res = await fetch(MODEL_URL);
      if (!res.ok) {
        throw new Error(
          `failed to download embedder model from ${MODEL_URL}: HTTP ${res.status}`,
        );
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      writeFileSync(modelReal, buf);
      console.warn(`[rag] embedder model cached (${buf.length} bytes)`);
    }

    // 4. Load ORT, point at extracted WASM, create session.
    const ortMod = (await import("onnxruntime-web")) as unknown as OrtModule;
    ortMod.env.wasm.numThreads = 1; // workers don't help much for single-text embedding
    ortMod.env.wasm.simd = true;
    ortMod.env.wasm.wasmPaths = wasmDir + "/";
    this.ort = ortMod;

    const modelBytes = readFileSync(modelReal);
    this.session = await ortMod.InferenceSession.create(
      new Uint8Array(modelBytes),
      { executionProviders: ["wasm"] },
    );
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.ready();
    if (!this.session || !this.tokenizer || !this.ort) {
      throw new Error("LocalEmbedderWasm not initialised");
    }
    const out: Float32Array[] = [];
    for (const text of texts) {
      out.push(await this.embedOne(text));
    }
    return out;
  }

  private async embedOne(text: string): Promise<Float32Array> {
    const tk = this.tokenizer!;
    const ort = this.ort!;
    const enc = tk.encode(text);
    const dims = [1, enc.inputIds.length];
    const feeds = {
      input_ids: new ort.Tensor("int64", enc.inputIds, dims),
      attention_mask: new ort.Tensor("int64", enc.attentionMask, dims),
      token_type_ids: new ort.Tensor("int64", enc.tokenTypeIds, dims),
    };
    const out = await this.session!.run(feeds);
    const outName = this.session!.outputNames[0]!;
    const tensor = out[outName]!;
    // last_hidden_state: [1, seqLen, dim]
    const [, seqLen, hidden] = tensor.dims as [number, number, number];
    if (hidden !== this.dim) {
      throw new Error(
        `embedding dim mismatch: got ${hidden}, expected ${this.dim} (model=${this.modelId})`,
      );
    }
    const data = tensor.data;
    const mask = enc.attentionMask;

    // Mean-pool weighted by attention mask, then L2-normalize.
    // bge-small uses CLS pooling per the official model card, but Xenova
    // ships the model with mean-pool as the default for matching their
    // reference embeddings — we mirror that to stay drop-in-compatible.
    const pooled = new Float32Array(hidden);
    let total = 0;
    for (let t = 0; t < seqLen; t++) {
      const m = Number(mask[t]!);
      if (m === 0) continue;
      total += m;
      const base = t * hidden;
      for (let h = 0; h < hidden; h++) {
        pooled[h]! += data[base + h]! * m;
      }
    }
    if (total > 0) {
      for (let h = 0; h < hidden; h++) pooled[h]! /= total;
    }
    let norm = 0;
    for (let h = 0; h < hidden; h++) norm += pooled[h]! * pooled[h]!;
    norm = Math.sqrt(norm) || 1;
    for (let h = 0; h < hidden; h++) pooled[h]! /= norm;
    return pooled;
  }
}

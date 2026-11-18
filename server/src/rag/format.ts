import type { RagConfig } from "./types";

// What the embedder sees. Retrieval models are trained with a prompt on the
// query side and often another on the document side; leaving them out costs
// a lot of quality (the 2026-11 eval: EmbeddingGemma with its prompts and
// the note title in every chunk scored nDCG@10 0.89, plain bge-small 0.61).
// `{text}` is the query or chunk, `{title}` the note's file name.
export interface EmbedFormat {
  query: string;
  document: string;
}

const PLAIN: EmbedFormat = { query: "{text}", document: "{title}\n{text}" };

// Matched against the lowercased model id, first hit wins.
const KNOWN: Array<[RegExp, EmbedFormat]> = [
  [/embeddinggemma/, { query: "task: search result | query: {text}", document: "title: none | text: {title}\n{text}" }],
  [
    /qwen3-embedding|f2llm/,
    {
      query: "Instruct: Given a question, retrieve passages that can help answer the question.\nQuery: {text}",
      document: "{title}\n{text}",
    },
  ],
  [/multilingual-e5|\be5-/, { query: "query: {text}", document: "passage: {title}\n{text}" }],
  [/mmlw/, { query: "zapytanie: {text}", document: "{title}\n{text}" }],
  [/bge-(small|base|large)-en/, { query: "Represent this sentence for searching relevant passages: {text}", document: "{title}\n{text}" }],
  [/nomic-embed/, { query: "search_query: {text}", document: "search_document: {title}\n{text}" }],
];

export function defaultFormat(modelId: string): EmbedFormat {
  const id = modelId.toLowerCase();
  for (const [re, f] of KNOWN) if (re.test(id)) return f;
  return PLAIN;
}

export function activeModelId(cfg: RagConfig): string {
  return cfg.provider === "local" ? cfg.local.model : cfg.openaiCompat.model;
}

export function resolveFormat(cfg: RagConfig): EmbedFormat {
  const d = defaultFormat(activeModelId(cfg));
  // Settings are one-line inputs, so a typed "\n" stands for a newline.
  const own = (t: string | undefined) => (t?.trim() ? t.replaceAll("\\n", "\n") : undefined);
  return {
    query: own(cfg.queryTemplate) ?? d.query,
    document: own(cfg.documentTemplate) ?? d.document,
  };
}

// Part of the store fingerprint: vectors made with one format can't be
// compared with queries made with another.
export function formatId(f: EmbedFormat): string {
  return JSON.stringify([f.query, f.document]);
}

// Function replacers: a string replacement would expand `$&`, `$$` and
// friends inside note text.
export function formatQuery(f: EmbedFormat, text: string): string {
  return f.query.replaceAll("{text}", () => text);
}

export function formatDocument(f: EmbedFormat, path: string, text: string): string {
  const title = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
  return f.document.replaceAll("{title}", () => title).replaceAll("{text}", () => text);
}

// Bun `with { type: "file" }` returns a file path string at import time.
declare module "*.wasm" { const p: string; export default p; }
declare module "*.mjs" { const p: string; export default p; }
declare module "*.txt" { const p: string; export default p; }

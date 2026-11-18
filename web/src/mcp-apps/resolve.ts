export function resolveWikilinkIn(notes: readonly string[], target: string): string | null {
  const stripped = target.trim().replace(/\.md$/i, "");
  if (!stripped) return null;
  if (stripped.includes("/")) {
    const lower = `${stripped}.md`.toLowerCase();
    const hit = notes.find((p) => p.toLowerCase() === lower);
    if (hit) return hit;
  }
  const lower = stripped.toLowerCase();
  return notes.find((p) => (p.split("/").pop() ?? p).replace(/\.md$/i, "").toLowerCase() === lower) ?? null;
}

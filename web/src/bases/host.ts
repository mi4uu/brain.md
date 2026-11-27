// What a mounted view needs from the app around it. Built once in App.tsx
// and kept stable, so Preview can mount views without re-rendering them.
export interface BaseHost {
  currentPath(): string | null;
  // Rewrites the open note: one CodeMirror transaction when the editor is
  // mounted, else the content state. `fn` may throw; nothing is applied then.
  edit(fn: (current: string) => string): void;
  // Rewrites the body of the ```base fence that opens on `startLine`. false when no such fence exists.
  editFence(startLine: number, mutate: (source: string) => string): boolean;
  openNote(path: string): void;
  openLink(target: string, fromPath: string): void;
  noteExists(path: string): boolean;
  createNote(path: string, content: string): Promise<"created" | "exists" | "failed">;
  toast(message: string): void;
}

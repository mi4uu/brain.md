export interface TreeData {
  folders: string[];
  notes: string[];
}

export interface NoteData {
  path: string;
  content: string;
  mtime: number;
  // Optional: older servers don't send it yet. sha256 of the file content,
  // used for optimistic-concurrency writes (see WriteNoteResult).
  revision?: string;
}

export interface WriteNoteResult {
  path: string;
  mtime: number;
  revision?: string;
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  snippet: string;
  matches: number;
}

export interface Backlink {
  from: string;
  lineNo: number;
  context: string;
  embed: boolean;
}

export interface ResolveResult {
  path: string | null;
  matches: string[];
  ambiguous: boolean;
}

export interface MediaUploadResult {
  url: string;
  path: string;
  name: string;
}

export interface RenameResult {
  ok: true;
  patchedFiles: string[];
  totalReplacements: number;
}

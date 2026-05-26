export interface TreeData {
  folders: string[];
  notes: string[];
}

export interface NoteData {
  path: string;
  content: string;
  mtime: number;
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

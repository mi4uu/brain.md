export interface NoteData {
  path: string;
  content: string;
  mtime: number;
  // sha256 hex of `content` as read/written, used for optimistic
  // concurrency on writes (see Vault.writeNoteChecked).
  revision: string;
}

export interface TreeNode {
  folders: string[];
  notes: string[];
}

export interface StatInfo {
  exists: boolean;
  mtime: number;
  isDir: boolean;
}

export class VaultError extends Error {
  constructor(
    message: string,
    public code:
      | "TRAVERSAL"
      | "NOT_FOUND"
      | "NOT_MARKDOWN"
      | "INVALID_PATH"
      | "INVALID_NAME"
      | "EXISTS"
      | "FORBIDDEN"
      | "IO",
  ) {
    super(message);
    this.name = "VaultError";
  }
}

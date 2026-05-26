// Mirror of server's assertSafeBasename rule (§V42). Keep in sync.
const FORBIDDEN = /[/\\%\x00\r\n]/;

export function validateBasename(name: string): string | null {
  if (!name || name.trim() === "") return "Name must not be empty.";
  const trimmed = name.trim();
  if (FORBIDDEN.test(trimmed)) {
    return "Name must not contain / \\ % NUL CR or LF.";
  }
  if (trimmed.startsWith(".")) {
    return 'Name must not start with "." (reserved for control dirs).';
  }
  if (trimmed.length > 200) return "Name too long (max 200 chars).";
  return null;
}

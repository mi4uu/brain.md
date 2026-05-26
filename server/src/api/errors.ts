import { VaultError } from "../vault/types";

export function vaultErrorToStatus(e: VaultError): number {
  switch (e.code) {
    case "TRAVERSAL":
    case "INVALID_PATH":
    case "INVALID_NAME":
    case "NOT_MARKDOWN":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "EXISTS":
      return 409;
    case "IO":
    default:
      return 500;
  }
}

export function asError(e: unknown): { status: number; body: { error: string; code?: string } } {
  if (e instanceof VaultError) {
    return { status: vaultErrorToStatus(e), body: { error: e.message, code: e.code } };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { status: 500, body: { error: msg } };
}

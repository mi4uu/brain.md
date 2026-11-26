import { FrontmatterError, setProperties, type PropValue } from "@brainmd/shared/frontmatter";
import { VaultError, type NoteData } from "../vault/types";
import { NoteConflictError, sha256Hex, type Vault } from "../vault/vault";

const MAX_KEYS = 100;
const MAX_NAME = 200;
const MAX_DEPTH = 8;
const MAX_ITEMS = 1000;

export interface UpdatePropertiesInput {
  set?: Record<string, unknown>;
  unset?: string[];
  baseRevision?: string;
}

function checkName(name: string): void {
  if (name === "" || name.length > MAX_NAME || name === "__proto__" || /[\r\n]/.test(name)) {
    throw new VaultError(`invalid property name: ${JSON.stringify(name.slice(0, 40))}`, "INVALID_VALUE");
  }
}

function checkValue(v: unknown, depth = 0): PropValue {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (depth >= MAX_DEPTH) throw new VaultError("property value is nested too deeply", "INVALID_VALUE");
  if (Array.isArray(v)) {
    if (v.length > MAX_ITEMS) throw new VaultError("property list is too long", "INVALID_VALUE");
    return v.map((x) => checkValue(x, depth + 1));
  }
  if (typeof v === "object") {
    const out: Record<string, PropValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      checkName(k);
      out[k] = checkValue(x, depth + 1);
    }
    return out;
  }
  throw new VaultError("property values must be JSON: string, number, boolean, null, list or map", "INVALID_VALUE");
}

// The one write path for property edits, shared by PATCH /api/note-properties
// and the update_properties MCP tool. It edits under the note's write lock,
// so concurrent writers queue instead of losing each other's change.
// `canRead` is false for a write-only caller: YAML errors quote the source,
// so their message is replaced by a generic one.
export async function updateProperties(
  vault: Vault,
  path: string,
  input: UpdatePropertiesInput,
  canRead: boolean,
): Promise<NoteData> {
  const set: Record<string, PropValue> = {};
  for (const [name, value] of Object.entries(input.set ?? {})) {
    checkName(name);
    set[name] = checkValue(value);
  }
  const unset = input.unset ?? [];
  for (const name of unset) checkName(name);
  if (Object.keys(set).length + unset.length > MAX_KEYS) {
    throw new VaultError(`too many properties in one call (max ${MAX_KEYS})`, "INVALID_VALUE");
  }
  if (Object.keys(set).length === 0 && unset.length === 0) {
    throw new VaultError("nothing to update: pass set or unset", "INVALID_VALUE");
  }

  const written = await vault.mutateNote(path, (current) => {
    if (current === null) throw new VaultError(`note not found: ${path}`, "NOT_FOUND");
    if (input.baseRevision !== undefined) {
      const revision = sha256Hex(current);
      if (revision !== input.baseRevision) throw new NoteConflictError(path, revision);
    }
    try {
      const next = setProperties(current, set, unset);
      return next === current ? null : next;
    } catch (e) {
      if (e instanceof FrontmatterError && !canRead) {
        throw new FrontmatterError(e.code, "frontmatter is not valid YAML");
      }
      throw e;
    }
  });
  return written ?? vault.readNote(path);
}

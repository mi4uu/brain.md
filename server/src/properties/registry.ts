import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeType, resolveType, type PropertyInfo, type PropertyType, type TypesFile } from "@brainmd/shared/property-types";
import type { VaultIndex } from "../index/index";
import { atomicWrite } from "../vault/atomic-write";
import { assertRealContainment } from "../vault/paths";
import type { Vault } from "../vault/vault";

const OWN_REL = ".brain/types.json";
const OBSIDIAN_REL = ".obsidian/types.json";

async function readJson(vault: Vault, rel: string): Promise<unknown> {
  const abs = vault.abs(rel);
  await assertRealContainment(vault.root, abs);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return undefined;
    throw e;
  }
  return JSON.parse(raw);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function readTypesFile(vault: Vault, rel: string): Promise<Record<string, string> | null> {
  const parsed = await readJson(vault, rel);
  if (parsed === undefined) return null;
  const types = isObject(parsed) ? (parsed as Partial<TypesFile>).types : undefined;
  const out: Record<string, string> = {};
  if (!isObject(types)) return out;
  for (const [name, type] of Object.entries(types)) {
    if (typeof type === "string" && name !== "__proto__") out[name] = type;
  }
  return out;
}

async function readTypesLenient(vault: Vault, rel: string): Promise<Record<string, string>> {
  try {
    return (await readTypesFile(vault, rel)) ?? {};
  } catch {
    return {};
  }
}

// brain.md's own file wins; `.obsidian/types.json` only fills in keys it has
// no entry for. An unknown type string reads as text.
export async function loadTypeOverrides(vault: Vault): Promise<Record<string, PropertyType>> {
  const [own, obsidian] = await Promise.all([
    readTypesLenient(vault, OWN_REL),
    readTypesLenient(vault, OBSIDIAN_REL),
  ]);
  const out: Record<string, PropertyType> = {};
  for (const [name, type] of Object.entries({ ...obsidian, ...own })) out[name] = normalizeType(type);
  return out;
}

let writeQueue: Promise<unknown> = Promise.resolve();

// Read-modify-write of .brain/types.json. Everything except this one entry
// is written back as parsed, including entries and keys this version does
// not understand. A file that exists but is not valid JSON stops the write
// instead of being replaced.
export function saveTypeOverride(vault: Vault, name: string, type: PropertyType): Promise<void> {
  const run = writeQueue.then(async () => {
    const parsed = await readJson(vault, OWN_REL);
    const file = isObject(parsed) ? parsed : {};
    const types = isObject(file.types) ? file.types : {};
    types[name] = type;
    const abs = vault.abs(OWN_REL);
    await mkdir(dirname(abs), { recursive: true });
    await atomicWrite(abs, `${JSON.stringify({ ...file, types }, null, 2)}\n`);
  });
  writeQueue = run.catch(() => {});
  return run;
}

export async function listProperties(
  vault: Vault,
  index: VaultIndex,
  allowed?: (path: string) => boolean,
): Promise<PropertyInfo[]> {
  const overrides = await loadTypeOverrides(vault);
  const visible = (path: string) =>
    (!allowed || allowed(path)) && !index.get(path)?.hidden && !index.visibility?.isHidden(path);
  return index.propertyKeys(visible).map((info) => ({
    ...info,
    type: resolveType(info.name, Object.hasOwn(overrides, info.name) ? overrides[info.name] : undefined, info.type),
  }));
}

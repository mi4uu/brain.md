// Vault-relative path globs: `*` and `?` stay inside one path segment, `**`
// spans segments, `**/` also matches no folder at all. Case-insensitive, so
// `**/secrets/**` also catches `Secrets/`.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

export function globMatcher(globs: readonly string[]): (path: string) => boolean {
  const res = globs.map((g) => g.trim()).filter(Boolean).map(globToRegExp);
  return (path) => res.some((r) => r.test(path));
}

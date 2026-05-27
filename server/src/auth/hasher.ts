// V53: argon2id via Bun's built-in password API. memory cost ~19MiB,
// time cost 2, parallelism 1. No external dep / native build needed.

const OPTS = {
  algorithm: "argon2id" as const,
  memoryCost: 19456, // KiB ≈ 19 MiB
  timeCost: 2,
};

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("password must be a non-empty string");
  }
  return Bun.password.hash(plain, OPTS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (typeof plain !== "string" || typeof hash !== "string") return false;
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}

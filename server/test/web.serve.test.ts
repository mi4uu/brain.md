import { describe, expect, test } from "bun:test";
import { expectedSha256, isSafeTarEntry } from "../src/web/serve";

describe("expectedSha256", () => {
  const sums = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  brain-md-linux-x64",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *web-dist.tar.gz",
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  SHA256SUMS",
  ].join("\n");

  test("finds a plain entry", () => {
    expect(expectedSha256(sums, "brain-md-linux-x64")).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  test("finds an entry marked binary with a leading asterisk", () => {
    expect(expectedSha256(sums, "web-dist.tar.gz")).toBe(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });

  test("returns null for a file not listed", () => {
    expect(expectedSha256(sums, "nope")).toBeNull();
  });

  test("returns null for an empty listing", () => {
    expect(expectedSha256("", "web-dist.tar.gz")).toBeNull();
  });
});

describe("isSafeTarEntry", () => {
  test("accepts ordinary relative paths", () => {
    expect(isSafeTarEntry("index.html")).toBe(true);
    expect(isSafeTarEntry("assets/app.js")).toBe(true);
    expect(isSafeTarEntry("./assets/app.js")).toBe(true);
  });

  test("rejects absolute paths", () => {
    expect(isSafeTarEntry("/etc/passwd")).toBe(false);
  });

  test("rejects windows drive-absolute paths", () => {
    expect(isSafeTarEntry("C:/Windows/System32/evil.dll")).toBe(false);
  });

  test("rejects parent-directory traversal", () => {
    expect(isSafeTarEntry("../../etc/passwd")).toBe(false);
    expect(isSafeTarEntry("assets/../../etc/passwd")).toBe(false);
  });

  test("rejects traversal with backslashes", () => {
    expect(isSafeTarEntry("..\\..\\evil.dll")).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { CSP, expectedSha256, isSafeTarEntry } from "../src/web/serve";

// Codex r2 #17: img-src used to only allow self/data/blob, breaking
// markdown-rendered remote https:// images; and there was no media-src
// at all for the blob-URL audio/video playback path.
describe("CSP", () => {
  test("img-src keeps remote https images working", () => {
    expect(CSP).toMatch(/img-src [^;]*\bhttps:/);
  });

  test("media-src allows blob URLs for protected audio/video", () => {
    expect(CSP).toMatch(/media-src 'self' blob:/);
  });
});

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

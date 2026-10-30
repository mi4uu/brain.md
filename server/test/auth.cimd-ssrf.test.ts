import { describe, it, expect } from "bun:test";
import { CimdResolver } from "../src/auth/cimd";

// Regression: the CIMD client_id resolver must refuse to fetch metadata
// from a hostname that resolves to a private/loopback address, and must
// not re-resolve the hostname a second time right before connecting
// (that second resolution is the DNS-rebinding TOCTOU window).

describe("CimdResolver SSRF guard", () => {
  it("rejects https:// client_id resolving to loopback", async () => {
    const resolver = new CimdResolver();
    await expect(resolver.resolve("https://localhost/client")).rejects.toThrow(
      /private|loopback/,
    );
  });

  it("rejects non-https client_id", async () => {
    const resolver = new CimdResolver();
    await expect(resolver.resolve("http://example.com/client")).rejects.toThrow(
      /https/,
    );
  });
});

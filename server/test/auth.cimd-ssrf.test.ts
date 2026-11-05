import { describe, it, expect } from "bun:test";
import { CimdResolver, isPrivateV4 } from "../src/auth/cimd";

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

describe("isPrivateV4 IANA special-purpose ranges", () => {
  it("blocks 192.0.0.0/24 (IETF protocol assignments, incl. NAT64 well-known prefix)", () => {
    expect(isPrivateV4("192.0.0.1")).toBe(true);
  });

  it("blocks 192.88.99.0/24 (6to4 relay anycast)", () => {
    expect(isPrivateV4("192.88.99.1")).toBe(true);
  });

  it("blocks 198.18.0.0/15 (benchmarking)", () => {
    expect(isPrivateV4("198.18.0.1")).toBe(true);
    expect(isPrivateV4("198.19.255.254")).toBe(true);
  });

  it("does not block addresses outside those ranges", () => {
    expect(isPrivateV4("192.0.1.1")).toBe(false);
    expect(isPrivateV4("192.88.98.1")).toBe(false);
    expect(isPrivateV4("198.20.0.1")).toBe(false);
  });
});

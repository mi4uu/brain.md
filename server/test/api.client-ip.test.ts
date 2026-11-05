import { describe, expect, test } from "bun:test";
import { getClientIp } from "../src/api/client-ip";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/login", { headers });
}

describe("getClientIp", () => {
  test("no server (test harness) and no X-Forwarded-For → unknown", () => {
    expect(getClientIp(req(), null)).toBe("unknown");
  });

  test("no server, X-Forwarded-For present → trusted (mirrors test-harness behaviour)", () => {
    expect(getClientIp(req({ "x-forwarded-for": "9.9.9.9" }), null)).toBe("9.9.9.9");
  });

  test("no server: X-Forwarded-For takes the rightmost entry", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 10.0.0.2" }), null),
    ).toBe("10.0.0.2");
  });

  test("a non-loopback direct peer is trusted and X-Forwarded-For is ignored", () => {
    const server = { requestIP: () => ({ address: "203.0.113.5" }) };
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }), server)).toBe("203.0.113.5");
  });

  test("requestIP returning null falls back to unknown, headers are not trusted by default", () => {
    const server = { requestIP: () => null };
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }), server)).toBe("unknown");
  });

  describe("default (BRAINMD_TRUST_PROXY unset): a loopback peer's headers are never trusted", () => {
    test("loopback peer with X-Forwarded-For set still resolves to the loopback address, not the header", () => {
      const server = { requestIP: () => ({ address: "127.0.0.1" }) };
      expect(getClientIp(req({ "x-forwarded-for": "203.0.113.9" }), server, undefined)).toBe(
        "127.0.0.1",
      );
    });

    test("loopback peer with CF-Connecting-IP set still resolves to the loopback address", () => {
      const server = { requestIP: () => ({ address: "::1" }) };
      expect(getClientIp(req({ "cf-connecting-ip": "203.0.113.9" }), server, undefined)).toBe(
        "::1",
      );
    });

    test("an attacker hitting the real server directly cannot spoof a fresh identity via X-Forwarded-For", () => {
      // Non-loopback peer: the header is ignored regardless of trust config.
      const server = { requestIP: () => ({ address: "198.51.100.1" }) };
      const a = getClientIp(req({ "x-forwarded-for": "1.1.1.1" }), server, "cloudflare");
      const b = getClientIp(req({ "x-forwarded-for": "2.2.2.2" }), server, "cloudflare");
      expect(a).toBe("198.51.100.1");
      expect(b).toBe("198.51.100.1");
    });
  });

  describe("BRAINMD_TRUST_PROXY=cloudflare", () => {
    test("loopback peer (the cloudflared tunnel) → CF-Connecting-IP is trusted", () => {
      const server = { requestIP: () => ({ address: "127.0.0.1" }) };
      expect(
        getClientIp(req({ "cf-connecting-ip": "203.0.113.9" }), server, "cloudflare"),
      ).toBe("203.0.113.9");
    });

    test("loopback peer with no CF-Connecting-IP header falls back to the loopback address", () => {
      const server = { requestIP: () => ({ address: "127.0.0.1" }) };
      expect(getClientIp(req(), server, "cloudflare")).toBe("127.0.0.1");
    });

    test("loopback peer, X-Forwarded-For set but no CF-Connecting-IP: X-Forwarded-For is still not trusted", () => {
      const server = { requestIP: () => ({ address: "127.0.0.1" }) };
      expect(
        getClientIp(req({ "x-forwarded-for": "203.0.113.9" }), server, "cloudflare"),
      ).toBe("127.0.0.1");
    });

    test("a non-loopback peer cannot spoof CF-Connecting-IP even with the opt-in set", () => {
      const server = { requestIP: () => ({ address: "198.51.100.1" }) };
      expect(
        getClientIp(req({ "cf-connecting-ip": "1.2.3.4" }), server, "cloudflare"),
      ).toBe("198.51.100.1");
    });
  });

  describe("BRAINMD_TRUST_PROXY=<trusted proxy IP list>", () => {
    test("peer in the trusted list → rightmost X-Forwarded-For entry not itself a trusted proxy", () => {
      const server = { requestIP: () => ({ address: "10.0.0.5" }) };
      expect(
        getClientIp(
          req({ "x-forwarded-for": "203.0.113.9, 10.0.0.5" }),
          server,
          "10.0.0.5,10.0.0.6",
        ),
      ).toBe("203.0.113.9");
    });

    test("a spoofed leftmost entry cannot change the resolved IP", () => {
      const server = { requestIP: () => ({ address: "10.0.0.5" }) };
      const a = getClientIp(
        req({ "x-forwarded-for": "spoof-a, 198.51.100.9, 10.0.0.5" }),
        server,
        "10.0.0.5",
      );
      const b = getClientIp(
        req({ "x-forwarded-for": "spoof-b, 198.51.100.9, 10.0.0.5" }),
        server,
        "10.0.0.5",
      );
      expect(a).toBe("198.51.100.9");
      expect(b).toBe("198.51.100.9");
    });

    test("peer not in the trusted list → X-Forwarded-For is ignored, falls back to the peer", () => {
      const server = { requestIP: () => ({ address: "127.0.0.1" }) };
      expect(
        getClientIp(req({ "x-forwarded-for": "203.0.113.9" }), server, "10.0.0.5"),
      ).toBe("127.0.0.1");
    });
  });
});

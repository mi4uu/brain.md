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

  test("X-Forwarded-For takes the rightmost entry, the one the trusted proxy appended", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 10.0.0.2" }), null),
    ).toBe("10.0.0.2");
  });

  test("a spoofed leftmost entry cannot change the resolved IP, only the real peer can", () => {
    const server = { requestIP: () => ({ address: "127.0.0.1" }) };
    const a = getClientIp(req({ "x-forwarded-for": "spoof-a, 198.51.100.9" }), server);
    const b = getClientIp(req({ "x-forwarded-for": "spoof-b, 198.51.100.9" }), server);
    expect(a).toBe("198.51.100.9");
    expect(b).toBe("198.51.100.9");
  });

  test("a non-loopback direct peer is trusted and X-Forwarded-For is ignored", () => {
    const server = { requestIP: () => ({ address: "203.0.113.5" }) };
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }), server)).toBe("203.0.113.5");
  });

  test("a loopback direct peer (local reverse proxy) defers to X-Forwarded-For", () => {
    const server = { requestIP: () => ({ address: "127.0.0.1" }) };
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }), server)).toBe("1.2.3.4");
  });

  test("a loopback direct peer with no X-Forwarded-For falls back to the peer address", () => {
    const server = { requestIP: () => ({ address: "::1" }) };
    expect(getClientIp(req(), server)).toBe("::1");
  });

  test("requestIP returning null falls back to X-Forwarded-For", () => {
    const server = { requestIP: () => null };
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }), server)).toBe("1.2.3.4");
  });
});

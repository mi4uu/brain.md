import { describe, it, expect } from "bun:test";
import { validateMetadata } from "../src/auth/cimd";

// Regression: Claude.ai's CIMD declares jwt-bearer among grant_types. We must
// ignore unsupported grants, not reject the whole client (was: invalid_client
// "grant_type not supported: urn:ietf:params:oauth:grant-type:jwt-bearer").
const CID = "https://claude.ai/client";
const base = {
  client_id: CID,
  client_name: "Claude",
  redirect_uris: ["https://claude.ai/callback"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

describe("CIMD grant_types filtering", () => {
  it("drops unsupported grants and keeps supported ones", () => {
    const m = validateMetadata(
      { ...base, grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"] },
      CID,
    );
    expect(m.grant_types).toEqual(["authorization_code", "refresh_token"]);
  });

  it("still requires authorization_code", () => {
    expect(() => validateMetadata({ ...base, grant_types: ["urn:ietf:params:oauth:grant-type:jwt-bearer"] }, CID))
      .toThrow("authorization_code");
  });
});

import { describe, expect, test } from "bun:test";
import { signedInAs } from "../src/auth/api";

describe("signedInAs", () => {
  test("external login shows the email", () => {
    expect(signedInAs({ method: "idp", email: "bob@example.com", name: "Bob" })).toBe("bob@example.com");
  });

  test("external login without an email falls back to the name", () => {
    expect(signedInAs({ method: "idp", name: "Bob" })).toBe("Bob");
  });

  test("password session, or a server that does not send user, shows password", () => {
    expect(signedInAs({ method: "password" })).toBe("password");
    expect(signedInAs(undefined)).toBe("password");
  });
});

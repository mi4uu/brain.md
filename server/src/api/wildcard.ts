// Elysia does NOT URL-decode the `*` wildcard parameter. Routes that
// accept user-controlled path segments must call this to round-trip
// percent-encoded chars (e.g. a filename `ddd%5C.md` arrives over the
// wire as `ddd%255C.md`; without this it would be looked up under the
// raw encoded form and never match).
//
// Note: a filename containing a literal `/` would have been encoded as
// `%2F` by the client and decoded back here, then resolved as a path
// separator. V42 (assertSafeBasename) rejects `/` in basenames, so
// pre-V42 pathological files with `/` in their name remain unreachable
// — by design, those would have been impossible to create cleanly anyway.
export function decodeWildcard(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // malformed percent escape — pass through raw so route's own
    // validators (assertSafePath etc) produce a clean 400
    return raw;
  }
}

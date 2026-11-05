# Contributing

Contributions welcome.

1. Open an issue first for anything non-trivial. A quick design
   sketch saves a long PR rewrite.
2. Write the test before the implementation. Server tests run with
   `bun test`; keep the suite green.
3. Open a PR. CI runs typecheck (server + web) + `bun test`.

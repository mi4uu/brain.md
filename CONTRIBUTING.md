# Contributing

Contributions welcome.

1. Open an issue first for anything non-trivial. A quick design
   sketch saves a long PR rewrite.
2. Write the test before the implementation. `bun run test` runs the
   server suite, `bun run test:web` the web one; keep both green.
3. Run `bun run lint` and `bun run typecheck` before you push.
4. Open a PR. CI runs lint, typecheck (server + web) and both test suites.

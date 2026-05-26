import { Elysia, t } from "elysia";
import type { SettingsStore } from "../settings/settings";
import type { Autocommit } from "../git/autocommit";
import { asError } from "./errors";

export function settingsRoutes(settings: SettingsStore, autocommit: Autocommit) {
  return new Elysia({ prefix: "/api/settings" })
    .get("/", () => settings.get())
    .patch(
      "/",
      async ({ body, set }) => {
        try {
          const next = await settings.patch(body);
          // sync to runtime autocommit
          autocommit.setEnabled(next.git.autocommit);
          autocommit.setDebounceMs(next.git.debounceMs);
          return next;
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          bookmarks: t.Optional(t.Array(t.String())),
          dailyDir: t.Optional(t.String()),
          git: t.Optional(
            t.Object({
              autocommit: t.Optional(t.Boolean()),
              debounceMs: t.Optional(t.Number()),
            }),
          ),
        }),
      },
    );
}

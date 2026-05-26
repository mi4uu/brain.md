import { useEffect, useState } from "react";
import type { Theme } from "../hooks/useTheme";
import { gitApi } from "../api/git";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

interface Props {
  onClose: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  dailyDir: string;
  setDailyDir: (s: string) => void;
}

export function Settings({
  onClose,
  theme,
  setTheme,
  dailyDir,
  setDailyDir,
}: Props) {
  const [acEnabled, setAcEnabled] = useState<boolean>(true);
  const [acDebounce, setAcDebounce] = useState<number>(15000);
  const [acError, setAcError] = useState<string | null>(null);
  const [gitEnabled, setGitEnabled] = useState<boolean>(false);

  useEffect(() => {
    void gitApi
      .status()
      .then((s) => {
        setGitEnabled(s.enabled);
        setAcEnabled(s.autocommit.enabled);
        setAcDebounce(s.autocommit.debounceMs);
      })
      .catch(() => {
        setGitEnabled(false);
      });
  }, []);

  const saveAutocommit = async (next: {
    enabled?: boolean;
    debounceMs?: number;
  }) => {
    try {
      const res = await gitApi.setAutocommit(next);
      setAcEnabled(res.enabled);
      setAcDebounce(res.debounceMs);
      setAcError(null);
    } catch (e) {
      setAcError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Vault, editor, git, and appearance preferences.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="appearance" className="mt-2">
          <TabsList>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="vault">Vault</TabsTrigger>
            <TabsTrigger value="git">Git</TabsTrigger>
            <TabsTrigger value="editor">Editor</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="space-y-4 pt-2">
            <Field label="Theme">
              <select
                className="input"
                value={theme}
                onChange={(e) => setTheme(e.target.value as Theme)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Field>
          </TabsContent>

          <TabsContent value="vault" className="space-y-4 pt-2">
            <Field label="Daily notes folder">
              <input
                className="input"
                value={dailyDir}
                onChange={(e) => setDailyDir(e.target.value)}
                placeholder="Journal"
              />
            </Field>
          </TabsContent>

          <TabsContent value="git" className="space-y-4 pt-2">
            {!gitEnabled ? (
              <p className="text-sm text-fg-3">
                Git not initialised in vault. Restart server with{" "}
                <code className="rounded-1 bg-code px-1 py-0.5 font-mono text-xs">
                  GIT_AUTOCOMMIT=1
                </code>{" "}
                to enable.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm text-fg-1">
                  <input
                    type="checkbox"
                    checked={acEnabled}
                    onChange={(e) =>
                      void saveAutocommit({ enabled: e.target.checked })
                    }
                  />
                  <span>Autocommit changes</span>
                </label>
                <Field label="Debounce (ms)">
                  <input
                    className="input"
                    type="number"
                    min={500}
                    step={500}
                    value={acDebounce}
                    onChange={(e) => setAcDebounce(Number(e.target.value))}
                    onBlur={() =>
                      void saveAutocommit({ debounceMs: acDebounce })
                    }
                  />
                </Field>
                {acError ? (
                  <p className="text-sm text-callout-danger">{acError}</p>
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="editor" className="space-y-4 pt-2">
            <p className="text-sm text-fg-3">No editor preferences yet.</p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-fg-3">{label}</span>
      {children}
    </label>
  );
}

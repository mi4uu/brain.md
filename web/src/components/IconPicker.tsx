import { useState } from "react";
import { ICONS, IconBare } from "./FolderIconCatalog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";

interface Props {
  folderPath: string;
  currentIcon: string | null;
  onSave: (icon: string | null) => void;
  onClose: () => void;
}

// Note: spec T81 named Popover, but picker is launched from a context menu
// item with no row anchor — Dialog preserves current UX. ScrollArea covers
// the catalog grid per spec.
export function IconPicker({
  folderPath,
  currentIcon,
  onSave,
  onClose,
}: Props) {
  const [emoji, setEmoji] = useState(
    currentIcon?.startsWith("emoji:") ? currentIcon.slice(6) : "",
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Folder icon</DialogTitle>
          <DialogDescription className="truncate">
            {folderPath}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[40vh] rounded-2 border border-border">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-1 p-2">
            {ICONS.map((it) => (
              <button
                key={it.key}
                type="button"
                title={it.label}
                aria-label={`Set icon: ${it.label}`}
                onClick={() => onSave(it.key)}
                className={`flex aspect-square items-center justify-center rounded-1 transition-colors duration-fast ${
                  currentIcon === it.key
                    ? "bg-accent-soft text-accent"
                    : "text-fg-2 hover:bg-hover hover:text-fg-1"
                }`}
              >
                <IconBare iconKey={it.key} size={22} />
              </button>
            ))}
          </div>
        </ScrollArea>

        <fieldset className="rounded-2 border border-border px-3 py-2">
          <legend className="px-1 text-xs uppercase tracking-wide text-fg-3">
            Custom emoji
          </legend>
          <div className="flex items-center gap-2">
            <input
              className="input w-24 text-center"
              maxLength={4}
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="📓"
              style={{ fontSize: "var(--text-md)" }}
            />
            <button
              type="button"
              className="rounded-1 bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
              disabled={emoji.trim() === ""}
              onClick={() => onSave(`emoji:${emoji.trim()}`)}
            >
              Use emoji
            </button>
          </div>
        </fieldset>

        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => onSave(null)}
            className="rounded-1 px-3 py-1 text-sm text-fg-2 hover:bg-hover"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-1 px-3 py-1 text-sm text-fg-2 hover:bg-hover"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

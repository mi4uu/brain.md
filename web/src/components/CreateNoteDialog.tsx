import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

interface Props {
  path: string;
  onCreate: () => Promise<void>;
  onClose: () => void;
}

// Clicking a link to a note that doesn't exist asks first: creating the
// file straight away is how vaults fill up with empty notes from typos.
export function CreateNoteDialog({ path, onCreate, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create this note?</DialogTitle>
          <DialogDescription className="break-all">{path}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-fg-2">There is no note with this name yet. It will be created as an empty note.</p>
        <DialogFooter>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-1 px-3 py-1 text-sm text-fg-2 hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onCreate().finally(() => setBusy(false));
            }}
            className="rounded-1 bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
          >
            Create
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

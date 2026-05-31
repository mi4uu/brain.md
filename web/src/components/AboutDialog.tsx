import {
  HeartFilledIcon,
  ExternalLinkIcon,
  GitHubLogoIcon,
} from "@radix-ui/react-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const VERSION = "0.4.3";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="items-center text-center">
          <img
            src="/brainmdlogo.png"
            alt=""
            width={56}
            height={56}
            className="mb-1"
          />
          <DialogTitle className="text-lg">brain.md</DialogTitle>
          <DialogDescription>
            A local-first second brain for you — and for your AI agents.
            <br />
            <span className="text-xs text-fg-4">
              v{VERSION} · AGPL-3.0-or-later
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <span className="text-fg-3">Built by</span>
          <ExtLink href="https://lipinski.work/">
            Michał Lipiński · lipinski.work
          </ExtLink>

          <span className="text-fg-3">Repository</span>
          <ExtLink href="https://github.com/mi4uu/brain.md" icon="gh">
            github.com/mi4uu/brain.md
          </ExtLink>

          <span className="text-fg-3">Docs</span>
          <ExtLink href="https://github.com/mi4uu/brain.md/blob/main/docs/mcp.md">
            MCP reference
          </ExtLink>

          <span className="text-fg-3">Issues</span>
          <ExtLink href="https://github.com/mi4uu/brain.md/issues/new">
            Report a bug
          </ExtLink>
        </div>

        <a
          href="https://github.com/sponsors/mi4uu"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-2 border border-border bg-surface-alt px-3 py-2 text-sm font-medium text-fg-1 transition-colors duration-fast hover:bg-hover"
        >
          <HeartFilledIcon className="text-pink-500" />
          Sponsor brain.md on GitHub
        </a>
      </DialogContent>
    </Dialog>
  );
}

function ExtLink({
  href,
  children,
  icon,
}: {
  href: string;
  children: React.ReactNode;
  icon?: "gh";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-link hover:underline"
    >
      {icon === "gh" ? <GitHubLogoIcon className="h-3.5 w-3.5" /> : null}
      <span>{children}</span>
      <ExternalLinkIcon className="h-3 w-3 opacity-60" />
    </a>
  );
}

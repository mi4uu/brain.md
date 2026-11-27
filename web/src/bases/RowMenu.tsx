import type { ReactNode } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import type { BaseHost } from "./host";
import type { Row } from "./types";

// Events bubble through the portal to the parent row or card, so the menu stops them.
// The keyboard and touch twin of every drag and hover action on a row.
export function RowMenu({ row, host, children }: { row: Row; host: BaseHost; children?: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn base-btn icon base-more" aria-label={`Actions for ${row.title || row.path}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DotsHorizontalIcon aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => host.openNote(row.path)}>Open note</DropdownMenuItem>
        {children ? <DropdownMenuSeparator /> : null}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

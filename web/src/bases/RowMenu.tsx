import type { ReactNode } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import type { BaseHost } from "./host";
import type { Row } from "./types";

// The keyboard and touch twin of every drag and hover action on a row.
export function RowMenu({ row, host, children }: { row: Row; host: BaseHost; children?: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn base-btn icon base-more" aria-label={`Actions for ${row.title}`} onClick={(e) => e.stopPropagation()}>
          <DotsHorizontalIcon aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => host.openNote(row.path)}>Open note</DropdownMenuItem>
        {children ? <DropdownMenuSeparator /> : null}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

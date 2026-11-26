import type { PropertyType } from "@brainmd/shared/property-types";
import { CHOOSABLE_TYPES, TYPE_META } from "../../properties/type-meta";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface Props {
  name: string;
  type: PropertyType;
  onPick: (type: PropertyType) => void;
}

// The type icon of a row. Clicking it changes the type for this name across
// the vault; tags and aliases are fixed, so their icon is not a button.
export function TypeButton({ name, type, onPick }: Props) {
  const { Icon, label } = TYPE_META[type];
  if (type === "tags" || type === "aliases") {
    return (
      <span className="prop-type" title={label} role="img" aria-label={`${name}: ${label}`}>
        <Icon width={14} height={14} />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="prop-type prop-type-btn" title={`${label}: change type`} aria-label={`${name} type: ${label}`}>
          <Icon width={14} height={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={type} onValueChange={(v) => onPick(v as PropertyType)}>
          {CHOOSABLE_TYPES.map((t) => {
            const meta = TYPE_META[t];
            return (
              <DropdownMenuRadioItem key={t} value={t}>
                <meta.Icon width={14} height={14} />
                <span className="ml-2">{meta.label}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

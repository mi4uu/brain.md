import { useRef, useState } from "react";
import { Command } from "cmdk";
import type { PropertyInfo, PropertyType } from "@brainmd/shared/property-types";
import { TYPE_META } from "../../properties/type-meta";
import { PlusIcon } from "../Icons";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface Props {
  infos: PropertyInfo[];
  // Names this note already has.
  existing: Set<string>;
  onOpen: () => void;
  onAdd: (name: string, type: PropertyType) => void;
}

export function AddProperty({ infos, existing, onOpen, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickedRef = useRef(false);
  const typed = query.trim();
  const candidates = infos.filter((i) => !existing.has(i.name));
  const canCreate =
    typed !== "" && typed !== "__proto__" && !existing.has(typed) && !infos.some((i) => i.name === typed);

  const pick = (name: string, type: PropertyType) => {
    pickedRef.current = true;
    setOpen(false);
    onAdd(name, type);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        if (next) onOpen();
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="props-add" data-prop-add>
          <PlusIcon width={14} height={14} />
          <span>Add property</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="props-add-pop"
        onCloseAutoFocus={(e) => {
          if (pickedRef.current) {
            e.preventDefault();
            pickedRef.current = false;
          }
        }}
      >
        <Command label="Add property">
          <Command.Input
            className="props-add-input"
            placeholder="Property name"
            value={query}
            onValueChange={setQuery}
          />
          <Command.List className="props-add-list">
            <Command.Empty className="props-add-empty">No matching property</Command.Empty>
            {candidates.map((i) => {
              const Icon = TYPE_META[i.type].Icon;
              return (
                <Command.Item
                  key={i.name}
                  value={i.name}
                  className="props-add-item"
                  onSelect={() => pick(i.name, i.type)}
                >
                  <Icon width={14} height={14} />
                  <span className="props-add-name">{i.name}</span>
                  <span className="props-add-count">{i.count}</span>
                </Command.Item>
              );
            })}
            {canCreate ? (
              <Command.Item
                forceMount
                value={`create:${typed}`}
                className="props-add-item"
                onSelect={() => pick(typed, "text")}
              >
                <PlusIcon width={14} height={14} />
                <span className="props-add-name">Create "{typed}"</span>
              </Command.Item>
            ) : null}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

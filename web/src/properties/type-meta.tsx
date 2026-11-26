import type { ComponentType, SVGProps } from "react";
import type { PropertyType } from "@brainmd/shared/property-types";
import {
  CalendarIcon,
  CheckSquareIcon,
  TagIcon,
  TypeAliasIcon,
  TypeClockIcon,
  TypeListIcon,
  TypeNumberIcon,
  TypeTextIcon,
} from "../components/Icons";

interface TypeMeta {
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const TYPE_META: Record<PropertyType, TypeMeta> = {
  text: { label: "Text", Icon: TypeTextIcon },
  multitext: { label: "List", Icon: TypeListIcon },
  number: { label: "Number", Icon: TypeNumberIcon },
  checkbox: { label: "Checkbox", Icon: CheckSquareIcon },
  date: { label: "Date", Icon: CalendarIcon },
  datetime: { label: "Date & time", Icon: TypeClockIcon },
  tags: { label: "Tags", Icon: TagIcon },
  aliases: { label: "Aliases", Icon: TypeAliasIcon },
};

// What a person can pick; tags and aliases are fixed by name.
export const CHOOSABLE_TYPES: PropertyType[] = ["text", "multitext", "number", "checkbox", "date", "datetime"];
